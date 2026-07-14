"""Stage 3 — TTS + Voice Cloning with OmniVoice.

This is the pipeline's key innovation: a speaker reference extracted from the
source audio conditions synthesis so the dubbed speech keeps the original
speaker's timbre and identity instead of a generic narrator voice.

Real path uses the `omnivoice` package (zero-shot voice cloning):

    from omnivoice import OmniVoice
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice",
                                      device_map="cuda:0", dtype=torch.float16)
    audio = model.generate(text=..., ref_audio="ref.wav", ref_text="...")
    # -> list[np.ndarray] shape (T,) at 24 kHz

Each translated segment is synthesized and placed at its source start time, so
the dubbed track keeps the original performance's timing. Simulation produces a
placeholder track (sized to the video) so the muxed output still has audio.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import media

SAMPLE_RATE = 24_000  # OmniVoice output sample rate


class OmniVoiceTTS:
    key = "tts"
    label = "Text-to-Speech + Voice Cloning"
    engine = "OmniVoice"

    def __init__(self) -> None:
        self._model = None
        self._importable: bool | None = None

    # ── capability probe ──────────────────────────────────────────────────
    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo":
            return False
        if importlib.util.find_spec("omnivoice") is None \
                or importlib.util.find_spec("soundfile") is None:
            return False
        # The package can be present but fail to import (e.g. it needs a newer
        # transformers than the one pinned for NLLB). Probe the import once and
        # cache it, so we don't advertise / attempt OmniVoice when it can't load.
        if self._importable is None:
            try:
                from omnivoice import OmniVoice  # noqa: F401
                self._importable = True
            except Exception:
                self._importable = False
        return self._importable

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def _load(self):
        if self._model is not None:
            return self._model
        from omnivoice import OmniVoice
        import torch
        s = get_settings()
        if s.omnivoice_device != "auto":
            device = s.omnivoice_device
        else:
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        self._model = OmniVoice.from_pretrained(
            s.omnivoice_model, device_map=device, dtype=dtype)
        return self._model

    # ── real synthesis ────────────────────────────────────────────────────
    def synthesize(self, segments: list[Segment], ref_audio: Path | None,
                   ref_text: str | None, voice_clone: bool,
                   out_audio: Path, total_duration: float | None) -> bool:
        """Synthesize each translated segment and lay it on a timeline that
        matches the source timing, then write a 24 kHz WAV for the sync stage."""
        import numpy as np
        import soundfile as sf

        model = self._load()
        clone = bool(voice_clone and ref_audio and Path(ref_audio).exists())
        ref = str(ref_audio) if clone else None

        total = total_duration or (segments[-1].end if segments else 1.0)
        buf = np.zeros(int(total * SAMPLE_RATE) + SAMPLE_RATE, dtype=np.float32)

        for seg in segments:
            text = (seg.target_text or seg.source_text or "").strip()
            if not text:
                continue
            if ref:
                out = model.generate(text=text, ref_audio=ref,
                                     ref_text=ref_text or "")
            else:
                out = model.generate(text=text)
            clip = np.asarray(out[0], dtype=np.float32).reshape(-1)
            start = int(max(0.0, seg.start) * SAMPLE_RATE)
            end = start + clip.shape[0]
            if end > buf.shape[0]:
                buf = np.pad(buf, (0, end - buf.shape[0]))
            buf[start:end] += clip

        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:                      # prevent clipping from overlaps
            buf = buf / peak
        sf.write(str(out_audio), buf, SAMPLE_RATE)
        return Path(out_audio).exists()

    # ── simulation ────────────────────────────────────────────────────────
    def simulate(self, duration: float, out_audio: Path,
                 voice_clone: bool) -> bool:
        # faint tone when cloning "on" so the demo output is audibly distinct
        freq = 196 if voice_clone else 0
        return media.synth_silent_track(duration, out_audio, freq=freq)
