from app.pipeline import subtitles
from app.schemas import Segment


def seg(i: int, start: float, end: float, target: str | None) -> Segment:
    return Segment(id=i, start=start, end=end, source_text="x", target_text=target)


def test_cues_skip_empty_and_zero_length_segments():
    items = subtitles.cues([seg(0, 0, 2, "Salom"), seg(1, 2, 3, "  "),
                            seg(2, 3, 3, "Hech"), seg(3, 4, 5, None)])
    assert items == [(0, 2, "Salom")]


def test_long_line_is_split_into_two_line_cues_covering_the_segment():
    text = " ".join(["soʻz"] * 60)
    items = subtitles.cues([seg(0, 10.0, 20.0, text)])
    assert len(items) > 1
    assert all(t.count("\n") < subtitles.MAX_LINES for _, _, t in items)
    assert all(len(line) <= subtitles.LINE_CHARS
               for _, _, t in items for line in t.split("\n"))
    assert items[0][0] == 10.0
    assert abs(items[-1][1] - 20.0) < 1e-9
    for (_, a_end, _), (b_start, _, _) in zip(items, items[1:]):
        assert a_end == b_start


def test_srt_and_vtt_format(tmp_path):
    items = [(1.5, 3_725.25, "Birinchi\nqator")]
    subtitles.write_srt(items, tmp_path / "a.srt")
    subtitles.write_vtt(items, tmp_path / "a.vtt")
    assert (tmp_path / "a.srt").read_text(encoding="utf-8") == (
        "1\n00:00:01,500 --> 01:02:05,250\nBirinchi\nqator\n")
    assert (tmp_path / "a.vtt").read_text(encoding="utf-8") == (
        "WEBVTT\n\n00:00:01.500 --> 01:02:05.250\nBirinchi\nqator\n")


def test_filter_path_escapes_separators():
    from pathlib import Path
    assert subtitles._filter_path(Path("/a:b/c'd.srt")) == "/a\\:b/c\\'d.srt"
