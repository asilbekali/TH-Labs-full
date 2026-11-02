"""Optional subtitles in the dub's own language.

Built from the translated segments the dub was voiced from, so the words on
screen are the words being spoken. Two outputs:

  - an .srt (download, and what ffmpeg burns in) and a .vtt (the browser
    player's <track>), both written whenever subtitles were asked for;
  - the dubbed video with those subtitles burned into the picture, so they
    survive being downloaded, re-uploaded or played anywhere.

Burning is best-effort. It needs an ffmpeg built with libass, and a failure
here must never cost the user their dub — the caller keeps the plain dubbed
video and the player shows the .vtt as a track instead.
"""
from __future__ import annotations

import logging
import textwrap
from pathlib import Path

from ..schemas import Segment
from . import media

log = logging.getLogger(__name__)

# Two lines of about this many characters is the usual broadcast limit; more
# than that and the viewer stops watching the picture to read.
LINE_CHARS = 42
MAX_LINES = 2

# libass style for burned-in text. Sizes are in libass's 288-line script space,
# so they scale with the video. DejaVu Sans covers Latin, Cyrillic and the
# Uzbek apostrophes (oʻ, gʻ); it is installed alongside ffmpeg in the image.
BURN_STYLE = ("FontName=DejaVu Sans,FontSize=16,PrimaryColour=&H00FFFFFF,"
              "OutlineColour=&H00000000,BorderStyle=1,Outline=1.6,Shadow=0,"
              "MarginV=22,Alignment=2")


def cues(segments: list[Segment]) -> list[tuple[float, float, str]]:
    """(start, end, text) cues, at most MAX_LINES lines each.

    A segment too long for one cue is split into several, sharing its time
    span in proportion to their length, rather than shown as a wall of text.
    """
    out: list[tuple[float, float, str]] = []
    for seg in segments:
        text = " ".join((seg.target_text or "").split())
        if not text or seg.end <= seg.start:
            continue
        lines = textwrap.wrap(text, LINE_CHARS) or [text]
        chunks = ["\n".join(lines[i:i + MAX_LINES])
                  for i in range(0, len(lines), MAX_LINES)]
        total = sum(len(c) for c in chunks)
        t = seg.start
        span = seg.end - seg.start
        for c in chunks:
            end = t + span * len(c) / total
            out.append((t, end, c))
            t = end
    return out


def _ts(seconds: float, sep: str) -> str:
    ms = max(0, int(round(seconds * 1000)))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def write_srt(items: list[tuple[float, float, str]], path: Path) -> None:
    body = "\n".join(f"{i}\n{_ts(a, ',')} --> {_ts(b, ',')}\n{t}\n"
                     for i, (a, b, t) in enumerate(items, 1))
    path.write_text(body, encoding="utf-8")


def write_vtt(items: list[tuple[float, float, str]], path: Path) -> None:
    body = "\n".join(f"{_ts(a, '.')} --> {_ts(b, '.')}\n{t}\n"
                     for a, b, t in items)
    path.write_text("WEBVTT\n\n" + body, encoding="utf-8")


def _filter_path(path: Path) -> str:
    # The subtitles filter parses its argument, so ':' and quotes in the path
    # have to be escaped or ffmpeg reads them as option separators.
    return (str(path).replace("\\", "\\\\").replace(":", "\\:")
            .replace("'", "\\'"))


def burn(video: Path, srt: Path, out_path: Path, duration: float | None) -> bool:
    """Write `video` with `srt` burned into the picture. False on any failure.

    Re-encodes the video (there is no way to draw on frames without it) and
    copies the audio untouched, so the dubbed track is exactly what was muxed.
    """
    ffmpeg = media._bin("ffmpeg")
    if not ffmpeg:
        return False
    vf = (f"subtitles=filename='{_filter_path(srt)}':charenc=UTF-8"
          f":force_style='{BURN_STYLE}'")
    # A re-encode runs at a few times real time on CPU; scale the timeout with
    # the clip instead of letting a long video hit the 180s default.
    timeout = int(max(300, (duration or 0) * 4))
    ok = media._run_ffmpeg(
        [ffmpeg, "-y", "-i", str(video), "-vf", vf,
         "-map", "0:v:0", "-map", "0:a:0",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-pix_fmt", "yuv420p", "-c:a", "copy",
         "-movflags", "+faststart", str(out_path)],
        out_path, "subtitles burn", timeout=timeout,
    )
    if ok and media.count_audio_streams(out_path) not in (None, 1):
        # Same guarantee the mux makes: one audio stream, the dubbed one.
        out_path.unlink(missing_ok=True)
        return False
    return ok
