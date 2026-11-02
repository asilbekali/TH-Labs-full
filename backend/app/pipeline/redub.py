"""Re-dub only the lines that changed (Studio Max speech editor).

A full re-voice (`POST /api/jobs/{id}/revoice`) synthesizes every line again,
separates the background again and re-muxes — minutes of GPU for a one-word
fix, and every line that was already right comes back slightly different. An
agency correcting one mispronounced name in a ten-minute video needs the
opposite: leave everything alone except that line.

So this patches the dub in place:

    1. Work out which lines to re-voice. Usually exactly the edited ones; with
       edge-tts it is the whole chunk an edited line was merged into (see
       `voice_groups`), because one chunk's audio is not aligned to its lines.
    2. Synthesize only those, with the engine and the cloned voice the dub
       was made with, so the new line sounds like its neighbours.
    3. Splice them into the existing voice stem: silence each group's old
       window, lay the new audio at the (possibly moved) start, cut at the
       next line with a short fade.
    4. Remix over the background bed the first run already separated, and mux
       onto the same video. No ASR, no translation, no separation.

The result is a new version of the same video (`{id}_v{n}.mp4`); the earlier
file is left on disk so a player holding its URL keeps working.
"""
from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from pathlib import Path

from ..config import get_settings
from ..schemas import Segment
from . import media, subtitles, timeline
from .tts_edge import CHUNK_SECONDS, SAMPLE_RATE
from .tts import dub_text

log = logging.getLogger(__name__)

# Fade on both edges of a cleared window and of a placed clip, so a splice is
# never a click. Short enough not to eat into a word.
SPLICE_FADE = 0.015


class EditError(ValueError):
    """An edit the user sent that cannot be applied. The message is for them."""


@dataclass
class LineEdit:
    id: int
    target_text: str | None = None
    start: float | None = None
    end: float | None = None


def apply_edits(segments: list[Segment], edits: list[LineEdit],
                duration: float | None) -> tuple[list[Segment], set[int]]:
    """The edited transcript and the ids that actually changed.

    Validates timing so lines never overlap and keep their order — the splice
    relies on every line owning the stretch up to the next one. Raises
    EditError with a sentence for the user.
    """
    new = [s.model_copy(deep=True) for s in segments]
    new_by_id = {s.id: s for s in new}
    changed: set[int] = set()
    total = duration or (segments[-1].end if segments else 0.0)

    for e in edits:
        seg = new_by_id.get(e.id)
        if seg is None:
            raise EditError(f"Line {e.id + 1} does not exist in this dub.")
        if e.target_text is not None:
            text = " ".join(e.target_text.split())
            if text != " ".join((seg.target_text or "").split()):
                seg.target_text = text
                changed.add(seg.id)
        if e.start is not None or e.end is not None:
            start = round(float(e.start if e.start is not None else seg.start), 3)
            end = round(float(e.end if e.end is not None else seg.end), 3)
            if end - start < 0.2:
                raise EditError(f"Line {seg.id + 1} must be at least 0.2 s long.")
            if start < 0 or (total and end > total + 0.05):
                raise EditError(f"Line {seg.id + 1} must stay inside the video "
                                f"(0 – {total:.1f} s).")
            if abs(start - seg.start) > 1e-3 or abs(end - seg.end) > 1e-3:
                seg.start, seg.end = start, end
                changed.add(seg.id)

    # Order is the original order; timing may move, but not past a neighbour.
    for prev, cur in zip(new, new[1:]):
        if cur.start < prev.end - 1e-3:
            raise EditError(
                f"Line {cur.id + 1} now overlaps line {prev.id + 1}. Move it so "
                f"it starts after {prev.end:.2f} s.")
    # Unchanged edits are fine to send; they are simply not re-voiced.
    return new, changed


def voice_groups(engine: str, segments: list[Segment]) -> list[list[int]]:
    """Which lines share one piece of synthesized audio in the CURRENT stem.

    edge-tts merges consecutive lines into chunks of up to CHUNK_SECONDS and
    compresses each chunk to its overall span, so a line's words are not at
    that line's own timestamps. Re-voicing one line of a chunk would leave
    half a sentence of its neighbour cut off, so the chunk is re-voiced whole.
    This reproduces tts_edge._merge_chunks' grouping, keyed by segment id.
    Navoiy and OmniVoice voice line by line, so every line is its own group.
    """
    if not engine.startswith("edge-tts"):
        return [[s.id] for s in segments]
    groups: list[list[int]] = []
    cur: list[int] = []
    cur_start = 0.0
    for seg in segments:
        if not dub_text(seg):
            continue
        if not cur:
            cur, cur_start = [seg.id], seg.start
        elif seg.end - cur_start <= CHUNK_SECONDS:
            cur.append(seg.id)
        else:
            groups.append(cur)
            cur, cur_start = [seg.id], seg.start
    if cur:
        groups.append(cur)
    # Lines with no text belong to no chunk; give them their own group so an
    # edit that adds text to one is still re-voiced.
    grouped = {i for g in groups for i in g}
    groups.extend([s.id] for s in segments if s.id not in grouped)
    return groups


def plan_groups(engine: str, old: list[Segment], new: list[Segment],
                changed: set[int]) -> list[list[int]]:
    """The groups to re-voice: every group that contains a changed line."""
    return [g for g in voice_groups(engine, old) if changed & set(g)]


def _window_end(segments: list[Segment], last_id: int,
                duration: float) -> float:
    """Where the stretch owned by the line `last_id` ends: the next line's
    start, or the end of the video."""
    ids = [s.id for s in segments]
    i = ids.index(last_id)
    return segments[i + 1].start if i + 1 < len(segments) else duration


@dataclass
class Plan:
    ids: list[int]
    clear: tuple[float, float]   # old window to silence
    at: float                    # where the new audio starts
    room: float                  # how long it may run
    segments: list[Segment]      # new lines, shifted so the group starts at 0


def build_plans(old: list[Segment], new: list[Segment],
                groups: list[list[int]], duration: float) -> list[Plan]:
    old_by = {s.id: s for s in old}
    new_by = {s.id: s for s in new}
    plans: list[Plan] = []
    for ids in groups:
        o0, o1 = old_by[ids[0]], old_by[ids[-1]]
        n0 = new_by[ids[0]]
        clear = (o0.start, max(_window_end(old, o1.id, duration), o1.end))
        at = n0.start
        room = max(_window_end(new, ids[-1], duration) - at, timeline.MIN_ROOM)
        shifted = []
        for i in ids:
            s = new_by[i].model_copy(deep=True)
            s.start, s.end = s.start - at, s.end - at
            shifted.append(s)
        plans.append(Plan(ids=ids, clear=clear, at=at, room=room,
                          segments=shifted))
    return plans


# ── Synthesis ───────────────────────────────────────────────────────────────

def synthesize_group(orch, engine: str, plan: Plan, out: Path, *,
                     target_lang: str, source_lang: str | None,
                     ref_audio: Path | None, ref_text: str | None) -> str | None:
    """Voice one group into `out` (a clip starting at 0). Blocking.

    Tries the dub's own engine first, so the line matches its neighbours, then
    falls back down the same chain the pipeline uses. Returns the engine that
    produced audio, or None if none did.
    """
    segs = plan.segments
    if not any(dub_text(s) for s in segs):
        return "silence"          # the edit removed the line's text

    attempts: list[str] = []
    if engine == "Navoiy":
        attempts.append("navoiy")
    elif engine == "OmniVoice":
        attempts.append("omnivoice")
    attempts += ["edge", "navoiy", "omnivoice"]
    seen: set[str] = set()
    for name in attempts:
        if name in seen:
            continue
        seen.add(name)
        try:
            if (name == "navoiy" and orch.navoiy.supports(target_lang)
                    and orch.navoiy.available()):
                res = orch.navoiy.synthesize(segs, ref_audio, out, plan.room,
                                             source_lang=source_lang,
                                             target_lang=target_lang)
                if res.ok and out.exists():
                    return "Navoiy"
            elif name == "omnivoice" and orch.tts.mode() == "real":
                ok = orch.tts.synthesize(segs, ref_audio, ref_text,
                                         bool(ref_audio), out, plan.room,
                                         target_lang, source_lang=source_lang)
                if ok and out.exists():
                    return "OmniVoice"
            elif (name == "edge" and orch.edge.available()
                  and orch.edge.supports(target_lang)):
                res = orch.edge.synthesize(segs, target_lang, out, plan.room)
                if not (res.ok and out.exists()):
                    continue
                if (engine == "edge-tts + OpenVoice" and ref_audio
                        and Path(ref_audio).exists()
                        and orch.cloner.available()):
                    cloned = out.with_name(out.stem + "_c.wav")
                    try:
                        if orch.cloner.clone(out, Path(ref_audio), cloned) \
                                is not None and cloned.exists():
                            cloned.replace(out)
                            return "edge-tts + OpenVoice"
                    except Exception as exc:
                        log.warning("redub: clone of %s skipped (%s)",
                                    out.name, exc)
                return "edge-tts"
        except Exception as exc:
            log.warning("redub: %s failed for lines %s (%s)", name, plan.ids,
                        exc)
    return None


# ── Splicing ────────────────────────────────────────────────────────────────

def _read_mono(path: Path):
    import numpy as np
    import soundfile as sf
    data, sr = sf.read(str(path), dtype="float32", always_2d=False)
    if getattr(data, "ndim", 1) > 1:
        data = data.mean(axis=1)
    return np.asarray(data, dtype=np.float32), sr


def _resample(data, sr_from: int, sr_to: int):
    import numpy as np
    if sr_from == sr_to or not len(data):
        return data
    n = int(round(len(data) * sr_to / sr_from))
    x_old = np.linspace(0.0, 1.0, num=len(data), endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=n, endpoint=False)
    return np.interp(x_new, x_old, data).astype(np.float32)


def splice(voice: Path, out: Path, clips: list[tuple[Plan, Path | None]],
           duration: float) -> None:
    """Write `out`: the voice stem with each plan's old window silenced and its
    new clip (None = leave it silent) laid in. Blocking."""
    import numpy as np
    import soundfile as sf

    buf, sr = _read_mono(voice)
    need = int((duration + 1.0) * sr)
    if len(buf) < need:
        buf = np.concatenate([buf, np.zeros(need - len(buf), np.float32)])
    fade = max(1, int(SPLICE_FADE * sr))

    def ramp(n: int):
        return np.linspace(1.0, 0.0, num=n, dtype=np.float32)

    # Silence every old window first, so a group moved onto ground another
    # group used to occupy is not mixed with what was there.
    for plan, _ in clips:
        a = max(0, int(plan.clear[0] * sr))
        b = min(len(buf), int(plan.clear[1] * sr))
        if b <= a:
            continue
        if a >= fade:
            buf[a - fade:a] *= ramp(fade)
        buf[a:b] = 0.0
        if b + fade <= len(buf):
            buf[b:b + fade] *= ramp(fade)[::-1]

    for plan, clip in clips:
        if clip is None or not clip.exists():
            continue
        data, csr = _read_mono(clip)
        data = _resample(data, csr, sr)
        limit = int(plan.room * sr)
        data = data[:limit].copy()
        if not len(data):
            continue
        n = min(fade, len(data))
        data[:n] *= ramp(n)[::-1]
        data[-n:] *= ramp(n)
        a = max(0, int(plan.at * sr))
        b = min(len(buf), a + len(data))
        a_end = b - a
        # Within the window this line owns, so nothing else is under it.
        buf[a:b] = data[:a_end]

    peak = float(np.max(np.abs(buf))) if buf.size else 0.0
    if peak > 1.0:
        buf = buf / peak
    sf.write(str(out), buf, sr)


# ── The whole edit ──────────────────────────────────────────────────────────

async def run(orch, job, artifacts: dict, new_segments: list[Segment],
              changed: set[int], emit) -> dict:
    """Re-dub `changed` lines of `job` and write a new version of its video.

    Updates the job in place (segments, output, subtitles, edit state) and
    returns the updated artifacts. Raises RuntimeError with a sentence for the
    user if nothing could be produced; the previous version is untouched then.
    """
    s = get_settings()
    opts = job.options
    old = job.result.segments
    duration = float(artifacts.get("duration") or job.result.duration
                     or (old[-1].end if old else 0.0))
    engine = artifacts.get("engine") or "edge-tts"
    voice = Path(artifacts["voice"])
    if not voice.exists():
        raise RuntimeError("The voice track of this dub is no longer on the "
                           "server, so it cannot be patched. Run the dub again.")

    groups = plan_groups(engine, old, new_segments, changed)
    plans = build_plans(old, new_segments, groups, duration)
    version = job.edit.version + 1
    work = s.outputs_dir / f"{job.id}_edit{version}"
    work.mkdir(parents=True, exist_ok=True)
    ref_audio = Path(artifacts["ref_audio"]) if artifacts.get("ref_audio") else None
    if ref_audio is not None and not ref_audio.exists():
        ref_audio = None
    src_lang = job.result.detected_source_lang or opts.source_lang

    clips: list[tuple[Plan, Path | None]] = []
    failed: list[int] = []
    for n, plan in enumerate(plans, 1):
        job.edit.message = f"Voicing {n} of {len(plans)}"
        await emit(job)
        out = work / f"g{n}.wav"
        used = await asyncio.to_thread(
            synthesize_group, orch, engine, plan, out,
            target_lang=opts.target_lang, source_lang=src_lang,
            ref_audio=ref_audio, ref_text=artifacts.get("ref_text"))
        if used is None:
            failed.extend(plan.ids)
            # Keep the old audio for a group that could not be re-voiced
            # rather than silencing a line the user only wanted improved.
            continue
        clips.append((plan, None if used == "silence" else out))
        log.info("[%s] redub v%s: lines %s via %s", job.id, version, plan.ids,
                 used)

    if not clips:
        raise RuntimeError("None of the edited lines could be voiced right now. "
                           "Try again in a minute.")

    job.edit.message = "Mixing"
    await emit(job)
    new_voice = s.outputs_dir / f"{job.id}_voice_v{version}.wav"
    await asyncio.to_thread(splice, voice, new_voice, clips, duration)

    final_audio = new_voice
    bg = artifacts.get("background")
    if bg and Path(bg).exists():
        mixed = s.outputs_dir / f"{job.id}_mixed_v{version}.wav"
        if await asyncio.to_thread(media.mix_voice_over_background, new_voice,
                                   Path(bg), mixed, s.voice_gain,
                                   s.background_gain):
            final_audio = mixed

    job.edit.message = "Rendering video"
    await emit(job)
    out_video = s.outputs_dir / f"{job.id}_v{version}.mp4"
    await asyncio.to_thread(orch.sync.run, Path(artifacts["video"]),
                            final_audio, out_video)

    # Lines that failed keep their old text, so the transcript matches what is
    # actually heard.
    by_old = {x.id: x for x in old}
    kept = [by_old[x.id].model_copy(deep=True) if x.id in failed else x
            for x in new_segments]
    job.result.segments = kept

    if opts.subtitles:
        items = subtitles.cues(kept)
        if items:
            srt = s.outputs_dir / f"{job.id}_v{version}.srt"
            vtt = s.outputs_dir / f"{job.id}_v{version}.vtt"
            await asyncio.to_thread(subtitles.write_srt, items, srt)
            await asyncio.to_thread(subtitles.write_vtt, items, vtt)
            job.result.subtitles_url = f"/media/outputs/{srt.name}"
            job.result.subtitles_vtt_url = f"/media/outputs/{vtt.name}"
            burned_out = s.outputs_dir / f"{job.id}_v{version}_subs.mp4"
            burned = await asyncio.to_thread(subtitles.burn, out_video, srt,
                                             burned_out, duration)
            if burned:
                burned_out.replace(out_video)
            job.result.subtitles_burned = burned

    job.result.output_url = f"/media/outputs/{out_video.name}"
    job.result.voice_url = f"/media/outputs/{new_voice.name}"
    job.edit.version = version
    job.edit.segment_ids = sorted(i for g in groups for i in g
                                  if i not in failed)
    job.edit.message = (f"{len(failed)} line(s) could not be re-voiced and "
                        "kept their previous audio" if failed else "")
    return {**artifacts, "voice": str(new_voice)}
