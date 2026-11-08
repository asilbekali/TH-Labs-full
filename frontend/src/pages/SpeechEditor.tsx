// Speech editor — Studio Max.
//
// For agencies delivering dubs to a client: when a word comes out wrong, the
// fix must not cost a whole new dub. Here you open a finished video, correct
// the line (its words, its timing, or both), and only that section is
// re-voiced and spliced back in — POST /v1/speech-edits on the account API
// (api/src/speech-edit). Everything you did not touch stays exactly as it was.
// The dub itself is read from the dubbing pipeline; each correction is a new
// version kept by the account API.
//
// The everyday job is changing the words, so the screen is the video and its
// lines. Dragging lines on a timeline is behind "Adjust timing".
//
//   /editor          your dubs, to pick one
//   /editor/:jobId   the editor; `?lines=3,4` opens with those lines selected
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Page from '../components/Page'
import EditorIcon from '../components/EditorIcon'
import IssuesPanel from '../components/IssuesPanel'
import UpgradeGate from '../components/UpgradeGate'
import WorkThumb from '../components/WorkThumb'
import { EDITOR_SHAPE } from '../lib/shape'
import { getJob, mediaUrl } from '../lib/api'
import { usePlan } from '../lib/plan'
import {
  accountMediaUrl,
  createSpeechEdit,
  getDubIssues,
  listSpeechEdits,
  type LineEdit,
  type SpeechEditVersion,
} from '../lib/tools-api'
import type { Issue, Job, Segment } from '../lib/types'
import { useWorks, workTitle } from '../lib/works'

const POLL_MS = 1500
const MIN_LINE = 0.2
const SNAP = 0.05

function ts(sec: number, precise = false): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return precise
    ? `${m}:${s.toFixed(2).padStart(5, '0')}`
    : `${m}:${Math.floor(s).toString().padStart(2, '0')}`
}

const snap = (v: number) => Math.round(v / SNAP) * SNAP

export default function SpeechEditor() {
  const plan = usePlan()
  const { jobId } = useParams()
  if (!plan.loading && !plan.isMax) {
    return (
      <UpgradeGate
        tool="speechEditor"
        points={[
          'Fix a mispronounced word without re-dubbing the video',
          'Only the edited section is re-voiced; the rest stays untouched',
          'Drag a line on the timeline to re-time it',
          'Every problem found after a dub, with the fix',
          'Each fix is a new version — the earlier one stays playable',
          'Pay only for the seconds of speech re-voiced',
        ]}
      />
    )
  }
  return jobId ? <Editor jobId={jobId} /> : <DubList />
}

// ── The list ─────────────────────────────────────────────────────────────────

function DubList() {
  // The library the Studio keeps of every dub (GET /v1/works).
  const { works, ready } = useWorks()
  const done = works.filter((w) => w.status === 'completed')

  return (
    <Page className="mx-auto w-full max-w-5xl py-2 sm:py-6" style={EDITOR_SHAPE}>
      <h1 className="text-xl font-semibold tracking-tight text-primary">Speech editor</h1>
      <p className="mt-0.5 text-sm text-secondary">
        Choose a dub and change a line. Only that line is voiced again.
      </p>

      {!ready && done.length === 0 && (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading your dubs">
          {[0, 1, 2].map((i) => (
            <div key={i} className="card overflow-hidden">
              <div className="shimmer aspect-video bg-sunken" />
              <div className="space-y-2 p-3.5">
                <div className="shimmer h-3.5 w-2/3 rounded-[6px] bg-sunken" />
                <div className="shimmer h-3 w-1/2 rounded-[6px] bg-sunken" />
              </div>
            </div>
          ))}
        </div>
      )}
      {ready && done.length === 0 && (
        <div className="card mt-5 flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-primary">No finished dubs yet</p>
          <p className="max-w-sm text-[13px] text-secondary">
            Dub a video in the Studio first. When it is done, it shows up here, ready to fix.
          </p>
          <Link to="/studio" className="btn-primary focusable inline-flex h-10 items-center px-5 text-sm">
            Dub a video
          </Link>
        </div>
      )}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {done.map((w) => (
          // The video, like My works: the frame is what an editor recognises
          // a dub by, not its file name.
          <Link
            key={w.id}
            to={`/editor/${w.id}`}
            className="card card-hover focusable group flex flex-col overflow-hidden"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <WorkThumb work={w} />
              {w.durationSec ? (
                <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">
                  {ts(w.durationSec)}
                </span>
              ) : null}
            </div>
            <div className="flex items-center gap-2 p-3.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-primary">{workTitle(w)}</p>
                <p className="mt-0.5 text-[13px] text-muted">
                  {w.sourceLang.toUpperCase()} → {w.targetLang.toUpperCase()} · {w.segments.length} lines
                </p>
              </div>
              <span className="shrink-0 text-[13px] font-medium text-brand">Edit</span>
            </div>
          </Link>
        ))}
      </div>
    </Page>
  )
}

// ── The editor ───────────────────────────────────────────────────────────────

type Draft = { target_text?: string; start?: number; end?: number }

function Editor({ jobId }: { jobId: string }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [job, setJob] = useState<Job | null>(null)
  // Corrected versions of this dub, newest first (account API).
  const [versions, setVersions] = useState<SpeechEditVersion[]>([])
  const [issues, setIssues] = useState<Issue[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [selected, setSelected] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [time, setTime] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [showTiming, setShowTiming] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const stopAt = useRef<number | null>(null)
  const rowRefs = useRef<Record<number, HTMLLIElement | null>>({})
  const poll = useRef<number | null>(null)

  const highlighted = useMemo(
    () => new Set((params.get('lines') ?? '').split(',').filter(Boolean).map(Number)),
    [params],
  )

  const load = useCallback(async () => {
    try {
      const [j, v] = await Promise.all([getJob(jobId), listSpeechEdits(jobId)])
      setJob(j)
      setVersions(v)
      return v
    } catch (e) {
      setLoadError(
        e instanceof Error
          ? `${e.message} — this dub is no longer on the dubbing server, so it cannot be edited.`
          : 'Could not open this dub.',
      )
      return null
    }
  }, [jobId])

  // Poll while an edit is being applied; report how it ended.
  const watch = useCallback(() => {
    if (poll.current) window.clearTimeout(poll.current)
    poll.current = window.setTimeout(async () => {
      let v: SpeechEditVersion[]
      try {
        v = await listSpeechEdits(jobId)
      } catch {
        return watch()
      }
      setVersions(v)
      const newest = v[0]
      if (!newest) return
      if (newest.status === 'QUEUED' || newest.status === 'RUNNING') return watch()
      setSubmitting(false)
      if (newest.status === 'DONE') {
        setDrafts({})
        const n = newest.changed.length
        setNotice(
          `Re-dubbed ${n} line${n === 1 ? '' : 's'} — this is version ${newest.version + 1}.` +
            (newest.message ? ` ${newest.message}.` : ''),
        )
      } else {
        setError(newest.error ?? 'The edit could not be applied.')
      }
    }, POLL_MS)
  }, [jobId])

  useEffect(() => {
    void load().then((v) => {
      if (v?.[0] && (v[0].status === 'QUEUED' || v[0].status === 'RUNNING')) {
        setSubmitting(true)
        watch()
      }
    })
    getDubIssues(jobId)
      .then(setIssues)
      .catch(() => setIssues([]))
    return () => {
      if (poll.current) window.clearTimeout(poll.current)
    }
  }, [load, watch, jobId])

  // Open on the lines a "Fix these lines" link pointed at.
  useEffect(() => {
    if (!job || !highlighted.size) return
    const first = Math.min(...highlighted)
    setSelected(first)
    rowRefs.current[first]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [job, highlighted])

  // The dub as it stands: the newest finished correction, or the dub itself.
  const current = versions.find((v) => v.status === 'DONE') ?? null
  const segments = useMemo(
    () => current?.segments ?? job?.result.segments ?? [],
    [current, job],
  )
  const videoUrl = current ? accountMediaUrl(current.outputUrl) : mediaUrl(job?.result.output_url ?? null)
  const pending = versions[0] && (versions[0].status === 'QUEUED' || versions[0].status === 'RUNNING')
    ? versions[0]
    : null
  const duration = job?.result.duration ?? (segments.length ? segments[segments.length - 1].end : 0)

  // The transcript as it will be after the drafts are applied.
  const view: Segment[] = useMemo(
    () =>
      segments.map((s) => {
        const d = drafts[s.id]
        return d
          ? { ...s, target_text: d.target_text ?? s.target_text, start: d.start ?? s.start, end: d.end ?? s.end }
          : s
      }),
    [segments, drafts],
  )

  const edits: LineEdit[] = useMemo(() => {
    const out: LineEdit[] = []
    for (const s of segments) {
      const d = drafts[s.id]
      if (!d) continue
      const e: LineEdit = { id: s.id }
      const text = d.target_text?.trim()
      if (text !== undefined && text !== (s.target_text ?? '').trim()) e.target_text = text
      if (d.start !== undefined && Math.abs(d.start - s.start) > 1e-3) e.start = d.start
      if (d.end !== undefined && Math.abs(d.end - s.end) > 1e-3) e.end = d.end
      if (Object.keys(e).length > 1) out.push(e)
    }
    return out
  }, [segments, drafts])

  const issueLines = useMemo(() => {
    const m = new Map<number, 'error' | 'warning' | 'info'>()
    for (const i of issues) {
      for (const id of i.segment_ids) {
        const cur = m.get(id)
        if (!cur || (cur !== 'error' && i.severity === 'error')) m.set(id, i.severity)
      }
    }
    return m
  }, [issues])

  const editing = submitting || !!pending

  function setDraft(id: number, patch: Draft) {
    setDrafts((d) => ({ ...d, [id]: { ...d[id], ...patch } }))
  }

  function revert(id: number) {
    setDrafts((d) => {
      const n = { ...d }
      delete n[id]
      return n
    })
  }

  function playSection(s: Segment) {
    const v = videoRef.current
    if (!v) return
    v.currentTime = Math.max(0, s.start - 0.15)
    stopAt.current = s.end + 0.3
    void v.play()
  }

  function seek(t: number) {
    const v = videoRef.current
    if (!v) return
    stopAt.current = null
    v.currentTime = Math.max(0, Math.min(duration, t))
  }

  async function apply() {
    if (!edits.length || editing) return
    setError(null)
    setNotice(null)
    setSubmitting(true)
    try {
      const created = await createSpeechEdit(jobId, edits)
      setVersions((v) => [created, ...v])
      watch()
    } catch (e) {
      setSubmitting(false)
      setError(e instanceof Error ? e.message : 'The edit could not be applied.')
    }
  }

  if (loadError) {
    return (
      <Page className="mx-auto max-w-xl py-10 text-center">
        <p className="text-sm text-danger">{loadError}</p>
        <button type="button" onClick={() => navigate('/editor')} className="btn-primary focusable mt-4 h-10 px-5 text-sm">
          Back to your dubs
        </button>
      </Page>
    )
  }
  if (!job) return <Page className="card mx-auto mt-6 h-64 max-w-5xl animate-pulse">{null}</Page>

  const version = (current?.version ?? 0) + 1

  return (
    <Page className="flex w-full min-w-0 flex-col gap-3 pb-28 lg:pb-6 xl:h-full xl:pb-0" style={EDITOR_SHAPE}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/editor" aria-label="Back to your dubs" title="Back to your dubs" className="btn-ghost focusable grid h-9 w-9 shrink-0 place-items-center rounded-full!">
          <EditorIcon name="back" className="h-4 w-4" />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-[15px] font-medium text-primary">{job.filename || 'Untitled video'}</h1>
          <p className="text-[12px] text-muted">
            {(job.result.detected_source_lang ?? job.options.source_lang).toUpperCase()} →{' '}
            {job.options.target_lang.toUpperCase()}
            {version > 1 && ` · version ${version}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowTiming((v) => !v)}
          aria-pressed={showTiming}
          className={`btn-ghost focusable h-9 rounded-full! px-4 text-[13px] ${showTiming ? 'text-primary' : ''}`}
        >
          {showTiming ? 'Hide timing' : 'Adjust timing'}
        </button>
        {videoUrl && (
          <a href={videoUrl} download className="btn-primary focusable inline-flex h-9 items-center gap-1.5 px-4 text-[13px]">
            <EditorIcon name="download" className="h-4 w-4" /> Download
          </a>
        )}
      </div>

      {editing && (
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-brand/30 bg-brand/[0.07] px-4 py-2.5 text-sm text-primary" aria-live="polite">
          <span className="eq" aria-hidden>
            <i /><i /><i /><i />
          </span>
          Re-dubbing only the changed section… {pending?.message}
        </div>
      )}
      {notice && !editing && (
        <div className="rounded-[var(--radius-control)] border border-success/30 bg-success/[0.07] px-4 py-2.5 text-sm text-primary" aria-live="polite">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-[var(--radius-control)] border border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-secondary" role="alert">
          {error}
        </div>
      )}

      <div className="grid min-h-0 min-w-0 flex-1 gap-3 [grid-template-areas:'video'_'time'_'lines'] xl:grid-cols-[minmax(0,1fr)_380px] xl:grid-rows-[minmax(0,1fr)_auto] xl:[grid-template-areas:'video_lines'_'time_lines']">
        <div className="card min-h-0 min-w-0 overflow-hidden bg-black [grid-area:video]">
          <video
            key={videoUrl ?? ''}
            ref={videoRef}
            src={videoUrl}
            controls
            playsInline
            onTimeUpdate={(e) => {
              const t = e.currentTarget.currentTime
              setTime(t)
              if (stopAt.current !== null && t >= stopAt.current) {
                e.currentTarget.pause()
                stopAt.current = null
              }
            }}
            className="block aspect-video w-full bg-black xl:aspect-auto xl:h-full"
          />
        </div>
        {showTiming && <LineTimeline
          segments={view}
          duration={duration}
          time={time}
          zoom={zoom}
          onZoom={setZoom}
          selected={selected}
          edited={new Set(edits.map((e) => e.id))}
          issues={issueLines}
          onSelect={(id) => {
            setSelected(id)
            rowRefs.current[id]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
          }}
          onSeek={seek}
          onRetime={(id, start, end) => setDraft(id, { start, end })}
          disabled={editing}
        />}

        <div className="flex min-h-0 min-w-0 flex-col gap-3 [grid-area:lines]">
          {/* Only there when something needs a look, and folded until asked. */}
          {issues.length > 0 && (
            <details className="card shrink-0 overflow-hidden">
              <summary className="focusable cursor-pointer px-4 py-2.5 text-[13px] font-medium text-primary">
                {issues.length} thing{issues.length === 1 ? '' : 's'} to check
              </summary>
              <div className="max-h-64 overflow-y-auto border-t border-subtle p-2">
                <IssuesPanel
                  issues={issues}
                  segments={segments}
                  canEditLines
                  compact
                  onFocusLine={(id) => {
                    setSelected(id)
                    const s = segments.find((x) => x.id === id)
                    if (s) seek(s.start)
                    rowRefs.current[id]?.scrollIntoView({ block: 'center', behavior: 'smooth' })
                  }}
                />
              </div>
            </details>
          )}

          {/* Lines */}
          <div className="card flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <div className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-2.5">
              <h2 className="text-sm font-medium text-primary">Lines</h2>
              <span className="text-[13px] text-muted">Click a line to change it</span>
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-[var(--card-edge)] overflow-y-auto">
              {view.map((s) => {
                const issue = issueLines.get(s.id)
                const changed = edits.some((e) => e.id === s.id)
                const active = selected === s.id
                const playing = time >= s.start && time < s.end
                return (
                  <li
                    key={s.id}
                    ref={(el) => {
                      rowRefs.current[s.id] = el
                    }}
                    className={`transition-colors ${active ? 'bg-brand/[0.07]' : highlighted.has(s.id) ? 'bg-warn/[0.06]' : ''}`}
                  >
                    <button type="button" onClick={() => setSelected(s.id)} className="focusable block w-full px-4 pb-1 pt-3 text-left">
                      <span className="flex items-center gap-2">
                        <span className={`text-[12px] ${playing ? 'text-brand' : 'text-muted'}`}>{ts(s.start)}</span>
                        {issue && (
                          <span className={`h-1.5 w-1.5 rounded-full ${issue === 'error' ? 'bg-danger' : issue === 'warning' ? 'bg-warn' : 'bg-info'}`} />
                        )}
                        {changed && <span className="chip ml-auto px-1.5 py-0 text-[11px] text-brand">Changed</span>}
                        {current?.changed.includes(s.id) && !changed && (
                          <span className="chip ml-auto px-1.5 py-0 text-[11px] text-success">Fixed</span>
                        )}
                      </span>
                      {!active && (
                        <span className={`mt-1 block pb-2 text-[13px] leading-relaxed ${s.target_text ? 'text-primary' : 'italic text-danger'}`}>
                          {s.target_text || 'Nothing is spoken here'}
                        </span>
                      )}
                    </button>
                    {active && (
                      <div className="flex flex-col gap-2 px-4 pb-3">
                        <p className="text-[13px] leading-relaxed text-muted">{s.source_text}</p>
                        <textarea
                          value={s.target_text ?? ''}
                          disabled={editing}
                          onChange={(e) => setDraft(s.id, { target_text: e.target.value })}
                          rows={3}
                          autoFocus
                          className="field w-full rounded-[12px]! resize-none text-[13px] leading-relaxed"
                        />
                        <div className="flex flex-wrap items-center gap-2">
                          <button type="button" onClick={() => playSection(s)} className="btn-ghost focusable inline-flex h-8 items-center gap-1.5 rounded-full! px-3.5 text-[12px]">
                            <EditorIcon name="play" className="h-3 w-3" /> Play
                          </button>
                          {drafts[s.id] && (
                            <button type="button" onClick={() => revert(s.id)} className="btn-ghost focusable h-8 rounded-full! px-3.5 text-[12px]">
                              Undo
                            </button>
                          )}
                        </div>
                        <details className="text-[12px] text-muted">
                          <summary className="focusable cursor-pointer py-0.5">Exact timing</summary>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <TimeField label="Start" value={s.start} disabled={editing} onChange={(v) => setDraft(s.id, { start: v })} />
                            <TimeField label="End" value={s.end} disabled={editing} onChange={(v) => setDraft(s.id, { end: v })} />
                          </div>
                        </details>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>

          {/* Apply bar: only once there is something to apply. */}
          {(edits.length > 0 || editing) && (
            <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-30 shrink-0 lg:sticky lg:inset-x-auto lg:bottom-2 xl:static">
              <div className="card flex flex-col gap-2 p-3 shadow-[var(--shadow-lg)] xl:shadow-none">
                <p className="text-[12px] leading-relaxed text-secondary">
                  Only {edits.length === 1 ? 'this line changes' : 'these lines change'}. It uses the standard voice and costs the same as text to speech.
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={apply}
                    disabled={!edits.length || editing}
                    className="btn-primary focusable h-10 flex-1 px-5 text-sm disabled:opacity-50"
                  >
                    {editing ? 'Saving…' : `Save ${edits.length} line${edits.length === 1 ? '' : 's'}`}
                  </button>
                  {!editing && (
                    <button type="button" onClick={() => setDrafts({})} className="focusable px-2 text-[13px] text-muted hover:text-primary">
                      Discard
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}

function TimeField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string
  value: number
  onChange: (v: number) => void
  disabled?: boolean
}) {
  return (
    <label className="flex items-center gap-1.5 text-[11px] text-muted">
      {label}
      <input
        type="number"
        step={SNAP}
        min={0}
        value={Number(value.toFixed(2))}
        disabled={disabled}
        onChange={(e) => {
          const v = parseFloat(e.target.value)
          if (Number.isFinite(v)) onChange(Math.max(0, v))
        }}
        className="field h-8 w-[5.5rem] px-2 font-mono text-[12px]"
      />
    </label>
  )
}

// ── The line timeline ────────────────────────────────────────────────────────
// Every line as a block at its time. Drag a block to move it, drag either edge
// to change its length; a line cannot be dragged over its neighbours, because
// each line owns the stretch up to the next one when it is re-voiced.

function LineTimeline({
  segments,
  duration,
  time,
  zoom,
  onZoom,
  selected,
  edited,
  issues,
  onSelect,
  onSeek,
  onRetime,
  disabled,
}: {
  segments: Segment[]
  duration: number
  time: number
  zoom: number
  onZoom: (z: number) => void
  selected: number | null
  edited: Set<number>
  issues: Map<number, 'error' | 'warning' | 'info'>
  onSelect: (id: number) => void
  onSeek: (t: number) => void
  onRetime: (id: number, start: number, end: number) => void
  disabled: boolean
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(600)
  const drag = useRef<{
    id: number
    mode: 'move' | 'start' | 'end'
    x0: number
    start: number
    end: number
    lo: number
    hi: number
  } | null>(null)

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const total = Math.max(duration, 1)
  const pps = (width / total) * zoom
  const inner = total * pps

  function begin(e: ReactPointerEvent, s: Segment, mode: 'move' | 'start' | 'end') {
    if (disabled) return
    e.stopPropagation()
    const i = segments.findIndex((x) => x.id === s.id)
    drag.current = {
      id: s.id,
      mode,
      x0: e.clientX,
      start: s.start,
      end: s.end,
      lo: i > 0 ? segments[i - 1].end : 0,
      hi: i + 1 < segments.length ? segments[i + 1].start : total,
    }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    onSelect(s.id)
  }

  function move(e: ReactPointerEvent) {
    const d = drag.current
    if (!d) return
    const dt = (e.clientX - d.x0) / pps
    let { start, end } = d
    if (d.mode === 'move') {
      const len = d.end - d.start
      start = Math.min(Math.max(d.lo, snap(d.start + dt)), d.hi - len)
      end = start + len
    } else if (d.mode === 'start') {
      start = Math.min(Math.max(d.lo, snap(d.start + dt)), d.end - MIN_LINE)
    } else {
      end = Math.max(Math.min(d.hi, snap(d.end + dt)), d.start + MIN_LINE)
    }
    onRetime(d.id, Number(start.toFixed(3)), Number(end.toFixed(3)))
  }

  // Labels at least 48px apart, whatever the screen and the zoom.
  const tick = [1, 2, 5, 10, 30, 60, 120, 300].find((t) => t * pps >= 48) ?? 600

  return (
    <div className="card flex min-w-0 flex-col overflow-hidden [grid-area:time]">
      <div className="flex items-center justify-between gap-3 border-b border-subtle px-3 py-1.5">
        <span className="text-[12px] text-muted">Drag a line to move it</span>
        <input
          type="range"
          min={1}
          max={12}
          step={0.5}
          value={zoom}
          onChange={(e) => onZoom(Number(e.target.value))}
          aria-label="Zoom"
          title="Zoom"
          className="w-24 accent-[var(--color-brand)]"
        />
      </div>
      <div ref={wrap} className="no-scrollbar overflow-x-auto">
        <div
          className="relative h-[84px] select-none"
          style={{ width: Math.max(inner, width) }}
          onPointerDown={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onSeek((e.clientX - rect.left) / pps)
          }}
        >
          {/* ruler */}
          <div className="absolute inset-x-0 top-0 h-6 border-b border-subtle">
            {Array.from({ length: Math.floor(total / tick) + 1 }, (_, i) => i * tick).map((t) => (
              <span key={t} className="absolute top-0 font-mono text-[10px] leading-6 text-muted" style={{ left: t * pps + 4 }}>
                {ts(t)}
              </span>
            ))}
          </div>
          {/* lines */}
          {segments.map((s) => {
            const issue = issues.get(s.id)
            const isSel = selected === s.id
            const tone = edited.has(s.id)
              ? 'border-brand bg-brand/25'
              : issue === 'error'
                ? 'border-danger/70 bg-danger/20'
                : issue === 'warning'
                  ? 'border-warn/70 bg-warn/15'
                  : 'border-[var(--card-edge)] bg-[var(--well)]'
            const grip = isSel ? '' : 'opacity-0 group-hover:opacity-100'
            return (
              <div
                key={s.id}
                onPointerDown={(e) => begin(e, s, 'move')}
                onPointerMove={move}
                onPointerUp={() => (drag.current = null)}
                className={`group absolute top-[34px] h-10 cursor-grab overflow-hidden rounded-[8px] border active:cursor-grabbing ${tone} ${isSel ? 'ring-2 ring-brand' : ''}`}
                style={{ left: s.start * pps, width: Math.max((s.end - s.start) * pps, 6) }}
                title={s.target_text ?? ''}
              >
                <span className="block truncate px-3 text-[12px] leading-[38px] text-primary">{s.target_text || '—'}</span>
                {!disabled && (
                  <>
                    <span
                      onPointerDown={(e) => begin(e, s, 'start')}
                      className={`absolute inset-y-0 left-0 grid w-2.5 cursor-ew-resize place-items-center ${grip}`}
                    >
                      <i className="h-4 w-1 rounded-[2px] bg-white shadow-sm" />
                    </span>
                    <span
                      onPointerDown={(e) => begin(e, s, 'end')}
                      className={`absolute inset-y-0 right-0 grid w-2.5 cursor-ew-resize place-items-center ${grip}`}
                    >
                      <i className="h-4 w-1 rounded-[2px] bg-white shadow-sm" />
                    </span>
                  </>
                )}
              </div>
            )
          })}
          {/* playhead */}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-brand" style={{ left: time * pps }}>
            <i className="absolute -left-1 top-1 h-2.5 w-2.5 rotate-45 rounded-[2px] bg-brand" />
          </span>
        </div>
      </div>
    </div>
  )
}
