"""What went wrong in a dub, and how to fix it.

A finished dub used to report its problems only as stage messages — "3 of 41
lines could not be synthesized" in the TTS row of the timeline — which tells the
user something is missing and nothing about where. This turns a finished (or
failed) job into a short list of `Issue`s, each with the lines it concerns and
the fix to offer, so the Studio can say "line 12 is silent: re-dub it" instead
of leaving someone to find the gap by watching the whole video.

Two kinds of evidence are used:

* What the pipeline already recorded — stage messages and details, billing,
  the simulated flag. Cheap and always available.
* The voice stem itself. A line whose slot on the dubbed voice track is
  silent was not voiced, whatever the counters say. That is the one check that
  names the exact lines, and it is what makes "re-dub this section" possible.

Nothing here raises: diagnostics are advice, and a check that cannot run is
skipped rather than failing the job it describes.
"""
from __future__ import annotations

import logging
from pathlib import Path

from ..schemas import Issue, Job, JobStatus, Segment

log = logging.getLogger(__name__)

# A slot quieter than this (RMS, full scale = 1.0) is treated as silent. Speech
# from every engine sits around 0.05-0.2; the gaps between lines are ~0.
SILENT_RMS = 0.004
# Characters per second above which a line has to be squeezed hard to fit its
# slot — it either sounds rushed or is cut off at the next line. Normal speech
# is 12-16 cps across the languages we voice.
RUSHED_CPS = 21.0
# Below this measured similarity the "their voice" promise is not really kept.
LOW_SIMILARITY = 55.0
# Listing every affected line in the title stops being useful past this.
_MAX_IDS_IN_TITLE = 4


def _ids(segments: list[Segment]) -> list[int]:
    return [s.id for s in segments]


def _line_list(ids: list[int]) -> str:
    shown = ", ".join(f"#{i + 1}" for i in ids[:_MAX_IDS_IN_TITLE])
    more = len(ids) - _MAX_IDS_IN_TITLE
    return shown + (f" and {more} more" if more > 0 else "")


def _stage(job: Job, key: str):
    return next((st for st in job.stages if st.key == key), None)


def silent_segments(voice: Path | None, segments: list[Segment]) -> list[Segment]:
    """Lines that have text but nothing audible in their slot of the voice stem.

    Reads the stem once and measures each slot. Returns [] if the stem cannot
    be read (no numpy/soundfile, missing file) — no evidence is not a silence.
    """
    if voice is None or not Path(voice).exists():
        return []
    try:
        import numpy as np
        import soundfile as sf
        data, sr = sf.read(str(voice), dtype="float32", always_2d=False)
    except Exception as exc:
        log.info("issues: voice stem unreadable (%s)", type(exc).__name__)
        return []
    if getattr(data, "ndim", 1) > 1:
        data = data.mean(axis=1)
    out: list[Segment] = []
    for seg in segments:
        if not (seg.target_text or "").strip():
            continue
        a = int(max(0.0, seg.start) * sr)
        b = int(max(seg.end, seg.start + 0.2) * sr)
        clip = data[a:b]
        if clip.size == 0:
            out.append(seg)
            continue
        rms = float(np.sqrt(np.mean(np.square(clip))))
        if rms < SILENT_RMS:
            out.append(seg)
    return out


def analyse(job: Job, voice: Path | None = None) -> list[Issue]:
    """Every issue worth showing for `job`, most serious first."""
    issues: list[Issue] = []
    try:
        issues = _analyse(job, voice)
    except Exception:  # pragma: no cover - advice must never break a job
        log.exception("[%s] issue analysis failed", job.id)
    order = {"error": 0, "warning": 1, "info": 2}
    return sorted(issues, key=lambda i: order[i.severity])


def _analyse(job: Job, voice: Path | None) -> list[Issue]:
    out: list[Issue] = []
    opts = job.options
    segs = job.result.segments

    # ── The job failed outright ──────────────────────────────────────────
    if job.status == JobStatus.failed:
        failed = next((st for st in job.stages if st.status == "failed"), None)
        where = failed.label if failed else "the pipeline"
        out.append(Issue(
            code="job_failed", severity="error",
            title=f"The dub stopped at {where}",
            detail=(failed.message if failed and failed.message
                    else job.error or "No output was written."),
            fix=("This is usually temporary. Start the dub again; if it fails "
                 "at the same step twice, try a shorter clip or a different "
                 "file format (MP4/H.264 works best). You were not charged "
                 "for output that was never produced."),
            action="retry"))
        return out

    asr = _stage(job, "asr")
    if asr and not segs:
        out.append(Issue(
            code="no_speech", severity="error",
            title="No speech was found in this video",
            detail=asr.message or "The recogniser heard nothing to translate.",
            fix=("Check the video has an audible voice track. Loud music under "
                 "the speech can hide it — pick the spoken language as the "
                 "source instead of Auto-detect, or upload a cleaner cut."),
            action="reupload"))
        return out

    if job.simulated:
        out.append(Issue(
            code="simulated", severity="warning",
            title="Parts of this dub are a simulation",
            detail=("One or more AI engines were not available, so a labelled "
                    "placeholder was used in their place."),
            fix="Run it again in a few minutes, once the engines are back up.",
            action="retry"))

    # ── Lines with no text, or text left in the source language ──────────
    empty = [s for s in segs if (s.source_text or "").strip()
             and not (s.target_text or "").strip()]
    if empty:
        out.append(Issue(
            code="untranslated", severity="warning",
            title=f"{len(empty)} line{'s' if len(empty) > 1 else ''} "
                  f"{'have' if len(empty) > 1 else 'has'} no translation "
                  f"({_line_list(_ids(empty))})",
            detail="These lines were heard but came out of translation empty, "
                   "so nothing is spoken there.",
            fix="Type the translation for each one and re-dub just those lines.",
            action="edit_line", segment_ids=_ids(empty)))

    src = (job.result.detected_source_lang or opts.source_lang or "").lower()
    if src and src != opts.target_lang:
        copied = [s for s in segs if (s.target_text or "").strip()
                  and s.target_text.strip().lower()
                  == (s.source_text or "").strip().lower()
                  and len(s.source_text.split()) > 2]
        if copied:
            out.append(Issue(
                code="not_translated", severity="warning",
                title=f"{len(copied)} line{'s' if len(copied) > 1 else ''} "
                      f"still in the original language "
                      f"({_line_list(_ids(copied))})",
                detail="The translation came back identical to what was said, "
                       "so the dub repeats the original words.",
                fix="Rewrite those lines in the target language and re-dub them.",
                action="edit_line", segment_ids=_ids(copied)))

    # ── Lines that are silent on the voice stem ─────────────────────────
    silent = [s for s in silent_segments(voice, segs) if s not in empty]
    tts = _stage(job, "tts")
    if silent:
        out.append(Issue(
            code="silent_lines", severity="error",
            title=f"{len(silent)} line{'s' if len(silent) > 1 else ''} "
                  f"{'are' if len(silent) > 1 else 'is'} silent in the dub "
                  f"({_line_list(_ids(silent))})",
            detail=(tts.message if tts and "could not be synthesized"
                    in (tts.message or "") else
                    "The voice engine returned no audio for these lines."),
            fix=("Re-dub just these lines — usually that is enough. If one stays "
                 "silent, simplify its text (spell out numbers and symbols, "
                 "split a very long sentence) and re-dub again."),
            action="edit_line", segment_ids=_ids(silent)))
    elif tts and "could not be synthesized" in (tts.message or ""):
        # Counted by the engine but not located on the stem (no stem to read).
        out.append(Issue(
            code="missing_lines", severity="error",
            title="Some lines could not be voiced",
            detail=tts.message,
            fix="Open the speech editor, find the gaps and re-dub those lines.",
            action="edit_line"))

    # ── Lines too long for their slot ───────────────────────────────────
    rushed = []
    for s in segs:
        text = (s.target_text or "").strip()
        span = max(s.end - s.start, 0.3)
        if text and s not in silent and len(text) / span > RUSHED_CPS:
            rushed.append(s)
    if rushed:
        out.append(Issue(
            code="rushed_lines", severity="warning",
            title=f"{len(rushed)} line{'s' if len(rushed) > 1 else ''} may "
                  f"sound rushed or cut off ({_line_list(_ids(rushed))})",
            detail=("The translation is much longer than the time the speaker "
                    "took, so it was sped up to fit and may be clipped at the "
                    "next line."),
            fix=("Shorten the wording, or widen the line's time window in the "
                 "speech editor (drag its edges), then re-dub it."),
            action="edit_line", segment_ids=_ids(rushed)))

    # ── Voice identity ───────────────────────────────────────────────────
    msg = (tts.message or "") if tts else ""
    if "cloning unavailable" in msg or "speaker match unavailable" in msg:
        out.append(Issue(
            code="clone_unavailable", severity="warning",
            title="The original speaker's voice was not kept",
            detail="Voice cloning was not available for this run, so a native "
                   "voice was used.",
            fix="Run the dub again later to get the speaker's own voice.",
            action="retry"))
    elif "speaker match off in Fast mode" in msg:
        out.append(Issue(
            code="clone_fast", severity="info",
            title="Fast quality uses a native voice",
            detail="Matching the speaker's timbre is skipped at Fast quality.",
            fix="Pick Balanced or Studio quality to keep the speaker's voice.",
            action="none"))
    sim = job.result.metrics.speaker_similarity
    tts_detail = (tts.detail or {}) if tts else {}
    if tts_detail.get("voice_clone") and sim is not None and sim < LOW_SIMILARITY:
        out.append(Issue(
            code="low_similarity", severity="info",
            title=f"Voice likeness is low ({sim:.0f}%)",
            detail="Background noise or several speakers in the reference clip "
                   "make the cloned voice drift from the original.",
            fix=("Upload a clean 10-20 second clip of the speaker as a custom "
                 "voice reference and dub again."),
            action="reupload"))

    # ── Background, lip sync ────────────────────────────────────────────
    sep = _stage(job, "separation")
    if sep and ("could not" in (sep.message or "") or "failed" in (sep.message or "")):
        out.append(Issue(
            code="background_lost", severity="warning",
            title="Background music and effects were dropped",
            detail=sep.message,
            fix=("The dub plays with voice only. Run it again; if it repeats, "
                 "the original speech is too mixed into the music to separate."),
            action="retry"))
    lip = _stage(job, "lipsync")
    if opts.lip_sync and lip and lip.status == "skipped":
        out.append(Issue(
            code="lipsync_skipped", severity="info",
            title="Lip sync did not run",
            detail=lip.message or "Lip sync is not available right now.",
            fix="The dub is complete without it. Try again later for lip sync.",
            action="none"))

    # ── Billing ──────────────────────────────────────────────────────────
    if job.billing.trimmed:
        out.append(Issue(
            code="trimmed", severity="info",
            title="Only part of the video was dubbed",
            detail=job.billing.notice or "Your balance covered part of it.",
            fix="Top up tokens and dub the full video.",
            action="buy_tokens"))

    if job.edit.version and opts.lip_sync and job.edit.segment_ids:
        out.append(Issue(
            code="lipsync_after_edit", severity="info",
            title="Edited lines keep the original lip movement",
            detail="Lip sync was rendered for the first version of the speech.",
            fix="Run a new dub with lip sync if the mouth movement must match.",
            action="none"))
    return out
