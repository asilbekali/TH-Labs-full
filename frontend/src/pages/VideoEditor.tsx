// Video editor — Studio Max.
//
// For animation agencies. They have a finished animation with no voice: upload
// it, type each line, turn it into speech, then cut and place those clips
// against the picture — with music under it — and export one video.
//
// The browser owns the timeline and plays a live preview of it; the server
// stores the project and renders the export with ffmpeg (backend/app/editor.py).
// The preview is a set of ordinary <video>/<audio> elements driven by one
// clock, so what you hear while editing is each clip at its own volume and
// trim, the same numbers the render uses.
//
//   /video-editor        projects
//   /video-editor/:id    the editor
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import Page from '../components/Page'
import UpgradeGate from '../components/UpgradeGate'
import LanguageSelect from '../components/LanguageSelect'
import {
  PaymentRequiredError,
  createSpeech,
  editorApi,
  getSpeech,
  getSpeechVoices,
  listJobs,
  mediaUrl,
  type EditorAsset,
  type EditorClip,
  type EditorProject,
  type EditorProjectSummary,
  type EditorTrack,
  type SpeechVoices,
  type TrackKind,
} from '../lib/api'
import { usePlan } from '../lib/plan'
import { useLanguages } from '../lib/queries'
import type { JobSummary } from '../lib/types'

const PEAKS_PER_SECOND = 20
const MIN_CLIP = 0.1
const SNAP_PX = 7
const SAVE_DEBOUNCE_MS = 700
const DRIFT = 0.25

const KIND_STYLE: Record<TrackKind, { block: string; label: string }> = {
  video: { block: 'border-brand/60 bg-brand/20', label: 'Video' },
  voice: { block: 'border-magenta/60 bg-magenta/20', label: 'Voice' },
  music: { block: 'border-gold/60 bg-gold/20', label: 'Music' },
  audio: { block: 'border-info/60 bg-info/20', label: 'Audio' },
}

const uid = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0')
const clipLen = (c: EditorClip) => Math.max(0, c.trim_out - c.trim_in)
const clipEnd = (c: EditorClip) => c.start + clipLen(c)

function fmt(sec: number, precise = false): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return precise
    ? `${m}:${s.toFixed(1).padStart(4, '0')}`
    : `${m}:${Math.floor(s).toString().padStart(2, '0')}`
}

function totalLength(tracks: EditorTrack[]): number {
  return Math.max(0, ...tracks.flatMap((t) => t.clips.map(clipEnd)))
}

export default function VideoEditor() {
  const plan = usePlan()
  const { projectId } = useParams()
  if (!plan.loading && !plan.isMax) {
    return (
      <UpgradeGate
        tool="videoEditor"
        points={[
          'Upload an animation and voice it with typed lines',
          'Turn text into speech in 30+ languages, right on the timeline',
          'Cut, trim and move speech to match the picture',
          'Cut and re-arrange sections of the video itself',
          'Add music with volume and fades',
          'Export one finished MP4',
        ]}
      />
    )
  }
  return projectId ? <Editor projectId={projectId} /> : <ProjectList />
}

// ── Projects ─────────────────────────────────────────────────────────────────

function ProjectList() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<EditorProjectSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const refresh = useCallback(() => {
    editorApi
      .list()
      .then(setProjects)
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not load your projects.'))
  }, [])
  useEffect(refresh, [refresh])

  async function create() {
    setCreating(true)
    try {
      const p = await editorApi.create(`Project ${new Date().toLocaleDateString()}`)
      navigate(`/video-editor/${p.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create a project.')
      setCreating(false)
    }
  }

  async function remove(p: EditorProjectSummary) {
    if (!window.confirm(`Delete “${p.name}” and its files?`)) return
    try {
      await editorApi.remove(p.id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete it.')
    }
  }

  return (
    <Page className="mx-auto w-full max-w-5xl py-2 sm:py-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Video editor</p>
          <h1 className="mt-2 text-[clamp(1.6rem,4vw,2.2rem)] font-medium leading-tight text-primary">
            Give your animation <span className="gradient-text">a voice.</span>
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-secondary">
            Upload the video, type the lines, and place each one where it belongs. Cut speech,
            trim the picture, add music — then export one finished video.
          </p>
        </div>
        <button type="button" onClick={create} disabled={creating} className="btn-primary focusable h-11 px-6 text-sm">
          {creating ? 'Creating…' : '+ New project'}
        </button>
      </div>
      {error && <p className="mt-6 text-sm text-danger">{error}</p>}
      {projects === null && !error && (
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card h-36 animate-pulse" />
          ))}
        </div>
      )}
      {projects?.length === 0 && (
        <div className="card mt-6 p-8 text-center text-sm text-secondary">
          No projects yet. Start one and drop your animation in.
        </div>
      )}
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {projects?.map((p) => (
          <div key={p.id} className="card card-hover flex flex-col overflow-hidden">
            <Link to={`/video-editor/${p.id}`} className="focusable block">
              <div className="aspect-video bg-black">
                {p.video_url && (
                  <video src={`${mediaUrl(p.video_url)}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="p-4">
                <p className="truncate text-sm font-medium text-primary">{p.name}</p>
                <p className="mt-1 font-mono text-[12px] text-muted">
                  {fmt(p.duration)} · {p.clips} clips · {new Date(p.updated_at * 1000).toLocaleDateString()}
                </p>
              </div>
            </Link>
            <div className="mt-auto flex items-center justify-between border-t border-subtle px-4 py-2">
              {p.render.status === 'done' && p.render.url ? (
                <a href={mediaUrl(p.render.url)} download className="text-[12px] font-medium text-primary hover:underline">
                  ↓ Last export
                </a>
              ) : (
                <span className="text-[12px] text-muted">Not exported yet</span>
              )}
              <button type="button" onClick={() => remove(p)} className="text-[12px] text-muted hover:text-danger">
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </Page>
  )
}

// ── Editor ───────────────────────────────────────────────────────────────────

type Sel = { track: string; clip: string } | null

function Editor({ projectId }: { projectId: string }) {
  const [project, setProject] = useState<EditorProject | null>(null)
  const [tracks, setTracks] = useState<EditorTrack[]>([])
  const [name, setName] = useState('')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const [sel, setSel] = useState<Sel>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const past = useRef<EditorTrack[][]>([])
  const future = useRef<EditorTrack[][]>([])
  const dirty = useRef(false)

  useEffect(() => {
    editorApi
      .get(projectId)
      .then((p) => {
        setProject(p)
        setTracks(p.tracks)
        setName(p.name)
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : 'Could not open this project.'))
  }, [projectId])

  // Autosave, debounced: every committed change reaches the server shortly.
  useEffect(() => {
    if (!dirty.current) return
    setSaveState('unsaved')
    const t = window.setTimeout(async () => {
      setSaveState('saving')
      try {
        const p = await editorApi.save(projectId, { tracks, name })
        dirty.current = false
        setProject((cur) => (cur ? { ...cur, assets: p.assets, updated_at: p.updated_at } : p))
        setSaveState('saved')
      } catch (e) {
        setSaveState('error')
        setError(e instanceof Error ? e.message : 'Could not save.')
      }
    }, SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [tracks, name, projectId])

  /** Apply a change and record it for undo. */
  const commit = useCallback((next: EditorTrack[], before?: EditorTrack[]) => {
    setTracks((cur) => {
      past.current.push(before ?? cur)
      if (past.current.length > 100) past.current.shift()
      future.current = []
      return next
    })
    dirty.current = true
  }, [])

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    setTracks((cur) => {
      future.current.push(cur)
      return prev
    })
    dirty.current = true
  }, [])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    setTracks((cur) => {
      past.current.push(cur)
      return next
    })
    dirty.current = true
  }, [])

  const assets = project?.assets
  const assetById = useMemo(() => new Map((assets ?? []).map((a) => [a.id, a])), [assets])
  const length = totalLength(tracks)
  const selected = sel
    ? (tracks.find((t) => t.id === sel.track)?.clips.find((c) => c.id === sel.clip) ?? null)
    : null
  const selectedTrack = sel ? (tracks.find((t) => t.id === sel.track) ?? null) : null

  function updateClip(trackId: string, clipId: string, patch: Partial<EditorClip>, live = false) {
    const next = tracks.map((t) =>
      t.id === trackId ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) } : t,
    )
    if (live) setTracks(next)
    else commit(next)
  }

  function updateTrack(trackId: string, patch: Partial<EditorTrack>) {
    commit(tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)))
  }

  function addTrack(kind: TrackKind) {
    const n = tracks.filter((t) => t.kind === kind).length + 1
    commit([...tracks, { id: uid(), kind, name: `${KIND_STYLE[kind].label} ${n}`, muted: false, volume: 1, clips: [] }])
  }

  function removeTrack(trackId: string) {
    const t = tracks.find((x) => x.id === trackId)
    if (t && t.clips.length && !window.confirm(`Remove “${t.name}” and its ${t.clips.length} clip(s)?`)) return
    commit(tracks.filter((x) => x.id !== trackId))
    if (sel?.track === trackId) setSel(null)
  }

  /** Put an asset on the timeline at the playhead, on the track it belongs to. */
  function place(asset: EditorAsset, at = time) {
    const want: TrackKind = asset.kind === 'video' ? 'video' : asset.source === 'tts' ? 'voice' : 'music'
    let track =
      tracks.find((t) => t.kind === want) ??
      (asset.kind === 'video' ? undefined : tracks.find((t) => t.kind !== 'video'))
    let next = tracks
    if (!track) {
      track = { id: uid(), kind: want, name: KIND_STYLE[want].label, muted: false, volume: 1, clips: [] }
      next = [...tracks, track]
    }
    const clip: EditorClip = {
      id: uid(),
      asset_id: asset.id,
      start: Math.max(0, Number(at.toFixed(2))),
      trim_in: 0,
      trim_out: asset.duration,
      volume: want === 'music' ? 0.35 : 1,
      fade_in: 0,
      fade_out: want === 'music' ? 1.5 : 0,
      label: asset.text ? asset.text.slice(0, 60) : null,
    }
    const tid = track.id
    commit(next.map((t) => (t.id === tid ? { ...t, clips: [...t.clips, clip] } : t)))
    setSel({ track: tid, clip: clip.id })
  }

  function onAssetAdded(p: EditorProject, asset: EditorAsset, autoPlace: boolean) {
    setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))
    if (autoPlace) place(asset)
  }

  function splitAtPlayhead() {
    if (!sel || !selected) return
    if (time <= selected.start + MIN_CLIP || time >= clipEnd(selected) - MIN_CLIP) return
    const cut = selected.trim_in + (time - selected.start)
    const left: EditorClip = { ...selected, trim_out: cut, fade_out: 0 }
    const right: EditorClip = { ...selected, id: uid(), start: time, trim_in: cut, fade_in: 0 }
    commit(
      tracks.map((t) =>
        t.id === sel.track
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === selected.id ? [left, right] : [c])) }
          : t,
      ),
    )
    setSel({ track: sel.track, clip: right.id })
  }

  function deleteSelected() {
    if (!sel) return
    commit(tracks.map((t) => (t.id === sel.track ? { ...t, clips: t.clips.filter((c) => c.id !== sel.clip) } : t)))
    setSel(null)
  }

  function duplicateSelected() {
    if (!sel || !selected) return
    const copy = { ...selected, id: uid(), start: clipEnd(selected) }
    commit(tracks.map((t) => (t.id === sel.track ? { ...t, clips: [...t.clips, copy] } : t)))
    setSel({ track: sel.track, clip: copy.id })
  }

  // Keyboard: space play/pause, S split, Delete remove, ⌘Z / ⇧⌘Z undo/redo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable]')) return
      const mod = e.metaKey || e.ctrlKey
      if (e.code === 'Space') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        duplicateSelected()
      } else if (e.key === 's' || e.key === 'S') {
        if (!mod) splitAtPlayhead()
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loadError) {
    return (
      <Page className="mx-auto max-w-xl py-10 text-center">
        <p className="text-sm text-danger">{loadError}</p>
        <Link to="/video-editor" className="btn-ghost focusable mt-4 inline-flex h-10 items-center px-5 text-sm">
          Back to projects
        </Link>
      </Page>
    )
  }
  if (!project) return <Page className="card mx-auto mt-6 h-96 max-w-6xl animate-pulse">{null}</Page>

  return (
    <Page className="flex w-full min-w-0 flex-col gap-3 pb-6">
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/video-editor" className="btn-ghost focusable inline-flex h-9 items-center px-3 text-[13px]">
          ← Projects
        </Link>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            dirty.current = true
          }}
          aria-label="Project name"
          className="field h-9 min-w-0 max-w-xs flex-1 text-sm font-medium"
        />
        <span className={`text-[12px] ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}>
          {saveState === 'saved' ? 'All changes saved' : saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Not saved' : 'Unsaved changes'}
        </span>
        <div className="ml-auto">
          <ExportButton project={project} length={length} flush={() => editorApi.save(projectId, { tracks, name })} onUpdate={setProject} />
        </div>
      </div>
      {error && (
        <div role="alert" className="flex items-start justify-between gap-3 rounded-[var(--radius-control)] border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-secondary">
          {error}
          <button type="button" onClick={() => setError(null)} className="text-muted hover:text-primary" aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}

      <div className="grid min-w-0 gap-3 xl:grid-cols-[300px_minmax(0,1fr)_260px]">
        <MediaBin
          project={project}
          onAdded={onAssetAdded}
          onPlace={(a) => place(a)}
          onError={setError}
          onRemoved={(p) => setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))}
          used={new Set(tracks.flatMap((t) => t.clips.map((c) => c.asset_id)))}
        />
        <Preview
          tracks={tracks}
          assets={assetById}
          time={time}
          setTime={setTime}
          playing={playing}
          setPlaying={setPlaying}
          length={length}
        />
        <Inspector
          clip={selected}
          track={selectedTrack}
          asset={selected ? assetById.get(selected.asset_id) : undefined}
          onChange={(patch) => sel && updateClip(sel.track, sel.clip, patch)}
          onSplit={splitAtPlayhead}
          onDelete={deleteSelected}
          onDuplicate={duplicateSelected}
          time={time}
        />
      </div>

      <Timeline
        tracks={tracks}
        assets={assetById}
        time={time}
        length={length}
        zoom={zoom}
        setZoom={setZoom}
        sel={sel}
        setSel={setSel}
        onSeek={(t) => {
          setPlaying(false)
          setTime(Math.max(0, t))
        }}
        onLive={setTracks}
        onCommit={commit}
        onTrack={updateTrack}
        onAddTrack={addTrack}
        onRemoveTrack={removeTrack}
        onSplit={splitAtPlayhead}
        onDelete={deleteSelected}
        onUndo={undo}
        onRedo={redo}
        playing={playing}
        setPlaying={setPlaying}
      />
    </Page>
  )
}

// ── Export ───────────────────────────────────────────────────────────────────

function ExportButton({
  project,
  length,
  flush,
  onUpdate,
}: {
  project: EditorProject
  length: number
  flush: () => Promise<EditorProject>
  onUpdate: (p: EditorProject) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const r = project.render
  const running = busy || r.status === 'running'

  useEffect(() => {
    if (r.status !== 'running') return
    const t = window.setTimeout(async () => {
      try {
        onUpdate(await editorApi.get(project.id))
      } catch {
        /* keep the last state; the next tick retries */
      }
    }, 1200)
    return () => window.clearTimeout(t)
  }, [r, project.id, onUpdate])

  async function go() {
    setErr(null)
    setBusy(true)
    try {
      await flush() // render what is on screen, not the last autosave
      onUpdate(await editorApi.render(project.id))
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Export failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {r.status === 'done' && r.url && !running && (
        <a href={mediaUrl(r.url)} download className="btn-ghost focusable inline-flex h-9 items-center px-4 text-[13px]">
          ↓ Download export
        </a>
      )}
      {(err || (r.status === 'failed' && r.error)) && !running && (
        <span className="max-w-xs text-[12px] text-danger">{err || r.error}</span>
      )}
      <button
        type="button"
        onClick={go}
        disabled={running || length <= 0}
        className="btn-primary focusable relative inline-flex h-9 items-center overflow-hidden px-5 text-[13px] disabled:opacity-60"
      >
        {running && (
          <span aria-hidden className="absolute inset-y-0 left-0 bg-white/20 transition-[width]" style={{ width: `${Math.round(r.progress * 100)}%` }} />
        )}
        <span className="relative">{running ? `Exporting ${Math.round(r.progress * 100)}%` : 'Export video'}</span>
      </button>
    </div>
  )
}

// ── Media bin: files, speech, dubs ──────────────────────────────────────────

function MediaBin({
  project,
  onAdded,
  onPlace,
  onError,
  onRemoved,
  used,
}: {
  project: EditorProject
  onAdded: (p: EditorProject, a: EditorAsset, autoPlace: boolean) => void
  onPlace: (a: EditorAsset) => void
  onError: (msg: string) => void
  onRemoved: (p: EditorProject) => void
  used: Set<string>
}) {
  const [tab, setTab] = useState<'files' | 'speech' | 'dubs'>('files')
  const [uploading, setUploading] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)

  async function upload(files: FileList | null) {
    if (!files?.length) return
    for (const f of Array.from(files)) {
      setUploading(f.name)
      try {
        const r = await editorApi.upload(project.id, f)
        onAdded(r.project, r.asset, false)
      } catch (e) {
        onError(e instanceof Error ? e.message : `Could not upload ${f.name}.`)
      }
    }
    setUploading(null)
  }

  async function remove(a: EditorAsset) {
    try {
      onRemoved(await editorApi.removeAsset(project.id, a.id))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove it.')
    }
  }

  return (
    <div className="card flex min-h-0 flex-col overflow-hidden xl:max-h-[440px]">
      <div role="tablist" className="seg-track m-2 flex">
        {(
          [
            ['files', 'Files'],
            ['speech', 'Text → speech'],
            ['dubs', 'From Studio'],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} data-active={tab === k} onClick={() => setTab(k)} className="seg focusable flex-1 text-[12px]">
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {tab === 'files' && (
          <>
            <button
              type="button"
              onClick={() => input.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                void upload(e.dataTransfer.files)
              }}
              className="focusable flex w-full flex-col items-center gap-1 rounded-[var(--radius-control)] border border-dashed border-strong px-3 py-4 text-center text-[13px] text-secondary hover:border-brand"
            >
              {uploading ? `Uploading ${uploading}…` : 'Drop a video, voice or music file — or click'}
              <span className="text-[11px] text-muted">MP4, MOV, WebM, MP3, WAV, M4A…</span>
            </button>
            <input ref={input} type="file" multiple accept="video/*,audio/*" hidden onChange={(e) => void upload(e.target.files)} />
            <ul className="mt-3 flex flex-col gap-1.5">
              {project.assets.map((a) => (
                <li key={a.id} className="inner flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2">
                  <span className={`h-7 w-1.5 shrink-0 rounded-full ${a.kind === 'video' ? 'bg-brand' : a.source === 'tts' ? 'bg-magenta' : 'bg-gold'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-primary" title={a.text ?? a.name}>
                      {a.text ?? a.name}
                    </p>
                    <p className="font-mono text-[10px] text-muted">
                      {a.kind === 'video' ? 'Video' : a.source === 'tts' ? 'Speech' : 'Audio'} · {fmt(a.duration, true)}
                    </p>
                  </div>
                  <button type="button" onClick={() => onPlace(a)} className="btn-ghost focusable h-7 shrink-0 px-2 text-[11px]" title="Add at the playhead">
                    + Add
                  </button>
                  {!used.has(a.id) && (
                    <button type="button" onClick={() => remove(a)} className="shrink-0 text-[11px] text-muted hover:text-danger" aria-label={`Remove ${a.name}`}>
                      ✕
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {tab === 'speech' && <SpeechMaker project={project} onAdded={onAdded} onError={onError} />}
        {tab === 'dubs' && <DubImporter project={project} onAdded={onAdded} onError={onError} />}
      </div>
    </div>
  )
}

function SpeechMaker({
  project,
  onAdded,
  onError,
}: {
  project: EditorProject
  onAdded: (p: EditorProject, a: EditorAsset, autoPlace: boolean) => void
  onError: (msg: string) => void
}) {
  const { data: languages = [] } = useLanguages()
  const [language, setLanguage] = useState('uz')
  const [voices, setVoices] = useState<SpeechVoices | null>(null)
  const [voice, setVoice] = useState<string | null>(null)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    getSpeechVoices(language)
      .then((v) => live && setVoices(v))
      .catch(() => live && setVoices(null))
    return () => {
      live = false
    }
  }, [language])

  const navoiy = !!voices?.navoiy.available && voices.navoiy.languages.includes(language)
  const engine = navoiy
    ? voices!.navoiy
    : !voices?.omnivoice.available && voices?.edge?.available
      ? voices.edge
      : voices?.omnivoice
  const options = engine?.voices ?? []
  const chosen = voice && options.some((o) => o.id === voice) ? voice : (engine?.default ?? undefined)

  async function make() {
    const line = text.trim()
    if (!line || busy) return
    setBusy(true)
    try {
      let task = await createSpeech({ text: line, language, voice: chosen })
      while (task.status === 'queued' || task.status === 'running') {
        await new Promise((r) => setTimeout(r, 1200))
        task = await getSpeech(task.id)
      }
      if (task.status !== 'done') throw new Error(task.error ?? 'Speech generation failed.')
      const r = await editorApi.importAsset(project.id, { tts_task_id: task.id, name: line.slice(0, 60) })
      onAdded(r.project, r.asset, true)
      setText('')
    } catch (e) {
      onError(
        e instanceof PaymentRequiredError
          ? `${e.message} Top up on the Plans page.`
          : e instanceof Error
            ? e.message
            : 'Speech generation failed.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-1">
      <LanguageSelect languages={languages} value={language} onChange={(c) => { setLanguage(c); setVoice(null) }} label="Language" />
      {options.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {options.slice(0, 12).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setVoice(o.id)}
              className={`focusable rounded-pill border px-2.5 py-1 text-[11px] ${chosen === o.id ? 'border-brand bg-brand/15 text-primary' : 'border-subtle text-secondary'}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void make()
        }}
        rows={4}
        maxLength={voices?.max_chars ?? 1000}
        placeholder="Type one line of dialogue…"
        className="field resize-none text-[13px] leading-relaxed"
      />
      <button type="button" onClick={make} disabled={!text.trim() || busy} className="btn-primary focusable h-10 text-[13px] disabled:opacity-50">
        {busy ? 'Making speech…' : 'Make speech & add at playhead'}
      </button>
      <p className="text-[11px] leading-relaxed text-muted">
        Each line becomes its own clip on the Voice track, so you can move and cut it. Priced like
        text to speech (≈{Math.max(1, Math.ceil((text.trim().length / 12) * (20 / 60)))} tokens). ⌘/Ctrl + Enter to make it.
      </p>
    </div>
  )
}

function DubImporter({
  project,
  onAdded,
  onError,
}: {
  project: EditorProject
  onAdded: (p: EditorProject, a: EditorAsset, autoPlace: boolean) => void
  onError: (msg: string) => void
}) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    listJobs()
      .then((j) => setJobs(j.filter((x) => x.status === 'completed' && x.output_url)))
      .catch(() => setJobs([]))
  }, [])

  async function bring(j: JobSummary) {
    setBusy(j.id)
    try {
      const r = await editorApi.importAsset(project.id, { job_id: j.id })
      onAdded(r.project, r.asset, false)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not import that dub.')
    } finally {
      setBusy(null)
    }
  }

  if (jobs === null) return <p className="pt-2 text-[12px] text-muted">Loading your dubs…</p>
  if (!jobs.length) return <p className="pt-2 text-[12px] text-muted">No finished dubs to bring in yet.</p>
  return (
    <ul className="flex flex-col gap-1.5 pt-1">
      {jobs.map((j) => (
        <li key={j.id} className="inner flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-primary">{j.filename || 'Untitled video'}</p>
            <p className="font-mono text-[10px] text-muted">
              → {j.target_lang.toUpperCase()} · {j.duration ? fmt(j.duration) : '—'}
            </p>
          </div>
          <button type="button" disabled={busy === j.id} onClick={() => bring(j)} className="btn-ghost focusable h-7 shrink-0 px-2 text-[11px]">
            {busy === j.id ? '…' : 'Import'}
          </button>
        </li>
      ))}
    </ul>
  )
}

// ── Preview ──────────────────────────────────────────────────────────────────
// One clock drives every clip. Each frame, every clip that covers the playhead
// is made to play at the right point of its asset (re-seeking only when it has
// drifted), and every other clip is paused. The topmost video clip is shown.

function clipGain(c: EditorClip, t: EditorTrack, at: number): number {
  const into = at - c.start
  const left = clipEnd(c) - at
  let g = c.volume * t.volume
  if (c.fade_in > 0 && into < c.fade_in) g *= Math.max(0, into / c.fade_in)
  if (c.fade_out > 0 && left < c.fade_out) g *= Math.max(0, left / c.fade_out)
  return Math.min(1, Math.max(0, g))
}

function Preview({
  tracks,
  assets,
  time,
  setTime,
  playing,
  setPlaying,
  length,
}: {
  tracks: EditorTrack[]
  assets: Map<string, EditorAsset>
  time: number
  setTime: (t: number) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  length: number
}) {
  const videos = useRef<Map<string, HTMLVideoElement>>(new Map())
  const audios = useRef<Map<string, HTMLAudioElement>>(new Map())
  const clock = useRef({ wall: 0, at: 0 })
  const timeRef = useRef(time)
  timeRef.current = time

  const videoClips = useMemo(
    () => tracks.flatMap((t, ti) => (t.kind === 'video' ? t.clips.map((c) => ({ c, t, ti })) : [])),
    [tracks],
  )

  // Audio elements for every clip that is not a video clip.
  useEffect(() => {
    const want = new Map<string, string>()
    for (const t of tracks) {
      if (t.kind === 'video') continue
      for (const c of t.clips) {
        const a = assets.get(c.asset_id)
        if (a) want.set(c.id, mediaUrl(a.url) ?? a.url)
      }
    }
    for (const [id, el] of audios.current) {
      if (!want.has(id) || el.dataset.src !== want.get(id)) {
        el.pause()
        el.src = ''
        audios.current.delete(id)
      }
    }
    for (const [id, src] of want) {
      if (!audios.current.has(id)) {
        const el = new Audio(src)
        el.preload = 'auto'
        el.dataset.src = src
        audios.current.set(id, el)
      }
    }
  }, [tracks, assets])

  useEffect(
    () => () => {
      for (const el of audios.current.values()) {
        el.pause()
        el.src = ''
      }
    },
    [],
  )

  // Put every element where it should be at time `at`.
  const sync = useCallback(
    (at: number, play: boolean) => {
      let top: string | null = null
      for (const t of tracks) {
        for (const c of t.clips) {
          const active = !t.muted && at >= c.start && at < clipEnd(c)
          const el = t.kind === 'video' ? videos.current.get(c.id) : audios.current.get(c.id)
          if (t.kind === 'video' && active) top = c.id
          if (!el) continue
          if (!active) {
            if (!el.paused) el.pause()
            continue
          }
          const want = c.trim_in + (at - c.start)
          el.volume = clipGain(c, t, at)
          el.muted = t.kind === 'video' && !assets.get(c.asset_id)?.has_audio
          if (Math.abs(el.currentTime - want) > (play ? DRIFT : 0.04)) el.currentTime = want
          if (play && el.paused) void el.play().catch(() => {})
          if (!play && !el.paused) el.pause()
        }
      }
      for (const [id, el] of videos.current) el.style.opacity = id === top ? '1' : '0'
    },
    [tracks, assets],
  )

  // Playback loop.
  useEffect(() => {
    if (!playing) {
      sync(timeRef.current, false)
      return
    }
    if (timeRef.current >= length) setTime(0)
    clock.current = { wall: performance.now(), at: timeRef.current >= length ? 0 : timeRef.current }
    let raf = 0
    const step = () => {
      const at = clock.current.at + (performance.now() - clock.current.wall) / 1000
      if (at >= length) {
        setTime(length)
        setPlaying(false)
        return
      }
      setTime(at)
      sync(at, true)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, length, sync, setTime, setPlaying])

  // Scrubbing while paused shows the frame under the playhead.
  useEffect(() => {
    if (!playing) sync(time, false)
  }, [time, playing, sync])

  // Clips leave the timeline: pause anything that no longer exists.
  useEffect(() => {
    if (!playing) {
      for (const el of audios.current.values()) el.pause()
    }
  }, [playing])

  const anyVideo = videoClips.some(({ c, t }) => !t.muted && time >= c.start && time < clipEnd(c))

  return (
    <div className="card flex min-w-0 flex-col overflow-hidden">
      <div className="relative aspect-video w-full bg-black">
        {videoClips.map(({ c, ti }) => {
          const a = assets.get(c.asset_id)
          if (!a) return null
          return (
            <video
              key={c.id}
              ref={(el) => {
                if (el) videos.current.set(c.id, el)
                else videos.current.delete(c.id)
              }}
              src={mediaUrl(a.url)}
              preload="auto"
              playsInline
              className="absolute inset-0 h-full w-full object-contain transition-none"
              style={{ zIndex: ti + 1, opacity: 0 }}
            />
          )
        })}
        {!anyVideo && (
          <div className="absolute inset-0 grid place-items-center text-[13px] text-white/50">
            {videoClips.length ? 'No picture at this point' : 'Add a video to see it here'}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          disabled={length <= 0}
          className="btn-primary focusable grid h-9 w-9 shrink-0 place-items-center rounded-full disabled:opacity-50"
          aria-label={playing ? 'Pause' : 'Play'}
        >
          {playing ? '❚❚' : '▶'}
        </button>
        <span className="font-mono text-[12px] text-primary">{fmt(time, true)}</span>
        <span className="font-mono text-[12px] text-muted">/ {fmt(length, true)}</span>
        <span className="ml-auto hidden text-[11px] text-muted sm:inline">Space play · S split · ⌫ delete · ⌘Z undo</span>
      </div>
    </div>
  )
}

// ── Inspector ────────────────────────────────────────────────────────────────

function Inspector({
  clip,
  track,
  asset,
  onChange,
  onSplit,
  onDelete,
  onDuplicate,
  time,
}: {
  clip: EditorClip | null
  track: EditorTrack | null
  asset?: EditorAsset
  onChange: (patch: Partial<EditorClip>) => void
  onSplit: () => void
  onDelete: () => void
  onDuplicate: () => void
  time: number
}) {
  if (!clip || !track) {
    return (
      <div className="card p-4 text-[13px] leading-relaxed text-muted">
        <p className="font-medium text-primary">Nothing selected</p>
        <p className="mt-1">Click a clip on the timeline to change its timing, volume and fades.</p>
        <p className="mt-3">Drag a clip to move it, its edges to trim it. Drag it onto another track of the same kind to move it there.</p>
      </div>
    )
  }
  const canSplit = time > clip.start + MIN_CLIP && time < clipEnd(clip) - MIN_CLIP
  const num = (label: string, value: number, set: (v: number) => void, step = 0.05, max?: number) => (
    <label className="flex items-center justify-between gap-2 text-[12px] text-muted">
      {label}
      <input
        type="number"
        step={step}
        min={0}
        max={max}
        value={Number(value.toFixed(2))}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) set(Math.max(0, max !== undefined ? Math.min(max, v) : v))
        }}
        className="field h-8 w-24 px-2 font-mono text-[12px]"
      />
    </label>
  )
  return (
    <div className="card flex flex-col gap-2.5 p-4">
      <p className="truncate text-sm font-medium text-primary" title={asset?.name}>
        {asset?.text ?? asset?.name ?? 'Clip'}
      </p>
      <p className="font-mono text-[11px] text-muted">
        {track.name} · {fmt(clipLen(clip), true)} long
      </p>
      {num('Starts at (s)', clip.start, (v) => onChange({ start: v }))}
      {num('Trim in (s)', clip.trim_in, (v) => onChange({ trim_in: Math.min(v, clip.trim_out - MIN_CLIP) }), 0.05, asset?.duration)}
      {num('Trim out (s)', clip.trim_out, (v) => onChange({ trim_out: Math.max(v, clip.trim_in + MIN_CLIP) }), 0.05, asset?.duration)}
      {(track.kind !== 'video' || asset?.has_audio) && (
        <>
          <label className="flex flex-col gap-1 text-[12px] text-muted">
            <span className="flex justify-between">
              Volume <span className="font-mono text-primary">{Math.round(clip.volume * 100)}%</span>
            </span>
            <input type="range" min={0} max={2} step={0.05} value={clip.volume} onChange={(e) => onChange({ volume: Number(e.target.value) })} className="accent-[var(--color-brand)]" />
          </label>
          {num('Fade in (s)', clip.fade_in, (v) => onChange({ fade_in: v }), 0.1, 30)}
          {num('Fade out (s)', clip.fade_out, (v) => onChange({ fade_out: v }), 0.1, 30)}
        </>
      )}
      <div className="mt-1 flex flex-wrap gap-2">
        <button type="button" onClick={onSplit} disabled={!canSplit} className="btn-ghost focusable h-8 px-3 text-[12px] disabled:opacity-40" title="Split at the playhead (S)">
          Split
        </button>
        <button type="button" onClick={onDuplicate} className="btn-ghost focusable h-8 px-3 text-[12px]" title="Duplicate (⌘D)">
          Duplicate
        </button>
        <button type="button" onClick={onDelete} className="btn-ghost focusable h-8 px-3 text-[12px] text-danger">
          Delete
        </button>
      </div>
    </div>
  )
}

// ── Timeline ─────────────────────────────────────────────────────────────────

type DragState = {
  mode: 'move' | 'left' | 'right'
  track: string
  clip: string
  x0: number
  orig: EditorClip
  before: EditorTrack[]
  moved: boolean
}

function Timeline({
  tracks,
  assets,
  time,
  length,
  zoom,
  setZoom,
  sel,
  setSel,
  onSeek,
  onLive,
  onCommit,
  onTrack,
  onAddTrack,
  onRemoveTrack,
  onSplit,
  onDelete,
  onUndo,
  onRedo,
  playing,
  setPlaying,
}: {
  tracks: EditorTrack[]
  assets: Map<string, EditorAsset>
  time: number
  length: number
  zoom: number
  setZoom: (z: number) => void
  sel: Sel
  setSel: (s: Sel) => void
  onSeek: (t: number) => void
  onLive: (t: EditorTrack[]) => void
  onCommit: (next: EditorTrack[], before?: EditorTrack[]) => void
  onTrack: (id: string, patch: Partial<EditorTrack>) => void
  onAddTrack: (k: TrackKind) => void
  onRemoveTrack: (id: string) => void
  onSplit: () => void
  onDelete: () => void
  onUndo: () => void
  onRedo: () => void
  playing: boolean
  setPlaying: (p: boolean) => void
}) {
  const pps = 36 * zoom
  const span = Math.max(length + 15, 30)
  const width = span * pps
  const drag = useRef<DragState | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scroller.current
    if (!el || !playing) return
    const x = time * pps
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - 40) el.scrollLeft = x - 80
  }, [time, pps, playing])

  // Snap to every other clip's edges, the playhead and 0.
  function snap(v: number, self: string): number {
    let best = v
    let dist = SNAP_PX / pps
    for (const t of tracks)
      for (const c of t.clips) {
        if (c.id === self) continue
        for (const e of [c.start, clipEnd(c)]) {
          if (Math.abs(e - v) < dist) {
            dist = Math.abs(e - v)
            best = e
          }
        }
      }
    for (const e of [0, time]) if (Math.abs(e - v) < dist) best = e
    return best
  }

  function begin(e: ReactPointerEvent, trackId: string, c: EditorClip, mode: DragState['mode']) {
    e.stopPropagation()
    if (e.button !== 0) return
    setSel({ track: trackId, clip: c.id })
    drag.current = { mode, track: trackId, clip: c.id, x0: e.clientX, orig: { ...c }, before: tracks, moved: false }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  function move(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const dt = (e.clientX - d.x0) / pps
    if (!d.moved && Math.abs(e.clientX - d.x0) < 3) return
    d.moved = true
    const o = d.orig
    const a = assets.get(o.asset_id)
    const maxOut = a?.duration ?? o.trim_out
    let patch: Partial<EditorClip>
    if (d.mode === 'move') {
      let start = Math.max(0, o.start + dt)
      // Snap whichever edge is closer to something.
      const s1 = snap(start, o.id)
      const s2 = snap(start + clipLen(o), o.id) - clipLen(o)
      start = Math.abs(s1 - start) <= Math.abs(s2 - start) ? s1 : s2
      patch = { start: Math.max(0, start) }
    } else if (d.mode === 'left') {
      let shift = dt
      shift = Math.max(shift, -o.trim_in, -o.start)
      shift = Math.min(shift, clipLen(o) - MIN_CLIP)
      const snapped = snap(o.start + shift, o.id) - o.start
      if (snapped >= -o.trim_in && snapped >= -o.start && snapped <= clipLen(o) - MIN_CLIP) shift = snapped
      patch = { start: o.start + shift, trim_in: o.trim_in + shift }
    } else {
      let out = Math.min(maxOut, Math.max(o.trim_in + MIN_CLIP, o.trim_out + dt))
      const end = snap(o.start + (out - o.trim_in), o.id)
      const snappedOut = o.trim_in + (end - o.start)
      if (snappedOut <= maxOut && snappedOut >= o.trim_in + MIN_CLIP) out = snappedOut
      patch = { trim_out: out }
    }
    const round = (v?: number) => (v === undefined ? undefined : Number(v.toFixed(3)))
    const p = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, round(v as number)]))
    onLive(
      d.before.map((t) =>
        t.id === d.track ? { ...t, clips: t.clips.map((c) => (c.id === d.clip ? { ...c, ...p } : c)) } : t,
      ),
    )
  }

  function end(e: ReactPointerEvent) {
    const d = drag.current
    drag.current = null
    if (!d || !d.moved) return
    // Dropped over another lane of the same kind: move the clip there.
    let next = tracks
    if (d.mode === 'move') {
      const lane = document
        .elementsFromPoint(e.clientX, e.clientY)
        .find((el) => (el as HTMLElement).dataset?.lane) as HTMLElement | undefined
      const target = lane?.dataset.lane
      const from = tracks.find((t) => t.id === d.track)
      const to = tracks.find((t) => t.id === target)
      const fits = (k1: TrackKind, k2: TrackKind) => (k1 === 'video') === (k2 === 'video')
      if (from && to && to.id !== from.id && fits(from.kind, to.kind)) {
        const clip = from.clips.find((c) => c.id === d.clip)
        if (clip) {
          next = tracks.map((t) =>
            t.id === from.id
              ? { ...t, clips: t.clips.filter((c) => c.id !== d.clip) }
              : t.id === to.id
                ? { ...t, clips: [...t.clips, clip] }
                : t,
          )
          setSel({ track: to.id, clip: d.clip })
        }
      }
    }
    onCommit(next, d.before)
  }

  function seekFrom(e: ReactPointerEvent) {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    onSeek((e.clientX - rect.left) / pps)
  }

  const tick = zoom >= 4 ? 1 : zoom >= 1.5 ? 2 : zoom >= 0.6 ? 5 : 15
  const laneH = (k: TrackKind) => (k === 'video' ? 'h-16' : 'h-14')

  return (
    <div className="card overflow-hidden">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-subtle px-3 py-2">
        <ToolBtn onClick={() => setPlaying(!playing)} label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </ToolBtn>
        <ToolBtn onClick={onUndo} label="Undo (⌘Z)">↶</ToolBtn>
        <ToolBtn onClick={onRedo} label="Redo (⇧⌘Z)">↷</ToolBtn>
        <span className="mx-1 h-5 w-px bg-[var(--card-edge)]" />
        <ToolBtn onClick={onSplit} label="Split at playhead (S)" disabled={!sel}>✂ Split</ToolBtn>
        <ToolBtn onClick={onDelete} label="Delete clip (⌫)" disabled={!sel}>🗑 Delete</ToolBtn>
        <span className="mx-1 h-5 w-px bg-[var(--card-edge)]" />
        <span className="text-[11px] text-muted">Add track</span>
        {(['video', 'voice', 'music'] as const).map((k) => (
          <ToolBtn key={k} onClick={() => onAddTrack(k)} label={`Add a ${k} track`}>
            + {KIND_STYLE[k].label}
          </ToolBtn>
        ))}
        <label className="ml-auto flex items-center gap-2 text-[11px] text-muted">
          Zoom
          <input type="range" min={0.3} max={10} step={0.1} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} className="w-28 accent-[var(--color-brand)]" />
        </label>
      </div>

      <div className="flex">
        {/* track headers */}
        <div className="w-[150px] shrink-0 border-r border-subtle">
          <div className="h-6 border-b border-subtle" />
          {tracks.map((t) => (
            <div key={t.id} className={`flex flex-col justify-center gap-1 border-b border-subtle px-2 ${laneH(t.kind)}`}>
              <div className="flex items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${KIND_STYLE[t.kind].block}`} />
                <span className="min-w-0 flex-1 truncate text-[12px] text-primary">{t.name}</span>
                <button type="button" onClick={() => onRemoveTrack(t.id)} className="text-[10px] text-muted hover:text-danger" aria-label={`Remove ${t.name}`}>
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onTrack(t.id, { muted: !t.muted })}
                  className={`rounded px-1.5 py-0.5 text-[10px] ${t.muted ? 'bg-danger/20 text-danger' : 'bg-[var(--well)] text-muted'}`}
                  title={t.muted ? 'Unmute track' : 'Mute track'}
                >
                  {t.muted ? 'Muted' : t.kind === 'video' ? 'Show' : 'On'}
                </button>
                {t.kind !== 'video' && (
                  <input
                    type="range"
                    min={0}
                    max={2}
                    step={0.05}
                    value={t.volume}
                    onChange={(e) => onTrack(t.id, { volume: Number(e.target.value) })}
                    className="w-16 accent-[var(--color-brand)]"
                    title={`Track volume ${Math.round(t.volume * 100)}%`}
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        {/* lanes */}
        <div ref={scroller} className="min-w-0 flex-1 overflow-x-auto">
          <div className="relative select-none" style={{ width }}>
            <div className="relative h-6 cursor-pointer border-b border-subtle" onPointerDown={seekFrom}>
              {Array.from({ length: Math.floor(span / tick) + 1 }, (_, i) => i * tick).map((t) => (
                <span key={t} className="absolute top-0 h-full border-l border-subtle pl-1 font-mono text-[10px] leading-6 text-muted" style={{ left: t * pps }}>
                  {fmt(t)}
                </span>
              ))}
            </div>
            {tracks.map((t) => (
              <div
                key={t.id}
                data-lane={t.id}
                onPointerDown={(e) => {
                  setSel(null)
                  seekFrom(e)
                }}
                className={`relative border-b border-subtle ${laneH(t.kind)} ${t.muted ? 'opacity-50' : ''}`}
              >
                {t.clips.map((c) => {
                  const a = assets.get(c.asset_id)
                  const isSel = sel?.clip === c.id
                  return (
                    <div
                      key={c.id}
                      onPointerDown={(e) => begin(e, t.id, c, 'move')}
                      onPointerMove={move}
                      onPointerUp={end}
                      className={`group absolute inset-y-1 cursor-grab overflow-hidden rounded-md border active:cursor-grabbing ${KIND_STYLE[t.kind].block} ${isSel ? 'ring-2 ring-primary' : ''}`}
                      style={{ left: c.start * pps, width: Math.max(clipLen(c) * pps, 4) }}
                      title={a?.text ?? a?.name}
                    >
                      {a && a.peaks.length > 0 && <Wave peaks={a.peaks} from={c.trim_in} to={c.trim_out} />}
                      <span className="relative block truncate px-2 pt-0.5 text-[10px] font-medium text-primary">
                        {c.label || a?.text || a?.name || 'Clip'}
                      </span>
                      {(c.fade_in > 0 || c.fade_out > 0) && (
                        <span className="relative block px-2 font-mono text-[9px] text-muted">
                          {c.fade_in > 0 ? '◢' : ''} {c.fade_out > 0 ? '◣' : ''}
                        </span>
                      )}
                      <span
                        onPointerDown={(e) => begin(e, t.id, c, 'left')}
                        onPointerMove={move}
                        onPointerUp={end}
                        className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/40"
                      />
                      <span
                        onPointerDown={(e) => begin(e, t.id, c, 'right')}
                        onPointerMove={move}
                        onPointerUp={end}
                        className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-white/0 group-hover:bg-white/40"
                      />
                    </div>
                  )
                })}
              </div>
            ))}
            {!tracks.length && (
              <p className="px-4 py-6 text-[13px] text-muted">No tracks. Add one from the toolbar.</p>
            )}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-danger" style={{ left: time * pps }} />
          </div>
        </div>
      </div>
    </div>
  )
}

function ToolBtn({
  children,
  onClick,
  label,
  disabled,
}: {
  children: ReactNode
  onClick: () => void
  label: string
  disabled?: boolean
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="btn-ghost focusable h-8 px-2.5 text-[12px] disabled:opacity-40">
      {children}
    </button>
  )
}

/** The part of an asset's loudness envelope a clip plays, as bars. */
function Wave({ peaks, from, to }: { peaks: number[]; from: number; to: number }) {
  const a = Math.floor(from * PEAKS_PER_SECOND)
  const b = Math.max(a + 1, Math.ceil(to * PEAKS_PER_SECOND))
  const slice = peaks.slice(a, b)
  const n = Math.min(slice.length, 160)
  const step = slice.length / n
  const bars = Array.from({ length: n }, (_, i) => {
    const part = slice.slice(Math.floor(i * step), Math.floor((i + 1) * step) || Math.floor(i * step) + 1)
    return part.length ? Math.max(...part) : 0
  })
  return (
    <svg aria-hidden viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-50">
      {bars.map((v, i) => (
        <rect key={i} x={i + 0.15} width={0.7} y={50 - v * 45} height={Math.max(2, v * 90)} fill="currentColor" className="text-primary" />
      ))}
    </svg>
  )
}
