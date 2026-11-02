"""Re-dubbing single lines (pipeline/redub.py) and the issue report
(pipeline/issues.py)."""
import numpy as np
import pytest
import soundfile as sf

from app.pipeline import issues, redub
from app.schemas import (DubOptions, Job, JobStatus, StageState, StageStatus,
                         Segment)

SR = 24_000


def _segs():
    return [
        Segment(id=0, start=0.5, end=2.0, source_text="Hello there friend",
                target_text="Salom do'stim"),
        Segment(id=1, start=2.5, end=4.0, source_text="How are you today",
                target_text="Bugun qalaysiz"),
        Segment(id=2, start=15.0, end=17.0, source_text="Goodbye now",
                target_text="Xayr"),
    ]


def test_apply_edits_reports_only_real_changes():
    new, changed = redub.apply_edits(_segs(), [
        redub.LineEdit(id=0, target_text="Salom  do'stim"),   # whitespace only
        redub.LineEdit(id=1, target_text="Bugun qandaysiz?"),
    ], 20.0)
    assert changed == {1}
    assert new[1].target_text == "Bugun qandaysiz?"
    assert _segs()[1].target_text == "Bugun qalaysiz"      # input untouched


def test_apply_edits_moves_timing_and_refuses_overlap():
    new, changed = redub.apply_edits(
        _segs(), [redub.LineEdit(id=1, start=2.2, end=4.5)], 20.0)
    assert changed == {1} and (new[1].start, new[1].end) == (2.2, 4.5)
    with pytest.raises(redub.EditError, match="overlaps"):
        redub.apply_edits(_segs(), [redub.LineEdit(id=1, start=1.0)], 20.0)
    with pytest.raises(redub.EditError, match="inside the video"):
        redub.apply_edits(_segs(), [redub.LineEdit(id=2, end=30.0)], 20.0)
    with pytest.raises(redub.EditError, match="does not exist"):
        redub.apply_edits(_segs(), [redub.LineEdit(id=9, target_text="x")], 20.0)


def test_edge_groups_follow_its_chunking_and_others_are_per_line():
    segs = _segs()
    # 0 and 1 fit one 11 s chunk; 2 is far enough away to start another.
    assert redub.voice_groups("edge-tts", segs) == [[0, 1], [2]]
    assert redub.voice_groups("edge-tts + OpenVoice", segs) == [[0, 1], [2]]
    assert redub.voice_groups("Navoiy", segs) == [[0], [1], [2]]
    # Editing line 1 of an edge dub re-voices its whole chunk.
    assert redub.plan_groups("edge-tts", segs, segs, {1}) == [[0, 1]]


def test_plans_clear_old_window_and_place_at_new_start():
    old = _segs()
    new, _ = redub.apply_edits(old, [redub.LineEdit(id=1, start=3.0, end=4.2)],
                               20.0)
    [plan] = redub.build_plans(old, new, [[1]], 20.0)
    assert plan.clear == (2.5, 15.0)          # old start → next line
    assert plan.at == 3.0 and plan.room == pytest.approx(12.0)
    assert plan.segments[0].start == 0.0      # shifted to the clip's origin


def test_splice_replaces_only_the_edited_window(tmp_path):
    voice = tmp_path / "voice.wav"
    buf = np.zeros(20 * SR, np.float32)
    buf[int(0.5 * SR):int(2.0 * SR)] = 0.3     # line 0
    buf[int(2.5 * SR):int(4.0 * SR)] = 0.3     # line 1 (to be replaced)
    buf[int(15 * SR):int(17 * SR)] = 0.3       # line 2
    sf.write(voice, buf, SR)
    clip = tmp_path / "clip.wav"
    sf.write(clip, np.full(SR, 0.5, np.float32), SR)

    old = _segs()
    new, _ = redub.apply_edits(old, [redub.LineEdit(id=1, start=3.0, end=4.0)],
                               20.0)
    [plan] = redub.build_plans(old, new, [[1]], 20.0)
    out = tmp_path / "out.wav"
    redub.splice(voice, out, [(plan, clip)], 20.0)
    data, sr = sf.read(out, dtype="float32")
    at = lambda t: round(float(data[int(t * sr)]), 3)  # noqa: E731  (16-bit WAV)
    assert at(1.0) == pytest.approx(0.3)       # line 0 untouched
    assert at(2.7) == pytest.approx(0.0)       # old line 1 removed
    assert at(3.5) == pytest.approx(0.5)       # new line 1 laid in
    assert at(16.0) == pytest.approx(0.3)      # line 2 untouched


def _job(segments, status=JobStatus.completed, tts_msg=""):
    stages = [StageState(key="asr", label="ASR", status=StageStatus.done),
              StageState(key="tts", label="TTS", status=StageStatus.done,
                         message=tts_msg)]
    j = Job(id="abc123abc123", options=DubOptions(target_lang="uz"),
            status=status, stages=stages, created_at=0, updated_at=0,
            simulated=False)
    j.result.segments = segments
    j.result.detected_source_lang = "en"
    return j


def test_issues_name_the_silent_lines(tmp_path):
    voice = tmp_path / "voice.wav"
    buf = np.zeros(20 * SR, np.float32)
    buf[int(0.5 * SR):int(2.0 * SR)] = 0.2        # only line 0 is voiced
    sf.write(voice, buf, SR)
    found = issues.analyse(_job(_segs()), voice)
    silent = next(i for i in found if i.code == "silent_lines")
    assert silent.severity == "error" and silent.action == "edit_line"
    assert silent.segment_ids == [1, 2]
    assert found[0].code == "silent_lines"        # errors sort first


def test_issues_flag_untranslated_and_rushed_lines():
    segs = _segs()
    segs[0].target_text = ""
    segs[1].target_text = segs[1].source_text      # left in English
    segs[2].target_text = "x" * 120                # 60 chars/s
    codes = {i.code: i for i in issues.analyse(_job(segs))}
    assert codes["untranslated"].segment_ids == [0]
    assert codes["not_translated"].segment_ids == [1]
    assert codes["rushed_lines"].segment_ids == [2]


def test_failed_job_reports_where_it_stopped():
    j = _job([], status=JobStatus.failed)
    j.stages[1].status = StageStatus.failed
    j.stages[1].message = "edge-tts error"
    [only] = issues.analyse(j)
    assert only.code == "job_failed" and only.action == "retry"
    assert "TTS" in only.title
