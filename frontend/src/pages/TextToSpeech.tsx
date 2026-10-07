// Text to speech — a placeholder for the next product, reachable from the
// sidebar so people can find it before it ships.
//
// Nothing here calls an API. The text box and voice picker are shown as a
// preview of the shape of the tool and are disabled, so no one types a
// paragraph into something that cannot read it back.
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import Page from '../components/Page'
import { EASE_ENTRANCE } from '../lib/motion'

const PREVIEW_VOICES = ['Uzbek · warm', 'Turkish · calm', 'Kazakh · bright', 'English · narrator']

export default function TextToSpeech() {
  return (
    <Page className="mx-auto max-w-2xl space-y-8 py-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_ENTRANCE }}
        className="text-center"
      >
        <Waveform />
        <span className="mt-6 inline-flex rounded-pill border border-subtle bg-sunken px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted">
          Coming soon
        </span>
        <h1 className="mt-4 text-[1.9rem] font-semibold tracking-tight text-primary">
          Text to speech
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-secondary">
          Type or paste a script and get it back as natural speech — in Turkic languages
          first, with the same voices that power your dubs. We're building it now.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_ENTRANCE, delay: 0.08 }}
        className="card space-y-4 p-5"
        aria-label="Preview of the text to speech tool"
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
            / Preview
          </span>
          <span className="font-mono text-[10px] text-muted">Not available yet</span>
        </div>
        <textarea
          disabled
          rows={4}
          placeholder="Salom! Bu matn tez orada ovozga aylanadi…"
          className="w-full cursor-not-allowed resize-none rounded-2xl border border-subtle bg-sunken px-4 py-3 text-sm text-primary opacity-70 outline-none placeholder:text-muted"
        />
        <div className="flex flex-wrap gap-2">
          {PREVIEW_VOICES.map((v) => (
            <span
              key={v}
              className="rounded-pill border border-subtle bg-sunken px-3 py-1 font-mono text-[11px] text-muted"
            >
              {v}
            </span>
          ))}
        </div>
        <button
          type="button"
          disabled
          className="btn-primary w-full cursor-not-allowed rounded-control py-2.5 font-mono text-xs font-medium opacity-50"
        >
          Generate speech
        </button>
      </motion.section>

      <p className="text-center text-sm text-secondary">
        Need a voice today?{' '}
        <Link to="/studio" className="font-medium text-primary underline-offset-4 hover:underline">
          Dub a video in the Studio
        </Link>
        .
      </p>
    </Page>
  )
}

/** Speech-like bars, parked still under prefers-reduced-motion. */
function Waveform() {
  const reduce = useReducedMotion()
  const BARS = [18, 34, 52, 30, 46, 24, 40, 16]
  return (
    <div
      aria-hidden
      className="mx-auto flex h-28 w-28 items-center justify-center gap-1.5 rounded-2xl border border-subtle bg-sunken/60"
    >
      {BARS.map((h, i) => (
        <motion.span
          key={i}
          className="w-1.5 rounded-full bg-[rgb(var(--c-text-primary))]"
          style={{ height: h }}
          initial={{ scaleY: 0.5 }}
          animate={reduce ? { scaleY: 0.7 } : { scaleY: [0.4, 1, 0.4] }}
          transition={
            reduce
              ? { duration: 0 }
              : { duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay: i * 0.1 }
          }
        />
      ))}
    </div>
  )
}
