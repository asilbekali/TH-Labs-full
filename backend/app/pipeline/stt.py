"""Stage 1 — ASR (Speech-to-Text) with Whisper medium.

Real path uses `faster-whisper` (CTranslate2) for word-level timestamps. If the
package is missing (or mode == demo) the stage returns a canned scenario so the
rest of the pipeline stays fully functional.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import samples


class WhisperSTT:
    key = "asr"
    label = "Speech-to-Text"
    engine = "Whisper medium"

    def __init__(self) -> None:
        self._model = None

    # ── capability probe ──────────────────────────────────────────────────
    def available(self) -> bool:
        # Detect installation WITHOUT importing the package: importing
        # faster-whisper (ctranslate2) alongside torch's CUDA context on every
        # health probe can crash the process. The heavy import happens lazily
        # in _load(), only when a real job actually runs.
        import importlib.util
        settings = get_settings()
        if settings.mode == "demo":
            return False
        return importlib.util.find_spec("faster_whisper") is not None

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def _load(self):
        if self._model is not None:
            return self._model
        from faster_whisper import WhisperModel
        s = get_settings()
        device = s.whisper_device if s.whisper_device != "auto" else (
            "cuda" if _has_cuda() else "cpu")
        compute = s.whisper_compute_type if s.whisper_compute_type != "auto" else (
            "float16" if device == "cuda" else "int8")
        self._model = WhisperModel(s.whisper_model, device=device,
                                   compute_type=compute)
        return self._model

    # ── real transcription ────────────────────────────────────────────────
    def transcribe(self, audio: Path, source_lang: str) -> tuple[list[Segment], str]:
        model = self._load()
        lang = None if source_lang == "auto" else source_lang
        segments_iter, info = model.transcribe(
            str(audio), language=lang, word_timestamps=True, vad_filter=True)
        out: list[Segment] = []
        for i, seg in enumerate(segments_iter):
            out.append(Segment(id=i, start=round(seg.start, 2),
                               end=round(seg.end, 2),
                               source_text=seg.text.strip()))
        return out, info.language

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


def _has_cuda() -> bool:
    try:
        import torch
        return torch.cuda.is_available()
    except Exception:
        return False
