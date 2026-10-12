import json

import pytest

from app.pipeline import emotion
from app.schemas import Segment


def seg(i: int, source: str = "Some line.", target: str = "Bir satr.") -> Segment:
    return Segment(id=i, start=i * 2.0, end=i * 2.0 + 1.5,
                   source_text=source, target_text=target)


def reply(items: list[dict]) -> dict:
    """An OpenAI-compatible chat completion, as the provider returns it."""
    return {
        "id": "chatcmpl-1", "object": "chat.completion", "model": "deepseek-chat",
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant",
                                 "content": json.dumps({"items": items})}}],
        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
    }


class Chat:
    """Stands in for the provider: records each request, answers via `answer`."""

    def __init__(self, answer):
        self.answer = answer
        self.payloads: list[dict] = []

    def __call__(self, payload: dict):
        self.payloads.append(payload)
        return self.answer(payload)

    @staticmethod
    def lines(payload: dict) -> list[dict]:
        return json.loads(payload["messages"][-1]["content"])


@pytest.mark.parametrize("label, score, want", [
    ("angry", 0.9, "angry"),
    ("happy", 0.9, "happy"),
    ("sad", 0.8, "sad"),
    ("fearful", 0.7, "nervous"),
    ("surprised", 0.9, "surprised"),
    ("disgusted", 0.9, "angry"),
    ("neutral", 0.95, "calm"),
    ("other", 0.9, "calm"),
])
def test_confident_audio_label_maps_to_a_navoiy_preset(label, score, want):
    assert emotion.from_audio({"label": label, "score": score}) == want


def test_unsure_or_missing_audio_label_is_calm():
    assert emotion.from_audio({"label": "angry", "score": 0.3}) == "calm"
    assert emotion.from_audio(None) == "calm"


def test_llm_pick_is_used_per_line():
    segs = [seg(0, "Welcome, everyone!"), seg(1, "Oh great, another bug.")]
    chat = Chat(lambda p: reply([{"i": 0, "emotion": "warm"},
                                 {"i": 1, "emotion": "sarcastic"}]))
    presets, stats = emotion.choose(segs, "en", [None, None], chat=chat)
    assert presets == ["warm", "sarcastic"]
    assert stats["by"] == "llm"
    assert stats["counts"] == {"warm": 1, "sarcastic": 1}


def test_audio_hint_is_sent_with_each_line():
    segs = [seg(0, "Hello."), seg(1, "We won!")]
    chat = Chat(lambda p: reply([{"i": 0, "emotion": "calm"},
                                 {"i": 1, "emotion": "happy"}]))
    emotion.choose(segs, "en", [None, {"label": "happy", "score": 0.82}], chat=chat)
    sent = Chat.lines(chat.payloads[0])
    assert sent[1]["source"] == "We won!"
    assert sent[1]["dub"] == "Bir satr."
    assert sent[1]["heard"] == "happy" and sent[1]["confidence"] == 0.82
    assert sent[0]["heard"] is None


def test_unknown_preset_from_llm_falls_back_to_audio_for_that_line():
    segs = [seg(0), seg(1)]
    chat = Chat(lambda p: reply([{"i": 0, "emotion": "ecstatic"},
                                 {"i": 1, "emotion": "warm"}]))
    heard = [{"label": "sad", "score": 0.9}, None]
    presets, _ = emotion.choose(segs, "en", heard, chat=chat)
    assert presets == ["sad", "warm"]


def test_no_reply_falls_back_to_audio():
    heard = [{"label": "angry", "score": 0.9}, {"label": "neutral", "score": 0.9}]
    presets, stats = emotion.choose([seg(0), seg(1)], "en", heard,
                                    chat=Chat(lambda p: None))
    assert presets == ["angry", "calm"]
    assert stats["by"] == "audio"


def test_malformed_reply_falls_back_to_audio():
    bad = reply([])
    bad["choices"][0]["message"]["content"] = "Sure! Here are the emotions:"
    presets, _ = emotion.choose([seg(0)], "en", [{"label": "happy", "score": 0.9}],
                                chat=Chat(lambda p: bad))
    assert presets == ["happy"]


def test_without_a_provider_audio_decides():
    presets, stats = emotion.choose([seg(0)], "en", [{"label": "fearful", "score": 0.8}],
                                    chat=None)
    assert presets == ["nervous"]
    assert stats["by"] == "audio"


def test_long_transcripts_are_batched_and_line_up():
    segs = [seg(i) for i in range(70)]

    def answer(payload):
        return reply([{"i": line["i"], "emotion": "sad" if line["i"] == 45 else "calm"}
                      for line in Chat.lines(payload)])

    chat = Chat(answer)
    presets, _ = emotion.choose(segs, "en", [None] * 70, chat=chat)
    assert len(chat.payloads) == 3
    assert presets[45] == "sad"
    assert presets[44] == "calm" and presets[46] == "calm"
    assert len(presets) == 70


def test_reply_naming_a_line_outside_its_batch_is_ignored():
    segs = [seg(i) for i in range(35)]

    def answer(payload):
        lines = Chat.lines(payload)
        if lines[0]["i"] == 0:          # first batch "answers" line 31 too
            return reply([{"i": 31, "emotion": "angry"}])
        return reply([{"i": line["i"], "emotion": "warm"}  # its own batch skips it
                      for line in lines if line["i"] != 31])

    presets, _ = emotion.choose(segs, "en", [None] * 35, chat=Chat(answer))
    assert presets[31] == "calm"
    assert presets[32] == "warm"


def test_source_language_is_named_to_the_model():
    chat = Chat(lambda p: reply([]))
    emotion.choose([seg(0)], "ru", [None], chat=chat)
    assert "Russian" in chat.payloads[0]["messages"][0]["content"]


def test_assign_sets_each_segment_from_what_was_heard_and_said():
    segs = [seg(0), seg(1)]
    heard_calls = []

    def hear():
        heard_calls.append(1)
        return [{"label": "happy", "score": 0.9}, None]

    stats = emotion.assign(segs, "en", hear,
                           chat=Chat(lambda p: reply([{"i": 1, "emotion": "warm"}])))
    assert [s.emotion for s in segs] == ["happy", "warm"]
    assert heard_calls == [1]
    assert stats["counts"] == {"happy": 1, "warm": 1}


def test_assign_keeps_presets_a_segment_already_has():
    segs = [seg(0), seg(1)]
    segs[0].emotion = "whispers"
    emotion.assign(segs, "en", lambda: [None, None],
                   chat=Chat(lambda p: reply([{"i": 0, "emotion": "angry"},
                                              {"i": 1, "emotion": "sad"}])))
    assert [s.emotion for s in segs] == ["whispers", "sad"]


def test_assign_skips_detection_when_every_segment_has_a_preset():
    segs = [seg(0), seg(1)]
    segs[0].emotion, segs[1].emotion = "warm", "calm"

    def hear():
        raise AssertionError("re-voicing must not run the emotion model again")

    chat = Chat(lambda p: reply([]))
    assert emotion.assign(segs, "en", hear, chat=chat) is None
    assert chat.payloads == []


def test_assign_when_switched_off_is_calm_without_detection(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "navoiy_emotions", False)
    segs = [seg(0), seg(1)]

    def hear():
        raise AssertionError("switched off: no emotion model")

    emotion.assign(segs, "en", hear, chat=Chat(lambda p: reply([])))
    assert [s.emotion for s in segs] == ["calm", "calm"]
