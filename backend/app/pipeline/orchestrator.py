"""Cascaded pipeline orchestration.

Runs ASR → NMT → TTS-VC → (Lip-Sync) → Sync for a job, awaiting blocking work
in worker threads and emitting live progress between steps. Each stage uses its
real implementation when available and its simulation fallback otherwise, so the
orchestrator behaves identically in both modes — only the `simulated` flag and
per-stage `mode` differ.
"""
from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from typing import Awaitable, Callable

from ..config import get_settings
from ..schemas import (DubOptions, Job, JobResult, Segment, StageState,
                       StageStatus)
from . import bleed, media, metrics, refine
from .lipsync import Wav2LipSync
from .nmt import NLLBTranslator
from .separation import DemucsSeparator
from .stt import WhisperSTT
from .stt_gigaam import GigaAMSTT
from . import stt_gigaam
from .sync import Synchronizer
from .tts import OmniVoiceTTS
from .tts_edge import EdgeTTS, TTSOutcome
from .voice_clone import OpenVoiceCloner

EmitFn = Callable[..., Awaitable[None]]

# Quality → Whisper model. "Fast" trades accuracy for a big speed-up (base is
# ~4-5× faster than medium); "Studio" is the paper's Whisper medium.
QUALITY_WHISPER = {"fast": "base", "balanced": "small", "studio": "medium"}


log = logging.getLogger(__name__)


class Orchestrator:
    def __init__(self) -> None:
        self.stt = WhisperSTT()
        self.giga = GigaAMSTT()   # Turkic + Russian ASR (see stt_gigaam)
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
            dict(key=self.stt.key, label=self.stt.label,
                 engine=(f"Whisper + {self.giga.engine}"
                         if self.giga.available() else self.stt.engine),
                 mode=self.stt.mode(),
                 detail=(f"GigaAM for {get_settings().gigaam_languages} · "
                         "Whisper elsewhere · silero-VAD gated"
                         if self.giga.available()
                         else "Whisper medium · silero-VAD gated"
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
                 detail=("Time-align + mux to container"
                         if self.sync.available()
                         else "Unavailable — ffmpeg is required to write a dub")),
        ]

    def is_simulated(self, options: DubOptions) -> bool:
        # Lip sync deliberately excluded. It is an optional extra on top of a
        # dub, and when it is unavailable the stage now says so itself — while
        # marking the whole job "simulation" implied the transcript, the
        # translation and the voice were fake too, when all three were real.
        return not (self.stt.mode() == "real" and self.nmt.mode() == "real"
                    and self._tts_available())

    async def _speaker_ref(self, job: Job, segments: list[Segment],
                           custom: Path | None, want_text: bool):
        """The voice to clone: an uploaded clip if given, else the source
        speaker.

        For an uploaded clip the transcript is produced by transcribing the
        TRIMMED reference rather than anything supplied alongside it. That is
        deliberate — OmniVoice speaks any reference text it is given that the
        reference audio does not cover, in the source language, at the head of
        every segment. Transcribing exactly what was trimmed makes the two
        agree by construction, so that failure cannot come back through this
        path.

        `want_text` is False for the tone-colour converter, which needs only
        audio; skipping transcription there saves an ASR pass per job.
        """
        if custom is None or not Path(custom).exists():
            return await asyncio.to_thread(_build_speaker_ref, job.id, segments)

        s = get_settings()
        clip = s.uploads_dir / f"{job.id}_ref.wav"
        ok = await asyncio.to_thread(media.trim_audio, Path(custom), clip,
                                     s.omnivoice_ref_seconds)
        if not ok:
            log.warning("[%s] supplied reference could not be trimmed — "
                        "falling back to the source speaker", job.id)
            return await asyncio.to_thread(_build_speaker_ref, job.id, segments)
        if not want_text:
            log.info("[%s] voice reference: supplied clip, %.1fs", job.id,
                     s.omnivoice_ref_seconds)
            return clip, None
        text = None
        try:
            heard, _lang, _d = await asyncio.to_thread(
                self.stt.transcribe, clip, "auto", "base")
            text = " ".join(x.source_text for x in heard).strip() or None
        except Exception as exc:
            log.warning("[%s] could not transcribe the supplied reference "
                        "(%s) — letting the model transcribe it itself",
                        job.id, type(exc).__name__)
        log.info("[%s] voice reference: supplied clip, %s chars of matching "
                 "transcript", job.id, len(text or ""))
        return clip, text

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
                  emit: EmitFn, force_simulate: bool = False,
                  preset_segments: list[Segment] | None = None,
                  reference_audio: Path | None = None) -> None:
        """Dub `input_video` into `job.options.target_lang`.

        `preset_segments` re-voices an existing transcript instead of producing
        one: the user corrected a translation and wants to hear it. Transcribing
        and translating again would only throw their edit away, so both stages
        are short-circuited and everything downstream — TTS, separation, mix,
        mux — runs exactly as it does for a first pass.

        `reference_audio` is a voice to dub in, supplied by the user instead of
        taken from the video. It replaces the speaker reference for whichever
        cloning mode is selected.
        """
        s = get_settings()
        options = job.options
        duration = await asyncio.to_thread(media.probe_duration, input_video)
        started = time.perf_counter()

        log.info(
            "[%s] START %s -> %s | quality=%s clone=%s lipsync=%s keep_bg=%s "
            "| duration=%ss force_simulate=%s",
            job.id, options.source_lang, options.target_lang, options.quality,
            options.voice_clone, options.lip_sync, options.keep_background,
            duration, force_simulate,
        )

        # `force_simulate` is set for the synthetic sample clip (no real speech
        # to transcribe) so the canned scenario is used end-to-end.
        real_asr = self.stt.mode() == "real" and not force_simulate
        real_nmt = self.nmt.mode() == "real" and not force_simulate
        real_tts = self.tts.mode() == "real" and not force_simulate
        used_real = False
        log.info("[%s] engines: asr=%s nmt=%s tts=%s separation=%s",
                 job.id, self.stt.mode(), self.nmt.mode(), self.tts.mode(),
                 self.sep.mode())

        # 1 ── ASR ---------------------------------------------------------
        async with _stage(job, "asr", emit) as st:
            vad_detail: dict = {}
            if preset_segments is not None:
                # Copies, so an edit to this job cannot reach back into the
                # transcript the original job is still holding.
                segments = [x.model_copy(deep=True) for x in preset_segments]
                detected = job.result.detected_source_lang or (
                    options.source_lang if options.source_lang != "auto" else "en")
                engine_mode = "reused"
                st.message = "Reused from the first run"
            elif real_asr:
                # Real ASR: never fabricate a transcript. If Whisper (VAD-gated)
                # finds no speech or errors, report that honestly — do NOT fall
                # back to the canned demo scenario.
                used_real = True
                try:
                    wav = s.uploads_dir / f"{job.id}.wav"
                    if not await asyncio.to_thread(media.extract_audio,
                                                   input_video, wav):
                        # Distinct from a silent video: there is nothing to
                        # transcribe, so reporting "no speech detected" would be
                        # a guess. ffmpeg's own reason is in the log.
                        raise RuntimeError("could not extract audio from the video")
                    # Engine selection. Whisper transcribes Turkic speech
                    # badly enough to be unusable — measured at 80% WER on
                    # Uzbek, written in a neighbouring alphabet — so those
                    # languages go to GigaAM instead. English stays on Whisper,
                    # which is better there. A source set to "auto" has to be
                    # resolved first, since the choice depends on the answer.
                    hint = options.source_lang
                    if hint != "auto":
                        # The user said what it is; that beats a guess.
                        use_giga = (self.giga.available()
                                    and stt_gigaam.supports(hint))
                    elif self.giga.available():
                        hint = await asyncio.to_thread(
                            self.stt.detect_language, wav) or "auto"
                        use_giga = stt_gigaam.supports_detected(hint)
                        log.info("[%s] asr: detected %s -> %s", job.id, hint,
                                 "GigaAM" if use_giga else "Whisper")
                    else:
                        use_giga = False
                    if use_giga:
                        asr_engine = f"GigaAM {s.gigaam_revision}"
                        regions = await asyncio.to_thread(
                            self.stt.speech_regions, wav)
                        segments, detected, vad_detail = await self._heartbeat(
                            job, "asr", emit,
                            lambda: self.giga.transcribe(wav, hint, regions))
                    else:
                        asr_engine = "Whisper"
                        wmodel = QUALITY_WHISPER.get(options.quality, "small")
                        segments, detected, vad_detail = await self._heartbeat(
                            job, "asr", emit,
                            lambda: self.stt.transcribe(wav, options.source_lang,
                                                        wmodel))
                        vad_detail = {**vad_detail, "model": wmodel}
                    vad_detail = {**vad_detail, "engine": asr_engine}
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
            # The transcript is where a looping phrase becomes visible: if the
            # same line repeats here it is a decoder loop, not the mix.
            # repeats_dropped (from stt._collapse_repeats) says how many the
            # guard already removed.
            log.info(
                "[%s] asr: mode=%s detected=%s segments=%s words=%s "
                "repeats_dropped=%s vad_regions=%s",
                job.id, engine_mode, detected, len(segments),
                sum(len(x.source_text.split()) for x in segments),
                vad_detail.get("repeats_dropped", 0),
                vad_detail.get("vad_regions", "n/a"),
            )
            for x in segments[:8]:
                log.info("[%s]   asr %6.2f-%6.2f  %s", job.id, x.start, x.end,
                         x.source_text[:90])
            if len(segments) > 8:
                log.info("[%s]   asr ... %s more segments", job.id, len(segments) - 8)
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
            if preset_segments is not None:
                # The text came from the user. Re-translating it would discard
                # the correction, and the repair pass below would second-guess
                # a person — so neither runs.
                st.message = "Using your edited translation"
            elif real_nmt:
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
            # Second pass over anything that came out visibly wrong. Reports as
            # part of translation because that is what it is; the stage detail
            # says how many lines were revised, not how.
            revised = 0
            if (segments and not force_simulate and preset_segments is None
                    and refine.available()):
                try:
                    revised, suspects = await self._heartbeat(
                        job, "nmt", emit,
                        lambda: refine.refine(segments, src_lang,
                                              options.target_lang))
                    for i, why in list(suspects.items())[:8]:
                        log.info("[%s]   nmt suspect %s: %s", job.id, i, why)
                except Exception as exc:
                    log.warning("[%s] translation repair skipped (%s)",
                                job.id, exc)
            job.result.segments = segments
            st.detail = {"length_ratio": self.nmt.length_ratio(segments),
                         "engine_mode": "simulation" if (not real_nmt or fell_back) else "real",
                         "target_lang": options.target_lang,
                         "revised": revised}
            if revised:
                st.message = f"{revised} line{'s' if revised > 1 else ''} revised"
            log.info("[%s] nmt: length_ratio=%s revised=%s", job.id,
                     self.nmt.length_ratio(segments), revised)
            await _tick(job, "nmt", emit, segments_preview(segments))

        # 3 ── TTS ---------------------------------------------------------
        # Which engine runs is decided by what the user asked the dub to sound
        # like, because the three answers need different engines:
        #
        #   "speaker"  OmniVoice, conditioned on a clip of the original. It
        #              reproduces the voice — including how its owner
        #              articulates — so a speaker dubbed out of their own
        #              language carries their accent into the target one. That
        #              is the cloning working, not failing: timbre and accent
        #              are the same signal and no dial separates them.
        #   "native"   edge-tts alone. A natural speaker of the target
        #              language, and none of the original's identity.
        #   "both"     edge-tts for the speech, then OpenVoice to transfer only
        #              the tone colour onto it. The accent and prosody come
        #              from the native voice, the timbre from the original, so
        #              this is the one that sounds like the speaker saying it
        #              properly. The likeness is looser than "speaker" —
        #              a converter matches timbre, it does not resynthesize
        #              the person.
        #
        # Each falls back down the chain when its engine is unavailable rather
        # than failing the job, and the placeholder tone is the last resort.
        dubbed_audio = s.outputs_dir / f"{job.id}_audio.wav"
        tts_engine = "simulation"
        voice_cloned = False
        measured_similarity: float | None = None
        voiced: TTSOutcome | None = None
        tts_stats: dict | None = None
        async with _stage(job, "tts", emit) as st:
            done = False
            # voice_mode is authoritative; voice_clone is what older clients
            # send, and maps onto the two modes that existed before.
            mode = options.voice_mode or (
                "speaker" if options.voice_clone else "native")
            if force_simulate:
                mode = "native"
            want_clone = mode in ("speaker", "both")
            log.info("[%s] tts: voice_mode=%s (voice_clone=%s)", job.id, mode,
                     options.voice_clone)
            # 1) OmniVoice — the speaker's own voice, accent included
            if mode == "speaker" and self.tts.mode() == "real":
                try:
                    ref_audio, ref_text = await self._speaker_ref(
                        job, segments, reference_audio, want_text=True)
                    tts_src = job.result.detected_source_lang or options.source_lang
                    lid = (self.stt.language_probs if self.stt.available()
                           else None)
                    ok = await self._heartbeat(job, "tts", emit,
                        lambda: self.tts.synthesize(segments, ref_audio, ref_text,
                                                    True, dubbed_audio, duration,
                                                    options.target_lang,
                                                    source_lang=tts_src,
                                                    language_probs=lid))
                    tts_stats = getattr(self.tts, "last_stats", None)
                    log.info("[%s] tts language check: %s (ref=%s)", job.id,
                             tts_stats, "yes" if ref_audio else "none")
                    if ok:
                        tts_engine, voice_cloned, used_real, done = \
                            "OmniVoice", bool(ref_audio), True, True
                except Exception as exc:
                    st.message = f"OmniVoice unavailable ({str(exc)[:45]})"
            # 2) edge-tts — real neural speech (generic per-language voice)
            if (not done and not force_simulate and segments
                    and self.edge.available()
                    and self.edge.supports(options.target_lang)):
                try:
                    voiced = await self._heartbeat(job, "tts", emit,
                        lambda: self.edge.synthesize(segments, options.target_lang,
                                                     dubbed_audio, duration))
                    # `ok` is false only when nothing at all was voiced. A dub
                    # missing some lines is kept and reported; it used to be
                    # discarded for the placeholder tone below.
                    if voiced.ok:
                        tts_engine, used_real, done = "edge-tts", True, True
                        # 2b) OpenVoice — clone the source speaker's timbre onto
                        # the generic edge-tts voice (real voice cloning here).
                        # Skipped in Fast mode (CPU cloning is slow on long audio).
                        if (mode == "both" and options.quality != "fast"
                                and self.cloner.available()):
                            try:
                                ref_audio, _ = await self._speaker_ref(
                                    job, segments, reference_audio,
                                    want_text=False)
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
                        elif mode == "both":
                            st.message = ("native voice (speaker match off in "
                                          "Fast mode)"
                                          if options.quality == "fast"
                                          else "native voice (speaker match "
                                               "unavailable)")
                        elif mode == "speaker":
                            # Wanted the speaker's own voice and could not have
                            # it; say so rather than quietly shipping a
                            # stranger's.
                            st.message = "native voice (speaker cloning unavailable)"
                        # Missing lines outrank whatever the clone had to say:
                        # it is the one thing here the viewer will actually
                        # notice in the finished video.
                        if voiced.voiced < voiced.total:
                            gap = (f"{voiced.total - voiced.voiced} of "
                                   f"{voiced.total} lines could not be "
                                   f"synthesized — the rest was dubbed")
                            st.message = (f"{gap}; {st.message}"
                                          if st.message not in ("", "Working…")
                                          else gap)
                        log.info(
                            "[%s] tts: voiced %s/%s chunks (network lost %s, "
                            "fit lost %s)", job.id, voiced.voiced, voiced.total,
                            voiced.lost_network, voiced.lost_fit,
                        )
                except Exception as exc:
                    st.message = f"edge-tts error ({str(exc)[:45]})"
            # 3) placeholder tone
            if not done:
                await _beat(0.7)
                await asyncio.to_thread(self.tts.simulate, duration or 25.0,
                                        dubbed_audio, options.voice_clone)
            st.detail = {"engine": tts_engine, "voice_mode": mode,
                         "voice_clone": voice_cloned,
                         "language_check": tts_stats,
                         "engine_mode": "real" if tts_engine != "simulation"
                         else "simulation",
                         **({"voiced": voiced.voiced, "lines": voiced.total}
                            if voiced is not None else {})}

        job.simulated = not used_real

        # 4 ── Background preservation (optional) --------------------------
        # Separate the ORIGINAL audio; keep the background (music/FX), drop the
        # original speech. The dubbed voice is mixed over it in the sync stage.
        # Fast mode skips the (slow, CPU) separation for speed.
        background: Path | None = None
        do_separation = (options.keep_background and options.quality != "fast"
                         and self.sep.available() and not force_simulate)
        # Log every input to this decision: "the fix did nothing" is usually
        # this branch not being taken at all, and the four reasons are
        # indistinguishable from the outside.
        log.info(
            "[%s] separation: run=%s (keep_background=%s quality=%s "
            "available=%s force_simulate=%s)",
            job.id, do_separation, options.keep_background, options.quality,
            self.sep.available(), force_simulate,
        )
        if do_separation:
            async with _stage(job, "separation", emit) as st:
                orig_hq = s.uploads_dir / f"{job.id}_orig.wav"
                sep_dir = s.outputs_dir / f"{job.id}_sep"
                sep_device = self.sep.resolve_device()
                if not await asyncio.to_thread(media.extract_audio_hq,
                                               input_video, orig_hq):
                    # Without this, Demucs was handed a path that does not
                    # exist and failed for a reason that read like a model
                    # problem.
                    st.message = "could not extract audio to separate — voice only"
                    log.warning("[%s] separation: audio extraction failed — "
                                "voice only", job.id)
                else:
                    if sep_device == "cuda":
                        # Demucs runs in its own process and cannot share the
                        # GPU with the models this one is holding — on a 6 GB
                        # box that is an OOM. Freeing them is what the CUDA
                        # path always documented and never did. ASR and NMT are
                        # finished by now, so this costs the next job a reload,
                        # which _rewarm_models covers off the request path.
                        log.info("[%s] separation: freeing STT+NMT for a CUDA "
                                 "Demucs run", job.id)
                        await asyncio.to_thread(self.stt.unload)
                        await asyncio.to_thread(self.nmt.unload)
                    try:
                        background = await self._heartbeat(
                            job, "separation", emit,
                            lambda: self.sep.separate_background(orig_hq, sep_dir,
                                                                 sep_device))
                    except Exception as exc:
                        st.message = f"separation failed ({str(exc)[:50]}) — voice only"
                    finally:
                        if sep_device == "cuda":
                            _rewarm_models(self)
                log.info("[%s] separation done: background_stem=%s device=%s",
                         job.id, background if background else "NONE (voice-only)",
                         sep_device)

                # Gate the original speech out of the bed and verify it is
                # gone — see pipeline/bleed.py for why the mixer's ducking on
                # the dub is not enough on its own.
                bleed_report: dict | None = None
                if background is not None:
                    bleed_lang = job.result.detected_source_lang or "auto"

                    def _words(clip: Path) -> list[str]:
                        segs, _, _ = self.stt.transcribe(
                            clip, bleed_lang, QUALITY_WHISPER.get(options.quality, "small"))
                        return [seg.source_text for seg in segs]

                    try:
                        background, bleed_report = await self._heartbeat(
                            job, "separation", emit,
                            lambda: bleed.suppress_original_speech(
                                background, background.parent / "vocals.wav",
                                [(seg.start, seg.end) for seg in job.result.segments],
                                sep_dir / "bleed", self.stt._vad,
                                _words if self.stt.available() else None, s))
                    except Exception as exc:
                        # The gate is what keeps the source language out; an
                        # ungated bed is exactly the bug this exists to fix,
                        # so failing it means voice-only, not "mix it anyway".
                        log.warning("[%s] bleed suppression failed (%s) — "
                                    "voice only", job.id, exc)
                        background, bleed_report = None, {"level": "error",
                                                          "error": str(exc)[:120]}
                    log.info("[%s] bleed: %s", job.id, bleed_report)
                    if background is None:
                        st.message = ("Original voice could not be removed "
                                      "cleanly — dubbed voice only")
                st.detail = {"kept_background": bool(background),
                             "device": sep_device,
                             "bleed": bleed_report,
                             # "real" describes whether Demucs ran, not whether
                             # its output was kept; kept_background carries that.
                             "engine_mode": "real"}
        else:
            _skip(job, "separation")
            await emit(job)

        # 5 ── Lip Sync (optional) ----------------------------------------
        working_video = input_video
        if options.lip_sync and self.lip.mode() != "real":
            # Asked for, not available. This used to pause for a second and
            # copy the video through, then report `enabled: True` — so the
            # stage showed as done, the toggle appeared to work, and the output
            # was byte-identical to leaving it off. Say plainly that it did not
            # run; a dub is still delivered, just without reshaped mouths.
            st = _find_stage(job, "lipsync")
            st.status = StageStatus.skipped
            st.progress = 1.0
            st.message = "Not available on this deployment — dubbed without it"
            st.detail = {"enabled": False, "reason": "engine not configured"}
            log.warning("[%s] lipsync requested but Wav2Lip is not configured "
                        "— skipping", job.id)
            await emit(job)
        elif options.lip_sync:
            lip_out = s.outputs_dir / f"{job.id}_lip.mp4"
            async with _stage(job, "lipsync", emit) as st:
                ok = await asyncio.to_thread(
                    self.lip.run, input_video, dubbed_audio, lip_out)
                if ok:
                    working_video = lip_out
                else:
                    st.message = "Lip sync failed — dubbed without it"
                st.detail = {"enabled": bool(ok)}
        else:
            _skip(job, "lipsync")
            await emit(job)

        # 6 ── Sync & Mux --------------------------------------------------
        # Fill in what is already known before the mux, so a job that fails here
        # still shows its source and its transcript. `output_url` stays unset
        # until there is genuinely a dubbed file to point it at.
        job.result.duration = duration
        job.result.source_url = _source_url(input_video)

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
            log.info(
                "[%s] mix: background=%s mixed=%s | final_audio=%s "
                "(voice_gain=%s background_gain=%s)",
                job.id, "present" if background is not None else "none", mixed,
                final_audio.name, s.voice_gain, s.background_gain,
            )
            st.detail = {"muxed": False, "background_kept": mixed}
            # Raises MuxFailed if the dub cannot be written. That propagates:
            # the stage is marked failed with the reason, the job fails, and
            # `output_url` below is never reached. There is deliberately nothing
            # to catch it with — the fallback this replaced returned the source
            # video, original soundtrack and all, as the finished dub.
            await asyncio.to_thread(self.sync.run, working_video,
                                    final_audio, out_video)
            log.info("[%s] mux: out=%s", job.id, out_video.name)
            st.detail = {**st.detail, "muxed": True}

        # ── finalise ------------------------------------------------------
        elapsed = time.perf_counter() - started
        job.result.output_url = f"/media/outputs/{out_video.name}"
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
    run freed them, so the next job doesn't pay the cold-load cost inline.

    Called from the separation stage when it ran on CUDA. Failures are
    swallowed on purpose: this is a warm-up, and `_load()` will simply do the
    work inline on the next job if it did not happen here.
    """
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
    """Cut a reference clip from the source audio and gather the transcript that
    matches it EXACTLY, for OmniVoice zero-shot cloning.

    The pairing has to be exact, because OmniVoice does two things with it.
    `models/omnivoice.py::_combine_text` prepends ref_text to the target text and
    generates the two together conditioned on ref_audio; and
    `utils/duration.py::estimate_duration` derives the speaker's rate from
    `ref_weight / ref_duration`. Text with no audio behind it therefore gets
    *spoken* — in the source language, at the head of what the model returns —
    and inflates the assumed speaking rate at the same time. When the caller
    also passes an explicit `duration`, that spurious speech shares the target's
    fixed token budget, so the real dubbed line is squeezed into what is left.

    This used to take the first `omnivoice_ref_seconds` of audio together with
    the text of every segment *starting* before that cutoff, so a segment
    straddling the boundary contributed all of its text and only part of its
    audio. Measured on a 44 s clip: 12.0 s of audio described by 20.0 s of text.
    The uncovered 8 s was heard repeating in English throughout the dub, and
    every duration estimate ran ~20/12 too fast.

    Whole segments only, then — a partial one cannot have its text trimmed to
    match, since segment timings are all the alignment we have.

    Returns (ref_audio_path | None, ref_text | None).
    """
    s = get_settings()
    src_wav = s.uploads_dir / f"{job_id}.wav"
    if not src_wav.exists() or not segments:
        return None, None
    limit = s.omnivoice_ref_seconds

    usable = [x for x in segments if x.end <= limit]
    if not usable:
        # The opening line alone is longer than the window. Use it whole rather
        # than cutting it: an over-long reference costs generation time, a
        # mismatched one costs correctness.
        usable = segments[:1]

    start, end = usable[0].start, usable[-1].end
    ref_clip = s.uploads_dir / f"{job_id}_ref.wav"
    if not media.trim_audio(src_wav, ref_clip, end - start, start=start):
        # No reference at all is better than a mismatched one: OmniVoice falls
        # back to its own voice, which is merely un-cloned rather than wrong.
        log.warning("[%s] could not cut a speaker reference — synthesizing "
                    "without voice cloning", job_id)
        return None, None
    ref_text = " ".join(x.source_text for x in usable).strip()
    log.info("[%s] speaker reference: %.2f-%.2fs (%.2fs) over %s segment(s), "
             "%s chars of matching transcript",
             job_id, start, end, end - start, len(usable), len(ref_text))
    return ref_clip, (ref_text or None)
