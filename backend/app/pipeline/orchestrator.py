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
from .separation import DemucsSeparator
from .stt import WhisperSTT
from .sync import Synchronizer
from .tts import OmniVoiceTTS
from .tts_edge import EdgeTTS
from .voice_clone import OpenVoiceCloner

EmitFn = Callable[..., Awaitable[None]]

# Quality → Whisper model. "Fast" trades accuracy for a big speed-up (base is
# ~4-5× faster than medium); "Studio" is the paper's Whisper medium.
QUALITY_WHISPER = {"fast": "base", "balanced": "small", "studio": "medium"}


class Orchestrator:
    def __init__(self) -> None:
        self.stt = WhisperSTT()
        self.nmt = NLLBTranslator()
        self.tts = OmniVoiceTTS()          # voice cloning (when it can load)
        self.edge = EdgeTTS()              # real neural speech (generic voice)
        self.cloner = OpenVoiceCloner()    # clone source speaker onto edge-tts
        self.sep = DemucsSeparator()       # keep original music/FX background
        self.lip = Wav2LipSync()
        self.sync = Synchronizer()

    def _tts_available(self) -> bool:
        return self.tts.mode() == "real" or self.edge.available()

    # ── introspection for /health ─────────────────────────────────────────
    def stage_info(self) -> list[dict]:
        return [
            dict(key=self.stt.key, label=self.stt.label, engine=self.stt.engine,
                 mode=self.stt.mode(),
                 detail=("Whisper medium · silero-VAD gated"
                         if self.stt._vad.available()
                         else "Whisper medium · segment timestamps")),
            dict(key=self.nmt.key, label=self.nmt.label, engine=self.nmt.engine,
                 mode=self.nmt.mode(),
                 detail="Transformer NMT · length-compatibility scoring"),
            dict(key="tts", label="Text-to-Speech + Voice Cloning",
                 engine=(self.tts.engine if self.tts.mode() == "real"
                         else (self.edge.engine if self.edge.available()
                               else self.tts.engine)),
                 mode="real" if self._tts_available() else "simulation",
                 detail=("OmniVoice · voice cloning" if self.tts.mode() == "real"
                         else "edge-tts · neural voice per language"
                         if self.edge.available()
                         else "placeholder tone (no TTS engine)")),
            dict(key=self.sep.key, label=self.sep.label, engine=self.sep.engine,
                 mode=self.sep.mode(),
                 detail="Keep original music/FX · remove source speech"),
            dict(key=self.lip.key, label=self.lip.label, engine=self.lip.engine,
                 mode=self.lip.mode(),
                 detail="Optional · enabled per job"),
            dict(key=self.sync.key, label=self.sync.label, engine=self.sync.engine,
                 mode=self.sync.mode(),
                 detail="Time-align + mux to container"),
        ]

    def is_simulated(self, options: DubOptions) -> bool:
        real = (self.stt.mode() == "real" and self.nmt.mode() == "real"
                and self._tts_available())
        if options.lip_sync:
            real = real and self.lip.mode() == "real"
        return not real

    async def _heartbeat(self, job: Job, key: str, emit: EmitFn, fn,
                         interval: float = 4.0, ceiling: float = 0.92):
        """Run a blocking `fn()` in a worker thread while periodically nudging
        the stage's progress bar and re-emitting. This keeps long stages (e.g.
        transcribing a 15-minute video) visibly alive and stops the SSE stream
        from idling out. Returns fn()'s result (re-raises its exception)."""
        task = asyncio.ensure_future(asyncio.to_thread(fn))
        st = _find_stage(job, key)
        while True:
            done, _ = await asyncio.wait({task}, timeout=interval)
            if done:
                break
            st.progress = min(ceiling, st.progress + 0.03)
            await emit(job)
        return task.result()

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
            vad_detail: dict = {}
            if real_asr:
                # Real ASR: never fabricate a transcript. If Whisper (VAD-gated)
                # finds no speech or errors, report that honestly — do NOT fall
                # back to the canned demo scenario.
                used_real = True
                try:
                    wav = s.uploads_dir / f"{job.id}.wav"
                    await asyncio.to_thread(media.extract_audio, input_video, wav)
                    wmodel = QUALITY_WHISPER.get(options.quality, "small")
                    segments, detected, vad_detail = await self._heartbeat(
                        job, "asr", emit,
                        lambda: self.stt.transcribe(wav, options.source_lang, wmodel))
                    vad_detail = {**vad_detail, "model": wmodel}
                    if not segments:
                        st.message = "No speech detected in the audio."
                except Exception as exc:
                    segments, detected = [], (
                        options.source_lang if options.source_lang != "auto" else "en")
                    st.message = f"ASR error: {str(exc)[:80]}"
                engine_mode = "real"
            else:
                await _beat(0.6)
                segments, detected = self.stt.simulate(duration, scenario)
                engine_mode = "simulation"
            job.result.detected_source_lang = detected
            job.result.segments = segments
            st.detail = {"segments": len(segments),
                         "detected_lang": detected,
                         "engine_mode": engine_mode,
                         "words": sum(len(x.source_text.split()) for x in segments),
                         **vad_detail}
            await _tick(job, "asr", emit, segments_preview(segments))

        src_lang = job.result.detected_source_lang or options.source_lang

        # 2 ── NMT ---------------------------------------------------------
        async with _stage(job, "nmt", emit) as st:
            fell_back = False
            if real_nmt:
                try:
                    segments = await self._heartbeat(
                        job, "nmt", emit,
                        lambda: self.nmt.translate(segments, src_lang, options.target_lang))
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

        # 3 ── TTS ---------------------------------------------------------
        # Engine chain: OmniVoice (clones the speaker) → edge-tts (real neural
        # voice) → tone (placeholder). Whichever produces audio wins.
        dubbed_audio = s.outputs_dir / f"{job.id}_audio.wav"
        tts_engine = "simulation"
        voice_cloned = False
        measured_similarity: float | None = None
        async with _stage(job, "tts", emit) as st:
            done = False
            want_clone = options.voice_clone and not force_simulate
            # 1) OmniVoice — voice cloning
            if want_clone and self.tts.mode() == "real":
                try:
                    ref_audio, ref_text = await asyncio.to_thread(
                        _build_speaker_ref, job.id, segments)
                    ok = await self._heartbeat(job, "tts", emit,
                        lambda: self.tts.synthesize(segments, ref_audio, ref_text,
                                                    True, dubbed_audio, duration))
                    if ok:
                        tts_engine, voice_cloned, used_real, done = \
                            "OmniVoice", True, True, True
                except Exception as exc:
                    st.message = f"OmniVoice unavailable ({str(exc)[:45]})"
            # 2) edge-tts — real neural speech (generic per-language voice)
            if (not done and not force_simulate and segments
                    and self.edge.available()
                    and self.edge.supports(options.target_lang)):
                try:
                    ok = await self._heartbeat(job, "tts", emit,
                        lambda: self.edge.synthesize(segments, options.target_lang,
                                                     dubbed_audio, duration))
                    if ok:
                        tts_engine, used_real, done = "edge-tts", True, True
                        # 2b) OpenVoice — clone the source speaker's timbre onto
                        # the generic edge-tts voice (real voice cloning here).
                        # Skipped in Fast mode (CPU cloning is slow on long audio).
                        if (want_clone and options.quality != "fast"
                                and self.cloner.available()):
                            try:
                                ref_audio, _ = await asyncio.to_thread(
                                    _build_speaker_ref, job.id, segments)
                                if ref_audio and Path(ref_audio).exists():
                                    cloned = s.outputs_dir / f"{job.id}_cloned.wav"
                                    sim = await self._heartbeat(job, "tts", emit,
                                        lambda: self.cloner.clone(dubbed_audio,
                                                                  ref_audio, cloned))
                                    if sim is not None and cloned.exists():
                                        dubbed_audio = cloned
                                        tts_engine = "edge-tts + OpenVoice"
                                        voice_cloned = True
                                        measured_similarity = sim
                                        st.message = f"cloned to source speaker · {sim}% match"
                            except Exception as exc:
                                st.message = f"clone skipped ({str(exc)[:40]})"
                        elif want_clone:
                            st.message = ("neural voice (cloning off in Fast mode)"
                                          if options.quality == "fast"
                                          else "neural voice (cloning unavailable)")
                except Exception as exc:
                    st.message = f"edge-tts error ({str(exc)[:45]})"
            # 3) placeholder tone
            if not done:
                await _beat(0.7)
                await asyncio.to_thread(self.tts.simulate, duration or 25.0,
                                        dubbed_audio, options.voice_clone)
            st.detail = {"engine": tts_engine, "voice_clone": voice_cloned,
                         "engine_mode": "real" if tts_engine != "simulation"
                         else "simulation"}

        job.simulated = not used_real

        # 4 ── Background preservation (optional) --------------------------
        # Separate the ORIGINAL audio; keep the background (music/FX), drop the
        # original speech. The dubbed voice is mixed over it in the sync stage.
        # Fast mode skips the (slow, CPU) separation for speed.
        background: Path | None = None
        do_separation = (options.keep_background and options.quality != "fast"
                         and self.sep.available() and not force_simulate)
        if do_separation:
            async with _stage(job, "separation", emit) as st:
                orig_hq = s.uploads_dir / f"{job.id}_orig.wav"
                sep_dir = s.outputs_dir / f"{job.id}_sep"
                await asyncio.to_thread(media.extract_audio_hq, input_video, orig_hq)
                sep_device = self.sep.resolve_device()
                try:
                    background = await self._heartbeat(
                        job, "separation", emit,
                        lambda: self.sep.separate_background(orig_hq, sep_dir,
                                                             sep_device))
                except Exception as exc:
                    st.message = f"separation failed ({str(exc)[:50]}) — voice only"
                st.detail = {"kept_background": bool(background),
                             "device": sep_device,
                             "engine_mode": "real" if background else "simulation"}
        else:
            _skip(job, "separation")
            await emit(job)

        # 5 ── Lip Sync (optional) ----------------------------------------
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

        # 6 ── Sync & Mux --------------------------------------------------
        out_video = s.outputs_dir / f"{job.id}.mp4"
        async with _stage(job, "sync", emit) as st:
            await _beat(0.5)
            final_audio = dubbed_audio
            mixed = False
            if background is not None:
                mixed_audio = s.outputs_dir / f"{job.id}_mixed.wav"
                if await asyncio.to_thread(
                        media.mix_voice_over_background, dubbed_audio, background,
                        mixed_audio, s.voice_gain, s.background_gain):
                    final_audio = mixed_audio
                    mixed = True
            await asyncio.to_thread(self.sync.run, working_video,
                                    final_audio, out_video)
            st.detail = {"muxed": out_video.exists(),
                         "background_kept": mixed}

        # ── finalise ------------------------------------------------------
        elapsed = time.perf_counter() - started
        job.result.duration = duration
        job.result.output_url = f"/media/outputs/{out_video.name}"
        job.result.source_url = _source_url(input_video)
        length_ratio = self.nmt.length_ratio(segments)
        job.result.metrics = metrics.simulated_metrics(
            job.id, options, elapsed, duration, length_ratio,
            voice_cloned=voice_cloned, measured_similarity=measured_similarity)
        # per-segment speaker similarity only makes sense when the voice was
        # actually cloned (edge-tts uses a generic voice → leave it unset)
        base_sim = job.result.metrics.speaker_similarity
        if voice_cloned and base_sim:
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
        # preserve a custom message set during the stage (e.g. "No speech
        # detected"); only stamp the default when none was set.
        if self.st.message in ("", "Working…"):
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


def _rewarm_models(orch) -> None:
    """Reload STT + NMT to the GPU in a background thread after a CUDA Demucs
    run freed them, so the next job doesn't pay the cold-load cost inline."""
    import threading

    def warm() -> None:
        try:
            if orch.stt.available():
                orch.stt._load()
            if orch.nmt.available():
                orch.nmt._load()
        except Exception:
            pass
    threading.Thread(target=warm, daemon=True).start()


def _build_speaker_ref(job_id: str, segments: list[Segment]):
    """Trim the extracted source audio to a short reference clip and gather the
    matching source transcript, for OmniVoice zero-shot cloning.

    Returns (ref_audio_path | None, ref_text | None).
    """
    s = get_settings()
    src_wav = s.uploads_dir / f"{job_id}.wav"
    if not src_wav.exists():
        return None, None
    secs = s.omnivoice_ref_seconds
    ref_clip = s.uploads_dir / f"{job_id}_ref.wav"
    if not media.trim_audio(src_wav, ref_clip, secs):
        ref_clip = src_wav          # fall back to the full source audio
    ref_text = " ".join(x.source_text for x in segments if x.start < secs).strip()
    if not ref_text and segments:
        ref_text = segments[0].source_text
    return ref_clip, ref_text
