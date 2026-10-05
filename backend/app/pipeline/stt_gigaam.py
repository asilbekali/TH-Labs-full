"""ASR for the languages Whisper cannot actually transcribe.

Whisper is a poor fit for Turkic speech. Measured here on clean synthesized
Uzbek against a known transcript, `small` and `large-v3` both scored 80% WER and
wrote the language in a neighbouring alphabet — "boşlayimiz" for *boshlaymiz*,
"dünyadaqi" for *dunyodagi*. GigaAM Multilingual scored 0% on the same clip in
5.4 s, against large-v3's 138 s. Its published numbers say the same for Kazakh
and Kyrgyz, where Whisper large-v3 sits between 58% and 102% WER.

So this is a second ASR engine, not a replacement. It runs for the languages it
is better at (see `LANGUAGES`) and Whisper keeps everything else — including
English, where the ordering reverses: GigaAM's own card measures 9.4% against
Whisper's 3.9% on FLEURS.

Segmentation comes from silero VAD rather than the model. GigaAM returns a
transcript with no timestamps and refuses audio longer than about 30 s in one
pass, while the ASR stage already computes speech regions to gate Whisper. Those
regions are real speech boundaries instead of a decoder's guesses, they are
short enough to decode individually, and they give each segment an exact start
and end — which is what the rest of the pipeline places the dub against.
"""
from __future__ import annotations

import logging
from pathlib import Path

from ..config import get_settings
from ..schemas import Segment

log = logging.getLogger(__name__)

# Where GigaAM beats Whisper, from its own published table plus the measurement
# above. English is deliberately absent: it is in GigaAM's training set but
# Whisper is more than twice as accurate there, so routing English here would
# be a regression.
LANGUAGES = {"uz", "kk", "ky", "ru"}

# What Whisper's language detector reports for speech GigaAM should handle.
#
# Detection is done by the same model that cannot transcribe these languages,
# and it mistakes them for each other: asked to identify a real Uzbek clip it
# answered "az". Routing on that answer alone sent the audio straight back to
# the engine it was supposed to avoid.
#
# So a detection anywhere in this neighbourhood is treated as "GigaAM's
# problem". It does not need to be told which one — a character-wise CTC
# decoder over all of them does not take a language argument — so being wrong
# about *which* Turkic language costs nothing, while being wrong about *whether*
# it is Turkic costs the whole transcript.
#
# Turkish is deliberately excluded despite being Turkic: Whisper is trained
# heavily on it, identifies it reliably, and transcribes it well, while GigaAM
# does not cover it at all.
DETECTED_AS = {"uz", "kk", "ky", "ru", "az", "tk", "tt", "ba"}

# GigaAM decodes at 16 kHz mono.
SAMPLE_RATE = 16_000
# Hard ceiling: the model raises above roughly 30 s, and this leaves room
# rather than sitting on the limit.
MAX_CHUNK_SECONDS = 25.0
# What a segment should actually be. The ceiling is about what GigaAM will
# decode; this is about what the rest of the pipeline can use. Continuous
# speech yields one enormous VAD region — a real 60 s clip came back as a
# single region — and splitting that only at the ceiling gave three 20 s
# segments, which is far too coarse to place a dub against and long enough that
# NLLB truncated the translation (a measured length ratio of 0.52, i.e. lost
# content rather than concision).
TARGET_CHUNK_SECONDS = 9.0
# How far from an ideal split point to hunt for a quiet moment to cut on.
SPLIT_SEARCH_SECONDS = 1.5
# Window used to judge quietness when looking for that cut.
SPLIT_WINDOW_SECONDS = 0.08
# Regions shorter than this carry no word worth decoding and cost a forward
# pass to find that out.
MIN_CHUNK_SECONDS = 0.20


def _configured() -> set[str]:
    configured = {c.strip() for c in get_settings().gigaam_languages.split(",")
                  if c.strip()}
    return configured or LANGUAGES


def supports(lang: str | None) -> bool:
    """True if this engine should handle a language the user chose explicitly.

    The configured list wins over the module default, so a deployment can widen
    or narrow the routing without a code change.
    """
    if not lang or lang == "auto":
        return False
    return lang in _configured()


def supports_detected(lang: str | None) -> bool:
    """True if a *detected* language should be handed to this engine.

    Looser than `supports` on purpose — see DETECTED_AS. Applies only when the
    user left the source on auto; an explicit choice is authoritative and goes
    through `supports`.
    """
    if not lang or lang == "auto":
        return False
    return lang in (_configured() | DETECTED_AS) and lang != "tr"


class GigaAMSTT:
    key = "asr"
    label = "Speech-to-Text"
    engine = "GigaAM Multilingual"

    def __init__(self) -> None:
        import threading
        self._model = None
        self._lock = threading.Lock()

    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo" or not s.gigaam_enabled:
            return False
        # transformers loads it through trust_remote_code, and that remote code
        # imports hydra/pyannote. Checking for them here keeps the failure at
        # "engine unavailable, Whisper handles it" rather than an exception
        # halfway through a job.
        return all(importlib.util.find_spec(m) is not None
                   for m in ("transformers", "torch", "soundfile", "hydra",
                             "pyannote"))

    def mode(self) -> str:
        return "real" if self.available() else "simulation"

    def _load(self):
        if self._model is not None:
            return self._model
        with self._lock:
            if self._model is not None:
                return self._model
            import torch
            from transformers import AutoModel
            s = get_settings()
            model = AutoModel.from_pretrained(
                s.gigaam_model, revision=s.gigaam_revision,
                trust_remote_code=True)
            device = "cuda" if torch.cuda.is_available() else "cpu"
            self._model = model.to(device).eval()
            log.info("gigaam: loaded %s [%s] on %s", s.gigaam_model,
                     s.gigaam_revision, device)
        return self._model

    def unload(self) -> None:
        from .stt import _free_cuda
        with self._lock:
            self._model = None
        _free_cuda()

    # ── chunking ──────────────────────────────────────────────────────────
    @staticmethod
    def _quiet_point(audio: Path, around: float, rate: int,
                     total: float) -> float:
        """The quietest instant within SPLIT_SEARCH_SECONDS of `around`.

        Continuous speech has to be cut somewhere, and cutting at an arbitrary
        offset lands mid-word, which a CTC decoder renders as two fragments.
        Breath and inter-word gaps are still the quietest points even inside a
        region VAD calls unbroken, so the cut is moved to one.
        """
        import numpy as np
        import soundfile as sf

        lo = max(0.0, around - SPLIT_SEARCH_SECONDS)
        hi = min(total, around + SPLIT_SEARCH_SECONDS)
        if hi - lo < SPLIT_WINDOW_SECONDS * 2:
            return around
        data, _ = sf.read(str(audio), start=int(lo * rate), stop=int(hi * rate),
                          dtype="float32", always_2d=True)
        mono = data.mean(axis=1)
        win = max(int(SPLIT_WINDOW_SECONDS * rate), 1)
        n = len(mono) // win
        if n < 2:
            return around
        energy = [float(np.abs(mono[i * win:(i + 1) * win]).mean())
                  for i in range(n)]
        return lo + (int(min(range(n), key=energy.__getitem__)) + 0.5) * win / rate

    def _chunks(self, regions: list[tuple[float, float]], audio: Path,
                rate: int, total: float) -> list[tuple[float, float]]:
        """Cut VAD regions into segments the pipeline can actually dub against.

        Regions are split toward TARGET_CHUNK_SECONDS, at the quietest moment
        near each boundary, and never exceed MAX_CHUNK_SECONDS.
        """
        out: list[tuple[float, float]] = []
        for start, end in regions:
            span = end - start
            if span < MIN_CHUNK_SECONDS:
                continue
            if span <= MAX_CHUNK_SECONDS and span <= TARGET_CHUNK_SECONDS * 1.4:
                out.append((start, end))
                continue
            parts = max(2, round(span / TARGET_CHUNK_SECONDS))
            step = span / parts
            cuts = [start]
            for i in range(1, parts):
                cuts.append(self._quiet_point(audio, start + i * step, rate,
                                              total))
            cuts.append(end)
            cuts = sorted(set(round(c, 3) for c in cuts))
            out.extend((a, b) for a, b in zip(cuts, cuts[1:])
                       if b - a >= MIN_CHUNK_SECONDS)
        return out

    def transcribe(self, audio: Path, source_lang: str,
                   regions: list[tuple[float, float]] | None,
                   ) -> tuple[list[Segment], str, dict]:
        """Transcribe `audio` over `regions`, one segment per region.

        `regions` are the VAD speech intervals the caller already computed. With
        none supplied there is nothing to segment against, so the whole file
        becomes one region and is chunked by length — workable, but the segment
        boundaries are then arbitrary rather than real pauses.
        """
        import numpy as np
        import soundfile as sf

        model = self._load()
        total = 0.0
        with sf.SoundFile(str(audio)) as f:
            total = len(f) / f.samplerate
            file_rate = f.samplerate

        if not regions:
            log.warning("gigaam: no VAD regions — segmenting %s by length only",
                        audio.name)
            regions = [(0.0, total)]
        chunks = self._chunks(regions, audio, file_rate, total)

        scratch = audio.parent / f"{audio.stem}_giga.wav"
        segments: list[Segment] = []
        empty = 0
        for start, end in chunks:
            a, b = int(start * file_rate), int(min(end, total) * file_rate)
            if b <= a:
                continue
            data, _ = sf.read(str(audio), start=a, stop=b, dtype="float32",
                              always_2d=True)
            mono = data.mean(axis=1)
            sf.write(str(scratch), mono, file_rate)
            try:
                text = _as_text(model.transcribe(str(scratch))).strip()
            except Exception as exc:
                log.warning("gigaam: chunk %.2f-%.2f failed (%s)",
                            start, end, type(exc).__name__)
                continue
            if not text:
                empty += 1
                continue
            segments.append(Segment(id=len(segments), start=round(start, 2),
                                    end=round(end, 2), source_text=text))
        try:
            scratch.unlink(missing_ok=True)
        except OSError:
            pass

        detail = {"vad_regions": len(regions), "chunks": len(chunks),
                  "empty_chunks": empty,
                  "speech_seconds": round(sum(e - s for s, e in regions), 1),
                  "model": get_settings().gigaam_revision}
        log.info("gigaam: %s chunks over %s regions -> %s segments (%s empty)",
                 len(chunks), len(regions), len(segments), empty)
        return segments, source_lang, detail


def _as_text(value) -> str:
    """GigaAM returns a TranscriptionResult rather than a string."""
    if isinstance(value, str):
        return value
    for attr in ("text", "transcription", "hypothesis"):
        got = getattr(value, attr, None)
        if isinstance(got, str):
            return got
        if isinstance(got, (list, tuple)):
            return " ".join(str(x) for x in got)
    if isinstance(value, (list, tuple)):
        return " ".join(_as_text(v) for v in value)
    return str(value)
