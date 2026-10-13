import asyncio

import numpy as np
import pytest

from app import speech
from app.pipeline import tts_navoiy


def test_split_keeps_every_word_and_respects_the_limit():
    text = ("Salom! Bugun biz juda muhim mavzuni muhokama qilamiz. "
            + "Bu gap, juda uzun bo'lgani uchun, vergullardan bo'linadi, " * 6
            + "Tamom.")
    chunks = speech.split_sentences(text, max_chars=80)
    assert all(len(c) <= 80 for c in chunks)
    assert " ".join(chunks).split() == text.split()


def test_split_packs_short_sentences_together():
    assert speech.split_sentences("Ha. Yo'q. Balki.", max_chars=80) == \
        ["Ha. Yo'q. Balki."]
    assert speech.split_sentences("   ") == []


class FakeOmni:
    def __init__(self, real: bool) -> None:
        import threading
        self.real, self.lock, self._model, self.calls = real, threading.Lock(), None, []

    def mode(self) -> str:
        return "real" if self.real else "simulation"

    def _load(self):
        outer = self

        class Model:
            def generate(self, **kw):
                outer.calls.append(kw)
                return [np.full(24_000, 0.1, dtype=np.float32)]
        return Model()


class FakeOrch:
    def __init__(self, omni_real: bool) -> None:
        self.tts = FakeOmni(omni_real)
        self.navoiy = tts_navoiy.NavoiyTTS()


@pytest.fixture
def unbound_navoiy(monkeypatch):
    monkeypatch.setattr(tts_navoiy, "_remote", None)


def test_uzbek_uses_navoiy_when_bound(monkeypatch):
    monkeypatch.setattr(tts_navoiy, "_remote", object())
    svc = speech.SpeechService(FakeOrch(omni_real=True))
    assert svc.engine_for("uz") == "Navoiy"
    assert svc.engine_for("en") == "OmniVoice"


def test_uzbek_falls_back_to_omnivoice(unbound_navoiy):
    svc = speech.SpeechService(FakeOrch(omni_real=True))
    assert svc.engine_for("uz") == "OmniVoice"
    assert speech.SpeechService(FakeOrch(omni_real=False)).engine_for("uz") is None


def test_omnivoice_render_passes_language_and_voice(unbound_navoiy, tmp_path,
                                                    monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "data_dir", tmp_path)
    (tmp_path / "outputs").mkdir()
    orch = FakeOrch(omni_real=True)
    svc = speech.SpeechService(orch)

    async def go():
        task = await svc.start("Hello there.", "en", "male-deep", 7, "tok")
        for _ in range(3000):      # first `import torch` is slow
            if task.status in ("done", "failed"):
                break
            await asyncio.sleep(0.02)
        return task

    task = asyncio.run(go())
    assert task.status == "done", task.error
    assert task.engine == "OmniVoice" and task.duration == 1.0
    assert (tmp_path / "outputs" / f"tts_{task.id}.wav").exists()
    assert orch.tts.calls == [{"text": "Hello there.", "language": "en",
                               "instruct": "male, middle-aged, very low pitch"}]
    assert svc.get(task.id, owner_id=8) is None      # someone else's render


def test_every_blend_names_a_trained_preset():
    trained = {k for k, v in speech.NAVOIY_STYLES.items() if k == v[1]}
    assert len(trained) == 10
    assert all(v[1] in trained for v in speech.NAVOIY_STYLES.values())


def test_shape_changes_speed_but_keeps_audio():
    from app.config import get_settings
    if not get_settings().ffmpeg:
        pytest.skip("needs ffmpeg")
    t = np.arange(48_000) / 24_000
    tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
    out = speech._shape(tone, semitones=1.5, tempo=1.12)
    assert abs(out.shape[0] / tone.shape[0] - 1 / 1.12) < 0.03
    spec = np.abs(np.fft.rfft(out))
    peak_hz = np.argmax(spec) * 24_000 / out.shape[0]
    assert abs(peak_hz - 220 * 2 ** (1.5 / 12)) < 6     # pitch moved up 1.5 st
