"""In-memory job store + async runner with SSE broadcast.

Good enough for a single-node demo / science-fair deployment. Swap the dicts for
Redis + a task queue to scale out; the public surface (create/get/subscribe)
stays the same.

Finished jobs are also written to disk (`data/jobs/<id>.json`). The speech
editor reopens a dub days later — an agency fixing a line a client flagged —
and a container restart in between used to make that job "not found" even
though its video, voice stem and background were all still on the volume.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from pathlib import Path
from typing import Awaitable, Callable

from .config import get_settings
from .schemas import (DubOptions, Job, JobBilling, JobResult, JobStatus,
                      Segment,
                      StageState, StageStatus)
from .pipeline import issues, redub
from .pipeline.orchestrator import Orchestrator

log = logging.getLogger(__name__)


def new_job_id() -> str:
    """A job id, mintable before the job exists.

    Callers that must bill against the id — the charge is idempotent on it —
    need it in hand before `JobManager.create` enqueues anything.
    """
    return uuid.uuid4().hex[:12]

_STAGE_DEFS = [
    ("asr", "Speech-to-Text"),
    ("nmt", "Translation"),
    ("tts", "Text-to-Speech + Voice Cloning"),
    ("separation", "Background Preservation"),
    ("lipsync", "Lip Sync"),
    ("sync", "Sync & Mux"),
]


def _initial_status(key: str, options: DubOptions) -> StageStatus:
    if key == "lipsync" and not options.lip_sync:
        return StageStatus.skipped
    if key == "separation" and (not options.keep_background
                                or options.quality == "fast"):
        return StageStatus.skipped
    return StageStatus.pending


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        # Source video per job, kept here rather than on the Job because Job is
        # serialised straight to the browser and a server filesystem path is
        # not the client's business. Re-voicing an edited transcript needs it.
        self._sources: dict[str, Path] = {}
        # An uploaded voice to dub in, when the user supplied one instead of
        # using the speaker from the video. Kept here for the same reason as
        # the source path: it is a server file, not the client's business.
        self._references: dict[str, Path | None] = {}
        # What a finished run left behind — voice stem, background, the video
        # it was muxed onto, engine, speaker reference. Server paths again;
        # re-dubbing single lines (pipeline/redub.py) patches these.
        self._artifacts: dict[str, dict] = {}
        self._subs: dict[str, list[asyncio.Queue]] = {}
        self._orch = Orchestrator()
        # Jobs execute one at a time through a single worker. The shared
        # openai-whisper model has stateful KV-cache hooks that concurrent
        # transcribe() calls corrupt, and a 6 GB GPU can't hold two model runs
        # at once — so serialising is both correct and necessary. Speech edits
        # go through the same worker for the same reason: they load the same
        # TTS and cloning models.
        self._pending: "asyncio.Queue[Callable[[], Awaitable[None]]] | None" = None
        self._worker: "asyncio.Task | None" = None

    # ── introspection ─────────────────────────────────────────────────────
    @property
    def orchestrator(self) -> Orchestrator:
        return self._orch

    def get(self, job_id: str) -> Job | None:
        job = self._jobs.get(job_id)
        if job is None:
            job = self._load(job_id)
        return job

    def list_for(self, owner_id: int) -> list[Job]:
        """This user's finished dubs, newest first — memory and disk alike."""
        seen: dict[str, Job] = {}
        d = self._store_dir()
        if d is not None:
            for f in d.glob("*.json"):
                if f.stem in self._jobs:
                    continue
                job = self._load(f.stem)
                if job is not None:
                    seen[job.id] = job
        for job in self._jobs.values():
            seen[job.id] = job
        mine = [j for j in seen.values() if j.owner_id == owner_id]
        return sorted(mine, key=lambda j: j.created_at, reverse=True)

    # ── creation ──────────────────────────────────────────────────────────
    def reference_audio(self, job_id: str) -> Path | None:
        """The voice the user supplied for this job, if any."""
        if job_id not in self._references:
            self._load(job_id)
        return self._references.get(job_id)

    def source_video(self, job_id: str) -> Path | None:
        """The video a job was run on, if it is still known."""
        if job_id not in self._sources:
            self._load(job_id)
        return self._sources.get(job_id)

    def artifacts(self, job_id: str) -> dict | None:
        """What a finished run left on disk, for patching it later."""
        if job_id not in self._artifacts:
            self._load(job_id)
        return self._artifacts.get(job_id)

    def create(self, options: DubOptions, input_video: Path,
               scenario: str, filename: str | None,
               owner_id: int | None = None,
               force_simulate: bool = False,
               job_id: str | None = None,
               billing: JobBilling | None = None,
               preset_segments: list[Segment] | None = None,
               reference_audio: Path | None = None) -> Job:
        """Register a job and queue it for the serial worker.

        `job_id` lets the caller reserve the id BEFORE the job exists. The credit
        charge is keyed on it (it is the idempotency key), and the charge has to
        settle before the pipeline starts — this method enqueues, so anything
        billed after it returns races the worker, and a refused charge would be
        marking a job failed that was already burning GPU. See main.py.
        """
        job_id = job_id or new_job_id()
        now = time.time()
        stages = [
            StageState(key=k, label=l, status=_initial_status(k, options))
            for k, l in _STAGE_DEFS
        ]
        simulated = force_simulate or self._orch.is_simulated(options)
        job = Job(id=job_id, owner_id=owner_id,
                  options=options, filename=filename,
                  simulated=simulated,
                  stages=stages, result=JobResult(),
                  billing=billing or JobBilling(),
                  created_at=now, updated_at=now)
        self._jobs[job_id] = job
        self._sources[job_id] = input_video
        self._subs[job_id] = []
        self._references[job_id] = reference_audio
        self._enqueue(lambda: self._run(job, input_video, scenario,
                                        force_simulate, preset_segments,
                                        reference_audio))
        return job

    def redub(self, job: Job, new_segments: list[Segment],
              changed: set[int]) -> None:
        """Queue re-dubbing `changed` lines of a finished job (speech editor).

        The caller has validated the edit (redub.apply_edits). The job's own
        status stays `completed` throughout — the previous version is still
        playable — and progress is reported on `job.edit`.
        """
        job.edit.status = "queued"
        job.edit.message = "Waiting for the dubbing engine"
        job.edit.error = None
        job.edit.updated_at = time.time()
        self._subs.setdefault(job.id, [])
        self._enqueue(lambda: self._run_redub(job, new_segments, changed))

    # ── serial worker ─────────────────────────────────────────────────────
    def _enqueue(self, work: Callable[[], Awaitable[None]]) -> None:
        self._ensure_worker()
        assert self._pending is not None
        self._pending.put_nowait(work)

    def _ensure_worker(self) -> None:
        if self._pending is None:
            self._pending = asyncio.Queue()
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._worker_loop())

    async def _worker_loop(self) -> None:
        assert self._pending is not None
        while True:
            work = await self._pending.get()
            try:
                await work()
            except Exception:  # pragma: no cover - defensive; keep worker alive
                log.exception("job worker: unhandled error")
            finally:
                self._pending.task_done()

    # ── runners ───────────────────────────────────────────────────────────
    async def _run(self, job: Job, input_video: Path, scenario: str,
                   force_simulate: bool = False,
                   preset_segments: list[Segment] | None = None,
                   reference_audio: Path | None = None) -> None:
        job.status = JobStatus.running
        await self._emit(job)
        artifacts: dict | None = None
        try:
            artifacts = await self._orch.run(job, input_video, scenario,
                                             self._emit,
                                             force_simulate=force_simulate,
                                             preset_segments=preset_segments,
                                             reference_audio=reference_audio)
            job.status = JobStatus.completed
        except Exception as exc:  # pragma: no cover - defensive
            job.status = JobStatus.failed
            job.error = str(exc)[:300]
        if artifacts:
            self._artifacts[job.id] = artifacts
        voice = Path(artifacts["voice"]) if artifacts else None
        job.result.issues = await asyncio.to_thread(issues.analyse, job, voice)
        self._save(job)
        await self._emit(job, final=True)

    async def _run_redub(self, job: Job, new_segments: list[Segment],
                         changed: set[int]) -> None:
        artifacts = self.artifacts(job.id)
        job.edit.status = "running"
        job.edit.message = "Starting"
        await self._emit(job)
        try:
            if not artifacts:
                raise RuntimeError("This dub was made before speech editing "
                                   "existed, so its voice track was not kept. "
                                   "Run it again to edit it.")
            self._artifacts[job.id] = await redub.run(
                self._orch, job, artifacts, new_segments, changed, self._emit)
            job.edit.status = "done"
        except Exception as exc:
            log.exception("[%s] speech edit failed", job.id)
            job.edit.status = "failed"
            job.edit.error = str(exc)[:300] or "The edit could not be applied."
            job.edit.message = ""
        job.edit.updated_at = time.time()
        voice = self._artifacts.get(job.id, {}).get("voice")
        job.result.issues = await asyncio.to_thread(
            issues.analyse, job, Path(voice) if voice else None)
        self._save(job)
        await self._emit(job, final=True)

    # ── persistence ───────────────────────────────────────────────────────
    def _store_dir(self) -> Path | None:
        try:
            d = get_settings().data_dir / "jobs"
            d.mkdir(parents=True, exist_ok=True)
            return d
        except Exception:
            return None

    def _save(self, job: Job) -> None:
        """Write a finished job and its server-side paths. Best effort: a
        read-only disk loses the restart survival, never the job."""
        d = self._store_dir()
        if d is None:
            return
        src = self._sources.get(job.id)
        ref = self._references.get(job.id)
        record = {
            "job": job.model_dump(mode="json"),
            "source": str(src) if src else None,
            "reference": str(ref) if ref else None,
            "artifacts": self._artifacts.get(job.id),
        }
        tmp = d / f"{job.id}.json.tmp"
        try:
            tmp.write_text(json.dumps(record))
            tmp.replace(d / f"{job.id}.json")
        except Exception as exc:
            log.warning("[%s] could not persist job (%s)", job.id, exc)

    def _load(self, job_id: str) -> Job | None:
        # Ids are 12 hex chars; anything else is not a file we wrote, and
        # refusing it keeps a crafted id from naming a path.
        if not job_id or len(job_id) > 32 or not job_id.isalnum():
            return None
        d = self._store_dir()
        f = d / f"{job_id}.json" if d is not None else None
        if f is None or not f.exists():
            return None
        try:
            record = json.loads(f.read_text())
            job = Job.model_validate(record["job"])
        except Exception as exc:
            log.warning("[%s] stored job unreadable (%s)", job_id, exc)
            return None
        # An edit interrupted by a restart will never finish; say so.
        if job.edit.status in ("queued", "running"):
            job.edit.status = "failed"
            job.edit.error = "The server restarted during this edit. Apply it again."
        self._jobs[job.id] = job
        if record.get("source"):
            self._sources[job.id] = Path(record["source"])
        self._references[job.id] = (Path(record["reference"])
                                    if record.get("reference") else None)
        if record.get("artifacts"):
            self._artifacts[job.id] = record["artifacts"]
        self._subs.setdefault(job.id, [])
        return job

    # ── event fan-out ─────────────────────────────────────────────────────
    async def _emit(self, job: Job, final: bool = False) -> None:
        job.updated_at = time.time()
        payload = job.model_dump(mode="json")
        for q in list(self._subs.get(job.id, [])):
            await q.put({"final": final, "job": payload})

    async def subscribe(self, job_id: str):
        """Yield the current snapshot, then stream updates until the job ends."""
        job = self.get(job_id)
        if not job:
            return
        q: asyncio.Queue = asyncio.Queue()
        self._subs.setdefault(job_id, []).append(q)
        try:
            # initial snapshot
            yield {"final": job.status in (JobStatus.completed, JobStatus.failed),
                   "job": job.model_dump(mode="json")}
            if job.status in (JobStatus.completed, JobStatus.failed):
                return
            while True:
                try:
                    evt = await asyncio.wait_for(q.get(), timeout=12)
                except asyncio.TimeoutError:
                    # no updates for a while (e.g. mid-transcription of a long
                    # video) — emit a keepalive so proxies don't drop the SSE
                    yield {"keepalive": True}
                    continue
                yield evt
                if evt.get("final"):
                    return
        finally:
            subs = self._subs.get(job_id, [])
            if q in subs:
                subs.remove(q)


manager = JobManager()
