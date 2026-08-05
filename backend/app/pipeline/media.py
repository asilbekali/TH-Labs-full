"""Media helpers built on ffmpeg/ffprobe (with graceful no-ffmpeg fallbacks)."""
from __future__ import annotations

import json
import logging
import shutil
import subprocess
from pathlib import Path

log = logging.getLogger(__name__)


def _bin(name: str) -> str | None:
    return shutil.which(name)


def _run_ffmpeg(cmd: list[str], out_path: Path, what: str,
                timeout: int = 180) -> bool:
    """Run an ffmpeg command and report honestly whether it produced output.

    Every call site used to be `subprocess.run(...); return out_path.exists()`,
    which is wrong twice over: a non-zero exit was ignored, and a stale file
    left at that path by an earlier attempt would report success for a run that
    actually failed. ffmpeg's diagnosis went to a captured pipe nobody read, so
    a broken filter or a missing codec looked identical to silence.
    """
    try:
        # Remove any earlier artefact so `exists()` can only mean "this run
        # wrote it".
        out_path.unlink(missing_ok=True)
    except OSError:
        pass
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=timeout)
    except Exception as exc:
        log.warning("%s: ffmpeg did not run (%s)", what, exc)
        return False
    if proc.returncode != 0:
        tail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        log.warning("%s: ffmpeg exited %s — %s", what, proc.returncode,
                    " | ".join(tail[-3:]) or "no stderr")
        return False
    if not out_path.exists():
        log.warning("%s: ffmpeg reported success but wrote no file", what)
        return False
    return True


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
                             bg_gain: float = 0.25) -> bool:
    """Mix the dubbed voice on top of the preserved background (M&E).

    The background is DUCKED under the dubbed voice rather than laid flat
    beneath it. That is standard dubbing practice, and here it also does
    corrective work: the `no_vocals` stem is never perfectly clean, and the
    original dialogue that survives separation is loudest exactly where the
    original speaker was talking — which is exactly where the dubbed voice now
    talks. Ducking on the dub therefore attenuates the residue precisely when
    it would otherwise be audible, instead of leaving the source language
    murmuring underneath the dub.

    Falls back to a flat mix if the sidechain filter is unavailable, and the
    caller falls back to voice-only if this returns False — both degrade toward
    less original-language bleed, not more.
    """
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not voice.exists() or not background.exists():
        return False

    # Normalise both legs first: sidechaincompress requires a matching sample
    # rate and channel layout, and the two stems come from different tools
    # (Demucs writes 44.1k stereo, the TTS buffer is 24k mono).
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    ducked = (
        f"[0:a]{fmt},volume={bg_gain}[bg];"
        f"[1:a]{fmt},volume={voice_gain}[v];"
        f"[v]asplit=2[vmix][vkey];"
        # threshold low / ratio high: this is a duck, not gentle glue — when the
        # dub speaks, the bed gets out of the way. release keeps it from
        # pumping between words.
        f"[bg][vkey]sidechaincompress="
        f"threshold=0.02:ratio=12:attack=15:release=300:makeup=1[bgduck];"
        f"[bgduck][vmix]amix=inputs=2:duration=longest:normalize=0[out]"
    )
    flat = (f"[0:a]{fmt},volume={bg_gain}[bg];"
            f"[1:a]{fmt},volume={voice_gain}[v];"
            f"[bg][v]amix=inputs=2:duration=longest:normalize=0[out]")

    for filt, what in ((ducked, "mix (ducked)"), (flat, "mix (flat)")):
        if _run_ffmpeg(
            [ffmpeg, "-y", "-i", str(background), "-i", str(voice),
             "-filter_complex", filt, "-map", "[out]",
             "-c:a", "pcm_s16le", str(out_path)],
            out_path, what,
        ):
            return True
    return False


def mux(video: Path, audio: Path, out_path: Path) -> bool:
    """Replace the video's audio track with `audio` (re-voiced speech)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    # -map 0:v:0 -map 1:a:0 takes video from the source and audio ONLY from the
    # dubbed track; the source's own audio stream is deliberately not mapped,
    # so no original dialogue can reach the output through here.
    return _run_ffmpeg(
        [ffmpeg, "-y", "-i", str(video), "-i", str(audio),
         "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy",
         "-c:a", "aac", "-shortest", str(out_path)],
        out_path, "mux",
    )


def copy_passthrough(src: Path, dst: Path) -> bool:
    try:
        shutil.copyfile(src, dst)
        return dst.exists()
    except Exception:
        return False
