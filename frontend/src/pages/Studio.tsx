import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import Uploader from '../components/Uploader'
import LanguageSelect from '../components/LanguageSelect'
import OptionToggle from '../components/OptionToggle'
import StageTimeline from '../components/StageTimeline'
import VideoCompare from '../components/VideoCompare'
import SegmentTable from '../components/SegmentTable'
import ResultMetrics from '../components/ResultMetrics'
import AnimatedNumber from '../components/AnimatedNumber'
import ScrollColumn from '../components/layout/ScrollColumn'
import Page from '../components/Page'
import LogoMark from '../components/brand/LogoMark'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { rise, stagger } from '../lib/motion'
import { createJob, getHealth, getLanguages, pollJob, subscribeJob, FALLBACK_HEALTH, FALLBACK_LANGUAGES } from '../lib/api'
import type { Health, Job, Language } from '../lib/types'
import { useWallet, QUALITY_COST } from '../lib/wallet'
import { canDub, commitDub } from '../lib/payments-api'
import { useWorks } from '../lib/works'

const QUALITIES = [
  { key: 'fast', label: 'Fast' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'studio', label: 'Studio' },
]

const SAMPLE_LANGS = ['uz', 'ru', 'es', 'fr', 'de']

// Best-effort source length for the credit gate. Sample clips are short (within
// the free-dub cap); for a real upload we read the media's metadata duration.
async function probeDurationSeconds(file: File | null): Promise<number> {
  if (!file) return 60
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file)
      const el = document.createElement('video')
      el.preload = 'metadata'
      el.onloadedmetadata = () => {
        URL.revokeObjectURL(url)
        resolve(Number.isFinite(el.duration) ? Math.round(el.duration) : 0)
      }
      el.onerror = () => {
        URL.revokeObjectURL(url)
        resolve(0)
      }
      el.src = url
    } catch {
      resolve(0)
    }
  })
}

export default function Studio() {
  const { balance } = useWallet()
  const { works, addWork } = useWorks()

  const [languages, setLanguages] = useState<Language[]>([])
  const [health, setHealth] = useState<Health | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [useSample, setUseSample] = useState(true)
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('es')
  const [voiceClone, setVoiceClone] = useState(true)
  const [lipSync, setLipSync] = useState(false)
  const [keepBackground, setKeepBackground] = useState(true)
  const [quality, setQuality] = useState('balanced')

  const [job, setJob] = useState<Job | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const unsubRef = useRef<null | (() => void)>(null)
  const savedRef = useRef<string | null>(null)

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => setLanguages(FALLBACK_LANGUAGES))
    getHealth().then(setHealth).catch(() => setHealth(FALLBACK_HEALTH))
    return () => unsubRef.current?.()
  }, [])

  useEffect(() => {
    if (file) setUseSample(false)
  }, [file])

  // Preset handoff from the Home launchpad (01): a quick-start card or a
  // template passes router state; apply it through the EXISTING setters only —
  // no new pipeline state is introduced here.
  const location = useLocation()
  const presetKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const s = location.state as
      | {
          preset?: 'video' | 'podcast' | 'voice'
          sourceLang?: string
          targetLang?: string
          voiceClone?: boolean
          lipSync?: boolean
          keepBackground?: boolean
          quality?: string
        }
      | null
    if (!s || location.key === presetKeyRef.current) return
    presetKeyRef.current = location.key
    if (s.preset === 'video') {
      setUseSample(true)
      setQuality('balanced')
    } else if (s.preset === 'podcast' || s.preset === 'voice') {
      setUseSample(true)
      setQuality('studio')
    }
    if (s.sourceLang) setSourceLang(s.sourceLang)
    if (s.targetLang) setTargetLang(s.targetLang)
    // "Duplicate these settings" from My works (03) hands the full config over
    // through router state; apply it via the EXISTING setters only.
    if (typeof s.voiceClone === 'boolean') setVoiceClone(s.voiceClone)
    if (typeof s.lipSync === 'boolean') setLipSync(s.lipSync)
    if (typeof s.keepBackground === 'boolean') setKeepBackground(s.keepBackground)
    if (s.quality) setQuality(s.quality)
  }, [location.key, location.state])

  const running = job?.status === 'running' || job?.status === 'queued'
  const completed = job?.status === 'completed'
  const failed = job?.status === 'failed'

  const overall = useMemo(() => {
    if (!job) return 0
    const active = job.stages.filter((s) => s.status !== 'skipped')
    if (!active.length) return 0
    return Math.round((active.reduce((a, s) => a + s.progress, 0) / active.length) * 100)
  }, [job])

  const stageProgress = useMemo(() => {
    if (!job) return { done: 0, total: 0 }
    const active = job.stages.filter((s) => s.status !== 'skipped')
    return { done: active.filter((s) => s.status === 'done').length, total: active.length }
  }, [job])

  // When a job finishes, record it in the user's works library (once).
  useEffect(() => {
    if (completed && job && savedRef.current !== job.id) {
      savedRef.current = job.id
      addWork({
        id: job.id,
        createdAt: Date.now(),
        filename: job.filename,
        sourceLang: job.result.detected_source_lang ?? sourceLang,
        targetLang,
        quality,
        simulated: job.simulated,
        outputUrl: job.result.output_url,
        sourceUrl: job.result.source_url,
        durationSec: job.result.duration,
        speakerSimilarity:
          job.result.metrics.speaker_similarity != null ? job.result.metrics.speaker_similarity / 100 : null,
      })
    }
  }, [completed, job, addWork, sourceLang, targetLang, quality])

  const isSampleRun = useSample && !file
  const sampleLangNote = isSampleRun && !SAMPLE_LANGS.includes(targetLang)
  const cost = QUALITY_COST[quality] ?? 10
  const canStart = !!(file || isSampleRun) && !!targetLang

  const lastWork = works[0]

  async function start() {
    setError(null)
    // Server-authoritative gate: the free dub, an active subscription, or enough
    // credits. Read-only — it charges nothing.
    const durationSeconds = await probeDurationSeconds(isSampleRun ? null : file)
    try {
      const gate = await canDub(durationSeconds, quality)
      if (!gate.allowed) {
        setError(
          gate.reason === 'FREE_DUB_LENGTH_EXCEEDED'
            ? `Your free dub covers clips up to 2 minutes — this one is longer. See Plans to continue.`
            : `Not enough credits — this ${quality} dub costs ${gate.cost}, you have ${gate.balance}. Top up in Plans.`,
        )
        return
      }
    } catch (e) {
      setError(
        e instanceof Error && /unauthor|401|session/i.test(e.message)
          ? 'Please sign in to start a dub.'
          : e instanceof Error
            ? e.message
            : 'Could not verify your credits.',
      )
      return
    }
    setBusy(true)
    setJob(null)
    savedRef.current = null
    unsubRef.current?.()
    try {
      const created = await createJob({
        target_lang: targetLang,
        source_lang: sourceLang,
        voice_clone: voiceClone,
        lip_sync: lipSync,
        keep_background: keepBackground,
        quality,
        sample: isSampleRun,
        file: isSampleRun ? null : file,
      })
      setJob(created)
      // The job exists — now actually charge it (or consume the free dub).
      // Idempotent on jobId; fire-and-forget so it never blocks the pipeline UI.
      void commitDub(created.id, durationSeconds, quality).catch(() => {})
      const stopSse = subscribeJob(
        created.id,
        (evt) => setJob(evt.job),
        () => {
          const stopPoll = pollJob(created.id, (j) => setJob(j))
          unsubRef.current = stopPoll
        },
      )
      unsubRef.current = stopSse
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start job')
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    unsubRef.current?.()
    setJob(null)
    setError(null)
  }

  function swapLangs() {
    if (sourceLang === 'auto') return
    setSourceLang(targetLang)
    setTargetLang(sourceLang)
  }

  // ── Presentation-only state (no pipeline logic) ──────────────────────────
  const isDesktop = useIsDesktop()
  const leftScrollRef = useRef<HTMLDivElement>(null)
  const rightScrollRef = useRef<HTMLDivElement>(null)

  // Reset both columns to the top when a run begins or the status changes (§7).
  useEffect(() => {
    rightScrollRef.current?.scrollTo({ top: 0 })
    leftScrollRef.current?.scrollTo({ top: 0 })
  }, [job?.status])

  // Elapsed clock while a run is live, for the repurposed Estimate card (§7).
  const [elapsed, setElapsed] = useState(0)
  const runStartRef = useRef<number | null>(null)
  useEffect(() => {
    if (!running) {
      runStartRef.current = null
      return
    }
    if (runStartRef.current == null) runStartRef.current = Date.now()
    const id = window.setInterval(() => {
      setElapsed(Date.now() - (runStartRef.current ?? Date.now()))
    }, 250)
    return () => window.clearInterval(id)
  }, [running])

  // Auto-advancing tips carousel (§7).
  const [tip, setTip] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setTip((t) => (t + 1) % TIPS.length), 6000)
    return () => window.clearInterval(id)
  }, [])

  const after = balance - cost
  const short = balance < cost
  const barPct = balance > 0 ? Math.min(100, Math.round((cost / balance) * 100)) : 100

  // ── Config cards (shared by desktop shell + mobile stack) ────────────────
  const configCards = (
    <>
      {/* 01 Source */}
      <div className="card space-y-3 p-5">
        <GroupLabel n="01" title="Source" />
        <Uploader file={file} onFile={setFile} disabled={running} />
        <button
          type="button"
          role="switch"
          aria-checked={isSampleRun}
          disabled={running}
          onClick={() => {
            const next = !isSampleRun
            setUseSample(next)
            if (next) setFile(null)
          }}
          className="focusable flex w-full items-center justify-between gap-2.5 rounded-control border border-subtle bg-sunken px-3.5 py-3 text-left text-sm text-secondary disabled:opacity-60"
        >
          <span>Use the built-in sample clip</span>
          <SwitchTrack on={isSampleRun} />
        </button>
      </div>

      {/* 02 Languages */}
      <div className="card space-y-3 p-5">
        <GroupLabel n="02" title="Languages" />
        <div className="relative space-y-3">
          <LanguageSelect label="Source language" languages={languages} value={sourceLang} onChange={setSourceLang} allowAuto />
          <div className="flex justify-center">
            <motion.button
              type="button"
              onClick={swapLangs}
              disabled={sourceLang === 'auto'}
              whileTap={{ rotate: 180 }}
              aria-label="Swap source and target languages"
              className="focusable -my-1 grid h-9 w-9 place-items-center rounded-full border border-subtle bg-surface text-secondary shadow-sm transition-colors hover:border-brand/50 hover:text-brand disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
              </svg>
            </motion.button>
          </div>
          <LanguageSelect label="Target language" languages={languages} value={targetLang} onChange={setTargetLang} />
        </div>
        {sampleLangNote && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warn/25 bg-warn/[0.07] px-3 py-2.5 text-xs text-warn">
            <span className="icon-tile mt-px h-6 w-6 shrink-0 bg-warn/15 text-warn">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              </svg>
            </span>
            <span className="flex-1 leading-relaxed">
              The sample ships hand-authored translations for UZ, RU, ES, FR, DE. Pick one of those to hear a real
              translation, or upload your own clip for full NLLB translation.
            </span>
          </div>
        )}
      </div>

      {/* 03 Options */}
      <div className="card space-y-2.5 p-5">
        <GroupLabel n="03" title="Options" />
        <OptionToggle
          checked={voiceClone}
          onChange={setVoiceClone}
          title="Voice cloning"
          description="Preserve the original speaker's voice instead of a generic narrator."
          icon={<path d="M3 12h3l2-6 3 15 3-12 2 5h4" />}
        />
        <OptionToggle
          checked={keepBackground}
          onChange={setKeepBackground}
          title="Keep background & effects"
          description="Dub over the original music/ambience instead of replacing it; the original speech is removed (Demucs)."
          icon={<path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />}
        />
        <OptionToggle
          checked={lipSync}
          onChange={setLipSync}
          accent="cyan"
          title="Lip sync (optional)"
          description="Reshape the speaker's mouth to match the translated speech (Wav2Lip)."
          icon={<path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />}
        />
      </div>

      {/* 04 Quality */}
      <div className="card space-y-3 p-5">
        <GroupLabel n="04" title="Quality" />
        <div className="flex rounded-control border border-subtle bg-sunken p-1">
          {QUALITIES.map((q) => (
            <button
              key={q.key}
              onClick={() => setQuality(q.key)}
              disabled={running}
              className="focusable relative flex-1 rounded-[10px] px-3 py-2 font-mono text-xs font-medium transition-colors"
            >
              {quality === q.key && (
                <motion.span
                  layoutId="quality-pill"
                  transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  className="absolute inset-0 rounded-[10px] bg-brand/15 shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.4)]"
                />
              )}
              <span className={`relative z-10 ${quality === q.key ? 'text-brand' : 'text-muted hover:text-primary'}`}>{q.label}</span>
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-relaxed text-muted">
          {quality === 'fast' && 'Fastest — skips separation & voice cloning. Best for long videos.'}
          {quality === 'balanced' && 'Balanced — separation + voice cloning on.'}
          {quality === 'studio' && 'Highest fidelity — full pipeline. Best quality, slowest.'}
        </p>
      </div>
    </>
  )

  // ── The pinned CTA footer (start button + pipeline health line) ──────────
  const ctaBlock = (
    <div className="space-y-2">
      <button
        onClick={start}
        disabled={busy || running || !canStart}
        title={!canStart ? 'Choose a source and a target language first' : undefined}
        className="btn-primary focusable w-full py-3.5 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'Starting…' : running ? `Dubbing… ${overall}%` : `Start dubbing · ${cost} →`}
      </button>
      {health && (
        <p className="flex items-center justify-center gap-1.5 text-center font-mono text-[11px] text-muted">
          <span className={`h-1.5 w-1.5 rounded-full ${health.stages.some((s) => s.mode === 'real') ? 'bg-success' : 'bg-warn'}`} />
          {health.stages.filter((s) => s.mode === 'real').length > 0 ? 'Pipeline online' : 'Simulation mode'}
        </p>
      )}
    </div>
  )

  // ── Right column content (idle blocks vs. live run) ──────────────────────
  const rightContent = (
    <>
      {error && (
        <div className="card border-danger/30 bg-danger/10 px-5 py-4 text-sm text-danger">{error}</div>
      )}

      <AnimatePresence mode="wait">
        {!job ? (
          <motion.div
            key="idle"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="space-y-4"
          >
            {/* Output empty state */}
            <div className="card relative grid h-[340px] place-items-center overflow-hidden p-8 text-center">
              <LogoMark className="pointer-events-none absolute -bottom-10 -right-10 h-[180px] w-[180px] text-primary/[0.045]" />
              <div className="relative">
                <h3 className="font-mono text-lg font-medium text-primary">Your dub will appear here</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm text-secondary">
                  Configure the pipeline on the left and start a run — every stage streams live.
                </p>
                <button onClick={() => { setUseSample(true); setFile(null) }} className="btn-ghost focusable mt-6 px-5 py-2.5 font-mono text-sm">
                  Load the sample clip →
                </button>
              </div>
            </div>

            {/* How it works */}
            <div className="card p-5">
              <SectionMark>How it works</SectionMark>
              <div className="mt-3 space-y-1">
                {pipelinePreview(voiceClone, lipSync, keepBackground, targetLang).map((s) => (
                  <div key={s.name} className={`flex items-center gap-3 rounded-xl px-2 py-1.5 ${s.skipped ? 'opacity-45' : ''}`}>
                    <span className={`icon-tile h-8 w-8 shrink-0 ${s.skipped ? 'bg-sunken text-muted' : 'bg-brand/12 text-brand'}`}>
                      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{s.icon}</svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className={`font-mono text-xs font-medium ${s.skipped ? 'text-muted line-through' : 'text-primary'}`}>{s.name}</span>
                      <span className="ml-2 text-xs text-secondary">· {s.desc}</span>
                    </div>
                    {s.skipped && <span className="rounded-full bg-sunken px-2 py-0.5 font-mono text-[10px] text-muted">skipped</span>}
                  </div>
                ))}
              </div>
            </div>

            {/* Estimate */}
            <div className="card p-5">
              <SectionMark>Estimate</SectionMark>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <div className="font-mono text-4xl font-medium text-primary">
                    <AnimatedNumber value={cost} />
                    <span className="ml-1.5 font-mono text-sm text-muted">credits</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted">{quality} run</div>
                </div>
                {short && (
                  <Link to="/plans" className="font-mono text-xs text-danger underline-offset-2 hover:underline">Top up in Plans →</Link>
                )}
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-sunken">
                <div
                  className={`h-full rounded-full ${short ? 'bg-danger' : ''}`}
                  style={{ width: `${barPct}%`, background: short ? undefined : 'var(--grad-brand)' }}
                />
              </div>
              <div className="mt-2 flex justify-between font-mono text-[11px] text-muted">
                <span>Balance {balance.toLocaleString()}</span>
                <span className={short ? 'text-danger' : ''}>After {after.toLocaleString()}</span>
              </div>
            </div>

            {/* Recent dubs */}
            {works.length > 0 && (
              <div className="card p-5">
                <div className="flex items-center justify-between">
                  <SectionMark>Recent dubs</SectionMark>
                  <Link to="/works" className="font-mono text-[11px] text-brand hover:underline">View all →</Link>
                </div>
                <div className="mt-3 space-y-2">
                  {works.slice(0, 3).map((w) => (
                    <div key={w.id} className="flex items-center gap-3">
                      <span className="h-10 w-14 shrink-0 rounded-lg" style={{ background: gradFor(w.id) }} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-primary">{w.filename ?? 'Sample dub'}</div>
                        <div className="font-mono text-[11px] text-muted">
                          {w.sourceLang.toUpperCase()}→{w.targetLang.toUpperCase()} · {fmtDur(w.durationSec)}
                        </div>
                      </div>
                      {w.outputUrl && (
                        <a href={w.outputUrl} download aria-label="Download" className="focusable grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-sunken hover:text-primary">
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" /></svg>
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tips */}
            <div className="card p-5">
              <SectionMark>Tips</SectionMark>
              <div className="mt-3 flex items-start gap-3">
                <span className="icon-tile mt-0.5 h-8 w-8 shrink-0 bg-warn/15 text-warn">
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor"><path d="m12 3 2.4 5.3 5.8.5-4.4 3.8 1.3 5.6L12 20.9 6.9 18.8l1.3-5.6L3.8 8.8l5.8-.5z" /></svg>
                </span>
                <AnimatePresence mode="wait">
                  <motion.p
                    key={tip}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.3 }}
                    className="min-h-[2.5rem] flex-1 text-sm text-secondary"
                  >
                    {TIPS[tip]}
                  </motion.p>
                </AnimatePresence>
              </div>
              <div className="mt-3 flex gap-1.5">
                {TIPS.map((_, i) => (
                  <button
                    key={i}
                    onClick={() => setTip(i)}
                    aria-label={`Tip ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${i === tip ? 'w-5 bg-brand' : 'w-1.5 bg-strong'}`}
                  />
                ))}
              </div>
            </div>
          </motion.div>
        ) : (
          <motion.div
            key="live"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
            className="space-y-4"
          >
            {/* Job header with ring progress */}
            <div className="card flex items-center justify-between gap-3 p-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-primary">
                    {running ? 'Running pipeline' : completed ? 'Dub complete' : failed ? 'Pipeline failed' : 'Queued'}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${job.simulated ? 'bg-warn/15 text-warn' : 'bg-success/15 text-success'}`}>
                    {job.simulated ? 'simulation' : 'live'}
                  </span>
                </div>
                <div className="mt-1 truncate font-mono text-xs text-muted">
                  job {job.id} · {job.filename ?? 'sample'} · →{targetLang.toUpperCase()}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <RingProgress value={overall} />
                {(completed || failed) && (
                  <button onClick={reset} className="btn-ghost focusable px-4 py-2 font-mono text-sm">New dub</button>
                )}
              </div>
            </div>

            {/* Estimate, repurposed during/after a run */}
            <div className="card flex items-center justify-between gap-3 p-5">
              <div>
                <SectionMark>Estimate</SectionMark>
                <div className="mt-2 font-mono text-sm text-secondary">
                  Spent <span className="text-primary">{cost}</span> · {stageProgress.done}/{stageProgress.total} stages
                </div>
              </div>
              <div className="text-right font-mono">
                <div className="text-2xl font-medium text-primary">{fmtElapsed(elapsed)}</div>
                <div className="text-[10px] uppercase tracking-[0.12em] text-muted">elapsed</div>
              </div>
            </div>

            {completed && (
              <div className="space-y-4">
                <VideoCompare
                  sourceUrl={job.result.source_url ?? undefined}
                  outputUrl={job.result.output_url ?? undefined}
                  simulated={job.simulated}
                />
                {job.result.output_url && (
                  <a href={job.result.output_url} download className="btn-primary focusable inline-flex px-5 py-2.5 font-mono text-sm">
                    ↓ Download dubbed video
                  </a>
                )}
                <ResultMetrics m={job.result.metrics} />
                <SegmentTable segments={job.result.segments} />
              </div>
            )}

            <div className="card p-5">
              <SectionMark>Pipeline stages</SectionMark>
              <div className="mt-3">
                <StageTimeline stages={job.stages} />
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )

  // ── Desktop: fixed two-column shell (§2) ─────────────────────────────────
  if (isDesktop) {
    return (
      <Page className="h-full min-h-0">
        <div className="grid h-full min-h-0 grid-cols-[380px_minmax(0,1fr)] gap-6">
          <aside className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
            <ScrollColumn ref={leftScrollRef} className="space-y-4 pr-0.5">
              {configCards}
            </ScrollColumn>
            <div className="pt-4">{ctaBlock}</div>
          </aside>
          <ScrollColumn ref={rightScrollRef} className="space-y-4 pr-0.5">
            {rightContent}
          </ScrollColumn>
        </div>
      </Page>
    )
  }

  // ── Mobile: single scrolling stack (§11) ─────────────────────────────────
  return (
    <Page className="space-y-4 pb-28">
      <motion.div variants={stagger} initial="hidden" animate="show" className="grid grid-cols-3 gap-3">
        <StatusChip tint="brand" label="Credits" value={`${balance}`} />
        <StatusChip tint={running ? 'warn' : 'cyan'} label="Pipeline" value={running ? `${stageProgress.done}/${stageProgress.total}` : completed ? 'Done' : 'Idle'} />
        <StatusChip tint="magenta" label="Last dub" value={lastWork ? `${lastWork.sourceLang.toUpperCase()}→${lastWork.targetLang.toUpperCase()}` : 'None'} />
      </motion.div>
      {configCards}
      {rightContent}
      {/* Fixed CTA bar above the tab bar */}
      <div className="glass fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+3.5rem)] z-30 flex items-center gap-3 px-4 py-2.5">
        <span className="font-mono text-sm text-secondary">{cost} credits</span>
        <button
          onClick={start}
          disabled={busy || running || !canStart}
          className="btn-primary focusable ml-auto px-6 py-2.5 font-mono text-sm disabled:opacity-60"
        >
          {busy ? 'Starting…' : running ? `Dubbing… ${overall}%` : 'Start dubbing →'}
        </button>
      </div>
    </Page>
  )
}

// ── Tips + pipeline preview data ───────────────────────────────────────────
const TIPS = [
  'Keep clips under a couple of minutes for the fastest turnaround.',
  'Voice cloning needs clear, single-speaker audio to match the original best.',
  'Lip sync earns its cost on close-up talking-head footage, less so on voiceover.',
  'The built-in sample ships translations for UZ, RU, ES, FR and DE.',
]

function pipelinePreview(voiceClone: boolean, lipSync: boolean, keepBackground: boolean, targetLang: string) {
  return [
    { name: 'Transcribe', desc: 'speech to text (Whisper)', icon: <path d="M4 6h16M4 12h10M4 18h7" />, skipped: false },
    { name: 'Translate', desc: `into ${targetLang.toUpperCase()} (NLLB)`, icon: <path d="M4 5h7M8 3v2c0 4-2 7-5 8m3-4c0 3 3 5 6 6M14 20l4-9 4 9M15.5 17h5" />, skipped: false },
    { name: 'Clone voice', desc: 'keep the speaker', icon: <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />, skipped: !voiceClone },
    { name: 'Sync lips', desc: 'match the mouth', icon: <path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />, skipped: !lipSync },
    { name: 'Mix', desc: 'keep music & effects', icon: <path d="M9 18V5l12-2v13M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />, skipped: !keepBackground },
  ]
}

// ── Small presentational helpers ───────────────────────────────────────────
function fmtDur(sec: number | null): string {
  if (sec == null) return '—'
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function gradFor(seed: string): string {
  let h = 0
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) % 360
  return `linear-gradient(135deg, hsl(${h} 68% 56%), hsl(${(h + 60) % 360} 68% 46%))`
}

// The animated 44×24 switch track (§9) — animates transform, not left.
function SwitchTrack({ on, accent }: { on: boolean; accent?: 'cyan' }) {
  return (
    <span
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors duration-200 ${
        on ? (accent === 'cyan' ? 'bg-cyan' : 'bg-brand') : 'bg-sunken shadow-[inset_0_0_0_1px_rgb(var(--c-border-strong))]'
      }`}
    >
      <motion.span
        className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow"
        animate={{ x: on ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 32 }}
      />
    </span>
  )
}

// Circular ring showing overall progress.
function RingProgress({ value }: { value: number }) {
  const r = 18
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid h-12 w-12 place-items-center">
      <svg viewBox="0 0 44 44" className="h-12 w-12 -rotate-90">
        <circle cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--c-border-subtle))" strokeWidth="3.5" />
        <motion.circle
          cx="22" cy="22" r={r} fill="none" stroke="rgb(var(--c-brand-500))" strokeWidth="3.5" strokeLinecap="round"
          strokeDasharray={c}
          animate={{ strokeDashoffset: c * (1 - value / 100) }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-medium text-primary">{value}</span>
    </div>
  )
}

function StatusChip({ tint, label, value }: { tint: 'brand' | 'cyan' | 'magenta' | 'warn'; label: string; value: string }) {
  const tintClass = { brand: 'text-brand', cyan: 'text-cyan', magenta: 'text-magenta', warn: 'text-warn' }[tint]
  return (
    <motion.div variants={rise} className="card p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{label}</div>
      <div className={`mt-0.5 truncate font-mono text-sm font-medium ${tintClass}`}>{value}</div>
    </motion.div>
  )
}

// `01 SOURCE` — index in brand, word in muted, uppercase mono (§4).
function GroupLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10px] text-brand">{n}</span>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">{title}</span>
    </div>
  )
}

// `/ SECTION` marker (§4).
function SectionMark({ children }: { children: ReactNode }) {
  return (
    <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">/ {children}</span>
  )
}
