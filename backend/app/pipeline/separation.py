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
from . import media

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

        # Is there actually a background worth preserving?
        #
        # htdemucs is trained on music: "vocals" means SUNG vocals. On a
        # talking-head clip with no music there is no M&E bed to keep — the
        # no_vocals stem is room tone plus whatever speech the model failed to
        # pull out. Mixing that back in does not preserve anything, it just
        # returns the source language to the dub, quietly, underneath the new
        # one.
        #
        # Measured on a real speech-only job: vocals -16.4 dB against no_vocals
        # -27.7 dB, and in the 300-3400 Hz dialogue band -23.3 vs -41.5. A gap
        # that large means the "background" is residue. With genuine music the
        # no_vocals stem is comparable to or louder than the vocals stem, so
        # the same test keeps it.
        #
        # keep_background asks to preserve music and effects. When there are
        # none, preserving nothing is the honest reading of that request.
        vocals = stem_dir / "vocals.wav"
        bg_db = media.mean_volume_db(bg)
        voc_db = media.mean_volume_db(vocals)
        if bg_db is not None and voc_db is not None:
            lead = voc_db - bg_db
            if lead >= s.background_min_lead_db:
                log.info(
                    "background is %.1f dB below vocals (%.1f vs %.1f) — "
                    "speech-only source, no music bed to keep; going voice-only "
                    "so the source language stays out of the dub",
                    lead, bg_db, voc_db,
                )
                return None
            log.info("background kept: %.1f dB below vocals (%.1f vs %.1f)",
                     lead, bg_db, voc_db)
        else:
            log.warning("could not measure stem levels (bg=%s vocals=%s) — "
                        "keeping background unmeasured", bg_db, voc_db)
        return bg
