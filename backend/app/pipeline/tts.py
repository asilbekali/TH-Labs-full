"""Stage 3 — TTS + Voice Cloning with OmniVoice.

This is the pipeline's key innovation: a speaker reference extracted from the
source audio conditions synthesis so the dubbed speech keeps the original
speaker's timbre and identity instead of a generic narrator voice.

Real path uses the `omnivoice` package (zero-shot voice cloning):

    from omnivoice import OmniVoice
    model = OmniVoice.from_pretrained("k2-fsa/OmniVoice",
                                      device_map="cuda:0", dtype=torch.float16)
    audio = model.generate(text=..., ref_audio="ref.wav", ref_text="...")
    # -> list[np.ndarray] shape (T,) at 24 kHz

Each translated segment is synthesized and placed at its source start time, so
the dubbed track keeps the original performance's timing. Simulation produces a
placeholder track (sized to the video) so the muxed output still has audio.
"""
from __future__ import annotations

from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import media

SAMPLE_RATE = 24_000  # OmniVoice output sample rate

# Slots shorter than this keep the model's own duration estimate — forcing a
# sub-third-of-a-second target just makes the speech sound rushed.
MIN_FITTED_SLOT = 0.35  # seconds

# ── language configuration ────────────────────────────────────────────────
# OmniVoice's `generate(language=...)` takes an ISO code ("uz") or an English
# name ("Uzbek"); passing None runs "language-agnostic" mode, which its own
# docs call measurably worse. It matters most for our targets: Uzbek text left
# unlabelled can be voiced with a neighbouring language's phonetics, since the
# model covers 644 languages and several are orthographically close.
#
# 31 of the app's 32 language codes are already valid OmniVoice codes, so the
# default is to pass the code straight through. This table holds the
# exceptions plus the three primary targets, spelled out deliberately:
OMNIVOICE_LANG: dict[str, str] = {
    "uz": "uz",    # Uzbek — NLLB emits uzn_Latn (Northern Uzbek, Latin).
                   # "uzn" is also in OmniVoice's table if you want to pin the
                   # narrower variant; "uz" is the generic and is what we send.
    "ru": "ru",    # Russian — Cyrillic, matches NLLB's rus_Cyrl output.
    "en": "en",    # English.
    "ar": "arb",   # EXCEPTION: OmniVoice has no generic "ar", only variants
                   # (arb/arz/ary/...). arb = Modern Standard Arabic.
}


def dub_text(seg: Segment, same_language: bool = False) -> str:
    """The text to voice for a segment — its translation, and nothing else.

    Both engines used to fall back to `source_text` when a line had no
    translation, which voices the ORIGINAL sentence in the cloned ORIGINAL
    voice: indistinguishable, to a listener, from the source leaking through.
    A missing translation is now a silent gap. So is a "translation" that is
    the source copied verbatim (NMT copy-through), unless the job really is
    same-language."""
    target = (seg.target_text or "").strip()
    if not target:
        return ""
    if not same_language:
        norm = lambda t: " ".join(t.lower().split())
        if norm(target) == norm(seg.source_text or ""):
            return ""
    return target


# Clips shorter than this are not language-checked: Whisper's language ID needs
# about a second of speech to say anything reliable.
MIN_CHECKED_SECONDS = 1.0


def speaks_source(probs: dict[str, float] | None, source: str | None,
                  target: str | None) -> bool:
    """True when Whisper's language ID hears the SOURCE language, confidently
    and more than the target. Unknown/same languages never trip it."""
    if not probs or not source or not target or source == target \
            or source == "auto":
        return False
    p_src = probs.get(source, 0.0)
    return p_src > 0.5 and p_src > probs.get(target, 0.0)


def resolve_language(code: str | None) -> str | None:
    """Map an app language code to an OmniVoice identifier.

    Returns None for auto/unknown so the model falls back to its
    language-agnostic mode rather than being fed a bogus code.
    """
    if not code or code == "auto":
        return None
    return OMNIVOICE_LANG.get(code, code)


class OmniVoiceTTS:
    key = "tts"
    label = "Text-to-Speech + Voice Cloning"
    engine = "OmniVoice"

    def __init__(self) -> None:
        self._model = None
        self._importable: bool | None = None

    # ── capability probe ──────────────────────────────────────────────────
    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo":
            return False
        if importlib.util.find_spec("omnivoice") is None \
                or importlib.util.find_spec("soundfile") is None:
            return False
        # The package can be present but fail to import (e.g. it needs a newer
        # transformers than the one pinned for NLLB). Probe the import once and
        # cache it, so we don't advertise / attempt OmniVoice when it can't load.
        if self._importable is None:
            try:
                from omnivoice import OmniVoice  # noqa: F401
                self._importable = True
            except Exception:
                self._importable = False
        return self._importable

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def _load(self):
        if self._model is not None:
            return self._model
        from omnivoice import OmniVoice
        import torch
        s = get_settings()
        if s.omnivoice_device != "auto":
            device = s.omnivoice_device
        else:
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device.startswith("cuda") else torch.float32
        self._model = OmniVoice.from_pretrained(
            s.omnivoice_model, device_map=device, dtype=dtype)
        return self._model

    # ── real synthesis ────────────────────────────────────────────────────
    def synthesize(self, segments: list[Segment], ref_audio: Path | None,
                   ref_text: str | None, voice_clone: bool,
                   out_audio: Path, total_duration: float | None,
                   target_lang: str | None = None,
                   source_lang: str | None = None,
                   language_probs=None) -> bool:
        """Synthesize each translated segment and lay it on a timeline that
        matches the source timing, then write a 24 kHz WAV for the sync stage.

        `target_lang` is the app language code (e.g. "uz"); it is mapped to an
        OmniVoice identifier and passed per segment so the text is voiced with
        the right phonetics instead of the model guessing.

        `language_probs(clip, sample_rate) -> {code: p}` (Whisper language ID)
        checks every generated line. Zero-shot cloning can speak the
        reference's language instead of the target's; a line heard in the
        SOURCE language is regenerated, then regenerated without cloning, and
        dropped if it still fails. What happened is left in `self.last_stats`.
        """
        import numpy as np
        import soundfile as sf

        model = self._load()
        clone = bool(voice_clone and ref_audio and Path(ref_audio).exists()
                     and (ref_text or "").strip())
        ref = str(ref_audio) if clone else None
        language = resolve_language(target_lang)
        same_language = bool(source_lang and source_lang == target_lang)
        stats = {"lines": 0, "untranslated_skipped": 0, "checked": 0,
                 "regenerated": 0, "unclone_fallback": 0, "dropped": 0}
        self.last_stats = stats

        total = total_duration or (segments[-1].end if segments else 1.0)
        buf = np.zeros(int(total * SAMPLE_RATE) + SAMPLE_RATE, dtype=np.float32)

        for seg in segments:
            text = dub_text(seg, same_language)
            if not text:
                if (seg.source_text or "").strip():
                    stats["untranslated_skipped"] += 1
                continue
            stats["lines"] += 1
            # Fit the clip to its source slot so dubbed segments don't overrun
            # into the next one. OmniVoice targets the duration during
            # generation, which beats synthesising then time-stretching with
            # ffmpeg (what the edge-tts path has to do).
            #
            # Measured: it's a SOFT target. Asking it to compress is accurate
            # (3.0 s requested -> 3.11 s), but it will not pad to fill a longer
            # slot (5.0 s requested -> 4.53 s). That asymmetry suits dubbing:
            # overruns are what break timing, and undershooting just leaves a
            # short gap. Very short slots keep the model's own estimate rather
            # than forcing a rush.
            slot = seg.end - seg.start
            kwargs: dict = {"text": text}
            if language:
                kwargs["language"] = language
            if slot >= MIN_FITTED_SLOT:
                kwargs["duration"] = slot
            if ref:
                kwargs["ref_audio"] = ref
                kwargs["ref_text"] = ref_text or ""

            # Attempts, in order: as configured; again without the duration
            # target (squeezing a long translation into a short slot is when
            # the model is likeliest to fall back on the reference); then with
            # no reference at all — a generic voice in the right language beats
            # the right voice in the wrong one.
            attempts = [dict(kwargs)]
            if "duration" in kwargs:
                attempts.append({k: v for k, v in kwargs.items() if k != "duration"})
            if ref:
                attempts.append({k: v for k, v in kwargs.items()
                                 if k not in ("ref_audio", "ref_text")})
            clip = None
            for i, attempt in enumerate(attempts):
                out = model.generate(**attempt)
                cand = np.asarray(out[0], dtype=np.float32).reshape(-1)
                if (language_probs is None
                        or cand.shape[0] < MIN_CHECKED_SECONDS * SAMPLE_RATE):
                    clip = cand
                    break
                stats["checked"] += 1
                try:
                    probs = language_probs(cand, SAMPLE_RATE)
                except Exception:
                    probs = None          # a broken check must not block the dub
                if not speaks_source(probs, source_lang, target_lang):
                    clip = cand
                    if i:
                        stats["regenerated"] += 1
                        if "ref_audio" not in attempt and ref:
                            stats["unclone_fallback"] += 1
                    break
            if clip is None:
                stats["dropped"] += 1     # every attempt spoke the source
                continue
            start = int(max(0.0, seg.start) * SAMPLE_RATE)
            end = start + clip.shape[0]
            if end > buf.shape[0]:
                buf = np.pad(buf, (0, end - buf.shape[0]))
            buf[start:end] += clip

        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:                      # prevent clipping from overlaps
            buf = buf / peak
        sf.write(str(out_audio), buf, SAMPLE_RATE)
        return Path(out_audio).exists()

    # ── simulation ────────────────────────────────────────────────────────
    def simulate(self, duration: float, out_audio: Path,
                 voice_clone: bool) -> bool:
        # faint tone when cloning "on" so the demo output is audibly distinct
        freq = 196 if voice_clone else 0
        return media.synth_silent_track(duration, out_audio, freq=freq)
