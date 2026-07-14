import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import PipelineDiagram from '../components/PipelineDiagram'
import MetricsShowcase from '../components/MetricsShowcase'
import LanguageMarquee from '../components/LanguageMarquee'
import FeatureCard from '../components/FeatureCard'
import WaveBars from '../components/WaveBars'
import Reveal from '../components/Reveal'

const steps = [
  { n: '01', t: 'Transcribe', d: 'Source speech becomes text with timestamps that anchor every later stage.' },
  { n: '02', t: 'Translate', d: 'Each line is translated into the target language and scored for length so the dub fits the timing.' },
  { n: '03', t: 'Re-voice', d: 'The translation is spoken and cloned to the original speaker’s own voice.' },
  { n: '04', t: 'Sync & mux', d: 'Audio is time-aligned, the original background is kept, and everything is muxed back — optional lip sync.' },
]

const chips = ['Voice preserved', 'Background kept', '30+ languages', 'Optional lip sync']

export default function Landing() {
  return (
    <div>
      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-5 pt-12 pb-10 sm:pt-16">
        <div className="grid items-center gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="chip inline-flex items-center gap-2 px-3 py-1.5 text-xs text-white/70"
            >
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
              Cascaded ASR → NMT → TTS · voice preservation
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05 }}
              className="mt-5 text-4xl font-bold leading-[1.04] tracking-tight sm:text-6xl"
            >
              Dub any video.
              <br />
              Keep the <span className="gradient-text">original voice.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.12 }}
              className="mt-5 max-w-xl text-lg leading-relaxed text-white/60"
            >
              TH-Labs translates spoken video into 30+ languages while preserving
              the speaker’s own voice, the original background, and the timing of
              the performance — with optional lip sync.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.19 }}
              className="mt-7 flex flex-wrap items-center gap-3"
            >
              <Link to="/studio" className="btn-primary px-7 py-3.5 text-sm">
                Try the Studio →
              </Link>
              <Link to="/research" className="btn-ghost px-6 py-3.5 text-sm">
                Read the research
              </Link>
              <div className="ml-1 hidden items-center gap-3 text-white/50 sm:flex">
                <WaveBars bars={16} className="h-8 w-24" />
              </div>
            </motion.div>

            <div className="mt-8 flex flex-wrap gap-2">
              {chips.map((c) => (
                <span key={c} className="chip px-3 py-1.5 text-xs text-white/60">
                  {c}
                </span>
              ))}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className="relative"
          >
            <PipelineDiagram />
            <div className="pointer-events-none absolute -inset-6 -z-10 rounded-[2rem] bg-violet-600/20 blur-3xl" />
          </motion.div>
        </div>

        <div className="mt-10">
          <LanguageMarquee />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-5 py-12">
        <Reveal>
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight sm:text-4xl">
            Not just translated — <span className="gradient-text">re-voiced</span>.
          </h2>
          <p className="mt-3 max-w-2xl text-white/55">
            Conventional dubbing swaps in a stranger’s voice on a bare track.
            TH-Labs carries the speaker’s identity and the scene through the whole
            pipeline.
          </p>
        </Reveal>

        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <FeatureCard delay={0} title="Voice preservation" icon={<path d="M3 12h3l2-6 3 15 3-12 2 5h4" />}>
            The dub keeps the original speaker’s timbre, pitch and identity —
            re-voiced in their own voice, not a generic narrator.
          </FeatureCard>
          <FeatureCard delay={0.06} title="Background preserved" icon={<path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />}>
            Original music and effects stay in the mix — only the spoken words are
            replaced, so it’s dubbed, not flattened.
          </FeatureCard>
          <FeatureCard delay={0.12} title="Timing-locked" icon={<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>}>
            Translation length and pacing are constrained to the original, so audio
            and video stay in sync — imperceptibly aligned.
          </FeatureCard>
          <FeatureCard delay={0} title="Robust transcription" icon={<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>}>
            Voice-activity filtering isolates real speech, so noisy, real-world
            audio transcribes cleanly without invented text.
          </FeatureCard>
          <FeatureCard delay={0.06} title="Optional lip sync" icon={<path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />}>
            Reshape the speaker’s mouth to the translated speech for on-camera
            talent — or leave it off for lectures and voiceover.
          </FeatureCard>
          <FeatureCard delay={0.12} title="Live pipeline view" icon={<path d="M3 12h4l3 8 4-16 3 8h4" />}>
            Watch every stage run in real time in the Studio — transcript,
            translation, voice and mix — with per-stage status.
          </FeatureCard>
        </div>
      </section>

      {/* ── Metrics band — the single home for the research numbers ──── */}
      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="card overflow-hidden p-7 sm:p-9">
          <Reveal>
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                  Measured, not hand-waved.
                </h2>
                <p className="mt-2 max-w-xl text-white/55">
                  Evaluated end-to-end across transcription, translation,
                  naturalness, speaker identity and sync.
                </p>
              </div>
              <Link to="/research" className="btn-ghost px-5 py-2.5 text-sm">
                How we measured →
              </Link>
            </div>
          </Reveal>
          <div className="mt-7">
            <MetricsShowcase />
          </div>
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-5 py-12">
        <Reveal>
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Four stages, one voice
          </h2>
          <p className="mt-3 max-w-2xl text-white/55">
            A cascaded pipeline — each stage runs independently and chains
            end-to-end.
          </p>
        </Reveal>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {steps.map((s, i) => (
            <Reveal key={s.n} delay={i * 0.08}>
              <div className="card card-hover h-full p-6">
                <div className="font-mono text-sm text-violet-300/80">{s.n}</div>
                <h3 className="mt-3 text-lg font-semibold text-white">{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/55">{s.d}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── Ethics + CTA ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-5 py-12">
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Reveal>
            <div className="card relative h-full overflow-hidden p-8 sm:p-10">
              <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-cyan-400/10 blur-3xl" />
              <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
                Ready to hear it in another language?
              </h2>
              <p className="mt-3 max-w-md text-white/55">
                Upload a clip or run the built-in sample. Pick a target language,
                keep the voice and the background, and optionally sync the lips.
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/studio" className="btn-primary px-7 py-3.5 text-sm">
                  Open the Studio
                </Link>
                <Link to="/research" className="btn-ghost px-6 py-3.5 text-sm">
                  See the pipeline
                </Link>
              </div>
            </div>
          </Reveal>
          <Reveal delay={0.1}>
            <div className="card h-full border-amber-400/20 bg-amber-400/[0.03] p-8">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-amber-400/15 text-amber-300">
                <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
                </svg>
              </span>
              <h3 className="mt-4 text-lg font-semibold text-white">Consent-first by design</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">
                Voice cloning is used to re-voice a speaker’s own words for their
                own video. Any third-party use should carry explicit speaker
                consent and clear “AI-dubbed” labeling.
              </p>
            </div>
          </Reveal>
        </div>
      </section>
    </div>
  )
}
