"""Stage 1 — ASR (Speech-to-Text) with Whisper medium.

Real path uses **openai-whisper** (torch + tiktoken). We deliberately avoid
`faster-whisper` here: its ctranslate2 backend loads fine but its Whisper
tokenizer uses the HuggingFace `tokenizers` Rust extension, which segfaults on
Python 3.14. openai-whisper tokenizes with `tiktoken`, which is stable there.

If the package is missing (or mode == demo) the stage returns a canned scenario
so the rest of the pipeline stays fully functional.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import samples
from .vad import SileroVAD


class WhisperSTT:
    key = "asr"
    label = "Speech-to-Text"
    engine = "Whisper medium"

    def __init__(self) -> None:
        import threading
        self._models: dict[str, object] = {}   # model name → loaded model
        self._lock = threading.Lock()
        self._vad = SileroVAD()

    # ── capability probe (no heavy import — see config note) ──────────────
    def available(self) -> bool:
        import importlib.util
        settings = get_settings()
        if settings.mode == "demo":
            return False
        return importlib.util.find_spec("whisper") is not None

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def _load(self, model_name: str | None = None):
        name = model_name or get_settings().whisper_model
        if name in self._models:
            return self._models[name]
        with self._lock:
            if name in self._models:
                return self._models[name]
            import whisper
            s = get_settings()
            device = s.whisper_device if s.whisper_device != "auto" else (
                "cuda" if _has_cuda() else "cpu")
            self._models[name] = whisper.load_model(name, device=device)
        return self._models[name]

    def unload(self) -> None:
        with self._lock:
            self._models.clear()
        _free_cuda()

    # ── real transcription (VAD-gated) ────────────────────────────────────
    def transcribe(self, audio: Path, source_lang: str,
                   model_name: str | None = None) -> tuple[list[Segment], str, dict]:
        model = self._load(model_name)
        lang = None if source_lang == "auto" else source_lang

        # 1) VAD: find real speech regions. If VAD is active and finds none,
        #    report empty honestly instead of letting Whisper hallucinate.
        regions = None
        if self._vad.available():
            try:
                regions = self._vad.speech_regions(audio)
            except Exception:
                regions = None
        if regions is not None and len(regions) == 0:
            return [], (lang or "en"), {"vad_regions": 0, "speech_seconds": 0.0}

        # 2) Transcribe with anti-hallucination settings.
        #
        # `temperature` MUST be the fallback tuple, not a bare 0.0. The two
        # thresholds below only DETECT a bad decode; the fallback is what
        # recovers from one. Whisper re-decodes a segment at the next higher
        # temperature when it trips compression_ratio_threshold (the signal for
        # "this text is repetitive") or logprob_threshold. Pass a scalar and
        # there is nothing to fall back to, so the repetitive decode is kept
        # verbatim — which is exactly the "same phrase looping" symptom, since
        # every repeat then gets translated and voiced in turn.
        result = model.transcribe(
            str(audio), language=lang, word_timestamps=False, fp16=_has_cuda(),
            temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
            condition_on_previous_text=False,
            no_speech_threshold=0.6, logprob_threshold=-1.0,
            compression_ratio_threshold=2.4)

        out: list[Segment] = []
        for seg in result.get("segments", []):
            text = (seg.get("text") or "").strip()
            if not text:
                continue
            # Whisper's own no-speech signal (drops phantom lines on silence)
            if (seg.get("no_speech_prob", 0.0) > 0.6
                    and seg.get("avg_logprob", 0.0) < -0.5):
                continue
            # keep only what actually overlaps a detected speech region
            if regions is not None and not self._vad.overlaps(
                    seg["start"], seg["end"], regions):
                continue
            out.append(Segment(id=len(out), start=round(seg["start"], 2),
                               end=round(seg["end"], 2), source_text=text))

        # Second line of defence. The temperature fallback above makes loops
        # rare, not impossible — a run that trips no threshold still gets
        # through, and each survivor is translated and voiced separately, so
        # the viewer hears the phrase repeated.
        out, dropped = _collapse_repeats(out)

        detail = {}
        if regions is not None:
            detail = {"vad_regions": len(regions),
                      "speech_seconds": round(sum(e - s for s, e in regions), 1)}
        if dropped:
            detail["repeats_dropped"] = dropped
        return out, result.get("language", lang or "en"), detail

    # ── simulation ────────────────────────────────────────────────────────
    def simulate(self, duration: float | None,
                 scenario: str = "lecture") -> tuple[list[Segment], str]:
        sc = samples.get_scenario(scenario)
        raw = sc["segments"]
        # If we know the real media duration, rescale the canned timings to fit.
        total = raw[-1][1]
        scale = (duration / total) if (duration and duration > 1) else 1.0
        out = [
            Segment(id=i, start=round(s * scale, 2), end=round(e * scale, 2),
                    source_text=txt)
            for i, (s, e, txt) in enumerate(raw)
        ]
        return out, sc["source_lang"]


# A run this long of the identical line is a decoder loop, not speech. Two in a
# row is ordinary ("No. No."), so collapsing at 2 would edit real content out of
# the dub — the threshold starts where genuine repetition effectively stops.
_REPEAT_RUN = 3


def _normalize(text: str) -> str:
    """Casefold and strip punctuation/space, so 'Thank you.' == 'thank you'."""
    return "".join(ch for ch in text.lower() if ch.isalnum() or ch.isspace()).strip()


def _collapse_repeats(segments: list[Segment]) -> tuple[list[Segment], int]:
    """Drop decoder loops: runs of >= _REPEAT_RUN identical consecutive lines.

    Keeps the FIRST occurrence with its own timing and discards the rest,
    rather than merging the run into one long segment. That matters
    downstream: TTS fits each clip to its source slot, so a merged segment
    spanning a 60s loop would stretch one short phrase across a minute of
    audio. Keeping the first leaves the phrase spoken once, where it was
    actually said, and silence over the hallucinated tail.

    Returns the filtered segments (ids renumbered so they stay contiguous) and
    how many were dropped, which the caller surfaces as stage detail.
    """
    if not segments:
        return segments, 0

    kept: list[Segment] = []
    dropped = 0
    i = 0
    n = len(segments)

    while i < n:
        key = _normalize(segments[i].source_text)
        # Scan the full run of consecutive segments sharing this text.
        j = i + 1
        if key:
            while j < n and _normalize(segments[j].source_text) == key:
                j += 1
        run = j - i

        if key and run >= _REPEAT_RUN:
            kept.append(segments[i])       # first occurrence only
            dropped += run - 1
        else:
            kept.extend(segments[i:j])     # short run / blank key — untouched
        i = j

    for idx, seg in enumerate(kept):
        seg.id = idx
    return kept, dropped


def _has_cuda() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False


def _free_cuda() -> None:
    try:
        import gc
        import torch
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass
