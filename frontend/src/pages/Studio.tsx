import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import Uploader from '../components/Uploader'
import LanguageSelect from '../components/LanguageSelect'
import OptionToggle from '../components/OptionToggle'
import StageTimeline from '../components/StageTimeline'
import VideoCompare from '../components/VideoCompare'
import SegmentTable from '../components/SegmentTable'
import ResultMetrics from '../components/ResultMetrics'
import { createJob, getHealth, getLanguages, pollJob, subscribeJob } from '../lib/api'
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
  const unsubRef = useRef<null | (() => void)>(null)

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

  return (
    <div className="mx-auto max-w-7xl px-5 pt-12 pb-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Dubbing Studio</h1>
        <p className="mt-2 max-w-2xl text-white/55">
          Upload a clip or run the built-in sample, pick a target language, keep
          the original voice, and optionally sync the lips. Watch the pipeline
          run stage by stage.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
        {/* ── Config panel ─────────────────────────────────────────── */}
        <div className="card h-fit space-y-5 p-5 lg:sticky lg:top-24">
          <Uploader file={file} onFile={setFile} disabled={running} />

          <label className="flex cursor-pointer items-center gap-2.5 text-sm text-white/70">
            <input
              type="checkbox"
              checked={isSampleRun}
              disabled={running}
              onChange={(e) => {
                setUseSample(e.target.checked)
                if (e.target.checked) setFile(null)
              }}
              className="h-4 w-4 accent-violet-500"
            />
            Use the built-in sample clip
          </label>

          <div className="grid gap-3">
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
          </div>

          {sampleLangNote && (
            <p className="rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2 text-xs text-amber-200/80">
              The sample ships hand-authored translations for UZ, RU, ES, FR, DE.
              Pick one of those to hear a real translation, or upload your own clip
              for full NLLB translation.
            </p>
          )}

          <div className="space-y-2.5">
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
              accent="cyan"
              title="Lip sync (optional)"
              description="Reshape the speaker's mouth to match the translated speech (Wav2Lip)."
              icon={<path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-white/50">Quality</label>
            <div className="flex rounded-xl border border-white/10 bg-white/[0.02] p-1">
              {QUALITIES.map((q) => (
                <button
                  key={q.key}
                  onClick={() => setQuality(q.key)}
                  disabled={running}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                    quality === q.key ? 'bg-violet-500/20 text-white' : 'text-white/50 hover:text-white'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-white/40">
              {quality === 'fast' && 'Whisper base · skips separation & voice cloning — fastest, best for long videos.'}
              {quality === 'balanced' && 'Whisper small + separation + voice cloning — balanced.'}
              {quality === 'studio' && 'Whisper medium (paper) + separation + cloning — best, slowest.'}
            </p>
          </div>

          <button
            onClick={start}
            disabled={busy || running}
            className="btn-primary w-full py-3.5 text-sm disabled:opacity-60"
          >
            {busy ? 'Starting…' : running ? `Dubbing… ${overall}%` : 'Start dubbing →'}
          </button>

          {health && (
            <p className="flex items-center justify-center gap-1.5 text-center text-[11px] text-white/35">
              <span className={`h-1.5 w-1.5 rounded-full ${health.stages.some((s) => s.mode === 'real') ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              {health.stages.filter((s) => s.mode === 'real').length > 0
                ? 'Pipeline online'
                : 'Simulation mode'}
            </p>
          )}
        </div>

        {/* ── Result / progress panel ──────────────────────────────── */}
        <div className="min-h-[30rem]">
          {error && (
            <div className="mb-4 rounded-2xl border border-red-400/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
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
                    <span className="text-sm font-semibold text-white">
                      {running ? 'Running pipeline' : completed ? 'Dub complete' : failed ? 'Pipeline failed' : 'Queued'}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${job.simulated ? 'bg-amber-400/15 text-amber-300' : 'bg-emerald-400/15 text-emerald-300'}`}>
                      {job.simulated ? 'simulation' : 'live inference'}
                    </span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-white/40">
                    job {job.id} · {job.filename ?? 'sample'} · → {targetLang.toUpperCase()}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <div className="text-2xl font-bold text-white">{overall}%</div>
                    <div className="text-[10px] text-white/40">overall</div>
                  </div>
                  {(completed || failed) && (
                    <button onClick={reset} className="btn-ghost px-4 py-2 text-sm">New dub</button>
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
                      className="btn-primary inline-flex px-5 py-2.5 text-sm"
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
                <h3 className="mb-3 text-sm font-semibold text-white/70">Pipeline stages</h3>
                <StageTimeline stages={job.stages} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function EmptyState({ onSample }: { onSample: () => void }) {
  return (
    <div className="card grid min-h-[30rem] place-items-center p-10 text-center">
      <div>
        <div className="mx-auto mb-5 h-16 w-16 rounded-2xl bg-gradient-to-br from-violet-500/25 to-cyan-400/10 p-4">
          <svg viewBox="0 0 24 24" className="h-full w-full text-violet-200" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-white">Your dub will appear here</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm text-white/50">
          Configure the pipeline on the left and hit <span className="text-white">Start dubbing</span>.
          Every stage — transcription, translation, voice cloning, sync — streams
          live.
        </p>
        <button onClick={onSample} className="btn-ghost mt-6 px-5 py-2.5 text-sm">
          Load the sample clip
        </button>
      </div>
    </div>
  )
}
