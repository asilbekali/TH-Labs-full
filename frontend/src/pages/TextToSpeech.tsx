// Text to speech — type a script, get it back as one audio file.
//
// The pipeline picks the model from the language (backend/app/speech.py):
// Uzbek is voiced by Navoiy, in one of its emotion styles; every other
// language by OmniVoice, in a designed voice. The voice chips therefore
// change with the language.
//
// Which model is behind a voice is ours to know, not the user's: nothing on
// this page names one. The user picks a language and a voice, and that is all.
//
// A render is a background task: createSpeech starts it, getSpeech is polled
// until it is done. Credits are charged per second of audio produced, at the
// Balanced dub rate, and only for a render that succeeded.
import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Link } from 'react-router-dom'
import Page from '../components/Page'
import LanguageSelect from '../components/LanguageSelect'
import { EASE_ENTRANCE } from '../lib/motion'
import {
  AuthRequiredError,
  PaymentRequiredError,
  createSpeech,
  getSpeech,
  getSpeechVoices,
  mediaUrl,
  type SpeechTask,
  type SpeechVoice,
  type SpeechVoices,
} from '../lib/api'
import { useLanguages, usePlans } from '../lib/queries'
import { CREDITS_PER_MINUTE_BY_QUALITY, estimateDubCost, useWallet } from '../lib/wallet'

const POLL_MS = 1500
const DEFAULT_MAX = 1000

// The quote mirrors the server's preflight exactly (backend/app/speech.py):
// characters / CHARS_PER_SECOND seconds of speech, priced as a Balanced dub.
// Keep this in step with CHARS_PER_SECOND there. It runs on the low side, so
// the quote usually overshoots — but it is not a ceiling: a slowed style
// (Sleepy, Storyteller) can produce more seconds than it assumes, and the
// charge is for the seconds really produced. Hence "≈" on the page.
const CHARS_PER_SECOND = 12
const BILLING_QUALITY = 'balanced'

const PLACEHOLDER: Record<string, string> = {
  uz: 'Salom! Bu matnni yozing va uni tabiiy ovozda eshiting.',
  ru: 'Здравствуйте! Введите текст, и он прозвучит естественным голосом.',
  en: 'Hello! Type a script here and hear it read back in a natural voice.',
}

export default function TextToSpeech() {
  const { data: languages = [] } = useLanguages()
  const wallet = useWallet()
  const { data: plansCatalog } = usePlans()
  const [language, setLanguage] = useState('uz')
  const [text, setText] = useState('')
  const [voices, setVoices] = useState<SpeechVoices | null>(null)
  const [voice, setVoice] = useState<string | null>(null)
  const [task, setTask] = useState<SpeechTask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [needsCredits, setNeedsCredits] = useState(false)
  const poll = useRef<number | null>(null)

  // Fetching the voices for a language also starts its engine, so a cold
  // container is warming while the user types.
  useEffect(() => {
    let live = true
    getSpeechVoices(language)
      .then((v) => live && setVoices(v))
      .catch(() => live && setVoices(null))
    return () => {
      live = false
    }
  }, [language])

  useEffect(() => () => {
    if (poll.current) window.clearTimeout(poll.current)
  }, [])

  const navoiy =
    !!voices?.navoiy.available && voices.navoiy.languages.includes(language)
  const engine = navoiy ? voices!.navoiy : voices?.omnivoice
  const available = navoiy || !!voices?.omnivoice.available
  const options = engine?.voices ?? []
  const selected =
    voice && options.some((o) => o.id === voice) ? voice : (engine?.default ?? null)
  const max = voices?.max_chars ?? DEFAULT_MAX
  const trimmed = text.trim()
  const running = busy || task?.status === 'queued' || task?.status === 'running'

  // Prefer the server's published tariff over the bundled fallback.
  const rates = plansCatalog?.qualityCost ?? CREDITS_PER_MINUTE_BY_QUALITY
  const estSeconds = trimmed.length / CHARS_PER_SECOND
  const estCost = estimateDubCost(estSeconds, BILLING_QUALITY, rates)
  // The server turns the render away on this same comparison, so say it here
  // before the click rather than as an error after it.
  const short = !wallet.loading && trimmed.length > 0 && wallet.balance < estCost

  function track(id: string) {
    poll.current = window.setTimeout(async () => {
      try {
        const t = await getSpeech(id)
        setTask(t)
        if (t.status === 'done') {
          setBusy(false)
          void wallet.refresh()
        } else if (t.status === 'failed') {
          setBusy(false)
          setError(t.error ?? 'Speech generation failed.')
        } else {
          track(id)
        }
      } catch (e) {
        setBusy(false)
        setError(e instanceof Error ? e.message : 'Lost track of the render.')
      }
    }, POLL_MS)
  }

  async function generate() {
    if (!trimmed || running) return
    setError(null)
    setNeedsCredits(false)
    setBusy(true)
    setTask(null)
    try {
      const t = await createSpeech({ text: trimmed, language, voice: selected ?? undefined })
      setTask(t)
      track(t.id)
    } catch (e) {
      setBusy(false)
      if (e instanceof PaymentRequiredError) setNeedsCredits(true)
      setError(
        e instanceof AuthRequiredError
          ? 'Sign in to generate speech.'
          : e instanceof Error
            ? e.message
            : 'Speech generation failed.',
      )
    }
  }

  const audio = task?.status === 'done' ? mediaUrl(task.audio_url) : undefined

  return (
    <Page className="mx-auto max-w-2xl space-y-6 py-2 sm:space-y-8 sm:py-6">
      <motion.section
        initial={{ opacity: 0, y: 14, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.6, ease: EASE_ENTRANCE }}
        className="text-center"
      >
        <Waveform active={running} />
        <p className="eyebrow mt-6">Text to speech</p>
        <h1 className="mt-3 text-[clamp(1.75rem,5vw,2.4rem)] font-medium leading-[1.15] text-primary">
          Type it. <span className="gradient-text">Hear it.</span>
        </h1>
        <p className="mx-auto mt-3 max-w-md text-[15px] leading-relaxed text-secondary">
          Paste a script, pick a language and a voice, and get it back as natural speech in
          seconds.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: EASE_ENTRANCE, delay: 0.1 }}
        className="composer space-y-5 p-4 sm:p-6"
        aria-label="Text to speech"
      >
        <LanguageSelect
          languages={languages}
          value={language}
          onChange={(code) => {
            setLanguage(code)
            setVoice(null)
          }}
          label="Language"
        />

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label htmlFor="tts-text" className="eyebrow">
              Script
            </label>
            <span
              className={`text-[11px] tabular-nums ${
                text.length > max ? 'text-danger' : 'text-muted'
              }`}
            >
              {text.length} / {max}
            </span>
          </div>
          <textarea
            id="tts-text"
            rows={6}
            value={text}
            maxLength={max}
            onChange={(e) => setText(e.target.value)}
            placeholder={PLACEHOLDER[language] ?? PLACEHOLDER.en}
            className="field min-h-[9rem] resize-y leading-relaxed"
          />
        </div>

        <div>
          <div className="mb-2">
            <span className="eyebrow">{navoiy ? 'Style' : 'Voice'}</span>
          </div>
          {voices && !available ? (
            <p className="text-sm text-muted">
              Speech isn't available for this language on the server right now.
            </p>
          ) : (
            <div className="space-y-3" role="radiogroup">
              {options.length === 0 ? (
                <div className="flex flex-wrap gap-2">
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className="h-9 w-24 animate-pulse rounded-pill border border-[var(--card-edge)] bg-[var(--well)]"
                    />
                  ))}
                </div>
              ) : (
                groups(options).map(([title, list]) => (
                  <div key={title ?? 'all'}>
                    {title && (
                      <p className="mb-2 text-[11px] text-muted">{title}</p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {list.map((o) => {
                        const active = o.id === selected
                        return (
                          <button
                            key={o.id}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            onClick={() => setVoice(o.id)}
                            className={`focusable min-h-9 rounded-pill border px-3.5 py-1.5 text-[13px] transition-all duration-200 active:scale-[0.97] ${
                              active
                                ? 'border-brand/60 bg-brand/15 text-primary shadow-[0_0_0_3px_rgb(var(--c-brand-500)/0.12)]'
                                : 'border-[var(--card-edge)] bg-[var(--well)] text-secondary hover:border-[var(--card-edge-hover)] hover:text-primary'
                            }`}
                          >
                            {o.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <CostLine
          seconds={estSeconds}
          cost={estCost}
          balance={wallet.balance}
          loading={wallet.loading}
          empty={!trimmed}
          short={short}
        />

        <button
          type="button"
          onClick={generate}
          disabled={!trimmed || running || !available || text.length > max || short}
          className="btn-primary btn-ring flex h-12 w-full items-center justify-center gap-2 text-[15px]"
        >
          {running ? (
            <>
              <span className="eq" aria-hidden>
                <i /><i /><i /><i /><i />
              </span>
              Generating…
            </>
          ) : trimmed ? (
            <>
              Generate speech
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[12px] tabular-nums">
                {estCost} {estCost === 1 ? 'credit' : 'credits'}
              </span>
            </>
          ) : (
            'Generate speech'
          )}
        </button>

        {running && (
          <p className="text-center text-[12px] text-muted" aria-live="polite">
            Voicing your script. The first render can take a minute or two while the voice
            warms up.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-[var(--radius-control)] border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-secondary"
          >
            {error}
            {needsCredits && (
              <>
                {' '}
                <Link to="/plans" className="font-medium text-primary underline-offset-4 hover:underline">
                  Get credits
                </Link>
              </>
            )}
          </div>
        )}

        {audio && task && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: EASE_ENTRANCE }}
            className="space-y-3 rounded-[var(--radius-card)] border border-success/30 bg-success/[0.07] p-3 sm:p-4"
          >
            <audio controls autoPlay src={audio} className="w-full" />
            <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[12px] text-muted">
              <span className="tabular-nums">
                {task.duration?.toFixed(1)}s
                {task.credits_charged != null && ` · ${task.credits_charged} credits`}
              </span>
              <a
                href={audio}
                download={`th-labs-speech-${task.id}.wav`}
                className="btn-ghost inline-flex h-9 items-center px-4 text-[13px]"
              >
                Download WAV
              </a>
            </div>
          </motion.div>
        )}
      </motion.section>

      <p className="text-center text-sm text-secondary">
        Have a video instead?{' '}
        <Link to="/studio" className="font-medium text-primary underline-offset-4 hover:underline">
          Dub it in the Studio
        </Link>
        .
      </p>
    </Page>
  )
}

/** What the script will cost, before it is voiced: the estimated length, the
 *  credits, and the balance they come out of. Turns into a warning with a way
 *  to top up when the balance cannot cover it. */
function CostLine({
  seconds,
  cost,
  balance,
  loading,
  empty,
  short,
}: {
  seconds: number
  cost: number
  balance: number
  loading: boolean
  empty: boolean
  short: boolean
}) {
  const s = Math.max(1, Math.round(seconds))
  const length = s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

  return (
    <div
      aria-live="polite"
      className={`rounded-[var(--radius-control)] border px-4 py-3 transition-colors ${
        short ? 'border-warn/35 bg-warn/[0.08]' : 'border-[var(--card-edge)] bg-[var(--well)]'
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand/15 text-brand">
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <circle cx="12" cy="12" r="8.5" />
              <path d="M14.8 9.2c-.5-.8-1.5-1.3-2.8-1.3-1.6 0-2.8.8-2.8 2s1.1 1.7 2.8 2.1c1.7.4 2.8 1 2.8 2.2s-1.2 2-2.8 2c-1.4 0-2.5-.6-3-1.5M12 6.5v1.4M12 16.6V18" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-[11px] text-muted">Estimated cost</p>
            <p className="text-[15px] font-medium tabular-nums text-primary">
              {empty ? (
                <span className="text-muted">Type a script to see it</span>
              ) : (
                <>
                  ≈ {cost} {cost === 1 ? 'credit' : 'credits'}
                  <span className="ml-1.5 text-[12px] font-normal text-muted">· ~{length} of audio</span>
                </>
              )}
            </p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[11px] text-muted">Your balance</p>
          <p className={`text-[15px] font-medium tabular-nums ${short ? 'text-warn' : 'text-primary'}`}>
            {loading ? '…' : balance}
          </p>
        </div>
      </div>
      {short ? (
        <p className="mt-2.5 text-[12px] text-secondary">
          Not enough credits for this script. Shorten it, or{' '}
          <Link to="/plans" className="font-medium text-brand underline-offset-4 hover:underline">
            get more credits
          </Link>
          .
        </p>
      ) : (
        !empty && (
          <p className="mt-2 text-[11px] text-muted">
            An estimate. You are charged for the audio actually produced, and nothing if a
            render fails.
          </p>
        )
      )}
    </div>
  )
}

/** Uzbek styles split into the trained ones and the blends built on them;
 *  any other voice list stays one group. */
function groups(options: SpeechVoice[]): [string | null, SpeechVoice[]][] {
  const blends = options.filter((o) => o.group === 'blend')
  if (!blends.length) return [[null, options]]
  return [
    ['Trained styles', options.filter((o) => o.group !== 'blend')],
    ['Blends', blends],
  ]
}

/** Speech-like bars: idle sway, livelier while a render runs, still under
 *  prefers-reduced-motion. */
function Waveform({ active }: { active: boolean }) {
  const reduce = useReducedMotion()
  const BARS = [18, 34, 52, 30, 46, 24, 40, 16]
  return (
    <div
      aria-hidden
      className="deep-card aurora grain mx-auto flex h-28 w-28 items-center justify-center gap-1.5 rounded-[1.75rem]"
    >
      {BARS.map((h, i) => (
        <motion.span
          key={i}
          className="w-1.5 rounded-full"
          style={{
            height: h,
            background: 'linear-gradient(180deg, #ffc128, #ff7a1a 55%, #ff5a3c)',
            boxShadow: '0 0 12px rgb(255 140 40 / 0.45)',
          }}
          initial={{ scaleY: 0.5 }}
          animate={reduce ? { scaleY: 0.7 } : { scaleY: [0.4, 1, 0.4] }}
          transition={
            reduce
              ? { duration: 0 }
              : {
                  duration: active ? 0.6 : 1.2,
                  repeat: Infinity,
                  ease: 'easeInOut',
                  delay: i * (active ? 0.05 : 0.1),
                }
          }
        />
      ))}
    </div>
  )
}
