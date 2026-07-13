"""Stage 5 — Synchronisation & mux.

Time-aligns the synthesized target-language audio to the source video's segment
boundaries and muxes it back into the container to produce the final dubbed
output. Uses ffmpeg when available; otherwise copies the source through so the
result is still playable.
"""
from __future__ import annotations

from pathlib import Path

from . import media


class Synchronizer:
    key = "sync"
    label = "Sync & Mux"
    engine = "ffmpeg"

    def available(self) -> bool:
        from ..config import get_settings
        return bool(get_settings().ffmpeg)

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def run(self, video: Path, audio: Path | None, out_video: Path) -> bool:
        """Mux revoiced audio with the (possibly lip-synced) video."""
        if audio and audio.exists() and self.available():
            if media.mux(video, audio, out_video):
                return True
        # fallback: keep the video as-is so playback always works
        return media.copy_passthrough(video, out_video)
