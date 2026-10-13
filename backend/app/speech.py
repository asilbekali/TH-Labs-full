"""Text to speech — the Studio's /tts page.

Typed text becomes one audio file, with no video and no translation step.

    Uzbek            Navoiy (pipeline/tts_navoiy.py), its stock voice in one of
                     its emotion presets. OmniVoice speaks Uzbek too, and takes
                     over when Navoiy is not bound or fails.
    everything else  OmniVoice in voice-design mode. The `instruct` string
                     picks a gender, age and pitch.

Requests run as background tasks that the page polls, not as one long HTTP
call. Modal answers a web request that takes more than 150 s with a redirect,
and a cold Navoiy container alone takes 50-120 s to start.

Billing uses the dub ledger. `can-dub` checks an estimate before anything runs,
and `commit-dub` charges the seconds actually produced. So a failed render costs
nothing, and the price per second is the same as a Balanced dub.
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading
import time
import uuid
from dataclasses import asdict, dataclass, field

from . import billing
from .config import get_settings
from .pipeline import tts_navoiy
from .pipeline.tts import resolve_language

log = logging.getLogger(__name__)

MAX_CHARS = 1000
# Billing preflight only: about how many characters a second of speech holds.
# On the low side, so the estimate overshoots and a short wallet is turned away
# before the GPU work rather than after it.
CHARS_PER_SECOND = 12.0
BILLING_QUALITY = "balanced"

SAMPLE_RATE = 24_000          # both engines
SENTENCE_GAP = 0.18           # seconds of silence between Navoiy sentences
NAVOIY_CHUNK_CHARS = 220      # Navoiy is voiced sentence by sentence
OMNIVOICE_SEED = 1986         # same voice preset -> same voice, every time

# Navoiy's emotion presets. Navoiy was trained on exactly ten style
# instructions (emotions_40h.json); its other tags, such as excited, scared,
# gentle and sighs, are aliases for the same ten, and free-form instructions
# measurably change nothing. So the presets are the ten trained styles plus
# blends: a trained style, then a pitch shift (semitones) and a speed change
# applied to the audio.
#   id: (label, trained preset, semitones, tempo)
NAVOIY_STYLES: dict[str, tuple[str, str, float, float]] = {
    "calm": ("Calm", "calm", 0, 1),
    "warm": ("Warm", "warm", 0, 1),
    "happy": ("Happy", "happy", 0, 1),
    "sad": ("Sad", "sad", 0, 1),
    "angry": ("Angry", "angry", 0, 1),
    "nervous": ("Nervous", "nervous", 0, 1),
    "surprised": ("Surprised", "surprised", 0, 1),
    "whispers": ("Whisper", "whispers", 0, 1),
    "tired": ("Tired", "tired", 0, 1),
    "sarcastic": ("Sarcastic", "sarcastic", 0, 1),
    # blends
    "excited": ("Excited", "happy", 1.5, 1.12),
    "cheerful": ("Cheerful", "happy", 0.7, 1.04),
    "confident": ("Confident", "calm", -0.8, 1.06),
    "serious": ("Serious", "calm", -1.5, 0.94),
    "storyteller": ("Storyteller", "warm", -1.0, 0.9),
    "gentle": ("Gentle", "warm", -0.3, 0.92),
    "furious": ("Furious", "angry", 0.8, 1.1),
    "scared": ("Scared", "nervous", 1.2, 1.1),
    "melancholy": ("Melancholy", "sad", -1.0, 0.88),
    "sleepy": ("Sleepy", "tired", -1.2, 0.85),
    "mysterious": ("Mysterious", "whispers", -1.0, 0.9),
}


# OmniVoice voice design. Values must come from its attribute list
# (docs/voice-design.md upstream): gender, age, pitch, and "whisper".
OMNIVOICE_VOICES: dict[str, tuple[str, str]] = {
    "female": ("Female", "female, young adult, moderate pitch"),
    "male": ("Male", "male, young adult, low pitch"),
    "female-mature": ("Female · mature", "female, middle-aged, low pitch"),
    "male-deep": ("Male · deep", "male, middle-aged, very low pitch"),
    "female-bright": ("Female · bright", "female, teenager, high pitch"),
    "whisper": ("Whisper", "female, young adult, whisper"),
}


def split_sentences(text: str, max_chars: int = NAVOIY_CHUNK_CHARS) -> list[str]:
    """Split `text` at sentence ends, then pack the sentences into chunks of at
    most `max_chars`. A single sentence longer than that is cut at commas, and
    then at spaces."""
    text = " ".join(text.split())
    if not text:
        return []
    sentences = re.split(r"(?<=[.!?…])\s+", text)
    pieces: list[str] = []
    for s in sentences:
        if len(s) <= max_chars:
            pieces.append(s)
            continue
        parts = re.split(r"(?<=[,;:])\s+", s)
        buf = ""
        for p in parts:
            while len(p) > max_chars:
                cut = p.rfind(" ", 0, max_chars)
                cut = cut if cut > 0 else max_chars
                if buf:
                    pieces.append(buf)
                    buf = ""
                pieces.append(p[:cut].strip())
                p = p[cut:].strip()
            if buf and len(buf) + 1 + len(p) > max_chars:
                pieces.append(buf)
                buf = p
            else:
                buf = f"{buf} {p}".strip()
        if buf:
            pieces.append(buf)
    chunks: list[str] = []
    for p in pieces:
        if chunks and len(chunks[-1]) + 1 + len(p) <= max_chars:
            chunks[-1] = f"{chunks[-1]} {p}"
        else:
            chunks.append(p)
    return [c for c in chunks if c]


@dataclass
class SpeechTask:
    id: str
    owner_id: int
    language: str
    voice: str
    chars: int
    status: str = "queued"            # queued | running | done | failed
    engine: str | None = None
    audio_url: str | None = None
    duration: float | None = None
    error: str | None = None
    credits_charged: int | None = None
    balance_after: int | None = None
    created: float = field(default_factory=time.time)

    def public(self) -> dict:
        d = asdict(self)
        d.pop("owner_id")
        return d


class SpeechService:
    def __init__(self, orchestrator) -> None:
        self._orch = orchestrator
        self._tasks: dict[str, SpeechTask] = {}
        self._navoiy = orchestrator.navoiy

    # ── what can run ───────────────────────────────────────────────────────
    def _omnivoice_ok(self) -> bool:
        return self._orch.tts.mode() == "real"

    def engine_for(self, language: str) -> str | None:
        if language in tts_navoiy.LANGUAGES and self._navoiy.available():
            return "Navoiy"
        if self._omnivoice_ok():
            return "OmniVoice"
        return None

    def voices(self) -> dict:
        return {
            "navoiy": {"available": self._navoiy.available(),
                       "languages": sorted(tts_navoiy.LANGUAGES),
                       "voices": [{"id": k, "label": v[0],
                                   "group": "trained" if k == v[1] else "blend"}
                                  for k, v in NAVOIY_STYLES.items()],
                       "default": "calm"},
            "omnivoice": {"available": self._omnivoice_ok(),
                          "voices": [{"id": k, "label": v[0]}
                                     for k, v in OMNIVOICE_VOICES.items()],
                          "default": "female"},
            "max_chars": MAX_CHARS,
        }

    def warm(self, language: str) -> None:
        """Get the engine for `language` ready while the user is still typing:
        start a Navoiy container, or load OmniVoice into this one."""
        engine = self.engine_for(language)
        if engine == "Navoiy":
            self._navoiy.warm()
        elif engine == "OmniVoice" and self._orch.tts._model is None:
            def load() -> None:
                try:
                    with self._orch.tts.lock:
                        self._orch.tts._load()
                except Exception as exc:
                    log.warning("tts: omnivoice warm-up failed (%s)", exc)
            threading.Thread(target=load, daemon=True).start()

    # ── tasks ──────────────────────────────────────────────────────────────
    def get(self, task_id: str, owner_id: int) -> SpeechTask | None:
        task = self._tasks.get(task_id)
        return task if task and task.owner_id == owner_id else None

    async def start(self, text: str, language: str, voice: str | None,
                    owner_id: int, token: str) -> SpeechTask:
        """Validate, check credits, queue the render. Raises HTTPException with
        a sentence for the user; once a task exists, failures go on the task."""
        from fastapi import HTTPException

        text = " ".join((text or "").split())
        if not text:
            raise HTTPException(400, "Type something to read out.")
        if len(text) > MAX_CHARS:
            raise HTTPException(
                400, f"That is {len(text)} characters; the limit is {MAX_CHARS}.")
        engine = self.engine_for(language)
        if engine is None:
            raise HTTPException(
                503, "Text to speech isn't available on this server right now.")

        # A voice id belongs to one engine. A Navoiy style sent for OmniVoice
        # (Uzbek on fallback) falls back to that engine's default voice.
        if engine == "Navoiy":
            voice = voice if voice in NAVOIY_STYLES else "calm"
        else:
            voice = voice if voice in OMNIVOICE_VOICES else "female"

        gate = await billing.can_dub(token, len(text) / CHARS_PER_SECOND,
                                     BILLING_QUALITY)
        if gate.trimmed:
            # A dub can be cut to what the wallet covers; a script cannot.
            raise HTTPException(
                402, f"You have {gate.balance} credits — not enough to voice "
                     "all of this text. Shorten it, or buy credits.")

        task = SpeechTask(id=uuid.uuid4().hex[:12], owner_id=owner_id,
                          language=language, voice=voice, chars=len(text),
                          engine=engine)
        self._tasks[task.id] = task
        asyncio.get_running_loop().create_task(
            self._run(task, text, token))
        return task

    async def _run(self, task: SpeechTask, text: str, token: str) -> None:
        import soundfile as sf

        task.status = "running"
        s = get_settings()
        out = s.outputs_dir / f"tts_{task.id}.wav"
        try:
            audio = None
            if task.engine == "Navoiy":
                try:
                    audio = await asyncio.to_thread(
                        self._navoiy_speak, text, task.voice)
                except Exception as exc:
                    log.warning("tts %s: navoiy failed (%s)", task.id, exc)
                if audio is None and self._omnivoice_ok():
                    task.engine, task.voice = "OmniVoice", "female"
            if audio is None and task.engine == "OmniVoice":
                audio = await asyncio.to_thread(
                    self._omnivoice_speak, text, task.language, task.voice)
            if audio is None or not audio.size:
                raise RuntimeError("no audio came back")

            await asyncio.to_thread(sf.write, str(out), audio, SAMPLE_RATE)
            seconds = audio.shape[0] / SAMPLE_RATE
            charged = await billing.commit_dub(token, f"tts_{task.id}",
                                               seconds, BILLING_QUALITY)
            task.duration = round(seconds, 2)
            task.audio_url = f"/media/outputs/{out.name}"
            if billing.enabled():
                task.credits_charged = charged.billable_cost
                task.balance_after = charged.balance
            task.status = "done"
            log.info("tts %s: %s, %s, %d chars -> %.1fs", task.id, task.engine,
                     task.voice, task.chars, seconds)
        except Exception as exc:
            detail = getattr(exc, "detail", None)
            log.exception("tts %s failed", task.id)
            out.unlink(missing_ok=True)
            task.status = "failed"
            task.error = (detail if isinstance(detail, str)
                          else "Speech generation failed. Please try again.")

    # ── engines (blocking; run in a worker thread) ───────────────────────────
    def _navoiy_speak(self, text: str, style: str):
        import numpy as np

        _label, preset, semitones, tempo = NAVOIY_STYLES[style]
        chunks = split_sentences(text)
        clips = self._navoiy._generate(chunks, None, [preset] * len(chunks))
        if not clips or all(c is None for c in clips):
            return None
        gap = np.zeros(int(SENTENCE_GAP * SAMPLE_RATE), dtype=np.float32)
        parts = []
        for clip in clips:
            if clip is None:
                continue          # one failed sentence must not lose the rest
            if parts:
                parts.append(gap)
            parts.append(np.asarray(clip, dtype=np.float32))
        audio = np.concatenate(parts)
        if semitones or tempo != 1:
            audio = _shape(audio, semitones, tempo)
        return _normalize(audio)

    def _omnivoice_speak(self, text: str, language: str, voice: str):
        """OmniVoice chunks long text itself, and reuses the first chunk as the
        reference for the rest, so the voice holds across the whole text."""
        import numpy as np
        import torch

        tts = self._orch.tts
        kwargs: dict = {"text": text, "instruct": OMNIVOICE_VOICES[voice][1]}
        lang = resolve_language(language)
        if lang:
            kwargs["language"] = lang
        with tts.lock:
            model = tts._load()
            torch.manual_seed(OMNIVOICE_SEED)
            out = model.generate(**kwargs)
        return _normalize(np.asarray(out[0], dtype=np.float32).reshape(-1))


def _shape(audio, semitones: float, tempo: float):
    """A blended style's pitch and speed. Unshaped audio beats none, so a
    failed ffmpeg run returns the input."""
    import tempfile
    from pathlib import Path

    import numpy as np
    import soundfile as sf

    from .pipeline import media

    with tempfile.TemporaryDirectory() as tmp:
        src, out = Path(tmp) / "in.wav", Path(tmp) / "out.wav"
        sf.write(str(src), audio, SAMPLE_RATE)
        if not media.pitch_tempo(src, out, semitones, tempo, SAMPLE_RATE):
            return audio
        data, _ = sf.read(str(out), dtype="float32")
    return np.asarray(data, dtype=np.float32).reshape(-1)


def _normalize(audio):
    import numpy as np

    peak = float(np.max(np.abs(audio))) if audio.size else 0.0
    return audio / peak * 0.95 if peak > 0.95 else audio


_service: SpeechService | None = None
_service_lock = threading.Lock()


def service(orchestrator) -> SpeechService:
    global _service
    with _service_lock:
        if _service is None:
            _service = SpeechService(orchestrator)
    return _service
