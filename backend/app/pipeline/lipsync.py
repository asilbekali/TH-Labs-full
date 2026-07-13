"""Stage 4 (optional) — Lip synchronisation with Wav2Lip.

Only runs when the user enables the Lip Sync option in the Studio. Real path
shells out to a local Wav2Lip checkout; simulation passes the video through
unchanged (audio is still swapped by the sync stage).
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

from ..config import get_settings
from . import media


class Wav2LipSync:
    key = "lipsync"
    label = "Lip Sync"
    engine = "Wav2Lip"

    def available(self) -> bool:
        s = get_settings()
        if s.mode == "demo":
            return False
        return bool(s.wav2lip_dir and Path(s.wav2lip_dir).exists())

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    # ── real lip-sync ─────────────────────────────────────────────────────
    def run(self, video: Path, audio: Path, out_video: Path) -> bool:
        s = get_settings()
        wl = Path(s.wav2lip_dir)
        ckpt = wl / "checkpoints" / "wav2lip_gan.pth"
        try:
            subprocess.run(
                [sys.executable, str(wl / "inference.py"),
                 "--checkpoint_path", str(ckpt),
                 "--face", str(video), "--audio", str(audio),
                 "--outfile", str(out_video)],
                cwd=str(wl), capture_output=True, timeout=1800,
            )
            return out_video.exists()
        except Exception:
            return False

    # ── simulation (passthrough) ──────────────────────────────────────────
    def simulate(self, video: Path, out_video: Path) -> bool:
        return media.copy_passthrough(video, out_video)
