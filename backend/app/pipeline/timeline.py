"""Where a dubbed line goes on the output timeline.

Both TTS engines lay synthesized clips onto one buffer at the source's timing,
and both did it the same wrong way: place each clip at its start time, at
whatever length it came out, and sum it into the buffer. Nothing tied a clip's
length to when the next line began, so a line that could not be compressed
enough played on top of its successor and the viewer heard the dub twice over.

The rules live here rather than in either engine because the defect was in both
files independently — `tts_edge` merging segments into chunks and `tts` going
segment by segment, but the same missing bound. Sharing them is what stops the
two from drifting apart again.
"""
from __future__ import annotations

# How far a dubbed line may run past the speaker's own utterance, into the pause
# that follows it. Dubbing mixes do this routinely; the alternative is
# compressing a line into the speaker's exact span while a second of silence
# sits unused right after it.
MAX_SPILL = 1.2
# How far a long line may push the line after it. A small overrun is better
# absorbed by starting the next line late than by cutting words off the end of
# this one; past this the tail is cut instead, so one bad line cannot drag the
# rest of the video out of sync.
MAX_SHIFT = 1.5
# Floor for a degenerate slot, so no line is ever asked for a 0-length clip.
MIN_ROOM = 0.25
# Fade applied to a clip that had to be cut, so the cut is not a click.
CUT_FADE = 0.08


def slot_budget(start: float, end: float, due_next: float,
                cursor: float) -> tuple[float, float, float]:
    """Budget for one dubbed line: where it starts, what it is compressed
    toward, and where it is cut.

    * `at` — normally the line's source time; a line whose predecessor ran long
      starts later, by at most `MAX_SHIFT`.
    * `target` — its own utterance span plus up to `MAX_SPILL` of the pause that
      follows, but never past where the next line is due. Spending that pause is
      why this is not simply `end - start`: compressing a line into the
      speaker's exact span while silence follows it is quality given up for
      nothing.
    * `limit` — the collision bound, measured to the next line's start, plus the
      `MAX_SHIFT` a line may borrow from its successor.

    `cursor` is where the previous line finished. Whatever a line borrows past
    `due_next` comes out of the next line's room, so the timeline catches back
    up instead of drifting for the rest of the video.
    """
    at = min(max(start, cursor), start + MAX_SHIFT)
    room = max(due_next - at, MIN_ROOM)
    span = max(end - at, MIN_ROOM)
    target = max(min(room, span + MAX_SPILL), MIN_ROOM)
    return at, target, room + MAX_SHIFT


def cut_to(clip, max_samples: int, sample_rate: int):
    """Truncate `clip` to `max_samples`, fading the last `CUT_FADE` seconds so
    the cut is not a click. Returns the clip unchanged if it already fits."""
    import numpy as np

    if max_samples <= 0:
        return clip[:0]
    if clip.shape[0] <= max_samples:
        return clip
    cut = np.array(clip[:max_samples], dtype="float32")
    fade = min(int(CUT_FADE * sample_rate), cut.shape[0])
    if fade > 1:
        cut[-fade:] *= np.linspace(1.0, 0.0, fade, dtype="float32")
    return cut


def write_without_overlap(buf, placements: list[tuple[int, object]]) -> None:
    """Sum clips into `buf`, each cut where the next one begins.

    `placements` is (offset_in_samples, samples), in chronological order. The
    budgets above should already have left a gap, but neither engine's output
    length is exactly predictable — `atempo` rounds, and OmniVoice treats its
    duration argument as a soft target — and this is the property the stage has
    to guarantee: no two dubbed lines in the same samples, ever. The `+=` then
    only ever adds to silence.
    """
    for k, (offset, data) in enumerate(placements):
        room = len(data)
        if k + 1 < len(placements):
            room = min(room, placements[k + 1][0] - offset)
        if room <= 0:
            continue
        buf[offset:offset + room] += data[:room]
