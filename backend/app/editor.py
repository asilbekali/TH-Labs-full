"""Video editor — Studio Max (the /video-editor page).

For animation agencies: they have a finished animation with no voice. They
upload it, type the lines, turn each into speech, and place and trim those
clips against the picture — plus music — then export one video. That is a
timeline editor, and this is its server half:

    projects   one JSON document per project: assets + tracks of clips
    assets     uploaded video/audio, speech made on the /tts engines, or a
               finished dub imported from the Studio
    render     ffmpeg composites the timeline into one MP4

The timeline is the browser's to edit; this module validates it, stores it and
renders it. Every clip says which asset it plays, where it sits on the
timeline (`start`), which part of the asset it plays (`trim_in`–`trim_out`),
and how loud. Video clips stack bottom-up across video tracks, so a later
track covers an earlier one where both have picture.

Storage is `data/editor/<owner>/<project>/`, served read-only under /media like
every other output. Ids are random, so a URL is as private as a dub's.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from typing import Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from . import billing
from .auth import StudioUser, require_user
from .config import get_settings

log = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/editor", tags=["editor"])

FEATURE = "The video editor"
MAX_UPLOAD_BYTES = 2 * 1024 ** 3
MAX_TIMELINE_SECONDS = 3 * 60 * 60
PEAKS_PER_SECOND = 20
_CHUNK = 1024 * 1024
_ID = re.compile(r"^[a-f0-9]{8,32}$")


# ── Models ──────────────────────────────────────────────────────────────────

class Asset(BaseModel):
    id: str
    kind: Literal["video", "audio"]
    name: str
    url: str
    duration: float
    has_audio: bool = True
    width: Optional[int] = None
    height: Optional[int] = None
    source: Literal["upload", "tts", "dub"] = "upload"
    # The script a speech asset was made from, so the editor can show it.
    text: Optional[str] = None
    # Loudness envelope for drawing the clip's waveform (0..1).
    peaks: list[float] = Field(default_factory=list)
    file: str = Field("", exclude=True)        # server path; never sent


class Clip(BaseModel):
    id: str
    asset_id: str
    start: float = Field(ge=0)                 # position on the timeline (s)
    trim_in: float = Field(0, ge=0)            # where in the asset it begins
    trim_out: float = Field(gt=0)              # where in the asset it ends
    volume: float = Field(1.0, ge=0, le=4)
    fade_in: float = Field(0, ge=0, le=30)
    fade_out: float = Field(0, ge=0, le=30)
    label: Optional[str] = None

    @property
    def length(self) -> float:
        return max(0.0, self.trim_out - self.trim_in)


class Track(BaseModel):
    id: str
    kind: Literal["video", "voice", "music", "audio"]
    name: str
    muted: bool = False
    volume: float = Field(1.0, ge=0, le=4)
    clips: list[Clip] = Field(default_factory=list)


class RenderState(BaseModel):
    status: Literal["idle", "running", "done", "failed"] = "idle"
    progress: float = 0.0
    url: Optional[str] = None
    error: Optional[str] = None
    updated_at: Optional[float] = None


class Project(BaseModel):
    id: str
    owner_id: int
    name: str
    created_at: float
    updated_at: float
    assets: list[Asset] = Field(default_factory=list)
    tracks: list[Track] = Field(default_factory=list)
    render: RenderState = Field(default_factory=RenderState)

    def asset(self, asset_id: str) -> Asset | None:
        return next((a for a in self.assets if a.id == asset_id), None)


class ProjectCreate(BaseModel):
    name: str = "Untitled project"


class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    tracks: Optional[list[Track]] = None


class ImportRequest(BaseModel):
    tts_task_id: Optional[str] = None
    job_id: Optional[str] = None
    name: Optional[str] = None


# ── Storage ─────────────────────────────────────────────────────────────────

def _root(owner_id: int) -> Path:
    d = settings.data_dir / "editor" / str(int(owner_id))
    d.mkdir(parents=True, exist_ok=True)
    return d


def _dir(owner_id: int, pid: str) -> Path:
    if not _ID.match(pid or ""):
        raise HTTPException(404, "Project not found")
    return _root(owner_id) / pid


def _url(path: Path) -> str:
    return f"/media/{path.relative_to(settings.data_dir).as_posix()}"


# Renders run in threads; their progress lives here, not on disk, so a busy
# render does not rewrite the project file several times a second.
_renders: dict[str, RenderState] = {}
_locks: dict[str, asyncio.Lock] = {}


def _lock(pid: str) -> asyncio.Lock:
    return _locks.setdefault(pid, asyncio.Lock())


def load(owner_id: int, pid: str) -> Project:
    f = _dir(owner_id, pid) / "project.json"
    if not f.exists():
        raise HTTPException(404, "Project not found")
    # `file` is excluded from dumps, not from validation, so it loads back.
    project = Project.model_validate(json.loads(f.read_text()))
    if project.owner_id != owner_id:
        raise HTTPException(404, "Project not found")
    live = _renders.get(pid)
    if live is not None:
        project.render = live
    return project


def save(project: Project) -> None:
    d = _dir(project.owner_id, project.id)
    d.mkdir(parents=True, exist_ok=True)
    data = project.model_dump(mode="json")
    # `file` is excluded from responses but must be stored.
    for a, raw in zip(project.assets, data["assets"]):
        raw["file"] = a.file
    tmp = d / "project.json.tmp"
    tmp.write_text(json.dumps(data))
    tmp.replace(d / "project.json")


def _public(project: Project) -> dict:
    return project.model_dump(mode="json")


def _summary(project: Project) -> dict:
    length = timeline_length(project)
    thumb = next((a.url for a in project.assets if a.kind == "video"), None)
    return {"id": project.id, "name": project.name,
            "created_at": project.created_at, "updated_at": project.updated_at,
            "duration": round(length, 2), "assets": len(project.assets),
            "clips": sum(len(t.clips) for t in project.tracks),
            "video_url": thumb, "render": project.render.model_dump()}


def default_tracks() -> list[Track]:
    return [Track(id=_new_id(), kind="video", name="Video"),
            Track(id=_new_id(), kind="voice", name="Voice"),
            Track(id=_new_id(), kind="music", name="Music")]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


# ── Media probing ───────────────────────────────────────────────────────────

def probe(path: Path) -> dict:
    """duration, whether there is picture and sound, and the frame size."""
    ffprobe = shutil.which("ffprobe")
    if not ffprobe:
        raise HTTPException(503, "Media tools are not installed on this server.")
    try:
        out = subprocess.run(
            [ffprobe, "-v", "error", "-show_entries",
             "format=duration:stream=codec_type,width,height",
             "-of", "json", str(path)],
            capture_output=True, text=True, timeout=60)
        info = json.loads(out.stdout or "{}")
    except Exception:
        info = {}
    streams = info.get("streams") or []
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    try:
        duration = float((info.get("format") or {}).get("duration") or 0)
    except (TypeError, ValueError):
        duration = 0.0
    return {"duration": duration,
            "has_video": video is not None and bool(video.get("width")),
            "has_audio": any(s.get("codec_type") == "audio" for s in streams),
            "width": int(video["width"]) if video and video.get("width") else None,
            "height": int(video["height"]) if video and video.get("height") else None}


def peaks(path: Path, duration: float) -> list[float]:
    """A coarse loudness envelope, PEAKS_PER_SECOND points per second (capped),
    for the timeline to draw. [] when it cannot be computed."""
    ffmpeg = settings.ffmpeg
    if not ffmpeg or duration <= 0:
        return []
    try:
        import numpy as np
        rate = 4000
        raw = subprocess.run(
            [ffmpeg, "-v", "error", "-i", str(path), "-vn", "-ac", "1",
             "-ar", str(rate), "-f", "s16le", "-"],
            capture_output=True, timeout=180).stdout
        data = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
        if not data.size:
            return []
        n = int(min(max(duration * PEAKS_PER_SECOND, 1), 6000))
        buckets = np.array_split(np.abs(data), n)
        vals = np.array([float(b.max()) if b.size else 0.0 for b in buckets])
        top = float(vals.max()) or 1.0
        return [round(float(v / top), 3) for v in vals]
    except Exception as exc:
        log.info("editor: peaks unavailable (%s)", type(exc).__name__)
        return []


async def _register(path: Path, name: str, source: str,
                    text: str | None = None) -> Asset:
    info = await asyncio.to_thread(probe, path)
    if info["duration"] <= 0:
        path.unlink(missing_ok=True)
        raise HTTPException(400, "That file has no playable audio or video.")
    kind = "video" if info["has_video"] else "audio"
    if kind == "audio" and not info["has_audio"]:
        path.unlink(missing_ok=True)
        raise HTTPException(400, "That file has no playable audio or video.")
    asset = Asset(id=path.stem, kind=kind, name=name[:120], url=_url(path),
                  duration=round(info["duration"], 3),
                  has_audio=info["has_audio"], width=info["width"],
                  height=info["height"], source=source, text=text,
                  peaks=(await asyncio.to_thread(peaks, path, info["duration"])
                         if info["has_audio"] else []))
    asset.file = str(path)
    return asset


# ── Validation ──────────────────────────────────────────────────────────────

def validate_tracks(project: Project, tracks: list[Track]) -> list[Track]:
    if len(tracks) > 24:
        raise HTTPException(400, "A project can have at most 24 tracks.")
    for t in tracks:
        if len(t.clips) > 500:
            raise HTTPException(400, f'Track "{t.name}" has too many clips.')
        for c in t.clips:
            a = project.asset(c.asset_id)
            if a is None:
                raise HTTPException(400, f'A clip on "{t.name}" uses a file '
                                         "that is not in this project.")
            if (t.kind == "video") != (a.kind == "video"):
                raise HTTPException(400, f'"{a.name}" cannot go on the '
                                         f'{t.kind} track "{t.name}".')
            c.trim_out = min(c.trim_out, a.duration)
            if c.trim_out - c.trim_in < 0.05:
                raise HTTPException(400, f'A clip of "{a.name}" is shorter '
                                         "than 0.05 s.")
            if c.start + c.length > MAX_TIMELINE_SECONDS:
                raise HTTPException(400, "The timeline can be at most 3 hours.")
    return tracks


def timeline_length(project: Project) -> float:
    ends = [c.start + c.length for t in project.tracks for c in t.clips]
    return max(ends, default=0.0)


# ── Rendering ───────────────────────────────────────────────────────────────

def _even(n: int) -> int:
    return max(2, n - n % 2)


def build_render(project: Project, out: Path) -> tuple[list[str], float]:
    """The ffmpeg command for `project`, and the timeline length it renders."""
    ffmpeg = settings.ffmpeg
    if not ffmpeg:
        raise RuntimeError("ffmpeg is not installed on this server.")
    active = [t for t in project.tracks if not t.muted]
    total = max((c.start + c.length for t in active for c in t.clips),
                default=0.0)
    if total <= 0:
        raise RuntimeError("The timeline is empty. Add a clip first.")

    video_clips = [(t, c) for t in active if t.kind == "video"
                   for c in sorted(t.clips, key=lambda x: x.start)]
    first = next((project.asset(c.asset_id) for _, c in video_clips), None)
    w = _even(first.width or 1280) if first else 1280
    h = _even(first.height or 720) if first else 720
    fps = 30

    inputs: list[str] = []
    filters: list[str] = []

    def add_input(path: str) -> int:
        inputs.extend(["-i", path])
        return len(inputs) // 2 - 1

    # Picture: a black canvas the length of the timeline, each video clip laid
    # over it from its start time, bottom track first.
    filters.append(f"color=c=black:s={w}x{h}:r={fps}:d={total:.3f},"
                   "format=yuv420p[base0]")
    base = "base0"
    for k, (_t, c) in enumerate(video_clips):
        a = project.asset(c.asset_id)
        i = add_input(a.file)
        filters.append(
            f"[{i}:v]trim=start={c.trim_in:.3f}:end={c.trim_out:.3f},"
            f"setpts=PTS-STARTPTS+{c.start:.3f}/TB,"
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps={fps},"
            f"format=yuv420p[v{k}]")
        nxt = f"base{k + 1}"
        filters.append(
            f"[{base}][v{k}]overlay=eof_action=pass:"
            f"enable='between(t,{c.start:.3f},{c.start + c.length:.3f})'[{nxt}]")
        base = nxt

    # Sound: every clip that has any, trimmed, faded, delayed to its start and
    # mixed without normalisation, so volumes mean what the sliders say.
    fmt = "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo"
    legs: list[str] = []
    for t in active:
        for c in t.clips:
            a = project.asset(c.asset_id)
            if a is None or not a.has_audio:
                continue
            gain = c.volume * t.volume
            if gain <= 0:
                continue
            i = add_input(a.file)
            chain = [f"atrim=start={c.trim_in:.3f}:end={c.trim_out:.3f}",
                     "asetpts=PTS-STARTPTS", fmt, f"volume={gain:.3f}"]
            if c.fade_in > 0:
                chain.append(f"afade=t=in:st=0:d={min(c.fade_in, c.length):.3f}")
            if c.fade_out > 0:
                d = min(c.fade_out, c.length)
                chain.append(f"afade=t=out:st={c.length - d:.3f}:d={d:.3f}")
            ms = int(round(c.start * 1000))
            if ms > 0:
                chain.append(f"adelay={ms}:all=1")
            label = f"a{len(legs)}"
            filters.append(f"[{i}:a]" + ",".join(chain) + f"[{label}]")
            legs.append(label)
    if legs:
        filters.append("".join(f"[{x}]" for x in legs)
                       + f"amix=inputs={len(legs)}:normalize=0:duration=longest,"
                       f"apad,atrim=end={total:.3f},alimiter=limit=0.97[aout]")
    else:
        filters.append(f"anullsrc=r=48000:cl=stereo,atrim=end={total:.3f}[aout]")

    cmd = [ffmpeg, "-y", "-v", "error", "-progress", "pipe:1", "-nostats",
           *inputs, "-filter_complex", ";".join(filters),
           "-map", f"[{base}]", "-map", "[aout]", "-t", f"{total:.3f}",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
           "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
           "-movflags", "+faststart", str(out)]
    return cmd, total


def _run_render(project: Project, state: RenderState) -> None:
    """Blocking: run ffmpeg, keep `state` current, never raise."""
    d = _dir(project.owner_id, project.id) / "renders"
    d.mkdir(parents=True, exist_ok=True)
    out = d / f"{_new_id()}.mp4"
    try:
        cmd, total = build_render(project, out)
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, text=True)
        assert proc.stdout is not None
        for line in proc.stdout:
            if line.startswith("out_time_us=") or line.startswith("out_time_ms="):
                try:
                    us = int(line.split("=", 1)[1])
                    state.progress = round(min(0.99, us / 1e6 / total), 3)
                    state.updated_at = time.time()
                except ValueError:
                    pass
        err = proc.stderr.read() if proc.stderr else ""
        code = proc.wait(timeout=60)
        if code != 0 or not out.exists():
            log.error("editor render %s failed: %s", project.id, err[-2000:])
            out.unlink(missing_ok=True)
            raise RuntimeError("The video could not be rendered. Check that "
                               "every clip's file still plays, then try again.")
        # Keep the latest render only; older ones are dead weight on the volume.
        for old in d.glob("*.mp4"):
            if old != out:
                old.unlink(missing_ok=True)
        state.status, state.progress, state.url = "done", 1.0, _url(out)
        state.error = None
    except Exception as exc:
        state.status, state.error = "failed", str(exc)[:300]
    state.updated_at = time.time()


# ── Routes ──────────────────────────────────────────────────────────────────

async def max_user(user: StudioUser = Depends(require_user)) -> StudioUser:
    """Every editor route is Studio Max only."""
    await billing.require_tier(user.token, "STUDIO", FEATURE)
    return user


@router.get("/projects")
def list_projects(user: StudioUser = Depends(max_user)) -> dict:
    items = []
    for f in _root(user.id).glob("*/project.json"):
        try:
            items.append(_summary(load(user.id, f.parent.name)))
        except Exception:
            continue
    items.sort(key=lambda p: p["updated_at"], reverse=True)
    return {"projects": items}


@router.post("/projects")
def create_project(body: ProjectCreate,
                   user: StudioUser = Depends(max_user)) -> dict:
    now = time.time()
    project = Project(id=_new_id(), owner_id=user.id,
                      name=(body.name or "Untitled project").strip()[:80]
                      or "Untitled project",
                      created_at=now, updated_at=now, tracks=default_tracks())
    save(project)
    return {"project": _public(project)}


@router.get("/projects/{pid}")
def get_project(pid: str, user: StudioUser = Depends(max_user)) -> dict:
    return {"project": _public(load(user.id, pid))}


@router.put("/projects/{pid}")
async def update_project(pid: str, body: ProjectUpdate,
                         user: StudioUser = Depends(max_user)) -> dict:
    async with _lock(pid):
        project = load(user.id, pid)
        if body.name is not None:
            project.name = body.name.strip()[:80] or project.name
        if body.tracks is not None:
            project.tracks = validate_tracks(project, body.tracks)
        project.updated_at = time.time()
        save(project)
    return {"project": _public(project)}


@router.delete("/projects/{pid}")
async def delete_project(pid: str, user: StudioUser = Depends(max_user)) -> dict:
    async with _lock(pid):
        load(user.id, pid)
        shutil.rmtree(_dir(user.id, pid), ignore_errors=True)
    _renders.pop(pid, None)
    return {"deleted": pid}


@router.post("/projects/{pid}/assets")
async def upload_asset(pid: str, file: UploadFile = File(...),
                       user: StudioUser = Depends(max_user)) -> dict:
    load(user.id, pid)
    suffix = Path(file.filename or "media").suffix.lower()[:8] or ".bin"
    if not re.match(r"^\.[a-z0-9]+$", suffix):
        suffix = ".bin"
    d = _dir(user.id, pid) / "assets"
    d.mkdir(parents=True, exist_ok=True)
    path = d / f"{_new_id()}{suffix}"
    size = 0
    with path.open("wb") as out:
        while chunk := await file.read(_CHUNK):
            size += len(chunk)
            if size > MAX_UPLOAD_BYTES:
                out.close()
                path.unlink(missing_ok=True)
                raise HTTPException(413, "Files can be at most 2 GB.")
            out.write(chunk)
    asset = await _register(path, file.filename or path.name, "upload")
    async with _lock(pid):
        project = load(user.id, pid)
        project.assets.append(asset)
        project.updated_at = time.time()
        save(project)
    return {"asset": asset.model_dump(mode="json"),
            "project": _public(project)}


@router.post("/projects/{pid}/assets/import")
async def import_asset(pid: str, body: ImportRequest,
                       user: StudioUser = Depends(max_user)) -> dict:
    """Bring in speech made with /api/tts, or a finished dub from the Studio."""
    from .jobs import manager
    from . import speech

    load(user.id, pid)
    d = _dir(user.id, pid) / "assets"
    d.mkdir(parents=True, exist_ok=True)
    text: str | None = None
    if body.tts_task_id:
        task = speech.service(manager.orchestrator).get(body.tts_task_id, user.id)
        if task is None or task.status != "done" or not task.audio_url:
            raise HTTPException(404, "That speech is not ready or not yours.")
        src = settings.outputs_dir / Path(task.audio_url).name
        name = body.name or "Speech"
        text = speech.service(manager.orchestrator).text_of(task.id)
        source = "tts"
    elif body.job_id:
        job = manager.get(body.job_id)
        if job is None or job.owner_id != user.id or not job.result.output_url:
            raise HTTPException(404, "That dub is not finished or not yours.")
        src = settings.outputs_dir / Path(job.result.output_url).name
        name = body.name or job.filename or "Dubbed video"
        source = "dub"
    else:
        raise HTTPException(400, "Send tts_task_id or job_id.")
    if not src.exists():
        raise HTTPException(410, "That file is no longer on the server.")
    path = d / f"{_new_id()}{src.suffix or '.bin'}"
    await asyncio.to_thread(shutil.copyfile, src, path)
    asset = await _register(path, name, source, text=text)
    async with _lock(pid):
        project = load(user.id, pid)
        project.assets.append(asset)
        project.updated_at = time.time()
        save(project)
    return {"asset": asset.model_dump(mode="json"),
            "project": _public(project)}


@router.delete("/projects/{pid}/assets/{asset_id}")
async def delete_asset(pid: str, asset_id: str,
                       user: StudioUser = Depends(max_user)) -> dict:
    async with _lock(pid):
        project = load(user.id, pid)
        asset = project.asset(asset_id)
        if asset is None:
            raise HTTPException(404, "File not found")
        if any(c.asset_id == asset_id for t in project.tracks for c in t.clips):
            raise HTTPException(409, "Remove the clips that use this file first.")
        project.assets = [a for a in project.assets if a.id != asset_id]
        if asset.file:
            Path(asset.file).unlink(missing_ok=True)
        project.updated_at = time.time()
        save(project)
    return {"project": _public(project)}


@router.post("/projects/{pid}/render")
async def render_project(pid: str, user: StudioUser = Depends(max_user)) -> dict:
    async with _lock(pid):
        project = load(user.id, pid)
        if project.render.status == "running":
            return {"project": _public(project)}
        if timeline_length(project) <= 0:
            raise HTTPException(400, "The timeline is empty. Add a clip first.")
        state = RenderState(status="running", progress=0.0,
                            updated_at=time.time())
        _renders[pid] = state
        project.render = state

    async def go() -> None:
        await asyncio.to_thread(_run_render, project, state)
        async with _lock(pid):
            try:
                fresh = load(user.id, pid)
            except HTTPException:
                return              # deleted mid-render
            fresh.render = state
            save(fresh)
        _renders.pop(pid, None)

    asyncio.get_running_loop().create_task(go())
    return {"project": _public(project)}
