"""In-memory job store + async runner with SSE broadcast.

Good enough for a single-node demo / science-fair deployment. Swap the dicts for
Redis + a task queue to scale out; the public surface (create/get/subscribe)
stays the same.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from pathlib import Path

from .schemas import (DubOptions, Job, JobResult, JobStatus, StageState,
                      StageStatus)
from .pipeline.orchestrator import Orchestrator

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
        self._subs: dict[str, list[asyncio.Queue]] = {}
        self._orch = Orchestrator()
        # Jobs execute one at a time through a single worker. The shared
        # openai-whisper model has stateful KV-cache hooks that concurrent
        # transcribe() calls corrupt, and a 6 GB GPU can't hold two model runs
        # at once — so serialising is both correct and necessary.
        self._pending: "asyncio.Queue | None" = None
        self._worker: "asyncio.Task | None" = None

    # ── introspection ─────────────────────────────────────────────────────
    @property
    def orchestrator(self) -> Orchestrator:
        return self._orch

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    # ── creation ──────────────────────────────────────────────────────────
    def create(self, options: DubOptions, input_video: Path,
               scenario: str, filename: str | None,
               owner_id: int | None = None,
               force_simulate: bool = False) -> Job:
        job_id = uuid.uuid4().hex[:12]
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
                  created_at=now, updated_at=now)
        self._jobs[job_id] = job
        self._subs[job_id] = []
        # enqueue for the single serial worker (started lazily on the loop)
        self._ensure_worker()
        self._pending.put_nowait((job, input_video, scenario, force_simulate))
        return job

    # ── serial worker ─────────────────────────────────────────────────────
    def _ensure_worker(self) -> None:
        if self._pending is None:
            self._pending = asyncio.Queue()
        if self._worker is None or self._worker.done():
            self._worker = asyncio.create_task(self._worker_loop())

    async def _worker_loop(self) -> None:
        assert self._pending is not None
        while True:
            job, input_video, scenario, force_simulate = await self._pending.get()
            try:
                await self._run(job, input_video, scenario, force_simulate)
            except Exception:  # pragma: no cover - defensive; keep worker alive
                pass
            finally:
                self._pending.task_done()

    # ── runner ────────────────────────────────────────────────────────────
    async def _run(self, job: Job, input_video: Path, scenario: str,
                   force_simulate: bool = False) -> None:
        job.status = JobStatus.running
        await self._emit(job)
        try:
            await self._orch.run(job, input_video, scenario, self._emit,
                                 force_simulate=force_simulate)
            job.status = JobStatus.completed
        except Exception as exc:  # pragma: no cover - defensive
            job.status = JobStatus.failed
            job.error = str(exc)[:300]
        await self._emit(job, final=True)

    # ── event fan-out ─────────────────────────────────────────────────────
    async def _emit(self, job: Job, final: bool = False) -> None:
        job.updated_at = time.time()
        payload = job.model_dump(mode="json")
        for q in list(self._subs.get(job.id, [])):
            await q.put({"final": final, "job": payload})

    async def subscribe(self, job_id: str):
        """Yield the current snapshot, then stream updates until the job ends."""
        job = self._jobs.get(job_id)
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
