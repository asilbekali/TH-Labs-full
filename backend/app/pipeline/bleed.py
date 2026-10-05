"""Keep the original voice out of the preserved background.

Source separation never removes speech completely: the `no_vocals` stem always
carries a faint copy of the original dialogue. The mixer ducks the background
under the DUBBED voice, but that is keyed on the wrong signal — the residue
lives where the ORIGINAL speaker talked, and the dub is usually shorter
(`tts_fit` only ever speeds speech up). Every gap between the end of a dubbed
line and the end of the original one was therefore a window where the source
language came back, undimmed.

So this gates the background on the original speech itself:

1. Windows = VAD on the clean `vocals` stem ∪ the ASR segment times, padded.
2. Inside a window the speech band (bleed_band_low_hz…high_hz) is cut hard and
   the rest of the spectrum only lightly — speech intelligibility lives in that
   band, while bass and cymbals carry the music, so the bed dips instead of
   vanishing.
3. The gated bed is CHECKED: VAD looks for speech left in it, and Whisper, in
   the source language, has to confirm actual words before it counts. A failed
   check escalates to a full-band cut over the windows plus wherever residue
   was found; a second failure drops the background and the dub goes out
   voice-only. Fewer words of the source language always wins over more music.

Every decision is returned as a report, which the orchestrator logs and puts
on the separation stage, so "is there bleed in job X" has a measured answer.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Callable, Iterable

log = logging.getLogger(__name__)

Region = tuple[float, float]
Transcriber = Callable[[Path], list[str]]


def merge_regions(regions: Iterable[Region], pad: float,
                  duration: float) -> list[Region]:
    """Pad, clip to [0, duration] and merge overlapping regions."""
    spans = sorted((max(0.0, s - pad), min(duration, e + pad))
                   for s, e in regions if e > s)
    out: list[Region] = []
    for s, e in spans:
        if e <= s:
            continue
        if out and s <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], e))
        else:
            out.append((s, e))
    return out


def gate_envelope(n: int, sr: int, regions: list[Region], depth_db: float,
                  fade_s: float):
    """Per-sample gain: 1 outside the regions, `depth_db` inside, with linear
    ramps of `fade_s` just outside each region so the cut never clicks."""
    import numpy as np

    gain = float(10 ** (depth_db / 20))
    env = np.ones(n, dtype=np.float32)
    fade = max(1, int(fade_s * sr))
    for s, e in regions:
        a, b = int(s * sr), min(n, int(e * sr))
        if b <= a:
            continue
        env[a:b] = np.minimum(env[a:b], gain)
        ra = max(0, a - fade)
        if a > ra:
            env[ra:a] = np.minimum(
                env[ra:a], np.linspace(1.0, gain, a - ra, endpoint=False))
        rb = min(n, b + fade)
        if rb > b:
            env[b:rb] = np.minimum(
                env[b:rb], np.linspace(gain, 1.0, rb - b, endpoint=False))
    return env


def apply_gate(src: Path, regions: list[Region], out_path: Path,
               band_db: float, full_db: float, low_hz: float,
               high_hz: float, fade_s: float) -> None:
    """Write `src` with the speech band at `band_db` and everything else at
    `full_db` inside `regions`. The band split is complementary (mid is what
    is left after removing low and high), so outside the regions the signal is
    reconstructed exactly."""
    import numpy as np
    import soundfile as sf
    from scipy.signal import butter, sosfiltfilt

    data, sr = sf.read(str(src), dtype="float32", always_2d=True)
    n = len(data)
    env_band = gate_envelope(n, sr, regions, band_db, fade_s)
    env_full = gate_envelope(n, sr, regions, full_db, fade_s)
    nyq = sr / 2
    sos_lo = butter(4, min(low_hz, nyq * 0.9), btype="lowpass", fs=sr,
                    output="sos")
    sos_hi = butter(4, min(high_hz, nyq * 0.95), btype="highpass", fs=sr,
                    output="sos")

    out = np.empty_like(data)
    # One channel at a time: sosfiltfilt works in float64, and a 15-minute
    # stereo stem is already ~230 MB in float32.
    for c in range(data.shape[1]):
        x = data[:, c].astype(np.float64)
        low = sosfiltfilt(sos_lo, x)
        high = sosfiltfilt(sos_hi, x)
        mid = x - low - high
        out[:, c] = ((low + high) * env_full + mid * env_band).astype(np.float32)
        del x, low, high, mid
    sf.write(str(out_path), out, sr, subtype="PCM_16")


def _clip_regions(src: Path, regions: list[Region], out_path: Path,
                  gap_s: float = 0.4) -> None:
    """Concatenate just the `regions` of `src` (mono, gaps of silence between)
    so Whisper reads seconds of candidate residue, not the whole bed."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(str(src), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    gap = np.zeros(int(gap_s * sr), dtype=np.float32)
    parts = []
    for s, e in regions:
        parts += [mono[int(s * sr):int(e * sr)], gap]
    sf.write(str(out_path), np.concatenate(parts) if parts else gap, sr,
             subtype="PCM_16")


def detect_bleed(bed: Path, vad, transcribe: Transcriber | None,
                 work_dir: Path, max_words: int, tag: str
                 ) -> tuple[bool, list[Region], dict]:
    """Is there still intelligible original speech in `bed`?

    VAD alone over-reports on music (a sung line or a breathy synth reads as
    speech), so it only nominates regions; Whisper in the source language has
    to transcribe more than `max_words` words there for it to count.

    The bed is checked loudness-normalised. Residue sits 20-30 dB under the
    music, and silero-VAD found nothing at all in real -27 dBFS beds; the
    listener, though, hears it whenever the music thins out."""
    import numpy as np
    import soundfile as sf

    data, sr = sf.read(str(bed), dtype="float32", always_2d=True)
    rms = float(np.sqrt(np.mean(np.square(data)))) if data.size else 0.0
    if rms > 0:
        gain = min(10 ** (-20 / 20) / rms, 10 ** (30 / 20))   # → -20 dBFS, ≤ +30 dB
        data = np.clip(data * gain, -1.0, 1.0)
    bed = work_dir / f"bleed_norm_{tag}.wav"
    sf.write(str(bed), data, sr, subtype="PCM_16")
    regions = vad.speech_regions(bed)
    seconds = sum(e - s for s, e in regions)
    report: dict = {"vad_regions": len(regions), "vad_seconds": round(seconds, 1),
                    "words": 0}
    if seconds < 0.5:
        return False, regions, report
    if transcribe is None:
        # No ASR to confirm with: be conservative, a few seconds of
        # speech-like signal is treated as bleed.
        report["unconfirmed"] = True
        return seconds >= 3.0, regions, report

    clip = work_dir / f"bleed_check_{tag}.wav"
    _clip_regions(bed, regions, clip)
    texts = transcribe(clip)
    text = " ".join(t.strip() for t in texts if t.strip())
    words = len(text.split())
    report["words"] = words
    if text:
        report["text"] = text[:160]
    return words > max_words, regions, report


def suppress_original_speech(background: Path, vocals: Path | None,
                             speech: list[Region], work_dir: Path, vad,
                             transcribe: Transcriber | None, settings
                             ) -> tuple[Path | None, dict]:
    """Return the background to mix (or None → voice-only) and a report."""
    import soundfile as sf

    s = settings
    duration = sf.info(str(background)).duration
    regions = list(speech)
    vad_ok = vad is not None and vad.available()
    if vad_ok and vocals is not None and vocals.exists():
        try:
            regions += vad.speech_regions(vocals)
        except Exception as exc:                     # segments still cover it
            log.warning("VAD on vocals stem failed (%s) — gating on ASR "
                        "segments only", exc)
    windows = merge_regions(regions, s.bleed_gate_pad_s, duration)
    report: dict = {"windows": len(windows),
                    "gated_seconds": round(sum(e - b for b, e in windows), 1),
                    "level": "none"}
    if not windows:
        return background, report

    work_dir.mkdir(parents=True, exist_ok=True)
    gated = work_dir / "background_gated.wav"
    apply_gate(background, windows, gated, s.bleed_gate_band_db,
               s.bleed_gate_full_db, s.bleed_band_low_hz, s.bleed_band_high_hz,
               s.bleed_gate_fade_s)
    report["level"] = "band"
    if s.bleed_max_words <= 0 or not vad_ok:
        report["check"] = "skipped"
        return gated, report

    bleed, found, chk = detect_bleed(gated, vad, transcribe, work_dir,
                                     s.bleed_max_words, "band")
    report["check"] = chk
    if not bleed:
        return gated, report

    # Escalate: full-band cut over the original windows AND wherever residue
    # turned up (VAD on the mix can miss quiet speech that the bed reveals).
    strict_windows = merge_regions(windows + found, s.bleed_gate_pad_s * 2,
                                   duration)
    strict = work_dir / "background_strict.wav"
    apply_gate(background, strict_windows, strict, s.bleed_strict_db,
               s.bleed_strict_db, s.bleed_band_low_hz, s.bleed_band_high_hz,
               s.bleed_gate_fade_s)
    bleed2, _, chk2 = detect_bleed(strict, vad, transcribe, work_dir,
                                   s.bleed_max_words, "strict")
    report.update(level="strict", check_strict=chk2,
                  gated_seconds=round(sum(e - b for b, e in strict_windows), 1))
    if not bleed2:
        return strict, report

    report["level"] = "dropped"
    return None, report
