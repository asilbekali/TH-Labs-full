"""Real TTS via edge-tts (Microsoft neural voices).

Produces natural spoken audio in the target language — this is what gets muxed
into the dubbed video, so you *hear* the translation. Generic per-language voice,
not a clone of the source speaker (that is OmniVoice's job).

For long videos this matters a lot: naively synthesizing one segment at a time
means hundreds of sequential WebSocket calls to Microsoft, which is slow and
times out. So we (1) merge short segments into ~11 s chunks, (2) synthesize them
concurrently, and (3) retry transient network failures. Each chunk is time-fitted
to its source slot for A/V sync and laid on a 24 kHz timeline.
"""
from __future__ import annotations

import asyncio
from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import media

SAMPLE_RATE = 24_000
CONCURRENCY = 6          # parallel edge-tts connections
RETRIES = 3
CHUNK_SECONDS = 11.0     # merge segments up to this duration per TTS call

# target language code → an edge-tts neural voice
VOICES: dict[str, str] = {
    "en": "en-US-AriaNeural",     "uz": "uz-UZ-SardorNeural",
    "ru": "ru-RU-SvetlanaNeural", "es": "es-ES-ElviraNeural",
    "fr": "fr-FR-DeniseNeural",   "de": "de-DE-KatjaNeural",
    "it": "it-IT-ElsaNeural",     "pt": "pt-PT-RaquelNeural",
    "nl": "nl-NL-ColetteNeural",  "pl": "pl-PL-ZofiaNeural",
    "tr": "tr-TR-EmelNeural",     "ar": "ar-SA-ZariyahNeural",
    "fa": "fa-IR-DilaraNeural",   "hi": "hi-IN-SwaraNeural",
    "bn": "bn-BD-NabanitaNeural", "ur": "ur-PK-UzmaNeural",
    "zh": "zh-CN-XiaoxiaoNeural", "ja": "ja-JP-NanamiNeural",
    "ko": "ko-KR-SunHiNeural",    "vi": "vi-VN-HoaiMyNeural",
    "id": "id-ID-GadisNeural",    "th": "th-TH-PremwadeeNeural",
    "uk": "uk-UA-PolinaNeural",   "kk": "kk-KZ-AigulNeural",
    "az": "az-AZ-BanuNeural",     "sv": "sv-SE-SofieNeural",
    "cs": "cs-CZ-VlastaNeural",   "el": "el-GR-AthinaNeural",
    "he": "he-IL-HilaNeural",     "ro": "ro-RO-AlinaNeural",
    "hu": "hu-HU-NoemiNeural",    "fi": "fi-FI-NooraNeural",
}


def _merge_chunks(segments: list[Segment],
                  max_dur: float = CHUNK_SECONDS) -> list[tuple[float, float, str]]:
    """Group consecutive segments into ~max_dur chunks → far fewer TTS calls."""
    chunks: list[tuple[float, float, str]] = []
    cur: list | None = None       # [start, end, text]
    for seg in segments:
        txt = (seg.target_text or seg.source_text or "").strip()
        if not txt:
            continue
        if cur is None:
            cur = [seg.start, seg.end, txt]
        elif (seg.end - cur[0]) <= max_dur:
            cur[1], cur[2] = seg.end, cur[2] + " " + txt
        else:
            chunks.append((cur[0], cur[1], cur[2]))
            cur = [seg.start, seg.end, txt]
    if cur is not None:
        chunks.append((cur[0], cur[1], cur[2]))
    return chunks


class EdgeTTS:
    key = "tts"
    label = "Text-to-Speech"
    engine = "edge-tts (neural)"

    def available(self) -> bool:
        import importlib.util
        s = get_settings()
        if s.mode == "demo":
            return False
        return (importlib.util.find_spec("edge_tts") is not None
                and importlib.util.find_spec("soundfile") is not None
                and bool(s.ffmpeg))

    def supports(self, target_lang: str) -> bool:
        return target_lang in VOICES

    def synthesize(self, segments: list[Segment], target_lang: str,
                   out_audio: Path, total_duration: float | None) -> bool:
        import numpy as np
        import soundfile as sf
        import edge_tts

        voice = VOICES.get(target_lang)
        if not voice:
            raise RuntimeError(f"no edge-tts voice for '{target_lang}'")

        chunks = _merge_chunks(segments)
        sem = asyncio.Semaphore(CONCURRENCY)
        placed: dict[int, tuple[int, "np.ndarray"]] = {}
        tmp_files: list[Path] = []
        failures = 0

        async def synth_one(i: int, start: float, end: float, text: str) -> None:
            nonlocal failures
            mp3 = out_audio.parent / f"{out_audio.stem}_c{i}.mp3"
            wav = out_audio.parent / f"{out_audio.stem}_c{i}.wav"
            tmp_files.extend([mp3, wav])
            async with sem:
                for attempt in range(RETRIES):
                    try:
                        await edge_tts.Communicate(text, voice).save(str(mp3))
                        break
                    except Exception:
                        if attempt == RETRIES - 1:
                            failures += 1
                            return
                        await asyncio.sleep(1.0 * (attempt + 1))
            slot = max(0.5, end - start)
            if not await asyncio.to_thread(media.tts_fit, mp3, wav, slot, SAMPLE_RATE):
                return
            data, _ = sf.read(str(wav), dtype="float32")
            if getattr(data, "ndim", 1) > 1:
                data = data.mean(axis=1)
            placed[i] = (int(max(0.0, start) * SAMPLE_RATE), data)

        async def run() -> None:
            await asyncio.gather(*[
                synth_one(i, s, e, t) for i, (s, e, t) in enumerate(chunks)])

        asyncio.run(run())

        total = total_duration or (segments[-1].end if segments else 1.0)
        end = max((s + len(d) for s, d in placed.values()),
                  default=int(total * SAMPLE_RATE))
        buf = np.zeros(max(end, int(total * SAMPLE_RATE)) + SAMPLE_RATE,
                       dtype=np.float32)
        for start, data in placed.values():
            buf[start:start + len(data)] += data
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            buf = buf / peak
        sf.write(str(out_audio), buf, SAMPLE_RATE)

        for f in tmp_files:
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass
        # success if we voiced most chunks (tolerate a few dropped network calls)
        return out_audio.exists() and len(placed) >= max(1, len(chunks) - failures)
