"""NavoiyTTS against a stand-in for the Modal class.

The stand-in replaces only the remote model (a GPU container); trimming,
timeline planning, fitting and writing the dub are the real code, so these
tests need ffmpeg on PATH.
"""
import shutil

import numpy as np
import pytest
import soundfile as sf

from app.pipeline import tts_navoiy
from app.schemas import Segment

pytestmark = pytest.mark.skipif(shutil.which("ffmpeg") is None,
                                reason="placement shells out to ffmpeg")

SR = 24_000


def tone(seconds: float, hz: float) -> bytes:
    t = np.arange(int(seconds * SR)) / SR
    return (0.3 * np.sin(2 * np.pi * hz * t)).astype("<f4").tobytes()


class FakeNavoiy:
    """The remote class's methods, with the call shapes Modal gives them."""

    calls: list[dict] = []
    emotions_reply: list | Exception = []

    def __init__(self):
        cls = type(self)

        class Synthesize:
            @staticmethod
            def starmap(args, order_outputs=True):
                for texts, reference, styles in args:
                    cls.calls.append({"texts": list(texts), "styles": list(styles),
                                      "cloned": reference is not None})
                    # A cloned "ENGLISH" line comes back as a 440 Hz tone, which
                    # the language check below hears as the source language.
                    yield [tone(1.2, 440.0 if ("ENGLISH" in t and reference) else 220.0)
                           for t in texts]

        class Emotions:
            @staticmethod
            def remote(audio, spans):
                cls.calls.append({"emotions": len(audio), "spans": spans})
                if isinstance(cls.emotions_reply, Exception):
                    raise cls.emotions_reply
                return cls.emotions_reply

        self.synthesize = Synthesize()
        self.emotions = Emotions()


@pytest.fixture
def navoiy(monkeypatch):
    FakeNavoiy.calls = []
    FakeNavoiy.emotions_reply = []
    monkeypatch.setattr(tts_navoiy, "_remote", FakeNavoiy)
    return tts_navoiy.NavoiyTTS()


def lid(clip, sample_rate):
    """Whisper language ID stand-in: English for a 440 Hz tone, else Uzbek."""
    spectrum = np.abs(np.fft.rfft(clip[:sample_rate]))
    peak = np.argmax(spectrum) * sample_rate / min(len(clip), sample_rate)
    return {"en": 0.9, "az": 0.1} if abs(peak - 440) < 20 else {"az": 0.9, "en": 0.1}


def segments(*lines):
    return [Segment(id=i, start=i * 3.0, end=i * 3.0 + 2.0, source_text=f"src {i}",
                    target_text=text, emotion=emo)
            for i, (text, emo) in enumerate(lines)]


def test_each_line_is_voiced_with_its_own_preset(navoiy, tmp_path):
    segs = segments(("Salom", "warm"), ("Afsus", "sad"), ("Bilmadim", None))
    out = navoiy.synthesize(segs, None, tmp_path / "dub.wav", 10.0, "en", "uz")
    assert out.voiced == 3
    assert FakeNavoiy.calls == [{"texts": ["Salom", "Afsus", "Bilmadim"],
                                 "styles": ["warm", "sad", "calm"], "cloned": False}]


def test_line_revoiced_in_the_stock_voice_keeps_its_preset(navoiy, tmp_path):
    ref = tmp_path / "ref.wav"
    sf.write(str(ref), np.zeros(SR * 3, dtype="float32"), SR)
    segs = segments(("Salom", "warm"), ("ENGLISH leak", "angry"))
    navoiy.synthesize(segs, ref, tmp_path / "dub.wav", 10.0, "en", "uz",
                      language_probs=lid)
    retry = FakeNavoiy.calls[-1]
    assert retry == {"texts": ["ENGLISH leak"], "styles": ["angry"], "cloned": False}


def test_hear_sends_source_audio_and_segment_spans(navoiy, tmp_path):
    wav = tmp_path / "source.wav"
    sf.write(str(wav), np.zeros(16_000 * 2, dtype="float32"), 16_000)
    FakeNavoiy.emotions_reply = [{"label": "happy", "score": 0.9}, None]
    heard = navoiy.hear(wav, segments(("a", None), ("b", None)))
    assert heard == [{"label": "happy", "score": 0.9}, None]
    assert FakeNavoiy.calls[0]["spans"] == [[0.0, 2.0], [3.0, 5.0]]
    assert FakeNavoiy.calls[0]["emotions"] == wav.stat().st_size


def test_hear_failure_means_no_labels(navoiy, tmp_path):
    wav = tmp_path / "source.wav"
    sf.write(str(wav), np.zeros(16_000, dtype="float32"), 16_000)
    FakeNavoiy.emotions_reply = RuntimeError("container crashed")
    assert navoiy.hear(wav, segments(("a", None), ("b", None))) == [None, None]


def test_hear_without_source_audio_means_no_labels(navoiy, tmp_path):
    assert navoiy.hear(tmp_path / "missing.wav", segments(("a", None))) == [None]
    assert FakeNavoiy.calls == []
