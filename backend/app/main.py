"""FastAPI application — the TH-Labs dubbing API.

Endpoints
    GET  /api/health            → mode + per-stage engine status      (public)
    GET  /api/languages         → supported languages                 (public)
    GET  /api/session           → who the bearer token belongs to     (auth)
    POST /api/jobs              → create a dubbing job (upload, source_url, or sample=1)
    GET  /api/jobs/{id}         → job snapshot                        (auth, owner)
    GET  /api/jobs/{id}/events  → SSE live pipeline progress          (auth, owner)
    /media/...                  → served source & dubbed media

Auth: everything under /api/jobs requires a bearer token issued by the NestJS
account API — see app/auth.py. health and languages stay public so the landing
page and uptime checks can read status without a session.
"""
from __future__ import annotations

import json
import logging
import threading
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import __version__, billing, languages
from .auth import StudioUser, require_user, require_user_sse
from .config import get_settings
from .logging_config import setup_logging

# Before anything else imports a module-level logger, so the pipeline's trace
# actually reaches Modal's log stream.
setup_logging()
from .jobs import manager, new_job_id
from .pipeline import fetch, media
from .schemas import (DubOptions, HealthInfo, JobBilling, JobStatus, Quality,
                      StageInfo)

settings = get_settings()
log = logging.getLogger(__name__)

_UPLOAD_CHUNK = 1024 * 1024      # 1 MiB: streamed upload copy buffer


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Pre-warm the STT + NMT models in the background (auto/real modes) so the
    # first real job doesn't pay the ~30 s cold-load cost mid-request.
    if settings.mode != "demo":
        def warm() -> None:
            try:
                orch = manager.orchestrator
                # Probe OmniVoice FIRST. available() does a real
                # `from omnivoice import OmniVoice` the first time (it caches
                # the result), which drags in transformers + torch and takes
                # tens of seconds. /api/health calls available() on every
                # stage, so without warming it here the first health request
                # pays that cost inline — painfully obvious on a cold cloud
                # container, where it can look like the app is hanging.
                orch.tts.available()
                if orch.stt.available():
                    orch.stt._load("small")     # the default (Balanced) model
                    if orch.stt._vad.available():
                        orch.stt._vad._load()
                if orch.nmt.available():
                    orch.nmt._load()
                if orch.cloner.available():
                    orch.cloner._load()
            except Exception:
                pass
        threading.Thread(target=warm, daemon=True).start()
    yield


app = FastAPI(title=settings.app_name, version=__version__, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# serve uploads + outputs (source and dubbed videos)
app.mount("/media", StaticFiles(directory=str(settings.data_dir)), name="media")


@app.get("/api/health", response_model=HealthInfo)
def health() -> HealthInfo:
    stages = [StageInfo(**s) for s in manager.orchestrator.stage_info()]
    return HealthInfo(
        app=settings.app_name, version=__version__, mode=settings.mode,
        ffmpeg=bool(settings.ffmpeg), billing=billing.enabled(), stages=stages,
    )


@app.get("/api/languages")
def get_languages() -> dict:
    return {"languages": languages.all_dicts()}


@app.get("/api/session")
def session(user: StudioUser = Depends(require_user)) -> dict:
    """Echo the identity behind the bearer token.

    The Studio calls this on boot to decide whether it has a live session, and
    to render who is signed in. It is the cheapest possible authenticated
    round-trip — no database, just the verified claims.
    """
    return {"user": {"id": user.id, "email": user.email, "role": user.role}}


@app.post("/api/jobs")
async def create_job(
    target_lang: str = Form(...),
    source_lang: str = Form("auto"),
    voice_clone: bool = Form(True),
    lip_sync: bool = Form(False),
    keep_background: bool = Form(True),
    quality: Quality = Form(Quality.balanced),
    sample: bool = Form(False),
    file: UploadFile | None = File(None),
    source_url: str | None = Form(None),
    user: StudioUser = Depends(require_user),
) -> dict:
    """Create a dubbing job from an upload, a pasted link, or the sample clip.

    The three sources are mutually exclusive and resolved in that order of
    precedence — a request carrying both a file and a `source_url` is a client
    bug, and picking one silently is how the user ends up dubbing the wrong
    thing, so it is a 400.
    """
    if not languages.get(target_lang):
        raise HTTPException(400, f"Unsupported target language: {target_lang}")

    source_url = (source_url or "").strip() or None
    if file is not None and source_url:
        raise HTTPException(
            400, "Send either a file or a source_url, not both.")

    options = DubOptions(
        source_lang=source_lang, target_lang=target_lang,
        voice_clone=voice_clone, lip_sync=lip_sync,
        keep_background=keep_background, quality=quality,
    )

    scenario = "lecture"
    filename: str | None = None
    force_simulate = False

    if source_url and not sample:
        # Fetch the link to disk first, then run the normal pipeline on it —
        # from here down a link job is indistinguishable from an upload. The
        # fetcher vets the URL (scheme, public address, size, duration) and
        # raises SourceFetchError with a message written for the user, which is
        # passed through verbatim: "that video is private" is actionable in a
        # way "400 Bad Request" is not.
        #
        # Off the event loop: download_source is blocking socket I/O and can run
        # for minutes on a large video. Called inline in this async handler it
        # would freeze every other request — health checks, SSE progress streams
        # for jobs already running — for the whole download.
        try:
            input_video, title = await run_in_threadpool(
                fetch.download_source,
                source_url, settings.uploads_dir, f"link_{_safe_id()}")
        except fetch.SourceFetchError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            # Anything the fetcher did not anticipate — a full disk, a
            # read-only uploads dir, an extractor raising a type the wrapper
            # missed. Unhandled, Starlette answers with the plain-text body
            # "Internal Server Error", which reaches the Studio as
            # "job creation failed: 500 Internal Server Error": no cause, and
            # nothing the person who pasted the link can act on.
            #
            # Log the traceback for the server and return a sentence for them.
            log.exception("link job failed for %s", source_url)
            raise HTTPException(
                502,
                "We couldn't fetch that link — something went wrong on our side. "
                "Try again, or upload the file instead.",
            ) from exc
        filename = title
    elif sample or file is None:
        # self-contained sample clip (generated once via ffmpeg). It carries no
        # real speech, so the pipeline runs the canned scenario end-to-end.
        sample_path = settings.assets_dir / "sample_source.mp4"
        media.make_sample_video(sample_path)
        if not sample_path.exists():
            raise HTTPException(
                503, "Sample generation needs ffmpeg. Upload a file instead.")
        input_video = sample_path
        filename = "sample_source.mp4"
        # The bundled sample carries real English speech, so run the real
        # pipeline on it when Whisper is available; otherwise use the canned
        # scenario (demo mode / no models).
        force_simulate = not manager.orchestrator.stt.available()
    else:
        suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
        input_video = settings.uploads_dir / f"upload_{_safe_id()}{suffix}"
        # Stream to disk in chunks. `await file.read()` with no argument pulls
        # the WHOLE video into memory, so peak usage is ~2x the file size (the
        # bytes object plus the write buffer) on top of several GB of resident
        # models. On a cloud container that OOMs mid-upload, and the symptom is
        # baffling: the request is cancelled with no POST ever reaching the
        # access log. Chunked copying keeps memory flat regardless of size.
        with input_video.open("wb") as out:
            while chunk := await file.read(_UPLOAD_CHUNK):
                out.write(chunk)
        filename = file.filename

    # ── Credit gate ───────────────────────────────────────────────────────
    # Runs here, not only in the Studio: a bearer token proves who is asking,
    # not that they have paid, and this route spends GPU minutes. See
    # app/billing.py. No-ops unless TH_LABS_ACCOUNT_API_URL is configured.
    #
    # Credits are priced per second, so a wallet that cannot pay for the whole
    # video still pays for the front of it. When that happens the source is cut
    # to the affordable length and the dub runs on that, with a notice carried
    # back to the user — a minute of a five-minute video is worth more to them
    # than a 402, and a brand-new account's free minute is exactly this path
    # rather than a special case.
    #
    # ORDER MATTERS. The id is reserved first, the charge settles against it,
    # and only then is the job queued. `manager.create` enqueues onto the
    # worker's loop, so anything awaited after it races the pipeline: a charge
    # that failed there would be marking a job failed that had already started
    # dubbing, and the status would be overwritten by the worker moments later.
    job_id = new_job_id()
    job_billing = JobBilling()
    if billing.enabled():
        probed = media.probe_duration(input_video)
        if probed is None:
            # The charge is computed FROM the length, so an unknown duration
            # cannot be quietly treated as zero — that would dub for free.
            raise HTTPException(400, "Could not read the video's duration.")
        source_seconds = probed
        gate = await billing.can_dub(user.token, source_seconds, quality.value)
        duration_seconds = source_seconds

        if gate.trimmed:
            # Cut to what the balance covers, then bill the cut length. Trimming
            # BEFORE the pipeline is the point: the GPU only ever processes what
            # has been paid for.
            trimmed_path = (settings.uploads_dir /
                            f"trim_{_safe_id()}{input_video.suffix or '.mp4'}")
            ok = await run_in_threadpool(
                media.trim_to_seconds, input_video, trimmed_path,
                gate.billable_seconds)
            if not ok:
                # No ffmpeg, or the cut failed. Charging for the full clip would
                # overdraw a wallet we already know is short, and dubbing it
                # would be unpaid GPU — so refuse, and say what would have run.
                log.error("trim to %.1fs failed for source %s",
                          gate.billable_seconds, input_video)
                raise HTTPException(
                    402,
                    f"You have {gate.balance} credits, which covers "
                    f"{int(gate.billable_seconds)}s of this video, but we "
                    "couldn't cut it to that length. Buy credits to dub the "
                    "whole video.",
                )
            input_video = trimmed_path
            # Bill the length ffmpeg actually produced, not the length we asked
            # for. They agree to within a frame, but the charge must follow the
            # file, not the request.
            actual = media.probe_duration(trimmed_path)
            duration_seconds = (actual if actual is not None
                                else gate.billable_seconds)

        # The charge, for the seconds that will actually be dubbed. Idempotent
        # on job_id, so the Studio issuing the same call is harmless. A refusal
        # here means no job is ever created, so there is nothing half-paid to
        # clean up and no orphan in the library.
        charged = await billing.commit_dub(user.token, job_id,
                                           duration_seconds, quality.value)
        job_billing = JobBilling(
            billed_seconds=duration_seconds,
            source_seconds=source_seconds,
            credits_charged=charged.billable_cost,
            balance_after=charged.balance,
            trimmed=gate.trimmed,
            notice=gate.notice(source_seconds),
        )

    job = manager.create(options, input_video, scenario, filename,
                         owner_id=user.id, force_simulate=force_simulate,
                         job_id=job_id, billing=job_billing)

    return {"id": job.id, "job": job.model_dump(mode="json")}


def _owned_job(job_id: str, user: StudioUser):
    """Fetch a job, or 404 unless it belongs to this user.

    404 rather than 403 for someone else's job on purpose: job ids are random,
    so "this exists but is not yours" is information the caller has no way to
    obtain otherwise, and no reason to receive. Not-yours and not-real look
    identical from outside.
    """
    job = manager.get(job_id)
    if not job or job.owner_id != user.id:
        raise HTTPException(404, "Job not found")
    return job


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str, user: StudioUser = Depends(require_user)) -> dict:
    job = _owned_job(job_id, user)
    return {"job": job.model_dump(mode="json")}


@app.get("/api/jobs/{job_id}/events")
async def job_events(
    job_id: str,
    user: StudioUser = Depends(require_user_sse),
) -> StreamingResponse:
    _owned_job(job_id, user)

    async def stream():
        async for evt in manager.subscribe(job_id):
            if evt.get("keepalive"):
                yield ": keepalive\n\n"      # SSE comment — keeps connection warm
            else:
                yield f"data: {json.dumps(evt)}\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no",
                 "Connection": "keep-alive"},
    )


def _safe_id() -> str:
    import uuid
    return uuid.uuid4().hex[:10]


# ── Serve the built frontend (single-origin deploy: Colab, HF Spaces, …) ──────
# After `npm run build`, the SPA lives in frontend/dist. When present we serve it
# straight from FastAPI so the whole app is ONE port (needed for a single tunnel
# on Colab / a single container on Spaces). In local dev this dir is absent and
# the Vite server serves the UI instead, proxying /api + /media back here.
_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"

if _FRONTEND_DIST.is_dir():
    _assets = _FRONTEND_DIST / "assets"
    if _assets.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets)), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str) -> FileResponse:
        # Serve a real static file if it exists (favicon, vite.svg, …); otherwise
        # hand back index.html so the client-side router takes over. /api and
        # /media are registered earlier, so they win over this catch-all.
        candidate = _FRONTEND_DIST / full_path
        if full_path and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_FRONTEND_DIST / "index.html")

else:
    @app.get("/")
    def root() -> dict:
        return {"service": settings.app_name, "version": __version__,
                "docs": "/docs", "health": "/api/health"}
