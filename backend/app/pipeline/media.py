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


def count_audio_streams(path: Path) -> int | None:
    """How many audio streams `path` carries, or None if it can't be probed.

    Used to check what the mux actually wrote rather than trusting its -map
    flags: exactly one audio stream is the difference between a dub and a file
    the original language can still play out of.
    """
    ffprobe = _bin("ffprobe")
    if not ffprobe or not path.exists():
        return None
    try:
        out = subprocess.run(
            [ffprobe, "-v", "quiet", "-print_format", "json",
             "-select_streams", "a", "-show_entries", "stream=index", str(path)],
            capture_output=True, text=True, timeout=30,
        )
        return len(json.loads(out.stdout or "{}").get("streams", []))
    except Exception:
        return None


def extract_audio(video: Path, out_wav: Path) -> bool:
    """Extract mono 16 kHz audio for ASR. False means Whisper has nothing to
    read — callers must not treat that as silence in the video."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg:
        return False
    return _run_ffmpeg(
        [ffmpeg, "-y", "-i", str(video), "-vn", "-ac", "1",
         "-ar", "16000", str(out_wav)],
        out_wav, f"extract_audio({video.name})", timeout=120,
    )


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
    return _run_ffmpeg(
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
        out_path, "make_sample_video", timeout=180,
    )


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
    return _run_ffmpeg(
        [ffmpeg, "-y", "-f", "lavfi", "-i", src,
         "-t", f"{max(duration, 0.5):.2f}", "-c:a", codec, str(out_path)],
        out_path, "synth_silent_track", timeout=60,
    )


def trim_audio(src: Path, out_path: Path, seconds: float,
               start: float = 0.0) -> bool:
    """Extract a mono 24 kHz reference clip (for voice cloning).

    `start` exists so the clip can be cut to a transcript's exact span rather
    than always from zero — see orchestrator._build_speaker_ref, where the clip
    and the text handed to OmniVoice have to describe the same speech.
    """
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src.exists():
        return False
    cmd = [ffmpeg, "-y"]
    if start > 0:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src), "-t", f"{max(seconds, 1.0):.2f}",
            "-ac", "1", "-ar", "24000", str(out_path)]
    return _run_ffmpeg(cmd, out_path, "trim_audio", timeout=60)


# Pitch-preserving compression ceiling. Past roughly 1.6x, atempo stops making
# a line sound hurried and starts making it sound mangled, so this is where
# compression gives up and the hard limit takes over.
TTS_MAX_TEMPO = 1.6
# Fade applied to a clip that had to be cut short, so the cut is not a click.
TTS_CUT_FADE = 0.08


# Level below which a synthesized clip's head and tail count as padding rather
# than speech. Well under any real utterance; only the ends are examined, so an
# internal pause can never be cut.
TTS_SILENCE_DB = -50
# A little head/tail silence is kept so onsets are not clipped bare.
TTS_KEEP_SILENCE = 0.02


def tts_trim(src_audio: Path, out_wav: Path, sr: int = 24000) -> bool:
    """Decode a synthesized clip to mono `sr` WAV with its leading and trailing
    silence removed.

    edge-tts pads every clip: measured across four lines, 0.246 s at the head
    and 0.929 s at the tail, consistently. Untrimmed, that padding is treated as
    speech three times over — it is placed on the timeline, so each dubbed line
    starts a quarter-second after the speaker does; it is counted into the
    duration `tts_fit` compresses against, so the real words get squeezed harder
    than the slot requires; and it advances the timeline cursor, so it eats into
    the room the *next* line gets. Trimming first makes all three arithmetic on
    speech instead of on silence.

    Only the head and tail are examined, so pauses between sentences inside a
    clip survive — those are the clip's own phrasing, not padding.
    """
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src_audio.exists():
        return False
    cut = (f"silenceremove=start_periods=1:start_threshold={TTS_SILENCE_DB}dB:"
           f"start_silence={TTS_KEEP_SILENCE}:detection=rms")
    return _run_ffmpeg(
        [ffmpeg, "-y", "-i", str(src_audio),
         "-af", f"{cut},areverse,{cut},areverse",
         "-ar", str(sr), "-ac", "1", str(out_wav)],
        out_wav, f"tts_trim({src_audio.name})", timeout=60,
    )


def tts_fit(src_audio: Path, out_wav: Path, target_seconds: float,
            sr: int = 24000, limit_seconds: float | None = None,
            max_tempo: float = TTS_MAX_TEMPO) -> bool:
    """Decode a synthesized clip to mono `sr` WAV and fit it to its place on the
    dubbed timeline, in two steps.

    1. **Compress** — pitch-preserving `atempo` toward `target_seconds`, never
       past `max_tempo`. This only ever speeds a clip up; one that is already
       shorter than its target is left alone rather than padded, so a short line
       does not drawl to fill the slot.
    2. **Hard-limit** — if compression alone could not get the clip under
       `limit_seconds`, cut it there, with a short fade so the cut is not a
       click.

    Step 2 is the point of this function. Compression used to be the only step,
    so anything needing more than `max_tempo` simply came out long: measured, a
    2.00 s slot whose translation needed 3.20x produced 3.99 s of speech. The
    caller then laid that clip at its start time and summed it into the output
    buffer, so its 1.99 s tail played on top of the next dubbed line and two
    voices spoke at once. Running over is the one failure this stage cannot pass
    downstream, so it is bounded here instead.

    `limit_seconds` defaults to `target_seconds`, i.e. clamp to the target.
    """
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src_audio.exists():
        return False
    target = max(target_seconds, 0.05)
    limit = max(limit_seconds if limit_seconds is not None else target, 0.05)
    dur = probe_duration(src_audio) or target
    tempo = min(max(dur / target, 1.0), max_tempo)

    af: list[str] = []
    if tempo > 1.01:
        af.append(f"atempo={tempo:.3f}")
    cmd = [ffmpeg, "-y", "-i", str(src_audio)]
    if dur / tempo > limit + 0.01:
        fade = min(TTS_CUT_FADE, limit / 2)
        af.append(f"afade=t=out:st={limit - fade:.3f}:d={fade:.3f}")
        cmd += ["-t", f"{limit:.3f}"]
        log.info("tts_fit: %s needs %.2fs, capped at %.2fx -> %.2fs, cut to "
                 "%.2fs so it cannot run over the next line",
                 src_audio.name, dur, tempo, dur / tempo, limit)
    if af:
        cmd += ["-af", ",".join(af)]
    cmd += ["-ar", str(sr), "-ac", "1", str(out_wav)]
    return _run_ffmpeg(cmd, out_wav, f"tts_fit({src_audio.name})", timeout=60)


def split_audio(src: Path, out_dir: Path, seconds: float = 30.0,
                sr: int = 22050) -> list[Path]:
    """Split `src` into ~`seconds` mono WAV chunks (for chunked voice cloning
    so we never convert a huge track in one pass)."""
    ffmpeg = _bin("ffmpeg")
    if not ffmpeg or not src.exists():
        return []
    out_dir.mkdir(parents=True, exist_ok=True)
    # Clear an earlier attempt's segments so the glob below can only return what
    # this run wrote.
    for stale in out_dir.glob("seg_*.wav"):
        try:
            stale.unlink(missing_ok=True)
        except OSError:
            pass
    pat = str(out_dir / "seg_%04d.wav")
    # Writes many files, so it cannot go through _run_ffmpeg (which verifies one
    # output path); the return code is checked the same way.
    try:
        proc = subprocess.run(
            [ffmpeg, "-y", "-i", str(src), "-ar", str(sr), "-ac", "1",
             "-f", "segment", "-segment_time", str(seconds), pat],
            capture_output=True, timeout=300,
        )
    except Exception as exc:
        log.warning("split_audio: ffmpeg did not run (%s)", exc)
        return []
    if proc.returncode != 0:
        tail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
        log.warning("split_audio: ffmpeg exited %s — %s", proc.returncode,
                    " | ".join(tail[-3:]) or "no stderr")
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
        return _run_ffmpeg(
            [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", str(listing),
             "-c", "copy", str(out_path)],
            out_path, "concat_audio", timeout=180,
        )
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
    return _run_ffmpeg(
        [ffmpeg, "-y", "-i", str(video), "-vn", "-ac", "2", "-ar", "44100",
         str(out_wav)],
        out_wav, f"extract_audio_hq({video.name})", timeout=180,
    )


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
