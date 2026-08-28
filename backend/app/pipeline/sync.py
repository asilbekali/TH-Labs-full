"""Stage 5 — Synchronisation & mux.

Time-aligns the synthesized target-language audio to the source video's segment
boundaries and muxes it back into the container to produce the final dubbed
output.

Alone among the stages, this one has no simulation fallback. It is the last
thing between a job and a file someone will play, and every way it can fail is a
way the original soundtrack reaches them labelled as a dub — so it raises.
"""
from __future__ import annotations

import logging
from pathlib import Path

from . import media

log = logging.getLogger(__name__)


class MuxFailed(RuntimeError):
    """The dubbed audio could not be muxed into the video.

    The fallback here used to be `copy_passthrough(video, out_video)` — "keep
    the video as-is so playback always works". What that actually produced was
    the source video *with its original soundtrack*: written to the output path,
    served from the output URL, listed in the user's library as a finished dub,
    and reported by the stage as `muxed: True`, because the only check made was
    that a file existed at that path. A total failure of the dub was
    indistinguishable from a success, from the outside and from the logs alike.

    Raising costs a playable file and buys the guarantee that anything this
    pipeline does hand back has the dubbed audio on it.
    """


class Synchronizer:
    key = "sync"
    label = "Sync & Mux"
    engine = "ffmpeg"

    def available(self) -> bool:
        from ..config import get_settings
        return bool(get_settings().ffmpeg)

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def run(self, video: Path, audio: Path | None, out_video: Path) -> None:
        """Replace the video's soundtrack with `audio` and write `out_video`.

        Returns nothing: it either wrote a dubbed video or raised MuxFailed
        saying why. Every failure path leaves no file behind, so a stale or
        undubbed artefact can never be served in place of the real thing.
        """
        if not self.available():
            raise MuxFailed("ffmpeg is not installed, so the dubbed audio "
                            "cannot be muxed into the video")
        if audio is None or not audio.exists():
            raise MuxFailed(
                "there is no dubbed audio to mux — "
                f"{audio.name if audio else 'the speech track'} was never written")
        if not media.mux(video, audio, out_video):
            raise MuxFailed("ffmpeg could not mux the dubbed audio into the "
                            "video (its output is in the pipeline log)")

        # Check what was written rather than trusting the -map flags. A second
        # audio stream would be the source's own, and players differ on which
        # one they pick — so it is not a cosmetic defect, it is the original
        # language reaching the viewer.
        streams = media.count_audio_streams(out_video)
        if streams is not None and streams != 1:
            out_video.unlink(missing_ok=True)
            raise MuxFailed(f"the muxed output carried {streams} audio streams "
                            "instead of 1; discarded it rather than serve a "
                            "file the original language can play out of")
        log.info("mux: %s written with the dubbed audio (%s audio stream)",
                 out_video.name,
                 streams if streams is not None else "unverified")
