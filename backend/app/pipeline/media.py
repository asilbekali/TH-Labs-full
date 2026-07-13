"""Media helpers built on ffmpeg/ffprobe (with graceful no-ffmpeg fallbacks)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path


def _bin(name: str) -> str | None:
    return shutil.which(name)


def probe_duration(path: Path) -> float | None:
    """Return media duration in seconds, or None if it can't be determined."""
    ffprobe = _bin("ffprobe")
    if not ffprobe or not path.exists():
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-show_format", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        data = json.loads(out.stdout or "{}")
        dur = data.get("format", {}).get("duration")
        return float(dur) if dur else None
    except Exception:
        return None


def extract_audio(video: Path, out_wav: Path) -> bool:
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(video), "-vn", "-ac", "1",
             "-ar", "16000", str(out_wav)],
            capture_output=True, timeout=120,
        )
        return out_wav.exists()
    except Exception:
        return False


def make_sample_video(out_path: Path, seconds: float = 25.0) -> bool:
    """Generate a self-contained branded sample clip (test pattern + tone)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    if out_path.exists():
        return True
    try:
        subprocess.run(
            [
                ffmpeg, "-y",
                "-f", "lavfi", "-i", f"testsrc=size=1280x720:rate=25:duration={seconds}",
                "-f", "lavfi", "-i", f"sine=frequency=220:duration={seconds}",
                "-vf", "drawtext=text='TH-Labs · sample clip':fontcolor=white:"
                       "fontsize=48:x=(w-text_w)/2:y=(h-text_h)/2:box=1:"
                       "boxcolor=black@0.5:boxborderw=20",
                "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
                "-shortest", str(out_path),
            ],
            capture_output=True, timeout=180,
        )
        return out_path.exists()
    except Exception:
        return False


def synth_silent_track(duration: float, out_path: Path,
                       freq: int = 0) -> bool:
    """Create a placeholder audio track (silence or faint tone) for the
    Simulation TTS stage so the muxed output still carries an audio channel."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    src = ("anullsrc=channel_layout=stereo:sample_rate=44100"
           if freq == 0 else f"sine=frequency={freq}:sample_rate=44100")
    try:
        subprocess.run(
            [ffmpeg, "-y", "-f", "lavfi", "-i", src,
             "-t", f"{max(duration, 0.5):.2f}", "-c:a", "aac", str(out_path)],
            capture_output=True, timeout=60,
        )
        return out_path.exists()
    except Exception:
        return False


def mux(video: Path, audio: Path, out_path: Path) -> bool:
    """Replace the video's audio track with `audio` (re-voiced speech)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(video), "-i", str(audio),
             "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
             "-c:a", "aac", "-shortest", str(out_path)],
            capture_output=True, timeout=180,
        )
        return out_path.exists()
    except Exception:
        return False


def copy_passthrough(src: Path, dst: Path) -> bool:
    try:
        shutil.copyfile(src, dst)
        return dst.exists()
    except Exception:
        return False
