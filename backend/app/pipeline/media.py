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
    """Provide the sample clip.

    Prefers the bundled real-speech lecture clip (so the sample exercises real
    STT/NMT); falls back to generating a branded test pattern + tone if ffmpeg
    is present but the bundled asset is missing.
    """
    if out_path.exists():
        return True
    bundled = Path(__file__).resolve().parent.parent / "assets" / "sample_source.mp4"
    if bundled.exists():
        return copy_passthrough(bundled, out_path)
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
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
    # choose an encoder compatible with the requested container/extension
    codec = "pcm_s16le" if out_path.suffix.lower() == ".wav" else "aac"
    try:
        subprocess.run(
            [ffmpeg, "-y", "-f", "lavfi", "-i", src,
             "-t", f"{max(duration, 0.5):.2f}", "-c:a", codec, str(out_path)],
            capture_output=True, timeout=60,
        )
        return out_path.exists()
    except Exception:
        return False


def trim_audio(src: Path, out_path: Path, seconds: float) -> bool:
    """Extract a short mono 24 kHz reference clip (for voice cloning)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src.exists():
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-t", f"{max(seconds, 1.0):.2f}",
             "-ac", "1", "-ar", "24000", str(out_path)],
            capture_output=True, timeout=60,
        )
        return out_path.exists()
    except Exception:
        return False


def tts_fit(src_audio: Path, out_wav: Path, slot_seconds: float,
            sr: int = 24000) -> bool:
    """Decode a synthesized clip to mono `sr` WAV, speeding it up (pitch-
    preserving atempo) only if it's longer than its time slot — so the dubbed
    line lands inside the original utterance without chipmunk artefacts."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src_audio.exists():
        return False
    dur = probe_duration(src_audio) or slot_seconds
    ratio = (dur / slot_seconds) if slot_seconds > 0 else 1.0
    tempo = min(max(ratio, 1.0), 1.6)           # only compress, cap at 1.6×
    cmd = [ffmpeg, "-y", "-i", str(src_audio)]
    if tempo > 1.01:
        cmd += ["-af", f"atempo={tempo:.3f}"]
    cmd += ["-ar", str(sr), "-ac", "1", str(out_wav)]
    try:
        subprocess.run(cmd, capture_output=True, timeout=60)
        return out_wav.exists()
    except Exception:
        return False


def split_audio(src: Path, out_dir: Path, seconds: float = 30.0,
                sr: int = 22050) -> list[Path]:
    """Split `src` into ~`seconds` mono WAV chunks (for chunked voice cloning
    so we never convert a huge track in one pass)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src.exists():
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    pat = str(out_dir / "seg_%04d.wav")
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-ar", str(sr), "-ac", "1",
             "-f", "segment", "-segment_time", str(seconds), pat],
            capture_output=True, timeout=300,
        )
    except Exception:
        return []
    return sorted(out_dir.glob("seg_*.wav"))


def concat_audio(paths: list[Path], out_path: Path) -> bool:
    """Concatenate same-format WAV chunks into one file."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not paths:
        return False
    listing = out_path.with_suffix(".txt")
    listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in paths))
    try:
        subprocess.run(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-c", "copy", str(out_path)],
            capture_output=True, timeout=180,
        )
        return out_path.exists()
    except Exception:
        return False
    finally:
        try:
            listing.unlink(missing_ok=True)
        except Exception:
            pass


def extract_audio_hq(video: Path, out_wav: Path) -> bool:
    """Extract full-quality stereo audio (for source separation / mixing)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(video), "-vn", "-ac", "2", "-ar", "44100",
             str(out_wav)],
            capture_output=True, timeout=180,
        )
        return out_wav.exists()
    except Exception:
        return False


def mix_voice_over_background(voice: Path, background: Path, out_path: Path,
                             voice_gain: float = 1.25,
                             bg_gain: float = 0.55) -> bool:
    """Mix the dubbed voice on top of the preserved background (M&E)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not voice.exists() or not background.exists():
        return False
    filt = (f"[0:a]volume={bg_gain}[bg];[1:a]volume={voice_gain}[v];"
            f"[bg][v]amix=inputs=2:duration=longest:normalize=0[out]")
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", str(background), "-i", str(voice),
             "-filter_complex", filt, "-map", "[out]",
             "-c:a", "pcm_s16le", str(out_path)],
            capture_output=True, timeout=180,
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
