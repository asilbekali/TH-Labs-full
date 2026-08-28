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

import logging
import subprocess
import sys
from pathlib import Path

from ..config import get_settings

log = logging.getLogger(__name__)


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
            proc = subprocess.run(
                [sys.executable, "-m", "demucs", "--two-stems=vocals",
                 "-n", s.separation_model, "-d", dev,
                 "-o", str(out_dir), str(audio)],
                capture_output=True, timeout=s.separation_timeout,
            )
        except subprocess.TimeoutExpired:
            log.warning("demucs timed out after %ss on %s — continuing "
                        "voice-only", s.separation_timeout, audio.name)
            return None
        except Exception as exc:
            log.warning("demucs did not run (%s) — continuing voice-only", exc)
            return None

        # The return code was previously ignored: a crashed run fell straight
        # through to the exists() check below and was indistinguishable from a
        # clean one, with demucs' explanation discarded into a captured pipe.
        if proc.returncode != 0:
            tail = (proc.stderr or b"").decode("utf-8", "replace").strip().splitlines()
            log.warning("demucs exited %s — %s", proc.returncode,
                        " | ".join(tail[-3:]) or "no stderr")
            return None

        stem_dir = out_dir / s.separation_model / audio.stem
        bg = stem_dir / "no_vocals.wav"
        if not bg.exists():
            log.warning("demucs finished but produced no no_vocals stem at %s", bg)
            return None

        # Is there actually a background worth preserving, or is the "background"
        # carrying the source dialogue? See speech_lift_db.
        vocals = stem_dir / "vocals.wav"
        measured = speech_lift_db(vocals, bg)
        if measured is None:
            log.warning("could not measure the stems (%s / %s) — going "
                        "voice-only, since an unmeasured background is the one "
                        "that might be carrying the source language",
                        vocals.name, bg.name)
            return None
        lift, corr, n_speech, n_quiet = measured
        if lift >= s.background_max_speech_lift_db:
            log.info(
                "background rises %+.1f dB while the original speaker talks "
                "(corr %.2f over %s speech / %s quiet windows) — that is the "
                "source dialogue, not a music bed; going voice-only so it "
                "stays out of the dub", lift, corr, n_speech, n_quiet,
            )
            return None
        log.info("background kept: rises %+.1f dB while the original speaker "
                 "talks (corr %.2f over %s speech / %s quiet windows) — "
                 "indifferent to the speech, so it is a real music/FX bed",
                 lift, corr, n_speech, n_quiet)
        return bg


# ── background residue measurement ────────────────────────────────────────
# Window for the RMS envelope: long enough to average out a glottal pulse,
# short enough to sit inside a single word.
WINDOW_SECONDS = 0.25
# A window counts as "the original speaker is talking" when the vocals stem is
# within this much of its own peak.
SPEECH_RANGE_DB = 25.0
# Below this the vocals stem holds no dialogue at all, so nothing can leak.
VOCALS_FLOOR_DB = -60.0
# Fewest windows of each kind before the comparison means anything.
MIN_WINDOWS = 8


def _window_rms_db(path: Path, window: float = WINDOW_SECONDS) -> list[float]:
    """Per-window RMS of `path` in dBFS, read incrementally.

    Streamed rather than loaded whole: a 16-minute 44.1 kHz stereo stem is
    ~340 MB as float32, and this runs on a box that already has Whisper and
    NLLB resident.
    """
    import numpy as np
    import soundfile as sf

    with sf.SoundFile(str(path)) as f:
        size = max(int(window * f.samplerate), 1)
    out: list[float] = []
    for block in sf.blocks(str(path), blocksize=size, dtype="float32",
                           always_2d=True):
        if block.shape[0] < size // 2:      # ragged tail — not a full window
            continue
        mono = block.mean(axis=1)
        out.append(20.0 * float(np.log10(np.sqrt(float((mono ** 2).mean())) + 1e-12)))
    return out


def speech_lift_db(vocals: Path, background: Path
                   ) -> tuple[float, float, int, int] | None:
    """How much louder the background stem gets while the original speaker is
    talking — the question this guard actually needs answered.

    A music-and-effects bed does not care whether anyone is speaking: its level
    is much the same in both kinds of window, so the lift sits around zero.
    Dialogue that survived separation is by definition loudest exactly when the
    original speaker was talking, so it shows up as a large positive lift.

    This replaces a comparison of the two stems' whole-file mean volumes. That
    number is dominated by however much silence a file happens to contain and
    says nothing about *what* the background is made of, so it answered a
    different question than the one being asked. Measured on the stems from real
    jobs: a 16-minute upload whose background carried the speaker read +26.4 dB
    with the two envelopes correlated at 0.95, while four clips with a genuine
    quiet bed read between -1.3 and -0.3 dB at correlations of 0.17 to 0.20. The
    two populations are ~26 dB apart, so the default threshold has wide margin
    either side. The old test would have kept the bleeding stem as soon as any
    music raised its mean.

    Returns (lift_db, envelope_correlation, speech_windows, quiet_windows), or
    None if the stems could not be measured — which callers should treat as a
    reason to drop the background, not to keep it.
    """
    import numpy as np

    try:
        voc = _window_rms_db(vocals)
        bg = _window_rms_db(background)
    except Exception as exc:
        log.warning("stem measurement failed (%s)", exc)
        return None

    n = min(len(voc), len(bg))
    if n < 2 * MIN_WINDOWS:
        return None
    v = np.asarray(voc[:n]); b = np.asarray(bg[:n])

    # No dialogue in the source at all: nothing can leak, so report no lift and
    # let the background through.
    if float(v.max()) < VOCALS_FLOOR_DB:
        return 0.0, 0.0, 0, n

    speech = v > (v.max() - SPEECH_RANGE_DB)
    quiet = ~speech
    if int(speech.sum()) < MIN_WINDOWS or int(quiet.sum()) < MIN_WINDOWS:
        return None

    lift = float(b[speech].mean() - b[quiet].mean())
    with np.errstate(invalid="ignore"):
        corr = float(np.corrcoef(v, b)[0, 1])
    if not np.isfinite(corr):
        corr = 0.0
    return lift, corr, int(speech.sum()), int(quiet.sum())
