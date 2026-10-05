"""Real TTS via edge-tts (Microsoft neural voices).

Produces natural spoken audio in the target language — this is what gets muxed
into the dubbed video, so you *hear* the translation. Generic per-language voice,
not a clone of the source speaker (that is OmniVoice's job).

For long videos this matters a lot: naively synthesizing one segment at a time
means hundreds of sequential WebSocket calls to Microsoft, which is slow and
times out. So we (1) merge short segments into ~11 s chunks, (2) synthesize them
concurrently, and (3) retry transient network failures. Each clip is then
stripped of the head/tail silence edge-tts pads it with, so everything after
this point measures speech rather than padding.

Chunks are then placed on a 24 kHz timeline by `_plan_timeline`, which gives each
one a start, a compression target and a hard limit measured against where the
next line is due. That budget is what keeps the dub aligned to the original
performance *and* keeps two dubbed lines out of the same samples.
"""
from __future__ import annotations

import asyncio
from pathlib import Path
from typing import NamedTuple

from ..config import get_settings
from ..schemas import Segment
from . import media, timeline

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


def _plan_timeline(chunks: list[tuple[float, float, str]],
                   durations: list[float | None],
                   total: float) -> list[tuple[float, float, float]]:
    """Give every chunk a start, a compression target and a hard limit, chosen
    so that two dubbed lines can never occupy the same moment.

    Placement used to have no plan at all: each chunk was laid down at its
    source start, at whatever length it happened to be, and summed into the
    output buffer. Nothing tied a chunk's length to when the next one began, so
    a line that needed more compression than `atempo` allows simply played on
    top of its successor and the viewer heard the dub twice over. This walks the
    chunks in order and hands each one an explicit budget:

    * `at` — where the line starts. Normally its source time; a line whose
      predecessor ran long starts later, by at most `MAX_SHIFT`.
    * `target` — what it is compressed toward: its own utterance span plus up to
      `MAX_SPILL` of the following pause, but never past where the next line is
      due. Spending that pause is why this is not simply `end - start`.
    * `limit` — where it is cut if compression could not get it under. This is
      the collision bound, so it is measured to the next line's start.

    A chunk that failed to synthesize (`durations[i] is None`) occupies no time
    and pushes nothing. Returns one `(at, target, limit)` per chunk, in order.
    """
    plan: list[tuple[float, float, float]] = []
    cursor = 0.0
    for i, (start, end, _text) in enumerate(chunks):
        due_next = chunks[i + 1][0] if i + 1 < len(chunks) else max(total, end)
        at, target, limit = timeline.slot_budget(start, end, due_next, cursor)
        plan.append((at, target, limit))
        dur = durations[i]
        if dur:
            # What the clip will actually occupy: compressed as far as the cap
            # allows, then cut at the limit.
            tempo = min(max(dur / target, 1.0), media.TTS_MAX_TEMPO)
            cursor = at + min(dur / tempo, limit)
    return plan


class TTSOutcome(NamedTuple):
    """What the stage managed to voice, so the caller can report it honestly.

    This used to be a bare bool, and the bar it had to clear was every chunk
    except the ones the network dropped. A chunk that synthesized fine but whose
    local fit failed pushed the count under that bar, the whole call reported
    failure, and the orchestrator threw a complete dub away and overwrote it
    with a placeholder tone — so one failed ffmpeg turned a finished translation
    into a beep. Nothing about a partial dub justifies that: gaps in the speech
    are worth far more to the viewer than a sine wave, and the counts here let
    the stage say which lines are missing instead of hiding it.
    """
    ok: bool            # usable speech was written; False only if nothing was
    voiced: int         # chunks that reached the timeline
    total: int          # chunks attempted
    lost_network: int   # dropped by edge-tts after its retries
    lost_fit: int       # synthesized, but the local fit or read failed


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
                   out_audio: Path, total_duration: float | None) -> TTSOutcome:
        import numpy as np
        import soundfile as sf
        import edge_tts

        voice = VOICES.get(target_lang)
        if not voice:
            raise RuntimeError(f"no edge-tts voice for '{target_lang}'")

        chunks = _merge_chunks(segments)
        total = total_duration or (segments[-1].end if segments else 1.0)
        sem = asyncio.Semaphore(CONCURRENCY)
        mp3s = [out_audio.parent / f"{out_audio.stem}_c{i}.mp3"
                for i in range(len(chunks))]
        # the clip with edge-tts' head/tail padding stripped — what the plan and
        # the fit both reason about, so both are measuring speech, not silence
        trims = [out_audio.parent / f"{out_audio.stem}_c{i}_t.wav"
                 for i in range(len(chunks))]
        wavs = [out_audio.parent / f"{out_audio.stem}_c{i}.wav"
                for i in range(len(chunks))]
        raw: list[float | None] = [None] * len(chunks)
        placed: dict[int, tuple[int, "np.ndarray"]] = {}
        failures = 0

        # Synthesis and fitting are two passes rather than one, because a chunk
        # cannot be fitted until every chunk's real length is known: its budget
        # depends on where the next line starts and on whether the previous one
        # ran long. The network pass keeps its concurrency; only the arithmetic
        # between them is serial.
        async def synth_one(i: int, text: str) -> None:
            nonlocal failures
            async with sem:
                for attempt in range(RETRIES):
                    try:
                        await edge_tts.Communicate(text, voice).save(str(mp3s[i]))
                        break
                    except Exception:
                        if attempt == RETRIES - 1:
                            failures += 1
                            return
                        await asyncio.sleep(1.0 * (attempt + 1))
            start, end, _ = chunks[i]
            if not await asyncio.to_thread(media.tts_trim, mp3s[i], trims[i],
                                           SAMPLE_RATE):
                trims[i] = mp3s[i]          # untrimmed is still usable
            raw[i] = (await asyncio.to_thread(media.probe_duration, trims[i])
                      or max(end - start, 0.5))

        async def fit_one(i: int, at: float, target: float, limit: float) -> None:
            async with sem:
                ok = await asyncio.to_thread(media.tts_fit, trims[i], wavs[i],
                                             target, SAMPLE_RATE, limit)
            if not ok:
                return
            data, _ = sf.read(str(wavs[i]), dtype="float32")
            if getattr(data, "ndim", 1) > 1:
                data = data.mean(axis=1)
            if not len(data):
                return          # nothing in it — do not count it as voiced
            placed[i] = (int(max(0.0, at) * SAMPLE_RATE), data)

        async def run() -> None:
            await asyncio.gather(*[synth_one(i, t)
                                   for i, (_, _, t) in enumerate(chunks)])
            plan = _plan_timeline(chunks, raw, total)
            await asyncio.gather(*[fit_one(i, *plan[i])
                                   for i in range(len(chunks))
                                   if raw[i] is not None])

        asyncio.run(run())

        end = max((s + len(d) for s, d in placed.values()),
                  default=int(total * SAMPLE_RATE))
        buf = np.zeros(max(end, int(total * SAMPLE_RATE)) + SAMPLE_RATE,
                       dtype=np.float32)
        timeline.write_without_overlap(buf, [placed[i] for i in sorted(placed)])
        peak = float(np.max(np.abs(buf))) if buf.size else 0.0
        if peak > 1.0:
            buf = buf / peak
        sf.write(str(out_audio), buf, SAMPLE_RATE)

        for f in (*mp3s, *trims, *wavs):
            try:
                f.unlink(missing_ok=True)
            except Exception:
                pass
        # `ok` asks only whether there is speech to play. Anything above zero
        # voiced chunks is a dub with holes in it, which is the caller's to
        # report, not to discard.
        return TTSOutcome(
            ok=bool(placed) and out_audio.exists(),
            voiced=len(placed), total=len(chunks),
            lost_network=failures,
            lost_fit=max(0, len(chunks) - failures - len(placed)),
        )
