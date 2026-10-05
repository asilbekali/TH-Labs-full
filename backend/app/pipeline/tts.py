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
    "uz": "uzn",   # Uzbek — the NARROW variant: Northern Uzbek, Latin script,
                   # which is what NLLB emits (uzn_Latn). The generic "uz" is
                   # also in OmniVoice's table and was used until listening
                   # comparison preferred "uzn". Noting the disagreement, since
                   # it is the sort of thing someone will re-measure: an ASR
                   # round-trip over identical text scored "uz" better (CER
                   # 0.258 vs 0.294 with whisper-small forced to Uzbek). That
                   # proxy is weak here — a native Uzbek voice speaking the
                   # same text only reached 0.228, so the measurement floor
                   # sits near the differences being compared — and a human
                   # listening to the audio is the better judge of how a voice
                   # pronounces a language.
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


# Whisper's language ID cannot tell these apart — asked about real Uzbek it
# answers "az" (see stt_gigaam.DETECTED_AS) — so a language in this group is
# scored as the whole group. Turkish stays out: Whisper identifies it reliably.
_TURKIC = frozenset({"uz", "kk", "ky", "az", "tk", "tt", "ba"})


def _family(code: str) -> frozenset[str]:
    return _TURKIC if code in _TURKIC else frozenset({code})


def speaks_source(probs: dict[str, float] | None, source: str | None,
                  target: str | None) -> bool:
    """True when Whisper's language ID hears the SOURCE language, confidently
    and more than the target. Unknown/same languages never trip it, and
    neither does a pair Whisper cannot separate (uz -> kk)."""
    if not probs or not source or not target or source == target \
            or source == "auto":
        return False
    src, tgt = _family(source), _family(target)
    if src & tgt:
        return False
    p_src = sum(probs.get(c, 0.0) for c in src)
    p_tgt = sum(probs.get(c, 0.0) for c in tgt)
    return p_src > 0.5 and p_src > p_tgt


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

        lines: list[tuple[Segment, str]] = []
        for seg in segments:
            text = dub_text(seg, same_language)
            if text:
                lines.append((seg, text))
            elif (seg.source_text or "").strip():
                stats["untranslated_skipped"] += 1
        stats["lines"] = len(lines)
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
            for n, attempt in enumerate(attempts):
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
                    if n:
                        stats["regenerated"] += 1
                        if "ref_audio" not in attempt and ref:
                            stats["unclone_fallback"] += 1
                    break
            if clip is None:
                stats["dropped"] += 1     # every attempt spoke the source
                continue
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
