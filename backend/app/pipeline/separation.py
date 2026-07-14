"""Background preservation via Demucs source separation.

Professional dubbing keeps the original *music & effects* (the M&E track) and
replaces only the spoken dialogue. We use Demucs' two-stem split to separate the
original audio into `vocals` (the original speech — discarded) and `no_vocals`
(the background — kept). The dubbed voice is later mixed over that background, so
the result is *dubbed*, not *replaced*, and the original language is inaudible.

Runs Demucs as a subprocess so its torch/CUDA context is isolated from the API
server's loaded models. Device defaults to CPU here (the 6 GB GPU is full);
set TH_LABS_SEPARATION_DEVICE=cuda on a bigger GPU / cloud box for speed.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from ..config import get_settings


class DemucsSeparator:
    key = "separation"
    label = "Background Preservation"
    engine = "Demucs"

    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo":
            return False
        return (importlib.util.find_spec("demucs") is not None
                and bool(s.ffmpeg))

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def resolve_device(self) -> str:
        s = get_settings()
        if s.separation_device == "auto":
            try:
                import torch
                return "cuda" if torch.cuda.is_available() else "cpu"
            except Exception:
                return "cpu"
        return s.separation_device

    def separate_background(self, audio: Path, out_dir: Path,
                            device: str | None = None) -> Path | None:
        """Split `audio`; return the path to the background (no_vocals) stem."""
        s = get_settings()
        dev = device or self.resolve_device()
        out_dir.mkdir(parents=True, exist_ok=True)
        try:
            subprocess.run(
                [sys.executable, "-m", "demucs", "--two-stems=vocals",
                 "-n", s.separation_model, "-d", dev,
                 "-o", str(out_dir), str(audio)],
                capture_output=True, timeout=s.separation_timeout,
            )
        except Exception:
            return None
        bg = out_dir / s.separation_model / audio.stem / "no_vocals.wav"
        return bg if bg.exists() else None
