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
// Most people only want three things: add a video, type the words, export. So
// that is the screen they get: the picture beside the words. The full timeline
// and clip settings are behind "Advanced editing", and the choice is remembered.
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
  getSpeech,
  getSpeechVoices,
  type SpeechVoices,
} from '../lib/api'
import { usePlan } from '../lib/plan'
import { useLanguages } from '../lib/queries'
import {
  accountMediaUrl as mediaUrl,
  editorApi,
  type EditorAsset,
  type EditorClip,
  type EditorProject,
  type EditorProjectSummary,
  type EditorTrack,
  type TrackKind,
} from '../lib/tools-api'
import { useWorks, workTitle, type Work } from '../lib/works'
import { useConfirm, type ConfirmOptions } from '../components/ConfirmDialog'
import { EDITOR_SHAPE } from '../lib/shape'
import HowItWorks from '../components/HowItWorks'
import EditorIcon, { type IconName } from '../components/EditorIcon'
import { AnimatePresence, motion } from 'framer-motion'

const PEAKS_PER_SECOND = 20
const MIN_CLIP = 0.1
const SNAP_PX = 7
const SAVE_DEBOUNCE_MS = 700
const DRIFT = 0.25
const ADVANCED_KEY = 'thlabs.voiceover.advanced'

const KIND_STYLE: Record<TrackKind, { block: string; tint: string; icon: IconName; label: string }> = {
  video: { block: 'border-brand/60 bg-brand/20', tint: 'text-brand', icon: 'media', label: 'Video' },
  voice: { block: 'border-magenta/60 bg-magenta/20', tint: 'text-magenta', icon: 'voice', label: 'Voice' },
  music: { block: 'border-gold/60 bg-gold/20', tint: 'text-gold', icon: 'music', label: 'Music' },
  audio: { block: 'border-info/60 bg-info/20', tint: 'text-info', icon: 'sound', label: 'Audio' },
  text: { block: 'border-strong bg-[var(--well)]', tint: 'text-secondary', icon: 'text', label: 'Subtitles' },
}

// Which tracks a clip may be dragged between: picture, words, or sound.
const family = (k: TrackKind) => (k === 'video' ? 'video' : k === 'text' ? 'text' : 'sound')

/** Split subtitle words into lines of at most `per` words, CapCut style. */
function chunkWords(text: string, per = 7): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const out: string[] = []
  for (let i = 0; i < words.length; i += per) out.push(words.slice(i, i + per).join(' '))
  return out
}

const uid = () => Math.random().toString(16).slice(2, 14).padEnd(12, '0')

/** A subtitle clip: words, a start and a length, no file. */
function textClip(start: number, length: number, text: string): EditorClip {
  return {
    id: uid(), asset_id: '', start: Number(start.toFixed(3)), trim_in: 0,
    trim_out: Number(Math.max(0.2, length).toFixed(3)), volume: 0, fade_in: 0, fade_out: 0, text,
  }
}
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

  const [confirmDialog, confirm] = useConfirm()
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
    const ok = await confirm({
      title: `Delete “${p.name}”?`,
      body: 'The project, its uploaded files and its exports are deleted. This cannot be undone.',
      confirmLabel: 'Delete project',
    })
    if (!ok) return
    // Gone from the list at once, so the card animates out while the server works.
    setProjects((list) => list?.filter((x) => x.id !== p.id) ?? null)
    try {
      await editorApi.remove(p.id)
      refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete it.')
    }
  }

  return (
    <Page className="mx-auto w-full max-w-5xl py-2 sm:py-6" style={EDITOR_SHAPE}>
      <h1 className="text-xl font-semibold tracking-tight text-primary">AI Voiceover</h1>
      <p className="mt-0.5 text-sm text-secondary">Add a video, type what the voice should say, and download it.</p>
      {error && <p className="mt-4 text-sm text-danger">{error}</p>}
      <motion.div layout className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          type="button"
          onClick={create}
          disabled={creating}
          className="card card-hover focusable flex min-h-48 flex-col items-center justify-center gap-3 p-5 text-center"
        >
          <span className="icon-tile h-12 w-12 text-brand" data-accent="false">
            <EditorIcon name="plus" className="h-6 w-6" />
          </span>
          <span className="text-[15px] font-medium text-primary">{creating ? 'Creating…' : 'New voiceover'}</span>
        </button>
        {projects === null && !error && [0, 1].map((i) => <div key={i} className="card min-h-48 animate-pulse" />)}
        <AnimatePresence initial={false}>
        {projects?.map((p) => (
          <motion.div
            key={p.id}
            layout
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className="card card-hover flex flex-col overflow-hidden"
          >
            <Link to={`/video-editor/${p.id}`} className="focusable block">
              <div className="grid aspect-video place-items-center bg-black">
                {p.videoUrl ? (
                  <video src={`${mediaUrl(p.videoUrl)}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                ) : (
                  <span className="text-[13px] text-white/60">No video yet</span>
                )}
              </div>
            </Link>
            <div className="flex items-center gap-2 p-3.5">
              <Link to={`/video-editor/${p.id}`} className="focusable min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-primary">{p.name}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {fmt(p.duration)} · {new Date(p.updatedAt).toLocaleDateString()}
                </p>
              </Link>
              {p.render.status === 'done' && p.render.url && (
                <a
                  href={mediaUrl(p.render.url)}
                  download
                  aria-label={`Download ${p.name}`}
                  title="Download"
                  className="focusable grid h-9 w-9 shrink-0 place-items-center rounded-full text-secondary hover:bg-[var(--well)] hover:text-primary"
                >
                  <EditorIcon name="download" />
                </a>
              )}
              <button
                type="button"
                onClick={() => remove(p)}
                aria-label={`Delete ${p.name}`}
                title="Delete"
                className="focusable grid h-9 w-9 shrink-0 place-items-center rounded-full text-muted hover:bg-[var(--well)] hover:text-danger"
              >
                <EditorIcon name="trash" />
              </button>
            </div>
          </motion.div>
        ))}
        </AnimatePresence>
      </motion.div>
      {/* The steps are for the first visit; after that the projects are the page. */}
      {projects?.length === 0 && (
        <HowItWorks
          className="mt-6"
          steps={[
            { title: 'Add your video', body: 'Press New voiceover and upload your video.' },
            { title: 'Type the words', body: 'Each line you type becomes speech.' },
            { title: 'Export', body: 'Download one finished video.' },
          ]}
        />
      )}
      {confirmDialog}
    </Page>
  )
}

// ── Editor ───────────────────────────────────────────────────────────────────

type Sel = { track: string; clip: string } | null
type BinTab = 'speech' | 'subtitles' | 'files'

function rememberedAdvanced(): boolean {
  try {
    return localStorage.getItem(ADVANCED_KEY) === '1'
  } catch {
    return false
  }
}

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
  const [confirmDialog, confirm] = useConfirm()
  const [binTab, setBinTab] = useState<BinTab>('speech')
  const [dubsOpen, setDubsOpen] = useState(false)
  const [advanced, setAdvanced] = useState(rememberedAdvanced)
  const tracksRef = useRef(tracks)
  tracksRef.current = tracks
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
        setProject((cur) => (cur ? { ...cur, assets: p.assets, updatedAt: p.updatedAt } : p))
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

  async function removeTrack(trackId: string) {
    const t = tracks.find((x) => x.id === trackId)
    if (!t) return
    if (t.clips.length) {
      const ok = await confirm({
        title: `Remove the “${t.name}” track?`,
        body: `Its ${t.clips.length} clip${t.clips.length > 1 ? 's go' : ' goes'} with it. You can undo this with ⌘Z.`,
        confirmLabel: 'Remove track',
      })
      if (!ok) return
    }
    commit(tracks.filter((x) => x.id !== trackId))
    if (sel?.track === trackId) setSel(null)
  }

  /**
   * Give a video clip's sound its own clip on a sound track, and silence the
   * video clip — so cutting or deleting the sound never cuts the picture.
   */
  function detachAudio(trackId: string, clipId: string, base = tracks): EditorTrack[] {
    const vt = base.find((t) => t.id === trackId)
    const clip = vt?.clips.find((c) => c.id === clipId)
    if (!vt || !clip) return base
    let next = base
    let at = next.find((t) => t.kind === 'audio')
    if (!at) {
      at = { id: uid(), kind: 'audio', name: 'Original audio', muted: false, volume: 1, clips: [] }
      next = [...next, at]
    }
    const sound: EditorClip = { ...clip, id: uid(), volume: clip.volume || 1, label: 'Original audio' }
    const atId = at.id
    return next.map((t) =>
      t.id === trackId
        ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, volume: 0 } : c)) }
        : t.id === atId
          ? { ...t, clips: [...t.clips, sound] }
          : t,
    )
  }

  function textTrack(base: EditorTrack[]): [EditorTrack[], string] {
    const existing = base.find((t) => t.kind === 'text')
    if (existing) return [base, existing.id]
    const t: EditorTrack = { id: uid(), kind: 'text', name: 'Subtitles', muted: false, volume: 1, clips: [] }
    return [[...base, t], t.id]
  }

  /** A subtitle at the playhead, two seconds long, ready to type into. */
  function addText() {
    const [base, tid] = textTrack(tracks)
    const clip: EditorClip = {
      id: uid(), asset_id: '', start: Number(time.toFixed(2)), trim_in: 0, trim_out: 2,
      volume: 0, fade_in: 0, fade_out: 0, text: 'New subtitle',
    }
    commit(base.map((t) => (t.id === tid ? { ...t, clips: [...t.clips, clip] } : t)))
    setSel({ track: tid, clip: clip.id })
  }

  const [subtitling, setSubtitling] = useState<string | null>(null)
  // The spoken language for auto subtitles. 'auto' lets the recogniser guess,
  // which it does poorly for Uzbek — naming it gives far better spelling.
  const [subLang, setSubLang] = useState('auto')

  /**
   * Auto subtitles, CapCut style: every clip you can hear becomes subtitle
   * lines at the exact time each phrase is said, in order.
   *
   * Speech typed in the Voice panel already has its exact words, spread over the
   * clip. Anything else — the animation's own sound, uploaded voice — is heard
   * by the AI service word by word (one request per file, reused for every
   * clip of it), and each line lands under the part of the clip that plays it.
   */
  async function autoSubtitles() {
    if (!project || subtitling) return
    type Audible = { clip: EditorClip; asset: EditorAsset }
    const audible: Audible[] = []
    for (const t of tracks) {
      if (t.kind === 'text' || t.kind === 'music' || t.muted || t.volume <= 0) continue
      for (const c of t.clips) {
        const asset = assetById.get(c.asset_id)
        if (asset?.has_audio && c.volume > 0) audible.push({ clip: c, asset })
      }
    }
    if (!audible.length) {
      setError('There is no speech on the timeline yet. Add a video with sound, a voice file, or make speech in the Voice panel.')
      return
    }
    setError(null)
    const heard = new Map<string, { start: number; end: number; text: string }[]>()
    const lines: EditorClip[] = []
    try {
      const files = [...new Set(audible.filter((a) => !(a.asset.source === 'tts' && a.asset.text)).map((a) => a.asset.id))]
      for (const [n, assetId] of files.entries()) {
        setSubtitling(`Listening ${n + 1} of ${files.length}…`)
        heard.set(assetId, (await editorApi.subtitles(project.id, assetId, subLang)).lines)
      }
      for (const { clip, asset } of audible) {
        if (asset.source === 'tts' && asset.text) {
          // Known words: spread over the clip a few at a time.
          const chunks = chunkWords(asset.text)
          const total = chunks.reduce((k, x) => k + x.length, 0)
          let at = clip.start
          for (const chunk of chunks) {
            const len = Math.max(0.4, (clipLen(clip) * chunk.length) / total)
            lines.push(textClip(at, len, chunk))
            at += len
          }
          continue
        }
        // Heard words: keep the lines this clip actually plays, at its time.
        for (const line of heard.get(asset.id) ?? []) {
          const a = Math.max(line.start, clip.trim_in)
          const b = Math.min(line.end, clip.trim_out)
          if (b - a < 0.15) continue
          lines.push(textClip(clip.start + (a - clip.trim_in), b - a, line.text))
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not make subtitles.')
      return
    } finally {
      setSubtitling(null)
    }
    if (!lines.length) {
      setError('No speech was heard in the clips on the timeline.')
      return
    }
    lines.sort((x, y) => x.start - y.start)
    // Replace earlier auto subtitles instead of stacking a second copy.
    const [base, tid] = textTrack(tracks)
    commit(base.map((t) => (t.id === tid ? { ...t, clips: lines } : t)))
    setSel({ track: tid, clip: lines[0].id })
  }

  /** Put an asset on the timeline at the playhead, on the track it belongs to. */
  function place(asset: EditorAsset, at = time) {
    // The timeline as it is NOW: this also runs when an upload finishes,
    // possibly after edits made while it was uploading.
    const current = tracksRef.current
    const want: TrackKind = asset.kind === 'video' ? 'video' : asset.source === 'tts' ? 'voice' : 'music'
    let track =
      current.find((t) => t.kind === want) ??
      (asset.kind === 'video' ? undefined : current.find((t) => t.kind !== 'video'))
    let next = current
    if (!track) {
      track = { id: uid(), kind: want, name: KIND_STYLE[want].label, muted: false, volume: 1, clips: [] }
      next = [...current, track]
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
    next = next.map((t) => (t.id === tid ? { ...t, clips: [...t.clips, clip] } : t))
    // A video's sound goes on its own track straight away, so cutting the
    // sound never cuts the picture.
    if (asset.kind === 'video' && asset.has_audio) next = detachAudio(tid, clip.id, next)
    commit(next)
    setSel({ track: tid, clip: clip.id })
  }

  function onAssetAdded(p: EditorProject, asset: EditorAsset, autoPlace: boolean) {
    setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))
    // The first video of a project goes straight onto the timeline at 0:00 —
    // uploading it and seeing nothing happen is where a beginner gets stuck.
    const firstVideo =
      asset.kind === 'video' &&
      !tracksRef.current.some((t) => t.kind === 'video' && t.clips.length)
    if (autoPlace) {
      place(asset)
      // The next line follows this one instead of landing on top of it.
      setTime(time + asset.duration)
    } else if (firstVideo) place(asset, 0)
  }

  function splitAtPlayhead() {
    if (!sel || !selected) return
    if (time <= selected.start + MIN_CLIP || time >= clipEnd(selected) - MIN_CLIP) return
    let left: EditorClip
    let right: EditorClip
    if (selectedTrack?.kind === 'text') {
      // A subtitle splits its words by where the cut falls in its time.
      const into = time - selected.start
      const words = (selected.text ?? '').split(/\s+/).filter(Boolean)
      const k = Math.min(words.length - 1, Math.max(1, Math.round((words.length * into) / clipLen(selected))))
      left = { ...selected, trim_out: into, text: words.slice(0, k).join(' ') || selected.text }
      right = {
        ...selected, id: uid(), start: time, trim_out: clipLen(selected) - into,
        text: words.slice(k).join(' ') || selected.text,
      }
    } else {
      const cut = selected.trim_in + (time - selected.start)
      left = { ...selected, trim_out: cut, fade_out: 0 }
      right = { ...selected, id: uid(), start: time, trim_in: cut, fade_in: 0 }
    }
    commit(
      tracks.map((t) =>
        t.id === sel.track
          ? { ...t, clips: t.clips.flatMap((c) => (c.id === selected.id ? [left, right] : [c])) }
          : t,
      ),
    )
    setSel({ track: sel.track, clip: right.id })
  }

  async function deleteSelected() {
    if (!sel || !selected) return
    const what =
      selectedTrack?.kind === 'text'
        ? 'subtitle'
        : selectedTrack?.kind === 'video'
          ? 'video clip'
          : 'clip'
    const ok = await confirm({
      title: `Delete this ${what}?`,
      body: 'Only this clip is removed; its file stays in the project. You can undo with ⌘Z.',
      confirmLabel: 'Delete',
    })
    if (!ok) return
    removeClip(sel.track, sel.clip)
  }

  function removeClip(trackId: string, clipId: string) {
    commit(tracks.map((t) => (t.id === trackId ? { ...t, clips: t.clips.filter((c) => c.id !== clipId) } : t)))
    if (sel?.clip === clipId) setSel(null)
  }

  function playFrom(at: number) {
    setPlaying(false)
    setTime(at)
    requestAnimationFrame(() => setPlaying(true))
  }

  function toggleAdvanced() {
    const next = !advanced
    setAdvanced(next)
    try {
      localStorage.setItem(ADVANCED_KEY, next ? '1' : '0')
    } catch {
      /* private mode — the choice is simply not remembered */
    }
  }

  const linesOf = (kind: TrackKind) =>
    tracks
      .filter((t) => t.kind === kind)
      .flatMap((t) => t.clips.map((clip) => ({ trackId: t.id, clip })))
      .sort((a, b) => a.clip.start - b.clip.start)

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
      if (document.querySelector('[role="alertdialog"]')) return
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
        void deleteSelected()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (loadError) {
    return (
      <Page className="mx-auto max-w-xl py-10 text-center">
        <p className="text-sm text-danger">{loadError}</p>
        <Link to="/video-editor" className="btn-primary focusable mt-4 inline-flex h-10 items-center px-5 text-sm">
          Back to projects
        </Link>
      </Page>
    )
  }
  if (!project) return <Page className="card mx-auto mt-6 h-96 max-w-6xl animate-pulse">{null}</Page>

  return (
    <Page className="flex w-full min-w-0 flex-col gap-3 pb-6 xl:h-full xl:pb-0" style={EDITOR_SHAPE}>
      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/video-editor" aria-label="Back to projects" title="Back to projects" className="btn-ghost focusable grid h-9 w-9 shrink-0 place-items-center rounded-full!">
          <EditorIcon name="back" className="h-4 w-4" />
        </Link>
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value)
            dirty.current = true
          }}
          aria-label="Project name"
          className="field h-9 min-w-0 max-w-xs flex-1 text-sm font-medium max-sm:order-last max-sm:max-w-none max-sm:basis-full"
        />
        <span className={`text-[12px] ${saveState === 'error' ? 'text-danger' : 'text-muted'}`}>
          {saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Saving…'}
        </span>
        <button
          type="button"
          onClick={toggleAdvanced}
          aria-pressed={advanced}
          className={`btn-ghost focusable ml-auto h-9 rounded-full! px-4 text-[13px] ${advanced ? 'text-primary' : ''}`}
        >
          {advanced ? 'Simple view' : 'Advanced editing'}
        </button>
        <div>
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

      {!advanced && (
        <VoiceSteps
          video={tracks.some((t) => t.kind === 'video' && t.clips.length > 0)}
          voice={tracks.some((t) => t.kind === 'voice' && t.clips.length > 0)}
          exported={project.render.status === 'done'}
        />
      )}

      {/* Simple view: the picture beside the words. Advanced, on a phone: one
          column. Tablet: panel beside the picture, the rest under it. Large
          screen: one window with the timeline along the bottom. */}
      <div className={`grid min-h-0 min-w-0 flex-1 gap-3 ${
          !advanced
            ? "[grid-template-areas:'preview'_'left'] lg:grid-cols-[minmax(0,1fr)_360px] lg:[grid-template-areas:'preview_left'] xl:grid-rows-[minmax(0,1fr)]"
            : `[grid-template-areas:'preview'_'left'_'time'_'insp'] lg:grid-cols-[320px_minmax(0,1fr)] lg:[grid-template-areas:'left_preview'_'time_time'_'insp_insp'] xl:grid-rows-[minmax(0,1fr)_auto] ${
                length > 0
                  ? "xl:grid-cols-[300px_minmax(0,1fr)_250px] xl:[grid-template-areas:'left_preview_insp'_'time_time_time']"
                  : "xl:grid-cols-[300px_minmax(0,1fr)] xl:[grid-template-areas:'left_preview'_'time_time']"
              }`
        }`}>
        <MediaBin
          project={project}
          onAdded={onAssetAdded}
          onPlace={(a) => place(a)}
          onError={setError}
          onRemoved={(p) => setProject((cur) => (cur ? { ...cur, assets: p.assets } : p))}
          used={new Set(tracks.flatMap((t) => t.clips.map((c) => c.asset_id)))}
          confirm={confirm}
          tab={binTab}
          setTab={setBinTab}
          dubsOpen={dubsOpen}
          setDubsOpen={setDubsOpen}
          advanced={advanced}
          startsAt={time}
          voiceLines={
            <VoiceLines
              lines={linesOf('voice')}
              assets={assetById}
              time={time}
              onPlay={playFrom}
              onMove={(l) => updateClip(l.trackId, l.clip.id, { start: Number(time.toFixed(2)) })}
              onDelete={(l) => removeClip(l.trackId, l.clip.id)}
            />
          }
          subtitles={
            <>
              <SubtitlesPanel
                onAuto={() => void autoSubtitles()}
                onAdd={addText}
                busy={subtitling}
                lang={subLang}
                setLang={setSubLang}
              />
              <SubtitleLines
                lines={linesOf('text')}
                onPlay={playFrom}
                onChange={(l, text) => updateClip(l.trackId, l.clip.id, { text })}
                onDelete={(l) => removeClip(l.trackId, l.clip.id)}
              />
            </>
          }
        />
        <Preview
          tracks={tracks}
          assets={assetById}
          time={time}
          setTime={setTime}
          playing={playing}
          setPlaying={setPlaying}
          length={length}
          onUpload={() => setBinTab('files')}
          onDubs={() => {
            setBinTab('files')
            setDubsOpen(true)
          }}
        />
        {advanced && length > 0 && (
          <Inspector
            clip={selected}
            track={selectedTrack}
            asset={selected ? assetById.get(selected.asset_id) : undefined}
            onChange={(patch) => sel && updateClip(sel.track, sel.clip, patch)}
            onTrackVolume={(volume) => sel && updateTrack(sel.track, { volume })}
            onDelete={deleteSelected}
            onDuplicate={duplicateSelected}
            onDetach={() => sel && commit(detachAudio(sel.track, sel.clip))}
          />
        )}
        {advanced && <Timeline
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
        />}
      </div>
      {confirmDialog}
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
        <a href={mediaUrl(r.url)} download className="btn-primary focusable inline-flex h-9 items-center gap-1.5 px-4 text-[13px]">
          <EditorIcon name="download" className="h-4 w-4" /> Download
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
  confirm,
  tab,
  setTab,
  dubsOpen,
  setDubsOpen,
  advanced,
  startsAt,
  voiceLines,
  subtitles,
}: {
  project: EditorProject
  onAdded: (p: EditorProject, a: EditorAsset, autoPlace: boolean) => void
  onPlace: (a: EditorAsset) => void
  onError: (msg: string) => void
  onRemoved: (p: EditorProject) => void
  used: Set<string>
  confirm: (opts: ConfirmOptions) => Promise<boolean>
  tab: BinTab
  setTab: (t: BinTab) => void
  dubsOpen: boolean
  setDubsOpen: (open: boolean) => void
  advanced: boolean
  /** Where the next line of speech will land. */
  startsAt: number
  voiceLines: ReactNode
  subtitles: ReactNode
}) {
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
    const ok = await confirm({
      title: `Remove “${a.text ?? a.name}” from the project?`,
      body: 'The file is deleted from this project. This cannot be undone.',
      confirmLabel: 'Remove file',
    })
    if (!ok) return
    try {
      onRemoved(await editorApi.removeAsset(project.id, a.id))
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not remove it.')
    }
  }

  return (
    <div className={`card flex min-h-0 min-w-0 flex-col overflow-hidden [grid-area:left] ${advanced ? 'lg:max-h-[420px] xl:max-h-none' : ''}`}>
      <div role="tablist" aria-label="Add to your video" className="m-3 mb-0 flex shrink-0 gap-1 rounded-control bg-sunken p-1">
        {(
          [
            ['speech', 'Voice', 'voice'],
            ['subtitles', 'Subtitles', 'subtitles'],
            ['files', 'Files', 'media'],
          ] as const
        ).map(([k, label, icon]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`focusable flex flex-1 items-center justify-center gap-1.5 rounded-[8px] px-1 py-2 text-[13px] font-medium transition-colors ${
              tab === k ? 'bg-surface text-primary shadow-sm dark:bg-raised' : 'text-muted hover:text-primary'
            }`}
          >
            <EditorIcon name={icon} className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      <input ref={input} id="ve-upload" type="file" multiple accept="video/*,audio/*" hidden onChange={(e) => void upload(e.target.files)} />
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
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
              className="focusable w-full rounded-[var(--radius-control)] border border-dashed border-strong px-3 py-5 text-center text-[13px] text-secondary hover:border-brand"
            >
              {uploading ? `Uploading ${uploading}…` : 'Add a video or music'}
            </button>
            <ul className="mt-3 flex flex-col gap-1">
              {project.assets.map((a) => (
                <li key={a.id} className="group flex items-center gap-2 rounded-[var(--radius-control)] px-1.5 py-1.5 hover:bg-[var(--well)]">
                  <span className={`h-7 w-1 shrink-0 rounded-[2px] ${a.kind === 'video' ? 'bg-brand' : a.source === 'tts' ? 'bg-magenta' : 'bg-gold'}`} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12px] text-primary" title={a.text ?? a.name}>
                      {a.text ?? a.name}
                    </p>
                    <p className="text-[12px] text-muted">{fmt(a.duration)}</p>
                  </div>
                  {!used.has(a.id) && (
                    <button type="button" onClick={() => remove(a)} className="shrink-0 text-[11px] text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100" aria-label={`Remove ${a.name}`}>
                      ✕
                    </button>
                  )}
                  <button type="button" onClick={() => onPlace(a)} className="btn-primary focusable h-8 shrink-0 px-3 text-[12px]" title="Add it where the video is now">
                    Add
                  </button>
                </li>
              ))}
            </ul>
            <details open={dubsOpen} onToggle={(e) => setDubsOpen(e.currentTarget.open)} className="mt-3 text-[13px] text-secondary">
              <summary className="focusable cursor-pointer py-1">Use a dub from the Studio</summary>
              <DubImporter project={project} onAdded={onAdded} onError={onError} />
            </details>
          </>
        )}
        {tab === 'speech' && (
          <>
            <SpeechMaker project={project} startsAt={startsAt} onAdded={onAdded} onError={onError} />
            {voiceLines}
          </>
        )}
        {tab === 'subtitles' && subtitles}
      </div>
    </div>
  )
}

function SpeechMaker({
  project,
  startsAt,
  onAdded,
  onError,
}: {
  project: EditorProject
  startsAt: number
  onAdded: (p: EditorProject, a: EditorAsset, autoPlace: boolean) => void
  onError: (msg: string) => void
}) {
  const { data: languages = [] } = useLanguages()
  const [language, setLanguage] = useState('uz')
  // undefined while loading, null when the dubbing service did not answer
  const [voices, setVoices] = useState<SpeechVoices | null | undefined>(undefined)
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
  // null voices = the dubbing service did not answer; both engines off = it
  // answered but has no voice engine (they run on the GPU server).
  const unavailable =
    voices === undefined
      ? null
      : voices === null
      ? 'The dubbing service is not reachable right now, so speech cannot be made.'
      : !navoiy && !voices.omnivoice.available && !voices.edge?.available
        ? 'Text to speech is not available on this server right now.'
        : null
  const chosen = voice && options.some((o) => o.id === voice) ? voice : (engine?.default ?? undefined)
  const tokens = Math.max(1, Math.ceil((text.trim().length / 12) * (20 / 60)))

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
      const r = await editorApi.importAsset(project.id, { ttsTaskId: task.id, name: line.slice(0, 60), text: line })
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
    <div className="flex flex-col gap-3">
      <LanguageSelect languages={languages} value={language} onChange={(c) => { setLanguage(c); setVoice(null) }} label="Language" />
      {options.length > 1 && (
        <label className="flex flex-col gap-1 text-[12px] text-muted">
          Voice
          <select value={chosen ?? ''} onChange={(e) => setVoice(e.target.value)} className="field h-10 py-0 text-[13px]">
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void make()
        }}
        rows={4}
        maxLength={voices?.max_chars ?? 1000}
        placeholder="Type what the voice should say…"
        className="field rounded-[12px]! resize-none text-[13px] leading-relaxed"
      />
      {unavailable && (
        <p className="rounded-[var(--radius-control)] border border-warn/30 bg-warn/[0.07] px-3 py-2 text-[12px] text-secondary">
          {unavailable}
        </p>
      )}
      <button type="button" onClick={make} disabled={!text.trim() || busy || !!unavailable} className="btn-primary focusable h-10 text-[13px] disabled:opacity-50">
        {busy ? 'Making speech…' : `Add at ${fmt(startsAt)}`}
      </button>
      {text.trim() && (
        <p className="text-center text-[12px] text-muted">
          About {tokens} token{tokens === 1 ? '' : 's'}
        </p>
      )}
    </div>
  )
}

/** Subtitles from the speech on the timeline, or one typed by hand. */
function SubtitlesPanel({
  onAuto,
  onAdd,
  busy,
  lang,
  setLang,
}: {
  onAuto: () => void
  onAdd: () => void
  /** Progress while auto subtitles are being made; null when idle. */
  busy: string | null
  lang: string
  setLang: (code: string) => void
}) {
  const { data: languages = [] } = useLanguages()
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] leading-relaxed text-secondary">Turn the speech on the timeline into subtitles.</p>
      <label className="flex flex-col gap-1 text-[12px] text-muted">
        Spoken language
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="field h-10 py-0 text-[13px]">
          <option value="auto">Detect automatically</option>
          {languages.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </label>
      <button type="button" onClick={onAuto} disabled={!!busy} className="btn-primary focusable h-10 text-[13px] disabled:opacity-60">
        {busy ?? 'Make subtitles'}
      </button>
      <button type="button" onClick={onAdd} className="focusable text-[13px] text-muted underline-offset-4 hover:text-primary hover:underline">
        or add one by hand
      </button>
    </div>
  )
}

type ClipLine = { trackId: string; clip: EditorClip }

/** What the voice says, in order. All the simple view needs to place a line. */
function VoiceLines({
  lines,
  assets,
  time,
  onPlay,
  onMove,
  onDelete,
}: {
  lines: ClipLine[]
  assets: Map<string, EditorAsset>
  time: number
  onPlay: (at: number) => void
  onMove: (line: ClipLine) => void
  onDelete: (line: ClipLine) => void
}) {
  if (!lines.length) return null
  return (
    <section className="mt-4 border-t border-subtle pt-3">
      <h3 className="mb-2 text-[13px] font-semibold text-primary">Your lines</h3>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.clip.id} className="inner p-2.5">
            <p className="line-clamp-2 text-[13px] leading-relaxed text-primary">
              {assets.get(l.clip.asset_id)?.text ?? l.clip.label ?? 'Voice'}
            </p>
            <div className="mt-1.5 flex items-center gap-1">
              <span className="text-[12px] text-muted">{fmt(l.clip.start)}</span>
              {Math.abs(l.clip.start - time) >= 0.1 && (
                <button type="button" onClick={() => onMove(l)} className="focusable ml-1 text-[12px] text-brand hover:underline">
                  Move to {fmt(time)}
                </button>
              )}
              <span className="ml-auto" />
              <LineButton label="Play from this line" onClick={() => onPlay(l.clip.start)}>
                <EditorIcon name="play" className="h-3.5 w-3.5" />
              </LineButton>
              <LineButton label="Remove this line" onClick={() => onDelete(l)}>
                <EditorIcon name="trash" className="h-4 w-4" />
              </LineButton>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function SubtitleLines({
  lines,
  onPlay,
  onChange,
  onDelete,
}: {
  lines: ClipLine[]
  onPlay: (at: number) => void
  onChange: (line: ClipLine, text: string) => void
  onDelete: (line: ClipLine) => void
}) {
  if (!lines.length) return null
  return (
    <section className="mt-4 border-t border-subtle pt-3">
      <h3 className="mb-2 text-[13px] font-semibold text-primary">Your subtitles</h3>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l) => (
          <li key={l.clip.id} className="flex items-center gap-1">
            <button type="button" onClick={() => onPlay(l.clip.start)} title="Play from here" className="focusable w-9 shrink-0 text-left text-[12px] text-muted hover:text-primary">
              {fmt(l.clip.start)}
            </button>
            <input
              key={l.clip.text}
              defaultValue={l.clip.text ?? ''}
              aria-label={`Subtitle at ${fmt(l.clip.start)}`}
              onBlur={(e) => {
                const text = e.target.value.trim()
                if (text && text !== l.clip.text) onChange(l, text)
              }}
              className="field h-9 min-w-0 flex-1 rounded-[10px]! px-2.5 py-0 text-[13px]"
            />
            <LineButton label="Remove this subtitle" onClick={() => onDelete(l)}>
              <EditorIcon name="trash" className="h-4 w-4" />
            </LineButton>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LineButton({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="focusable grid h-8 w-8 shrink-0 place-items-center rounded-full text-secondary hover:bg-[var(--well)] hover:text-primary"
    >
      {children}
    </button>
  )
}

function VoiceSteps({ video, voice, exported }: { video: boolean; voice: boolean; exported: boolean }) {
  const steps = [
    { label: 'Add your video', done: video },
    { label: 'Type the words', done: voice },
    { label: 'Export', done: exported },
  ]
  const current = steps.findIndex((s) => !s.done)
  return (
    <ol className="flex items-center gap-2 sm:gap-3">
      {steps.map((s, i) => (
        <li key={s.label} className={`flex min-w-0 items-center gap-1.5 text-[13px] ${i === current ? 'font-medium text-primary' : 'text-muted'}`}>
          <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] text-[12px] ${s.done ? 'bg-success/15 text-success' : i === current ? 'bg-brand/15 text-brand' : 'bg-[var(--well)]'}`}>
            {s.done ? '✓' : i + 1}
          </span>
          <span className="truncate">{s.label}</span>
        </li>
      ))}
    </ol>
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
  // Finished dubs from the library; the account API fetches the video from
  // the dubbing pipeline with the user's own token.
  const { works } = useWorks()
  const jobs = works.filter((w) => w.status === 'completed' && w.outputUrl)
  const [busy, setBusy] = useState<string | null>(null)

  async function bring(j: Work) {
    setBusy(j.id)
    try {
      const r = await editorApi.importAsset(project.id, { jobId: j.id, name: workTitle(j) })
      onAdded(r.project, r.asset, false)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not import that dub.')
    } finally {
      setBusy(null)
    }
  }

  if (!jobs.length) return <p className="pt-2 text-[12px] text-muted">No finished dubs to bring in yet.</p>
  return (
    <ul className="flex flex-col gap-1.5 pt-1">
      {jobs.map((j) => (
        <li key={j.id} className="inner flex items-center gap-2 rounded-[var(--radius-control)] px-2.5 py-2">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] text-primary">{workTitle(j)}</p>
            <p className="font-mono text-[10px] text-muted">
              → {j.targetLang.toUpperCase()} · {j.durationSec ? fmt(j.durationSec) : '—'}
            </p>
          </div>
          <button type="button" disabled={busy === j.id} onClick={() => bring(j)} className="btn-primary focusable h-7 shrink-0 px-2 text-[11px]">
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
  onUpload,
  onDubs,
}: {
  tracks: EditorTrack[]
  assets: Map<string, EditorAsset>
  time: number
  setTime: (t: number) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  length: number
  onUpload: () => void
  onDubs: () => void
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
      if (t.kind === 'video' || t.kind === 'text') continue
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
      // Forget them too. A stopped, emptied player left in the map is
      // reused as if it were fine the next time the preview mounts — which
      // React does straight away in development (StrictMode), and on every
      // return to the project — so the sound was silent after re-opening.
      audios.current.clear()
    },
    [],
  )

  // Put every element where it should be at time `at`.
  const sync = useCallback(
    (at: number, play: boolean) => {
      let top: string | null = null
      for (const t of tracks) {
        if (t.kind === 'text') continue
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

  const subtitle =
    tracks
      .filter((t) => t.kind === 'text' && !t.muted)
      .flatMap((t) => t.clips)
      .find((c) => time >= c.start && time < clipEnd(c)) ?? null
  const anyVideo = videoClips.some(({ c, t }) => !t.muted && time >= c.start && time < clipEnd(c))

  return (
    <div className="card flex min-h-0 min-w-0 flex-col overflow-hidden [grid-area:preview]">
      <div className="relative aspect-video w-full bg-black xl:aspect-auto xl:min-h-0 xl:flex-1">
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
        {length <= 0 ? (
          // An empty project has one thing to do, so that is all it shows.
          <div className="absolute inset-0 z-[41] flex flex-col items-center justify-center gap-3 p-4 text-center">
            <p className="text-[15px] font-medium text-white">Start with your video</p>
            <label htmlFor="ve-upload" onClick={onUpload} className="btn-primary focusable inline-flex h-10 cursor-pointer items-center px-5 text-sm">
              Upload a video
            </label>
            <button type="button" onClick={onDubs} className="focusable text-[13px] text-white/70 underline-offset-4 hover:text-white hover:underline">
              or use a dub from the Studio
            </button>
          </div>
        ) : (
          !anyVideo && (
            <div className="absolute inset-0 grid place-items-center text-[13px] text-white/50">
              {videoClips.length ? 'No picture at this point' : 'Add a video to see it here'}
            </div>
          )
        )}
        {/* The subtitle under the playhead, drawn the way the export burns it. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-[6%] z-[40] flex justify-center px-[6%]">
          <AnimatePresence mode="wait">
            {subtitle && (
              <motion.p
                key={subtitle.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.16 }}
                className="max-w-full text-center text-[clamp(13px,2.4vw,22px)] font-semibold leading-snug text-white"
                style={{ textShadow: '0 0 3px #000, 0 0 3px #000, 0 1px 2px #000' }}
              >
                {subtitle.text}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
      <input
        type="range"
        min={0}
        max={Math.max(length, 0.1)}
        step={0.05}
        value={Math.min(time, length)}
        disabled={length <= 0}
        onChange={(e) => {
          setPlaying(false)
          setTime(Number(e.target.value))
        }}
        aria-label="Position in the video"
        className="mx-3 mt-2 block w-[calc(100%-1.5rem)] accent-[var(--color-brand)]"
      />
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 px-3 py-2">
        <span className="font-mono text-[12px] text-primary">{fmt(time, true)}</span>
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          disabled={length <= 0}
          className="btn-primary focusable grid h-9 w-9 place-items-center rounded-full disabled:opacity-50"
          aria-label={playing ? 'Pause' : 'Play'}
          title="Play or pause (Space)"
        >
          <EditorIcon name={playing ? 'pause' : 'play'} className="h-4 w-4" />
        </button>
        <span className="text-right font-mono text-[12px] text-muted">{fmt(length, true)}</span>
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
  onTrackVolume,
  onDelete,
  onDuplicate,
  onDetach,
}: {
  clip: EditorClip | null
  track: EditorTrack | null
  asset?: EditorAsset
  onChange: (patch: Partial<EditorClip>) => void
  onTrackVolume: (v: number) => void
  onDelete: () => void
  onDuplicate: () => void
  /** Give a video clip's sound its own clip, so it can be cut on its own. */
  onDetach: () => void
}) {
  const box = 'card min-h-0 min-w-0 overflow-y-auto p-4 [grid-area:insp]'
  if (!clip || !track) {
    return (
      <div className={`${box} grid place-items-center text-center text-[13px] leading-relaxed text-muted`}>
        Click a clip on the timeline to edit it.
      </div>
    )
  }
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
  const slider = (label: string, value: number, set: (v: number) => void) => (
    <label className="flex flex-col gap-1 text-[12px] text-muted">
      <span className="flex justify-between">
        {label} <span className="font-mono text-primary">{Math.round(value * 100)}%</span>
      </span>
      <input type="range" min={0} max={2} step={0.05} value={value} onChange={(e) => set(Number(e.target.value))} className="accent-[var(--color-brand)]" />
    </label>
  )
  const actions = (
    <div className="mt-1 flex flex-wrap gap-2">
      <button type="button" onClick={onDuplicate} className="btn-primary focusable h-8 px-3 text-[12px]" title="Duplicate (⌘D)">
        Duplicate
      </button>
      <button type="button" onClick={onDelete} className="focusable h-8 rounded-full bg-danger px-3.5 text-[12px] font-medium text-white hover:bg-danger/90">
        Delete
      </button>
    </div>
  )
  const more = (children: ReactNode) => (
    <details className="text-[12px] text-muted">
      <summary className="focusable cursor-pointer py-0.5">More options</summary>
      <div className="mt-2 flex flex-col gap-2.5">{children}</div>
    </details>
  )

  if (track.kind === 'text') {
    return (
      <div className={`${box} flex flex-col gap-2.5`}>
        <p className="text-sm font-medium text-primary">Subtitle</p>
        <SubtitleWords
          key={clip.id}
          text={clip.text ?? ''}
          onChange={(text) => onChange({ text })}
        />
        {more(
          <>
            {num('Starts at (s)', clip.start, (v) => onChange({ start: v }))}
            {num('Length (s)', clipLen(clip), (v) => onChange({ trim_out: Math.max(0.2, v) }), 0.1, 60)}
          </>,
        )}
        {actions}
      </div>
    )
  }

  const detached = track.kind === 'video' && !!asset?.has_audio && clip.volume === 0
  const hasSound = track.kind !== 'video' || (!!asset?.has_audio && !detached)

  return (
    <div className={`${box} flex flex-col gap-2.5`}>
      <div>
        <p className="line-clamp-2 text-sm font-medium text-primary" title={asset?.name}>
          {asset?.text ?? asset?.name ?? 'Clip'}
        </p>
        <p className="mt-0.5 text-[12px] text-muted">
          {track.name} · {fmt(clipLen(clip), true)}
        </p>
      </div>
      {hasSound && slider('Volume', clip.volume, (v) => onChange({ volume: v }))}
      {detached && (
        <p className="text-[12px] leading-relaxed text-muted">
          This video's sound is on its own track, so you can cut it there.
        </p>
      )}
      {more(
        <>
          {num('Starts at (s)', clip.start, (v) => onChange({ start: v }))}
          {num('Trim in (s)', clip.trim_in, (v) => onChange({ trim_in: Math.min(v, clip.trim_out - MIN_CLIP) }), 0.05, asset?.duration)}
          {num('Trim out (s)', clip.trim_out, (v) => onChange({ trim_out: Math.max(v, clip.trim_in + MIN_CLIP) }), 0.05, asset?.duration)}
          {hasSound && num('Fade in (s)', clip.fade_in, (v) => onChange({ fade_in: v }), 0.1, 30)}
          {hasSound && num('Fade out (s)', clip.fade_out, (v) => onChange({ fade_out: v }), 0.1, 30)}
          {track.kind !== 'video' && slider('Whole track volume', track.volume, onTrackVolume)}
          {track.kind === 'video' && asset?.has_audio && !detached && (
            <button type="button" onClick={onDetach} className="btn-primary focusable h-8 px-3 text-[12px]" title="Put this clip's sound on its own track">
              Detach audio
            </button>
          )}
        </>,
      )}
      {actions}
    </div>
  )
}

/**
 * A subtitle's words, CapCut style: click a word to fix it, drag a word to
 * move it, × to drop it, + to add one. Every change reaches the timeline at
 * once, so the preview and the export follow.
 */
function SubtitleWords({ text, onChange }: { text: string; onChange: (text: string) => void }) {
  const words = text.split(/\s+/).filter(Boolean)
  // Stable keys while words move: a word keeps its key wherever it goes.
  const keys = useRef<string[]>([])
  if (keys.current.length !== words.length) {
    keys.current = words.map((_, i) => keys.current[i] ?? uid())
  }
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  const emit = (next: string[], nextKeys: string[]) => {
    keys.current = nextKeys
    onChange(next.join(' '))
  }

  function commitEdit(i: number) {
    const parts = draft.split(/\s+/).filter(Boolean)
    const next = [...words]
    const nextKeys = [...keys.current]
    // Typing several words into one splits it; clearing it removes it.
    next.splice(i, 1, ...parts)
    nextKeys.splice(i, 1, ...parts.map((_, k) => (k === 0 ? keys.current[i] : uid())))
    setEditing(null)
    if (!next.length) return
    emit(next, nextKeys)
  }

  function move(from: number, to: number) {
    if (from === to) return
    const next = [...words]
    const nextKeys = [...keys.current]
    const [w] = next.splice(from, 1)
    const [k] = nextKeys.splice(from, 1)
    next.splice(to, 0, w)
    nextKeys.splice(to, 0, k)
    emit(next, nextKeys)
  }

  function remove(i: number) {
    if (words.length <= 1) return
    emit(words.filter((_, j) => j !== i), keys.current.filter((_, j) => j !== i))
  }

  function add() {
    const next = [...words, 'word']
    emit(next, [...keys.current, uid()])
    setEditing(next.length - 1)
    setDraft('word')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[11px] text-muted">Click a word to fix it · drag it to move it</p>
      <motion.div layout className="flex flex-wrap gap-1.5 rounded-[12px] border border-subtle bg-sunken p-2">
        <AnimatePresence initial={false}>
          {words.map((w, i) => (
            // motion.div animates the reflow; the inner div does the browser
            // drag-and-drop, whose onDragStart/End framer-motion would swallow.
            <motion.div
              key={keys.current[i]}
              layout
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: dragging === i ? 0.4 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            >
            <div
              draggable={editing !== i}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/plain', String(i))
                e.dataTransfer.effectAllowed = 'move'
                setDragging(i)
              }}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(i)
              }}
              onDragLeave={() => setOver((o) => (o === i ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                if (dragging !== null) move(dragging, i)
                setDragging(null)
                setOver(null)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOver(null)
              }}
              className={`group relative flex items-center rounded-[8px] border text-[13px] ${
                over === i && dragging !== null && dragging !== i
                  ? 'border-brand bg-brand/15'
                  : 'border-[var(--card-edge)] bg-raised'
              } ${editing === i ? '' : 'cursor-grab active:cursor-grabbing'}`}
            >
              {editing === i ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => commitEdit(i)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit(i)
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  size={Math.max(2, draft.length)}
                  className="h-7 rounded-[8px] bg-transparent px-2 text-[13px] text-primary outline-none ring-2 ring-brand"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditing(i)
                    setDraft(w)
                  }}
                  className="focusable h-7 px-2 text-primary"
                  title="Click to edit"
                >
                  {w}
                </button>
              )}
              {editing !== i && words.length > 1 && (
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label={`Remove “${w}”`}
                  className="mr-1 grid h-4 w-4 place-items-center rounded-[4px] text-[10px] text-muted opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                >
                  ✕
                </button>
              )}
            </div>
            </motion.div>
          ))}
        </AnimatePresence>
        <motion.button
          layout
          type="button"
          onClick={add}
          className="focusable h-7 rounded-full border border-dashed border-strong px-3 text-[12px] text-muted hover:text-primary"
        >
          + word
        </motion.button>
      </motion.div>
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
}) {
  const [adding, setAdding] = useState(false)
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
    if (o.text !== undefined && d.mode !== 'move') {
      // A subtitle has no file to run out of: its edges move freely, the
      // left one keeping its end where it is.
      const end = clipEnd(o)
      if (d.mode === 'left') {
        const start = Math.min(Math.max(0, snap(o.start + dt, o.id)), end - MIN_CLIP)
        patch = { start, trim_out: end - start }
      } else {
        const newEnd = Math.max(o.start + MIN_CLIP, Math.min(o.start + 60, snap(end + dt, o.id)))
        patch = { trim_out: newEnd - o.start }
      }
    } else if (d.mode === 'move') {
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
      const fits = (k1: TrackKind, k2: TrackKind) => family(k1) === family(k2)
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
  const laneH = (k: TrackKind) => (k === 'video' ? 'h-14' : 'h-11')

  return (
    <div className="card flex min-h-0 min-w-0 flex-col overflow-hidden [grid-area:time] xl:max-h-[300px]">
      {/* toolbar */}
      <div className="flex items-center gap-1 border-b border-subtle px-2 py-1">
        <ToolBtn onClick={onUndo} label="Undo (⌘Z)"><EditorIcon name="undo" /></ToolBtn>
        <ToolBtn onClick={onRedo} label="Redo (⇧⌘Z)"><EditorIcon name="redo" /></ToolBtn>
        <span className="mx-1 h-5 w-px bg-[var(--card-edge)]" />
        <ToolBtn onClick={onSplit} label="Split at the playhead (S)" disabled={!sel}><EditorIcon name="split" /></ToolBtn>
        <ToolBtn onClick={onDelete} label="Delete clip (⌫)" disabled={!sel}><EditorIcon name="trash" /></ToolBtn>
        <span className="mx-1 h-5 w-px bg-[var(--card-edge)]" />
        <div
          className="relative"
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget)) setAdding(false)
          }}
        >
          <ToolBtn onClick={() => setAdding(!adding)} label="Add a track"><EditorIcon name="plus" /></ToolBtn>
          {adding && (
            <div className="absolute left-0 top-full z-20 mt-1 flex w-32 flex-col rounded-[10px] border border-subtle bg-raised p-1 shadow-[var(--shadow-lg)]">
              {(['video', 'voice', 'music'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => {
                    onAddTrack(k)
                    setAdding(false)
                  }}
                  className="focusable rounded-[8px] px-2.5 py-1.5 text-left text-[12px] text-primary hover:bg-[var(--well)]"
                >
                  {KIND_STYLE[k].label} track
                </button>
              ))}
            </div>
          )}
        </div>
        <input
          type="range"
          min={0.3}
          max={10}
          step={0.1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          aria-label="Zoom"
          title="Zoom"
          className="ml-auto mr-1 w-24 accent-[var(--color-brand)]"
        />
      </div>

      <div className="flex min-h-0 flex-1 overflow-y-auto">
        {/* track headers */}
        <div className="h-fit w-[124px] shrink-0 border-r border-subtle">
          <div className="h-6 border-b border-subtle" />
          {tracks.map((t) => (
            <div key={t.id} className={`group flex items-center gap-1.5 border-b border-subtle px-2 ${laneH(t.kind)}`}>
              <span className={KIND_STYLE[t.kind].tint}>
                <EditorIcon name={KIND_STYLE[t.kind].icon} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-primary" title={t.name}>{t.name}</span>
              <button
                type="button"
                onClick={() => onRemoveTrack(t.id)}
                className="text-[10px] text-muted opacity-0 hover:text-danger focus:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                aria-label={`Remove ${t.name}`}
                title={`Remove ${t.name}`}
              >
                ✕
              </button>
              <button
                type="button"
                onClick={() => onTrack(t.id, { muted: !t.muted })}
                className={`focusable shrink-0 hover:text-primary ${t.muted ? 'text-danger' : 'text-muted'}`}
                aria-label={t.muted ? `Turn ${t.name} on` : `Turn ${t.name} off`}
                title={t.muted ? 'Turn this track on' : 'Turn this track off'}
              >
                <EditorIcon
                  name={t.kind === 'video' || t.kind === 'text' ? (t.muted ? 'eyeOff' : 'eye') : t.muted ? 'soundOff' : 'sound'}
                  className="h-4 w-4"
                />
              </button>
            </div>
          ))}
        </div>

        {/* lanes */}
        <div ref={scroller} className="h-fit min-w-0 flex-1 overflow-x-auto">
          <div className="relative select-none" style={{ width }}>
            <div className="relative h-6 cursor-pointer border-b border-subtle" onPointerDown={seekFrom}>
              {Array.from({ length: Math.floor(span / tick) + 1 }, (_, i) => i * tick).map((t) => (
                <span key={t} className="absolute top-0 h-full pl-1 font-mono text-[10px] leading-6 text-muted" style={{ left: t * pps }}>
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
                  const grip = `absolute inset-y-0 grid w-2.5 cursor-ew-resize place-items-center ${isSel ? '' : 'opacity-0 group-hover:opacity-100'}`
                  return (
                    <div
                      key={c.id}
                      onPointerDown={(e) => begin(e, t.id, c, 'move')}
                      onPointerMove={move}
                      onPointerUp={end}
                      className={`group absolute inset-y-1 cursor-grab overflow-hidden rounded-[8px] border active:cursor-grabbing ${KIND_STYLE[t.kind].block} ${isSel ? 'ring-2 ring-brand' : ''}`}
                      style={{ left: c.start * pps, width: Math.max(clipLen(c) * pps, 4) }}
                      title={a?.text ?? a?.name}
                    >
                      {/* A video's sound has its own track, so its picture clip draws no wave. */}
                      {a && t.kind !== 'video' && a.peaks.length > 0 && <Wave peaks={a.peaks} from={c.trim_in} to={c.trim_out} />}
                      <span className="relative block truncate px-3 pt-0.5 text-[11px] font-medium text-primary">
                        {c.text ?? (c.label || a?.text || a?.name || 'Clip')}
                      </span>
                      <span
                        onPointerDown={(e) => begin(e, t.id, c, 'left')}
                        onPointerMove={move}
                        onPointerUp={end}
                        className={`${grip} left-0`}
                      >
                        <i className="h-4 w-1 rounded-[2px] bg-white shadow-sm" />
                      </span>
                      <span
                        onPointerDown={(e) => begin(e, t.id, c, 'right')}
                        onPointerMove={move}
                        onPointerUp={end}
                        className={`${grip} right-0`}
                      >
                        <i className="h-4 w-1 rounded-[2px] bg-white shadow-sm" />
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
            {!tracks.length && (
              <p className="px-4 py-6 text-[13px] text-muted">No tracks yet. Press + above to add one.</p>
            )}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-brand" style={{ left: time * pps }}>
              <i className="absolute -left-1 top-1 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brand" />
            </span>
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
    <button type="button" onClick={onClick} disabled={disabled} title={label} aria-label={label} className="focusable grid h-8 w-8 place-items-center rounded-full text-secondary transition-colors hover:bg-[var(--well)] hover:text-primary disabled:opacity-35">
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
    <svg aria-hidden viewBox={`0 0 ${n} 100`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full opacity-30">
      {bars.map((v, i) => (
        <rect key={i} x={i + 0.15} width={0.7} y={50 - v * 45} height={Math.max(2, v * 90)} fill="currentColor" className="text-primary" />
      ))}
    </svg>
  )
}
