"""Uzbek TTS with Navoiy (aisha-org/navoiy-tts, Apache-2.0).

Navoiy is an LLM checkpoint for CosyVoice2-0.5B, fine-tuned on ~600 h of Uzbek.
Measured on the dev laptop (TTS_train/uz_eval, 2026-10-12): median CER 0-2 %
under GigaAM on hand-written and USC sentences, for three different reference
voices. It is used for Uzbek targets only; every other language keeps the
OmniVoice / edge-tts chain, and so does Uzbek whenever this engine is missing.

The model does not run in this process. CosyVoice pins torch 2.3 and
transformers 4.51, while this app needs transformers >= 5.3 for OmniVoice, so
the deployment runs Navoiy as a Modal class in an image of its own
(deploy/modal/modal_app.py) and hands it over with `bind()`. Nothing is bound
locally, so a laptop run simply skips this engine.

It runs in CosyVoice2's `instruct2` mode, as Navoiy's own inference script does:
the reference clip conditions only the flow model (timbre), and the language
model sees an English style instruction instead of the reference's speech
tokens. The source speaker's words therefore have no path into the dub, which
is the failure the OmniVoice language check exists for. The check is kept here
anyway, because it costs little and the leak was expensive to find.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import media, timeline
from .tts import MIN_CHECKED_SECONDS, dub_text, source_heard
from .tts_edge import TTSOutcome, _plan_timeline

log = logging.getLogger(__name__)

SAMPLE_RATE = 24_000           # CosyVoice2 output rate, same as the pipeline's
LANGUAGES = frozenset({"uz"})  # the only language Navoiy was trained on

# Lines per remote call. Batches are mapped over the Modal class, so a long
# video can fan out to several containers, while a short one stays on one.
BATCH_LINES = 12

# The Modal class that serves the model. Set by the deployment; see bind().
_remote = None


def bind(cls) -> None:
    """Hand this module the Modal class that serves Navoiy.

    Called by deploy/modal/modal_app.py before the app is imported. Keeping the
    handle injected, instead of looked up by app name, means `modal run`
    test functions reach the class of the app they are running in.
    """
    global _remote
    _remote = cls


class NavoiyTTS:
    key = "tts"
    label = "Text-to-Speech (Uzbek)"
    engine = "Navoiy"

    def __init__(self) -> None:
        self.last_stats: dict | None = None

    def available(self) -> bool:
        s = get_settings()
        return s.navoiy_enabled and s.mode != "demo" and _remote is not None

    def supports(self, target_lang: str | None) -> bool:
        return target_lang in LANGUAGES

    def warm(self) -> None:
        """Start a container while ASR and translation run, so the TTS stage
        does not wait out a cold start. Fire and forget, from a thread: the
        caller is on the event loop, where Modal's blocking API must not run."""
        import threading

        if not self.available():
            return

        def spawn() -> None:
            try:
                _remote().ping.spawn()
            except Exception as exc:
                log.warning("navoiy: warm-up failed (%s)", exc)

        threading.Thread(target=spawn, daemon=True).start()

    def hear(self, audio: Path, segments: list[Segment]) -> list[dict | None]:
        """How each segment was said in the source: the emotion model's
        {"label", "score"} per segment, or None where it could not tell.
        Never raises — no labels just means the text decides alone."""
        if not segments or not Path(audio).exists():
            return [None] * len(segments)
        try:
            heard = _remote().emotions.remote(
                Path(audio).read_bytes(),
                [[seg.start, seg.end] for seg in segments])
        except Exception as exc:
            log.warning("navoiy: emotion model failed (%s)", exc)
            return [None] * len(segments)
        if not isinstance(heard, list) or len(heard) != len(segments):
            return [None] * len(segments)
        return heard

    def _generate(self, texts: list[str], reference: bytes | None,
                  styles: list[str]):
        """Voice `texts` remotely, each with its preset from `styles`. Returns
        one float32 array per text, or None where that line failed."""
        import numpy as np

        if not texts:
            return []
        args = [(texts[i:i + BATCH_LINES], reference, styles[i:i + BATCH_LINES])
                for i in range(0, len(texts), BATCH_LINES)]
        clips: list = []
        for batch in _remote().synthesize.starmap(args, order_outputs=True):
            for raw in batch:
                clip = np.frombuffer(raw, dtype="<f4") if raw else None
                clips.append(clip if clip is not None and clip.size else None)
        return clips

    def synthesize(self, segments: list[Segment], ref_audio: Path | None,
                   out_audio: Path, total_duration: float | None,
                   source_lang: str | None = None,
                   target_lang: str | None = "uz",
                   language_probs=None) -> TTSOutcome:
        """Voice every translated line and lay it on the source timeline.

        `ref_audio` is the voice to clone; None uses the model's stock voice.
        Each line is spoken with its segment's `emotion` preset, calm if unset.
        Placement is the edge-tts path: trim, plan the timeline from the real
        clip lengths, compress toward each slot, cut at the collision limit.
        """
        import numpy as np
        import soundfile as sf

        same_language = bool(source_lang and source_lang == target_lang)
        lines: list[tuple[Segment, str]] = []
        stats = {"lines": 0, "untranslated_skipped": 0, "cloned": False,
                 "checked": 0, "unclone_fallback": 0, "dropped": 0}
        self.last_stats = stats
        for seg in segments:
            text = dub_text(seg, same_language)
            if text:
                lines.append((seg, text))
            elif (seg.source_text or "").strip():
                stats["untranslated_skipped"] += 1
        stats["lines"] = len(lines)
        total = total_duration or (segments[-1].end if segments else 1.0)
        if not lines:
            return TTSOutcome(False, 0, 0, 0, 0)

        reference = (Path(ref_audio).read_bytes()
                     if ref_audio and Path(ref_audio).exists() else None)
        stats["cloned"] = reference is not None
        texts = [t for _, t in lines]
        styles = [seg.emotion or "calm" for seg, _ in lines]
        clips = self._generate(texts, reference, styles)
        failed = sum(c is None for c in clips)

        # A line heard in the source language is voiced again in the stock
        # voice, then dropped if it still fails.
        if language_probs is not None:
            def heard(clip) -> bool:
                if clip is None or clip.shape[0] < MIN_CHECKED_SECONDS * SAMPLE_RATE:
                    return False
                stats["checked"] += 1
                try:
                    return source_heard(clip, SAMPLE_RATE, language_probs,
                                        source_lang, target_lang)
                except Exception:
                    return False      # a broken check must not block the dub
            flagged = [i for i, c in enumerate(clips) if heard(c)]
            if flagged and reference is not None:
                redo = self._generate([texts[i] for i in flagged], None,
                                      [styles[i] for i in flagged])
                for i, clip in zip(flagged, redo):
                    if clip is not None and not heard(clip):
                        clips[i] = clip
                        stats["unclone_fallback"] += 1
                    else:
                        clips[i] = None
                        stats["dropped"] += 1
            else:
                for i in flagged:
                    clips[i] = None
                    stats["dropped"] += 1

        work = out_audio.parent / f"{out_audio.stem}_navoiy"
        work.mkdir(parents=True, exist_ok=True)
        raws = [work / f"l{i}.wav" for i in range(len(lines))]
        trims = [work / f"l{i}_t.wav" for i in range(len(lines))]
        fits = [work / f"l{i}_f.wav" for i in range(len(lines))]

        def trim(i: int) -> float | None:
            if clips[i] is None:
                return None
            sf.write(str(raws[i]), clips[i], SAMPLE_RATE)
            if not media.tts_trim(raws[i], trims[i], SAMPLE_RATE):
                trims[i] = raws[i]      # untrimmed is still usable
            return media.probe_duration(trims[i]) or clips[i].shape[0] / SAMPLE_RATE

        with ThreadPoolExecutor(6) as pool:
            durations = list(pool.map(trim, range(len(lines))))

        chunks = [(max(0.0, seg.start), seg.end, text) for seg, text in lines]
        plan = _plan_timeline(chunks, durations, total)

        def fit(i: int):
            at, target, limit = plan[i]
            if durations[i] is None or not media.tts_fit(
                    trims[i], fits[i], target, SAMPLE_RATE, limit):
                return None
            data, _ = sf.read(str(fits[i]), dtype="float32")
            if getattr(data, "ndim", 1) > 1:
                data = data.mean(axis=1)
            return (int(at * SAMPLE_RATE), data) if len(data) else None

        with ThreadPoolExecutor(6) as pool:
            placed = [p for p in pool.map(fit, range(len(lines))) if p]

        end = max((s + len(d) for s, d in placed),
                  default=int(total * SAMPLE_RATE))
        buf = np.zeros(max(end, int(total * SAMPLE_RATE)) + SAMPLE_RATE,
                       dtype=np.float32)
        timeline.write_without_overlap(buf, placed)
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            buf = buf / peak
        sf.write(str(out_audio), buf, SAMPLE_RATE)

        for f in work.glob("*.wav"):
            f.unlink(missing_ok=True)
        try:
            work.rmdir()
        except OSError:
            pass
        voiced = len(placed)
        return TTSOutcome(
            ok=voiced > 0 and out_audio.exists(),
            voiced=voiced, total=len(lines),
            lost_network=failed,
            lost_fit=max(0, len(lines) - failed - stats["dropped"] - voiced),
        )
