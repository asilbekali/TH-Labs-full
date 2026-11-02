"""The video editor's renderer (app/editor.py), run against real ffmpeg."""
import shutil
import subprocess
import time

import pytest

from app import editor

pytestmark = pytest.mark.skipif(not shutil.which("ffmpeg"),
                                reason="needs ffmpeg")


def _make(path, args):
    subprocess.run(["ffmpeg", "-y", "-v", "error", *args, str(path)],
                   check=True)
    return path


@pytest.fixture
def media(tmp_path):
    video = _make(tmp_path / "anim.mp4", [
        "-f", "lavfi", "-i", "testsrc=s=320x240:r=30:d=4", "-c:v", "libx264",
        "-pix_fmt", "yuv420p"])                    # silent animation
    voice = _make(tmp_path / "line.wav", [
        "-f", "lavfi", "-i", "sine=f=440:d=1.5"])
    music = _make(tmp_path / "music.mp3", [
        "-f", "lavfi", "-i", "sine=f=220:d=6"])
    return video, voice, music


def _asset(path, kind, aid):
    info = editor.probe(path)
    a = editor.Asset(id=aid, kind=kind, name=path.name, url="/x",
                     duration=info["duration"], has_audio=info["has_audio"],
                     width=info["width"], height=info["height"])
    a.file = str(path)
    return a


def test_probe_tells_picture_from_sound(media):
    video, voice, _ = media
    v, a = editor.probe(video), editor.probe(voice)
    assert v["has_video"] and not v["has_audio"] and v["width"] == 320
    assert not a["has_video"] and a["has_audio"]
    assert a["duration"] == pytest.approx(1.5, abs=0.1)


def test_render_composites_trimmed_clips(media, tmp_path):
    video, voice, music = media
    p = editor.Project(id="a" * 12, owner_id=1, name="t", created_at=0,
                       updated_at=0, tracks=editor.default_tracks())
    p.assets = [_asset(video, "video", "v" * 12), _asset(voice, "audio", "l" * 12),
                _asset(music, "audio", "m" * 12)]
    vt, st, mt = p.tracks
    # Two cuts of the same animation, back to back, the second trimmed.
    vt.clips = [editor.Clip(id="c1", asset_id="v" * 12, start=0, trim_in=0,
                            trim_out=2),
                editor.Clip(id="c2", asset_id="v" * 12, start=2, trim_in=3,
                            trim_out=4)]
    st.clips = [editor.Clip(id="c3", asset_id="l" * 12, start=0.5,
                            trim_out=1.5, fade_in=0.1)]
    mt.clips = [editor.Clip(id="c4", asset_id="m" * 12, start=0, trim_out=3.5,
                            volume=0.3, fade_out=1)]
    editor.validate_tracks(p, p.tracks)

    out = tmp_path / "out.mp4"
    cmd, total = editor.build_render(p, out)
    assert total == pytest.approx(3.5)
    subprocess.run(cmd, check=True, capture_output=True)
    info = editor.probe(out)
    assert info["has_video"] and info["has_audio"]
    assert info["width"] == 320
    assert info["duration"] == pytest.approx(3.5, abs=0.15)


def test_validation_keeps_clips_on_their_own_kind_of_track(media):
    video, voice, _ = media
    p = editor.Project(id="b" * 12, owner_id=1, name="t", created_at=0,
                       updated_at=0, tracks=editor.default_tracks())
    p.assets = [_asset(voice, "audio", "l" * 12)]
    p.tracks[0].clips = [editor.Clip(id="c", asset_id="l" * 12, start=0,
                                     trim_out=1)]
    with pytest.raises(Exception, match="cannot go on"):
        editor.validate_tracks(p, p.tracks)


def test_render_state_reports_done(media, tmp_path, monkeypatch):
    video, _, _ = media
    monkeypatch.setattr(editor.settings, "data_dir", tmp_path)
    p = editor.Project(id="c" * 12, owner_id=7, name="t",
                       created_at=time.time(), updated_at=time.time(),
                       tracks=editor.default_tracks())
    p.assets = [_asset(video, "video", "v" * 12)]
    p.tracks[0].clips = [editor.Clip(id="c", asset_id="v" * 12, start=0,
                                     trim_out=1)]
    state = editor.RenderState(status="running")
    editor._run_render(p, state)
    assert state.status == "done", state.error
    assert state.url and state.url.endswith(".mp4")
