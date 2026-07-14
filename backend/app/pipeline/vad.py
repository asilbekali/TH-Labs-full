"""Voice Activity Detection with silero-vad.

Gates the ASR stage so Whisper only transcribes real speech. Without this,
Whisper hallucinates phantom text on music/silence (e.g. "Thanks for watching!")
and empty audio silently falls back to canned demo text. VAD lets us:
  • drop non-speech regions before/after transcription, and
  • report "no speech detected" honestly instead of inventing content.

silero-vad's own `read_audio` helper depends on torchcodec (whose DLL fails to
load on this Windows/Py3.14 setup), so we load audio with soundfile instead and
feed the tensor straight to `get_speech_timestamps`.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings

Region = tuple[float, float]


class SileroVAD:
    def __init__(self) -> None:
        import threading
        self._model = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo" or not s.vad_enabled:
            return False
        return (importlib.util.find_spec("silero_vad") is not None
                and importlib.util.find_spec("soundfile") is not None)

    def _load(self):
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            from silero_vad import load_silero_vad
            self._model = load_silero_vad()
        return self._model

    def speech_regions(self, audio: Path, sr: int = 16000) -> list[Region]:
        """Return [(start_s, end_s), ...] speech intervals (may be empty)."""
        import numpy as np
        import soundfile as sf
        import torch
        from silero_vad import get_speech_timestamps

        model = self._load()
        data, file_sr = sf.read(str(audio), dtype="float32", always_2d=False)
        if getattr(data, "ndim", 1) > 1:
            data = data.mean(axis=1)
        if file_sr != sr:                       # cheap linear resample to 16 kHz
            n = int(len(data) * sr / file_sr)
            data = np.interp(np.linspace(0, len(data), n, endpoint=False),
                             np.arange(len(data)), data).astype("float32")
        wav = torch.from_numpy(data)
        ts = get_speech_timestamps(wav, model, sampling_rate=sr,
                                   return_seconds=True, speech_pad_ms=120)
        return [(float(t["start"]), float(t["end"])) for t in ts]

    @staticmethod
    def overlaps(start: float, end: float, regions: list[Region],
                 min_frac: float = 0.2) -> bool:
        dur = max(end - start, 1e-6)
        need = min(0.3, min_frac * dur)
        for rs, re in regions:
            if max(0.0, min(end, re) - max(start, rs)) >= need:
                return True
        return False
