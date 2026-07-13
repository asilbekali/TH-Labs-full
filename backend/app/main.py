"""FastAPI application — the TH-Labs dubbing API.

Endpoints
    GET  /api/health            → mode + per-stage engine status
    GET  /api/languages         → supported languages
    POST /api/jobs              → create a dubbing job (upload or ?sample=1)
    GET  /api/jobs/{id}         → job snapshot
    GET  /api/jobs/{id}/events  → SSE live pipeline progress
    /media/...                  → served source & dubbed media
"""
from __future__ import annotations

import json
from pathlib import Path

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, languages
from .config import get_settings
from .jobs import manager
from .pipeline import media
from .schemas import (DubOptions, HealthInfo, Quality, StageInfo)

settings = get_settings()
app = FastAPI(title=settings.app_name, version=__version__)

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
        ffmpeg=bool(settings.ffmpeg), stages=stages,
    )


@app.get("/api/languages")
def get_languages() -> dict:
    return {"languages": languages.all_dicts()}


@app.post("/api/jobs")
async def create_job(
    target_lang: str = Form(...),
    source_lang: str = Form("auto"),
    voice_clone: bool = Form(True),
    lip_sync: bool = Form(False),
    quality: Quality = Form(Quality.balanced),
    sample: bool = Form(False),
    file: UploadFile | None = File(None),
) -> dict:
    if not languages.get(target_lang):
        raise HTTPException(400, f"Unsupported target language: {target_lang}")

    options = DubOptions(
        source_lang=source_lang, target_lang=target_lang,
        voice_clone=voice_clone, lip_sync=lip_sync, quality=quality,
    )

    scenario = "lecture"
    filename: str | None = None
    force_simulate = False

    if sample or file is None:
        # self-contained sample clip (generated once via ffmpeg). It carries no
        # real speech, so the pipeline runs the canned scenario end-to-end.
        sample_path = settings.assets_dir / "sample_source.mp4"
        media.make_sample_video(sample_path)
        if not sample_path.exists():
            raise HTTPException(
                503, "Sample generation needs ffmpeg. Upload a file instead.")
        input_video = sample_path
        filename = "sample_source.mp4"
        force_simulate = True
    else:
        suffix = Path(file.filename or "upload.mp4").suffix or ".mp4"
        input_video = settings.uploads_dir / f"upload_{_safe_id()}{suffix}"
        input_video.write_bytes(await file.read())
        filename = file.filename

    job = manager.create(options, input_video, scenario, filename,
                         force_simulate=force_simulate)
    return {"id": job.id, "job": job.model_dump(mode="json")}


@app.get("/api/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = manager.get(job_id)
    if not job:
        raise HTTPException(404, "Job not found")
    return {"job": job.model_dump(mode="json")}


@app.get("/api/jobs/{job_id}/events")
async def job_events(job_id: str) -> StreamingResponse:
    if not manager.get(job_id):
        raise HTTPException(404, "Job not found")

    async def stream():
        async for evt in manager.subscribe(job_id):
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


@app.get("/")
def root() -> dict:
    return {"service": settings.app_name, "version": __version__,
            "docs": "/docs", "health": "/api/health"}
