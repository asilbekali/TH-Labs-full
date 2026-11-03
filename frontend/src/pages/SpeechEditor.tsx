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
//   /editor          your dubs, to pick one
//   /editor/:jobId   the editor; `?lines=3,4` opens with those lines selected
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Page from '../components/Page'
import IssuesPanel from '../components/IssuesPanel'
import UpgradeGate from '../components/UpgradeGate'
import WorkThumb from '../components/WorkThumb'
import HowItWorks from '../components/HowItWorks'
import { SQUARED } from '../lib/shape'
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
    // No pill or capsule shapes on this page (lib/shape.ts).
    <Page className="mx-auto w-full max-w-5xl py-2 sm:py-6" style={SQUARED}>
      <p className="eyebrow">Speech editor</p>
      <h1 className="mt-2 text-[clamp(1.6rem,4vw,2.2rem)] font-medium leading-tight text-primary">
        Fix a line, <span className="gradient-text">not the whole video.</span>
      </h1>
      <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-secondary">
        Pick a dub. Correct a word or re-time a line, and only that section is re-voiced and
        put back — everything else stays exactly as it was.
      </p>

      <HowItWorks
        className="mt-6"
        steps={[
          {
            title: 'Pick a dub',
            body: 'Choose one of your finished dubs below. Its lines open on a timeline.',
          },
          {
            title: 'Fix the line',
            body: 'Click a line to change its words, or drag its edges to change when it is said.',
          },
          {
            title: 'Re-dub just that part',
            body: 'Press “Re-dub”. Only the changed lines are re-voiced; the rest stays as it is.',
          },
        ]}
      />

      <h2 className="mt-8 text-sm font-medium text-primary">Your dubs</h2>
      {!ready && done.length === 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Loading your dubs">
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
        <div className="card mt-3 flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm font-medium text-primary">No finished dubs yet</p>
          <p className="max-w-sm text-[13px] text-secondary">
            Dub a video in the Studio first. When it is done, it shows up here, ready to fix.
          </p>
          <Link to="/studio" className="btn-primary focusable inline-flex h-10 items-center px-5 text-sm">
            Dub a video
          </Link>
        </div>
      )}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {done.map((w) => (
          // The video, like My works: the frame is what an editor recognises
          // a dub by, not its file name.
          <Link
            key={w.id}
            to={`/editor/${w.id}`}
            style={SQUARED}
            className="card card-hover focusable group flex flex-col overflow-hidden"
          >
            <div className="relative aspect-video w-full overflow-hidden bg-black">
              <WorkThumb work={w} />
              {w.durationSec ? (
                <span className="absolute bottom-2 right-2 rounded-[6px] bg-black/60 px-1.5 py-0.5 font-mono text-[11px] text-white">
                  {ts(w.durationSec)}
                </span>
              ) : null}
              <span className="absolute inset-0 grid place-items-center bg-black/0 text-sm font-medium text-white opacity-0 transition-all duration-200 group-hover:bg-black/35 group-hover:opacity-100">
                ✎ Edit speech
              </span>
            </div>
            <div className="flex flex-col gap-1 p-3.5">
              <p className="truncate text-sm font-medium text-primary">{workTitle(w)}</p>
              <p className="font-mono text-[12px] text-muted">
                {w.sourceLang.toUpperCase()} → {w.targetLang.toUpperCase()} · {w.segments.length} lines ·{' '}
                {new Date(w.createdAt).toLocaleDateString()}
              </p>
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

  const sel = view.find((s) => s.id === selected) ?? null
  const version = (current?.version ?? 0) + 1

  return (
    <Page className="mx-auto flex w-full max-w-6xl flex-col gap-4 pb-28 lg:pb-6" style={SQUARED}>
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/editor" className="btn-primary focusable inline-flex h-9 items-center px-3 text-[13px]">
          ← Dubs
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-medium text-primary">{job.filename || 'Untitled video'}</h1>
          <p className="font-mono text-[12px] text-muted">
            {(job.result.detected_source_lang ?? job.options.source_lang).toUpperCase()} →{' '}
            {job.options.target_lang.toUpperCase()} · {segments.length} lines · version {version}
          </p>
        </div>
        {videoUrl && (
          <a href={videoUrl} download className="btn-primary focusable inline-flex h-9 items-center px-4 text-[13px]">
            ↓ Download
          </a>
        )}
      </div>

      <FirstTip />

      {editing && (
        <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-brand/30 bg-brand/[0.07] px-4 py-3 text-sm text-primary" aria-live="polite">
          <span className="eq" aria-hidden>
            <i /><i /><i /><i />
          </span>
          Re-dubbing only the changed section… {pending?.message}
        </div>
      )}
      {notice && !editing && (
        <div className="rounded-[var(--radius-control)] border border-success/30 bg-success/[0.07] px-4 py-3 text-sm text-primary" aria-live="polite">
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-[var(--radius-control)] border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-secondary" role="alert">
          {error}
        </div>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Player + timeline */}
        <div className="flex min-w-0 flex-col gap-4">
          <div className="card overflow-hidden">
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
              className="block aspect-video w-full bg-black"
            />
          </div>
          <LineTimeline
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
          />
          {sel && (
            <div className="card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-primary">Line #{sel.id + 1}</p>
                <div className="flex items-center gap-2">
                  <TimeField label="Start" value={sel.start} disabled={editing} onChange={(v) => setDraft(sel.id, { start: v })} />
                  <TimeField label="End" value={sel.end} disabled={editing} onChange={(v) => setDraft(sel.id, { end: v })} />
                </div>
              </div>
              <p className="mt-2 text-[13px] text-muted">{sel.source_text}</p>
              <textarea
                value={sel.target_text ?? ''}
                disabled={editing}
                onChange={(e) => setDraft(sel.id, { target_text: e.target.value })}
                rows={3}
                className="field mt-2 w-full resize-none text-sm leading-relaxed"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => playSection(sel)} className="btn-primary focusable h-8 px-3 text-[12px]">
                  ▶ Play this section
                </button>
                {drafts[sel.id] && (
                  <button type="button" onClick={() => revert(sel.id)} className="btn-primary focusable h-8 px-3 text-[12px]">
                    Undo changes
                  </button>
                )}
                <span className="text-[12px] text-muted">
                  {(sel.end - sel.start).toFixed(2)} s · {((sel.target_text ?? '').length / Math.max(sel.end - sel.start, 0.3)).toFixed(0)} chars/s
                </span>
              </div>
            </div>
          )}
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

        {/* Lines */}
        <div className="card flex min-h-0 min-w-0 flex-col overflow-hidden lg:max-h-[calc(100dvh-12rem)]">
          <div className="flex items-center justify-between gap-2 border-b border-subtle px-4 py-3">
            <h2 className="text-sm font-semibold text-primary">Lines</h2>
            <span className="text-xs text-muted">
              {edits.length ? `${edits.length} changed` : 'Click a line to edit it'}
            </span>
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
                  className={`px-4 py-3 transition-colors ${active ? 'bg-brand/[0.07]' : highlighted.has(s.id) ? 'bg-warn/[0.06]' : ''}`}
                >
                  <button type="button" onClick={() => setSelected(s.id)} className="focusable flex w-full items-center gap-2 text-left">
                    <span className={`font-mono text-[11px] ${playing ? 'text-brand' : 'text-muted'}`}>
                      #{s.id + 1} · {ts(s.start)}–{ts(s.end)}
                    </span>
                    {issue && (
                      <span className={`h-1.5 w-1.5 rounded-full ${issue === 'error' ? 'bg-danger' : issue === 'warning' ? 'bg-warn' : 'bg-info'}`} />
                    )}
                    {changed && <span className="chip ml-auto px-1.5 py-0 text-[10px] text-brand">edited</span>}
                    {current?.changed.includes(s.id) && !changed && (
                      <span className="chip ml-auto px-1.5 py-0 text-[10px] text-success">re-dubbed</span>
                    )}
                  </button>
                  <p className="mt-1 line-clamp-2 text-[12px] text-muted">{s.source_text}</p>
                  {active ? (
                    <textarea
                      value={s.target_text ?? ''}
                      disabled={editing}
                      onChange={(e) => setDraft(s.id, { target_text: e.target.value })}
                      rows={2}
                      autoFocus
                      className="field mt-1.5 w-full resize-none text-[13px] leading-relaxed"
                    />
                  ) : (
                    <p className={`mt-1 text-[13px] leading-relaxed ${s.target_text ? 'text-primary' : 'italic text-danger'}`}>
                      {s.target_text || 'No translation — nothing is spoken here'}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>

      {/* Apply bar */}
      <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+6.5rem)] z-30 lg:static lg:inset-auto">
        <div className="deep-card grain flex flex-wrap items-center gap-3 px-4 py-3">
          <span className="above min-w-0 flex-1 text-sm text-white">
            {edits.length
              ? `${edits.length} line${edits.length > 1 ? 's' : ''} changed — only ${edits.length > 1 ? 'those sections' : 'that section'} will be re-dubbed, in the standard voice for the language. Priced like text to speech.`
              : 'Change a line’s words or drag it on the timeline, then re-dub just that part.'}
          </span>
          {edits.length > 0 && !editing && (
            <button type="button" onClick={() => setDrafts({})} className="btn-primary focusable above h-10 px-4 text-[13px] opacity-80">
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={apply}
            disabled={!edits.length || editing}
            className="btn-primary focusable above h-10 px-5 text-sm disabled:opacity-50"
          >
            {editing
              ? 'Re-dubbing…'
              : edits.length
                ? `Re-dub ${edits.length} line${edits.length === 1 ? '' : 's'}`
                : 'Re-dub lines'}
          </button>
        </div>
      </div>
    </Page>
  )
}

const TIP_KEY = 'th-labs.tip.speech-editor'

/**
 * How to fix a line, in three steps — shown until the customer closes it, and
 * never again after that on this device.
 */
function FirstTip() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(TIP_KEY) !== 'closed'
    } catch {
      return true
    }
  })
  const close = () => {
    setOpen(false)
    try {
      localStorage.setItem(TIP_KEY, 'closed')
    } catch {
      /* the tip simply shows again next time */
    }
  }
  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25 }}
          className="overflow-hidden"
        >
          <div className="flex flex-wrap items-start gap-x-6 gap-y-2 rounded-[14px] border border-brand/25 bg-brand/[0.06] px-4 py-3 text-[13px] text-secondary">
            <p className="font-medium text-primary">How to fix a line</p>
            <p><span className="font-mono text-brand">1</span> Click the line on the right or on the timeline.</p>
            <p><span className="font-mono text-brand">2</span> Change its words, or drag its edges to move it.</p>
            <p><span className="font-mono text-brand">3</span> Press “Re-dub” — only that part is re-voiced.</p>
            <button
              type="button"
              onClick={close}
              className="focusable ml-auto text-[12px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Got it
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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

  const tick = total > 600 ? 60 : total > 120 ? 10 : total > 30 ? 5 : 1

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between gap-3 px-1">
        <span className="text-[12px] text-muted">Timeline · drag a line to move it, its edges to re-time it</span>
        <label className="flex items-center gap-2 text-[11px] text-muted">
          Zoom
          <input type="range" min={1} max={12} step={0.5} value={zoom} onChange={(e) => onZoom(Number(e.target.value))} className="w-24 accent-[var(--color-brand)]" />
        </label>
      </div>
      <div ref={wrap} className="no-scrollbar overflow-x-auto">
        <div
          className="relative h-[86px] select-none"
          style={{ width: Math.max(inner, width) }}
          onPointerDown={(e) => {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
            onSeek((e.clientX - rect.left) / pps)
          }}
        >
          {/* ruler */}
          <div className="absolute inset-x-0 top-0 h-5 border-b border-subtle">
            {Array.from({ length: Math.floor(total / tick) + 1 }, (_, i) => i * tick).map((t) => (
              <span key={t} className="absolute top-0 font-mono text-[10px] text-muted" style={{ left: t * pps + 2 }}>
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
            return (
              <div
                key={s.id}
                onPointerDown={(e) => begin(e, s, 'move')}
                onPointerMove={move}
                onPointerUp={() => (drag.current = null)}
                className={`group absolute top-7 h-[50px] cursor-grab overflow-hidden rounded-lg border px-2 py-1 active:cursor-grabbing ${tone} ${isSel ? 'ring-2 ring-brand' : ''}`}
                style={{ left: s.start * pps, width: Math.max((s.end - s.start) * pps, 6) }}
                title={s.target_text ?? ''}
              >
                <span className="block truncate font-mono text-[10px] text-muted">#{s.id + 1}</span>
                <span className="block truncate text-[11px] text-primary">{s.target_text || '—'}</span>
                {!disabled && (
                  <>
                    <span
                      onPointerDown={(e) => begin(e, s, 'start')}
                      className="absolute inset-y-0 left-0 w-2 cursor-ew-resize bg-brand/0 group-hover:bg-brand/50"
                    />
                    <span
                      onPointerDown={(e) => begin(e, s, 'end')}
                      className="absolute inset-y-0 right-0 w-2 cursor-ew-resize bg-brand/0 group-hover:bg-brand/50"
                    />
                  </>
                )}
              </div>
            )
          })}
          {/* playhead */}
          <span aria-hidden className="pointer-events-none absolute inset-y-0 w-px bg-brand" style={{ left: time * pps }} />
        </div>
      </div>
    </div>
  )
}
