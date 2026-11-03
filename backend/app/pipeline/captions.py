"""Word-level transcription for the video editor's auto subtitles.

The dubbing pipeline transcribes by segment (pipeline/stt.py) — enough to
translate and voice a line. Subtitles laid out the way CapCut does need every
WORD with its time, so a line can start exactly when its first word is said.
Whisper gives that with `word_timestamps=True`.

This keeps its own Whisper model rather than borrowing the pipeline's: the
shared model has stateful KV-cache hooks that two concurrent transcribe()
calls corrupt (see jobs.py), and a dub may be running while someone asks for
subtitles. One lock serialises caption requests among themselves.
"""
from __future__ import annotations

import importlib.util
import threading
from pathlib import Path

from ..config import get_settings
from .stt import _has_cuda

_model = None
_model_name: str | None = None
_lock = threading.Lock()


def available() -> bool:
    return (get_settings().mode != "demo"
            and importlib.util.find_spec("whisper") is not None)


def _load():
    global _model, _model_name
    name = get_settings().caption_model
    if _model is None or _model_name != name:
        import whisper
        _model = whisper.load_model(name, device="cuda" if _has_cuda() else "cpu")
        _model_name = name
    return _model


def transcribe_words(audio: Path, language: str = "auto") -> tuple[list[dict], str]:
    """Every word heard in `audio`, in order: [{word, start, end}], plus the
    language. Blocking; run it in a worker thread."""
    with _lock:
        model = _load()
        result = model.transcribe(
            str(audio),
            language=None if language == "auto" else language,
            word_timestamps=True,
            fp16=_has_cuda(),
            # The pipeline's anti-hallucination settings (see stt.py).
            temperature=(0.0, 0.2, 0.4, 0.6, 0.8, 1.0),
            condition_on_previous_text=False,
            no_speech_threshold=0.6,
            logprob_threshold=-1.0,
            compression_ratio_threshold=2.4,
        )
    words: list[dict] = []
    for seg in result.get("segments", []):
        # Whisper's own "this was silence" signal: drop phantom lines.
        if seg.get("no_speech_prob", 0.0) > 0.6 and seg.get("avg_logprob", 0.0) < -0.5:
            continue
        for w in seg.get("words") or []:
            text = (w.get("word") or "").strip()
            if text:
                words.append({"word": text,
                              "start": round(float(w["start"]), 3),
                              "end": round(float(w["end"]), 3)})
    return words, result.get("language") or (language if language != "auto" else "en")
