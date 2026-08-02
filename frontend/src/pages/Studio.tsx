import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Uploader from '../components/Uploader'
import LanguageSelect from '../components/LanguageSelect'
import OptionToggle from '../components/OptionToggle'
import StageTimeline from '../components/StageTimeline'
import VideoCompare from '../components/VideoCompare'
import SegmentTable from '../components/SegmentTable'
import ResultMetrics from '../components/ResultMetrics'
import SignInRequired from '../components/SignInRequired'
import { AuthRequiredError, createJob, getHealth, getLanguages, pollJob, subscribeJob } from '../lib/api'
import { useSession } from '../lib/session-context'
import type { Health, Job, Language } from '../lib/types'

const QUALITIES = [
  { key: 'fast', label: 'Fast' },
  { key: 'balanced', label: 'Balanced' },
  { key: 'studio', label: 'Studio' },
]

const SAMPLE_LANGS = ['uz', 'ru', 'es', 'fr', 'de']

export default function Studio() {
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
  // Set when a call comes back 401 past the point authFetch can refresh —
  // i.e. the refresh token is gone or revoked too. Swaps the whole page for
  // the sign-in prompt rather than leaving a Studio that cannot do anything.
  const [expired, setExpired] = useState(false)
  const unsubRef = useRef<null | (() => void)>(null)
  const { invalidate } = useSession()

  useEffect(() => {
    getLanguages().then(setLanguages).catch(() => {})
    getHealth().then(setHealth).catch(() => {})
    return () => unsubRef.current?.()
  }, [])

  // choosing a file switches off sample mode
  useEffect(() => {
    if (file) setUseSample(false)
  }, [file])

  const running = job?.status === 'running' || job?.status === 'queued'
  const completed = job?.status === 'completed'
  const failed = job?.status === 'failed'

  const overall = useMemo(() => {
    if (!job) return 0
    const active = job.stages.filter((s) => s.status !== 'skipped')
    if (!active.length) return 0
    return Math.round((active.reduce((a, s) => a + s.progress, 0) / active.length) * 100)
  }, [job])

  const isSampleRun = useSample && !file
  const sampleLangNote = isSampleRun && !SAMPLE_LANGS.includes(targetLang)

  async function start() {
    setError(null)
    setBusy(true)
    setJob(null)
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
      // Live progress via SSE; if the stream drops (e.g. a proxy times out
      // during a long transcription), transparently fall back to polling.
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
      if (e instanceof AuthRequiredError) {
        invalidate()
        setExpired(true)
      } else {
        setError(e instanceof Error ? e.message : 'Failed to start job')
      }
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    unsubRef.current?.()
    setJob(null)
    setError(null)
  }

  if (expired) {
    return (
      <SignInRequired reason="Your session expired while you were away. Sign in again to keep dubbing." />
    )
  }

  return (
    <div className="wrap pb-8 pt-4">
      <div className="mb-8">
        <span className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-text-3">
          <span className="h-px w-6 bg-accent" />
          Dubbing Studio
        </span>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
          Dub a clip, <span className="text-accent">keep the voice</span>
        </h1>
        <p className="mt-3 max-w-2xl text-text-2">
          Upload a clip or run the built-in sample, pick a target language, keep
          the original voice, and optionally sync the lips. Watch the pipeline
          run stage by stage.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* ── Config panel ─────────────────────────────────────────── */}
        <div className="card h-fit space-y-6 p-5 lg:sticky lg:top-24">
          <div className="space-y-3">
            <GroupLabel n="01">Source</GroupLabel>
            <Uploader file={file} onFile={setFile} disabled={running} />
            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-text-2">
              <input
                type="checkbox"
                checked={isSampleRun}
                disabled={running}
                onChange={(e) => {
                  setUseSample(e.target.checked)
                  if (e.target.checked) setFile(null)
                }}
                className="h-4 w-4 accent-[var(--accent)]"
              />
              Use the built-in sample clip
            </label>
          </div>

          <div className="space-y-3 border-t border-line pt-5">
            <GroupLabel n="02">Languages</GroupLabel>
            <LanguageSelect
              label="Source language"
              languages={languages}
              value={sourceLang}
              onChange={setSourceLang}
              allowAuto
            />
            <LanguageSelect
              label="Target language"
              languages={languages}
              value={targetLang}
              onChange={setTargetLang}
            />
            {sampleLangNote && (
              <p className="rounded-lg border border-warn/20 bg-warn/[0.05] px-3 py-2 text-xs text-warn/80">
                The sample ships hand-authored translations for UZ, RU, ES, FR, DE.
                Pick one of those to hear a real translation, or upload your own clip
                for full NLLB translation.
              </p>
            )}
          </div>

          <div className="space-y-2.5 border-t border-line pt-5">
            <GroupLabel n="03">Options</GroupLabel>
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
              title="Keep background music & effects"
              description="Dub over the original music/ambience instead of replacing it; the original speech is removed (Demucs)."
              icon={<path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />}
            />
            <OptionToggle
              checked={lipSync}
              onChange={setLipSync}
              title="Lip sync (optional)"
              description="Reshape the speaker's mouth to match the translated speech (Wav2Lip)."
              icon={<path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />}
            />
          </div>

          <div className="space-y-3 border-t border-line pt-5">
            <GroupLabel n="04">Quality</GroupLabel>
            <div className="flex rounded-xl border border-line bg-white/[0.02] p-1">
              {QUALITIES.map((q) => (
                <button
                  key={q.key}
                  onClick={() => setQuality(q.key)}
                  disabled={running}
                  className={`focus-ring flex-1 rounded-lg px-3 py-2 font-mono text-sm font-medium transition-colors ${
                    quality === q.key
                      ? 'bg-accent-dim text-white shadow-[inset_0_0_0_1px_var(--accent)]'
                      : 'text-text-3 hover:text-white'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-text-3">
              {quality === 'fast' && 'Fastest — skips separation & voice cloning. Best for long videos.'}
              {quality === 'balanced' && 'Balanced — separation + voice cloning on.'}
              {quality === 'studio' && 'Highest fidelity — full pipeline. Best quality, slowest.'}
            </p>
          </div>

          <button
            onClick={start}
            disabled={busy || running}
            className="btn-primary focus-ring w-full py-3.5 text-sm"
          >
            {busy ? 'Starting…' : running ? `Dubbing… ${overall}%` : 'Start dubbing →'}
          </button>

          {health && (
            <p className="flex items-center justify-center gap-1.5 text-center font-mono text-[11px] text-text-3">
              <span className={`h-1.5 w-1.5 rounded-full ${health.stages.some((s) => s.mode === 'real') ? 'bg-ok' : 'bg-warn'}`} />
              {health.stages.filter((s) => s.mode === 'real').length > 0
                ? 'Pipeline online'
                : 'Simulation mode'}
            </p>
          )}
        </div>

        {/* ── Result / progress panel ──────────────────────────────── */}
        <div className="min-h-[30rem]">
          {error && (
            <div className="mb-4 rounded-xl border border-live/30 bg-live/10 px-5 py-4 text-sm text-live">
              {error}
            </div>
          )}

          {!job && !error && <EmptyState onSample={() => { setUseSample(true); setFile(null) }} />}

          {job && (
            <div className="space-y-5">
              {/* header */}
              <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-medium text-white">
                      {running ? 'Running pipeline' : completed ? 'Dub complete' : failed ? 'Pipeline failed' : 'Queued'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide ${job.simulated ? 'bg-warn/15 text-warn' : 'bg-ok/15 text-ok'}`}>
                      {job.simulated ? 'simulation' : 'live inference'}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-text-3">
                    job {job.id} · {job.filename ?? 'sample'} · → {targetLang.toUpperCase()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="font-mono text-2xl font-semibold text-white">{overall}%</div>
                    <div className="font-mono text-[10px] text-text-3">overall</div>
                  </div>
                  {(completed || failed) && (
                    <button onClick={reset} className="btn-ghost focus-ring px-4 py-2 text-sm">New dub</button>
                  )}
                </div>
              </div>

              {/* completed → results first */}
              {completed && (
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-5"
                >
                  <VideoCompare
                    sourceUrl={job.result.source_url ?? undefined}
                    outputUrl={job.result.output_url ?? undefined}
                    simulated={job.simulated}
                  />
                  {job.result.output_url && (
                    <a
                      href={job.result.output_url}
                      download
                      className="btn-primary focus-ring inline-flex px-5 py-2.5 text-sm"
                    >
                      ↓ Download dubbed video
                    </a>
                  )}
                  <ResultMetrics m={job.result.metrics} />
                  <SegmentTable segments={job.result.segments} />
                </motion.div>
              )}

              {/* stage timeline */}
              <div>
                <h3 className="mb-3 font-mono text-xs uppercase tracking-[0.14em] text-text-3">
                  Pipeline stages
                </h3>
                <StageTimeline stages={job.stages} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// Step numbers use the pixel font, matching how the landing page numbers its
// "how it works" steps.
function GroupLabel({ n, children }: { n: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="font-pixel text-[9px] text-accent">{n}</span>
      <span className="font-mono text-xs uppercase tracking-[0.14em] text-text-3">{children}</span>
    </div>
  )
}

function EmptyState({ onSample }: { onSample: () => void }) {
  return (
    <div className="card relative grid min-h-[30rem] place-items-center overflow-hidden p-10 text-center">
      {/* Dither field — the landing page's texture motif. */}
      <div
        aria-hidden="true"
        className="dither-dots z-base pointer-events-none absolute inset-0 text-accent/20 [mask-image:radial-gradient(circle_at_50%_45%,black,transparent_70%)]"
      />
      <div className="z-content relative">
        <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-xl border border-line bg-accent-dim p-4">
          <svg viewBox="0 0 24 24" className="h-full w-full text-accent" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-white">Your dub will appear here</h3>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-text-2">
          Configure the pipeline on the left and hit <span className="text-white">Start dubbing</span>.
          Every stage — transcription, translation, voice cloning, sync — streams
          live.
        </p>
        <button onClick={onSample} className="btn-ghost focus-ring mt-6 px-5 py-2.5 text-sm">
          Load the sample clip
        </button>
      </div>
    </div>
  )
}
