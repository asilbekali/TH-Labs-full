"""Which of Navoiy's emotion presets each dubbed line is spoken with.

Navoiy only responds to the ten style instructions it was trained on (its
emotions_40h.json); free-form instructions do nothing measurable — asked to
speak slowly or quickly, the same line came out within 1 % of its usual length.
So "expressive" here means picking one preset per line, and voicing every line
calm is what made dubs sound stiff.

Two signals decide it:

* **How the line was said.** An audio emotion model (emotion2vec+, run in the
  Navoiy container) labels each source segment: angry, happy, sad, fearful,
  surprised, disgusted or neutral, with a confidence.
* **What the line says.** A chat model reads the source, the dub and the
  neighbouring lines together with that label, and picks the preset. The audio
  settles the emotion; the text settles what audio cannot: warm against calm
  for friendly narration, sarcasm, a whisper, a tired sigh.

Every failure is soft. No provider, no reply, a malformed reply, or a preset
the model invented all fall back to the audio label for that line, and an
unsure or missing label falls back to calm, which is what every line got before.
"""
from __future__ import annotations

import json
import logging
from collections import Counter

from ..schemas import Segment

log = logging.getLogger(__name__)

# Navoiy's presets, by the tag the Navoiy class looks its instruction up with.
PRESETS = ("calm", "happy", "sad", "angry", "nervous", "surprised",
           "whispers", "warm", "tired", "sarcastic")
DEFAULT = "calm"

# Audio model label -> preset, for when the text cannot be consulted.
AUDIO_TO_PRESET = {
    "angry": "angry", "happy": "happy", "sad": "sad", "fearful": "nervous",
    "surprised": "surprised", "disgusted": "angry",
}
# Below this the audio model is guessing; a wrong strong emotion is worse than
# a neutral read.
MIN_CONFIDENCE = 0.5
# Lines per request. Neighbouring lines are the context, so batches are
# consecutive stretches of the transcript.
BATCH = 30

INSTRUCTIONS = (
    "You are directing the voice actor for a video dub from {language}. For "
    "each line, choose "
    "how it should be delivered, from exactly this list: "
    + ", ".join(PRESETS) + ".\n\n"
    "Each line has the original text (`source`), the dubbed text (`dub`), and "
    "what an audio emotion model heard in the original speaker's voice "
    "(`heard`, with `confidence` from 0 to 1, or null). When the model is "
    "confident, keep its emotion. Use the text and the surrounding lines to "
    "decide what audio cannot: warm instead of calm for friendly or "
    "encouraging speech, sarcastic, whispers, tired. Narration and lectures are "
    "mostly calm or warm; do not invent drama the speaker did not put there.\n\n"
    'Reply with JSON only: {"items": [{"i": <line i>, "emotion": "<one of the '
    'list>"}]}.'
)


def from_audio(heard: dict | None) -> str:
    """The preset an audio label implies on its own."""
    if not heard or float(heard.get("score") or 0.0) < MIN_CONFIDENCE:
        return DEFAULT
    return AUDIO_TO_PRESET.get(str(heard.get("label")), DEFAULT)


def _default_chat():
    from . import refine
    return refine._post if refine.available() else None


def _ask(chat, model: str, language: str,
         lines: list[dict]) -> dict[int, str]:
    """One request; returns {line i: preset} for the valid picks only."""
    data = chat({
        "model": model,
        "messages": [{"role": "system",
                      "content": INSTRUCTIONS.replace("{language}", language)},
                     {"role": "user", "content": json.dumps(lines, ensure_ascii=False)}],
        "temperature": 0.2,
        "response_format": {"type": "json_object"},
    })
    if not data:
        return {}
    try:
        items = json.loads(data["choices"][0]["message"]["content"]).get("items", [])
    except Exception as exc:
        log.warning("emotion: unusable reply (%s)", type(exc).__name__)
        return {}
    picks: dict[int, str] = {}
    for item in items:
        try:
            i, preset = int(item["i"]), str(item["emotion"]).strip().lower()
        except (KeyError, TypeError, ValueError):
            continue
        if preset in PRESETS:
            picks[i] = preset
    return picks


_UNSET = object()


def choose(segments: list[Segment], source_lang: str,
           heard: list[dict | None], chat=_UNSET) -> tuple[list[str], dict]:
    """One preset per segment, plus stats for the stage detail.

    `heard[i]` is the audio model's {"label", "score"} for segment i, or None.
    `chat(payload) -> response | None` is an OpenAI-compatible chat call;
    left out, the translation-repair provider is used when one is configured.
    """
    if chat is _UNSET:
        chat = _default_chat()
    presets = [from_audio(h) for h in heard]
    from_llm = 0
    if chat is not None:
        from ..config import get_settings
        from ..languages import get as get_lang
        model = get_settings().refine_model
        lang = get_lang(source_lang)
        language = lang.name if lang else "the original language"
        for start in range(0, len(segments), BATCH):
            lines = []
            for i in range(start, min(start + BATCH, len(segments))):
                h = heard[i] or {}
                lines.append({"i": i, "source": segments[i].source_text,
                              "dub": segments[i].target_text or "",
                              "heard": h.get("label"),
                              "confidence": (round(float(h["score"]), 2)
                                             if h.get("score") is not None else None)})
            for i, preset in _ask(chat, model, language, lines).items():
                if start <= i < start + len(lines):
                    presets[i] = preset
                    from_llm += 1
    stats = {"by": "llm" if from_llm else "audio",
             "counts": dict(Counter(presets))}
    log.info("emotion: %s", stats)
    return presets, stats


def assign(segments: list[Segment], source_lang: str, hear,
           chat=_UNSET) -> dict | None:
    """Give every segment without an `emotion` one, in place.

    `hear() -> [{"label", "score"} | None, ...]` runs the audio emotion model
    over the source, one entry per segment; it is only called when some
    segment still needs a preset. Presets already on a segment are kept: on a
    re-voice they are what the first dub used. Returns the stats for the stage
    detail, or None when nothing had to be decided.
    """
    from ..config import get_settings

    if all(seg.emotion for seg in segments):
        return None
    if not get_settings().navoiy_emotions:
        for seg in segments:
            seg.emotion = seg.emotion or DEFAULT
        return {"by": "off", "counts": dict(Counter(s.emotion for s in segments))}
    presets, stats = choose(segments, source_lang, hear(), chat=chat)
    for seg, preset in zip(segments, presets):
        seg.emotion = seg.emotion or preset
    stats["counts"] = dict(Counter(seg.emotion for seg in segments))
    return stats
