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
from . import media, timeline

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
                   target_lang: str | None = None) -> bool:
        """Synthesize each translated segment and lay it on a timeline that
        matches the source timing, then write a 24 kHz WAV for the sync stage.

        `target_lang` is the app language code (e.g. "uz"); it is mapped to an
        OmniVoice identifier and passed per segment so the text is voiced with
        the right phonetics instead of the model guessing.
        """
        import numpy as np
        import soundfile as sf

        model = self._load()
        clone = bool(voice_clone and ref_audio and Path(ref_audio).exists())
        ref = str(ref_audio) if clone else None
        language = resolve_language(target_lang)

        lines: list[tuple[Segment, str]] = []
        for seg in segments:
            text = (seg.target_text or seg.source_text or "").strip()
            if text:
                lines.append((seg, text))
        total = total_duration or (segments[-1].end if segments else 1.0)

        # Each clip gets a budget from `timeline`, exactly as the edge-tts path
        # does, and is placed against a cursor so it cannot land on top of the
        # line after it. Generation is sequential here, so the budget is
        # computed one line at a time rather than planned up front.
        #
        # The duration argument is a SOFT target — measured, asking OmniVoice to
        # compress is accurate (3.0 s requested -> 3.11 s) but it will not pad to
        # fill a longer slot (5.0 s -> 4.53 s). Undershooting only leaves a short
        # gap; overrunning is what used to put two dubbed voices in the same
        # samples, so `cut_to` bounds it whatever the model returns.
        placements: list[tuple[int, "np.ndarray"]] = []
        cursor = 0.0
        for i, (seg, text) in enumerate(lines):
            due_next = (lines[i + 1][0].start if i + 1 < len(lines)
                        else max(total, seg.end))
            at, target, limit = timeline.slot_budget(
                max(0.0, seg.start), seg.end, due_next, cursor)
            kwargs: dict = {"text": text}
            if language:
                kwargs["language"] = language
            # Very short slots keep the model's own estimate rather than being
            # forced into a rush.
            if target >= MIN_FITTED_SLOT:
                kwargs["duration"] = target
            if ref:
                kwargs["ref_audio"] = ref
                kwargs["ref_text"] = ref_text or ""
            out = model.generate(**kwargs)
            clip = np.asarray(out[0], dtype=np.float32).reshape(-1)
            clip = timeline.cut_to(clip, int(limit * SAMPLE_RATE), SAMPLE_RATE)
            if not clip.shape[0]:
                continue
            placements.append((int(at * SAMPLE_RATE), clip))
            cursor = at + clip.shape[0] / SAMPLE_RATE

        end = max((s + len(c) for s, c in placements),
                  default=int(total * SAMPLE_RATE))
        buf = np.zeros(max(end, int(total * SAMPLE_RATE)) + SAMPLE_RATE,
                       dtype=np.float32)
        timeline.write_without_overlap(buf, placements)
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            buf = buf / peak
        sf.write(str(out_audio), buf, SAMPLE_RATE)
        return Path(out_audio).exists()

    # ── simulation ────────────────────────────────────────────────────────
    def simulate(self, duration: float, out_audio: Path,
                 voice_clone: bool) -> bool:
        # faint tone when cloning "on" so the demo output is audibly distinct
        freq = 196 if voice_clone else 0
        return media.synth_silent_track(duration, out_audio, freq=freq)
