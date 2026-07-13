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
    ("lipsync", "Lip Sync"),
    ("sync", "Sync & Mux"),
]


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._subs: dict[str, list[asyncio.Queue]] = {}
        self._orch = Orchestrator()

    # ── introspection ─────────────────────────────────────────────────────
    @property
    def orchestrator(self) -> Orchestrator:
        return self._orch

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    # ── creation ──────────────────────────────────────────────────────────
    def create(self, options: DubOptions, input_video: Path,
               scenario: str, filename: str | None,
               force_simulate: bool = False) -> Job:
        job_id = uuid.uuid4().hex[:12]
        now = time.time()
        stages = [
            StageState(key=k, label=l,
                       status=(StageStatus.skipped
                               if k == "lipsync" and not options.lip_sync
                               else StageStatus.pending))
            for k, l in _STAGE_DEFS
        ]
        simulated = force_simulate or self._orch.is_simulated(options)
        job = Job(id=job_id, options=options, filename=filename,
                  simulated=simulated,
                  stages=stages, result=JobResult(),
                  created_at=now, updated_at=now)
        self._jobs[job_id] = job
        self._subs[job_id] = []
        # kick off the pipeline in the background
        asyncio.create_task(self._run(job, input_video, scenario, force_simulate))
        return job

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
                evt = await q.get()
                yield evt
                if evt.get("final"):
                    return
        finally:
            subs = self._subs.get(job_id, [])
            if q in subs:
                subs.remove(q)


manager = JobManager()
