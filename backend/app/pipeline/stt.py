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
        result = model.transcribe(
            str(audio), language=lang, word_timestamps=False, fp16=_has_cuda(),
            temperature=0.0, condition_on_previous_text=False,
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

        detail = {}
        if regions is not None:
            detail = {"vad_regions": len(regions),
                      "speech_seconds": round(sum(e - s for s, e in regions), 1)}
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
