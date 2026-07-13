"""Cascaded pipeline orchestration.

Runs ASR → NMT → TTS-VC → (Lip-Sync) → Sync for a job, awaiting blocking work
in worker threads and emitting live progress between steps. Each stage uses its
real implementation when available and its simulation fallback otherwise, so the
orchestrator behaves identically in both modes — only the `simulated` flag and
per-stage `mode` differ.
"""
from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Awaitable, Callable

from ..config import get_settings
from ..schemas import (DubOptions, Job, JobResult, Segment, StageState,
                       StageStatus)
from . import media, metrics
from .lipsync import Wav2LipSync
from .nmt import NLLBTranslator
from .stt import WhisperSTT
from .sync import Synchronizer
from .tts import OmniVoiceTTS

EmitFn = Callable[..., Awaitable[None]]


class Orchestrator:
    def __init__(self) -> None:
        self.stt = WhisperSTT()
        self.nmt = NLLBTranslator()
        self.tts = OmniVoiceTTS()
        self.lip = Wav2LipSync()
        self.sync = Synchronizer()

    # ── introspection for /health ─────────────────────────────────────────
    def stage_info(self) -> list[dict]:
        return [
            dict(key=self.stt.key, label=self.stt.label, engine=self.stt.engine,
                 mode=self.stt.mode(),
                 detail="Whisper medium · word-level timestamps"),
            dict(key=self.nmt.key, label=self.nmt.label, engine=self.nmt.engine,
                 mode=self.nmt.mode(),
                 detail="Transformer NMT · length-compatibility scoring"),
            dict(key=self.tts.key, label=self.tts.label, engine=self.tts.engine,
                 mode=self.tts.mode(),
                 detail="Speaker-conditioned synthesis · voice cloning"),
            dict(key=self.lip.key, label=self.lip.label, engine=self.lip.engine,
                 mode=self.lip.mode(),
                 detail="Optional · enabled per job"),
            dict(key=self.sync.key, label=self.sync.label, engine=self.sync.engine,
                 mode=self.sync.mode(),
                 detail="Time-align + mux to container"),
        ]

    def is_simulated(self, options: DubOptions) -> bool:
        real = (self.stt.mode() == "real" and self.nmt.mode() == "real"
                and self.tts.mode() == "real")
        if options.lip_sync:
            real = real and self.lip.mode() == "real"
        return not real

    # ── main run ──────────────────────────────────────────────────────────
    async def run(self, job: Job, input_video: Path, scenario: str,
                  emit: EmitFn, force_simulate: bool = False) -> None:
        s = get_settings()
        options = job.options
        duration = await asyncio.to_thread(media.probe_duration, input_video)
        started = time.perf_counter()

        # `force_simulate` is set for the synthetic sample clip (no real speech
        # to transcribe) so the canned scenario is used end-to-end.
        real_asr = self.stt.mode() == "real" and not force_simulate
        real_nmt = self.nmt.mode() == "real" and not force_simulate
        real_tts = self.tts.mode() == "real" and not force_simulate
        used_real = False

        # 1 ── ASR ---------------------------------------------------------
        async with _stage(job, "asr", emit) as st:
            fell_back = False
            if real_asr:
                try:
                    wav = s.uploads_dir / f"{job.id}.wav"
                    await asyncio.to_thread(media.extract_audio, input_video, wav)
                    segments, detected = await asyncio.to_thread(
                        self.stt.transcribe, wav, options.source_lang)
                    if not segments:            # no speech detected → fall back
                        raise RuntimeError("no speech detected")
                    used_real = True
                except Exception as exc:
                    fell_back = True
                    await _beat(0.4)
                    segments, detected = self.stt.simulate(duration, scenario)
                    st.message = f"real ASR unavailable ({str(exc)[:60]}) — simulated"
            else:
                await _beat(0.6)
                segments, detected = self.stt.simulate(duration, scenario)
            job.result.detected_source_lang = detected
            job.result.segments = segments
            st.detail = {"segments": len(segments),
                         "detected_lang": detected,
                         "engine_mode": "simulation" if (not real_asr or fell_back) else "real",
                         "words": sum(len(x.source_text.split()) for x in segments)}
            await _tick(job, "asr", emit, segments_preview(segments))

        src_lang = job.result.detected_source_lang or options.source_lang

        # 2 ── NMT ---------------------------------------------------------
        async with _stage(job, "nmt", emit) as st:
            fell_back = False
            if real_nmt:
                try:
                    segments = await asyncio.to_thread(
                        self.nmt.translate, segments, src_lang, options.target_lang)
                    used_real = True
                except Exception as exc:
                    fell_back = True
                    await _beat(0.4)
                    segments = self.nmt.simulate(segments, options.target_lang, scenario)
                    st.message = f"real NMT unavailable ({str(exc)[:60]}) — simulated"
            else:
                await _beat(0.7)
                segments = self.nmt.simulate(segments, options.target_lang, scenario)
            job.result.segments = segments
            st.detail = {"length_ratio": self.nmt.length_ratio(segments),
                         "engine_mode": "simulation" if (not real_nmt or fell_back) else "real",
                         "target_lang": options.target_lang}
            await _tick(job, "nmt", emit, segments_preview(segments))

        # 3 ── TTS + Voice Cloning ----------------------------------------
        dubbed_audio = s.outputs_dir / f"{job.id}_audio.m4a"
        async with _stage(job, "tts", emit) as st:
            engine_mode = "simulation"
            if real_tts:
                try:
                    ref = s.uploads_dir / f"{job.id}.wav"
                    ref = ref if ref.exists() else None
                    ok = await asyncio.to_thread(
                        self.tts.synthesize, segments, ref,
                        options.voice_clone, dubbed_audio)
                    engine_mode = "real"
                    used_real = True
                except Exception as exc:
                    await _beat(0.5)
                    ok = await asyncio.to_thread(
                        self.tts.simulate, duration or 25.0, dubbed_audio,
                        options.voice_clone)
                    st.message = f"real TTS unavailable ({str(exc)[:60]}) — simulated"
            else:
                await _beat(0.9)
                ok = await asyncio.to_thread(
                    self.tts.simulate, duration or 25.0, dubbed_audio,
                    options.voice_clone)
            st.detail = {"voice_clone": options.voice_clone,
                         "engine_mode": engine_mode,
                         "audio_ok": bool(ok)}

        job.simulated = not used_real

        # 4 ── Lip Sync (optional) ----------------------------------------
        working_video = input_video
        if options.lip_sync:
            lip_out = s.outputs_dir / f"{job.id}_lip.mp4"
            async with _stage(job, "lipsync", emit) as st:
                if self.lip.mode() == "real":
                    ok = await asyncio.to_thread(
                        self.lip.run, input_video, dubbed_audio, lip_out)
                else:
                    await _beat(1.0)
                    ok = await asyncio.to_thread(
                        self.lip.simulate, input_video, lip_out)
                if ok:
                    working_video = lip_out
                st.detail = {"enabled": True}
        else:
            _skip(job, "lipsync")
            await emit(job)

        # 5 ── Sync & Mux --------------------------------------------------
        out_video = s.outputs_dir / f"{job.id}.mp4"
        async with _stage(job, "sync", emit) as st:
            await _beat(0.5)
            await asyncio.to_thread(self.sync.run, working_video,
                                    dubbed_audio, out_video)
            st.detail = {"muxed": out_video.exists()}

        # ── finalise ------------------------------------------------------
        elapsed = time.perf_counter() - started
        job.result.duration = duration
        job.result.output_url = f"/media/outputs/{out_video.name}"
        job.result.source_url = _source_url(input_video)
        length_ratio = self.nmt.length_ratio(segments)
        job.result.metrics = metrics.simulated_metrics(
            job.id, options, elapsed, duration, length_ratio)
        # attach per-segment speaker similarity for the results table
        base_sim = job.result.metrics.speaker_similarity or 0.0
        for i, seg in enumerate(job.result.segments):
            seg.speaker_similarity = round(
                max(0.0, min(99.9, base_sim + metrics._jitter(job.id, f"s{i}", 3.0))), 1)


# ── small async helpers ───────────────────────────────────────────────────
def segments_preview(segments: list[Segment]) -> dict:
    return {"preview": [s.model_dump() for s in segments[:8]]}


async def _beat(seconds: float) -> None:
    """A short visible pause so simulated stages are watchable."""
    await asyncio.sleep(seconds)


def _find_stage(job: Job, key: str) -> StageState:
    for st in job.stages:
        if st.key == key:
            return st
    raise KeyError(key)


def _skip(job: Job, key: str) -> None:
    st = _find_stage(job, key)
    st.status = StageStatus.skipped
    st.progress = 1.0
    st.message = "Skipped (not enabled)"


async def _tick(job: Job, key: str, emit: EmitFn, detail: dict | None = None):
    st = _find_stage(job, key)
    if detail:
        st.detail = {**st.detail, **detail}
    await emit(job)


class _stage:
    """Async context manager: marks a stage running → done, times it, emits."""

    def __init__(self, job: Job, key: str, emit: EmitFn):
        self.job, self.key, self.emit = job, key, emit
        self.st = _find_stage(job, key)

    async def __aenter__(self) -> StageState:
        self.t0 = time.perf_counter()
        self.st.status = StageStatus.running
        self.st.progress = 0.05
        self.st.message = "Working…"
        await self.emit(self.job)
        return self.st

    async def __aexit__(self, exc_type, exc, tb):
        if exc_type is not None:
            self.st.status = StageStatus.failed
            self.st.message = str(exc)[:200]
            await self.emit(self.job)
            return False
        self.st.status = StageStatus.done
        self.st.progress = 1.0
        self.st.message = "Done"
        self.st.duration_ms = int((time.perf_counter() - self.t0) * 1000)
        await self.emit(self.job)
        return False


def _source_url(input_video: Path) -> str:
    s = get_settings()
    try:
        rel = input_video.relative_to(s.data_dir)
        return f"/media/{rel.as_posix()}"
    except ValueError:
        return f"/media/uploads/{input_video.name}"
