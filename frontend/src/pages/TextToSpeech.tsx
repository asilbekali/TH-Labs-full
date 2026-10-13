// Text to speech — type a script, get it back as one audio file.
//
// The pipeline picks the model from the language (backend/app/speech.py):
// Uzbek is voiced by Navoiy, in one of its emotion styles; every other
// language by OmniVoice, in a designed voice. The voice chips therefore
// change with the language.
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
import { useLanguages } from '../lib/queries'
import { useWallet } from '../lib/wallet'

const POLL_MS = 1500
const DEFAULT_MAX = 1000

const PLACEHOLDER: Record<string, string> = {
  uz: 'Salom! Bu matnni yozing va uni tabiiy ovozda eshiting.',
  ru: 'Здравствуйте! Введите текст, и он прозвучит естественным голосом.',
  en: 'Hello! Type a script here and hear it read back in a natural voice.',
}

export default function TextToSpeech() {
  const { data: languages = [] } = useLanguages()
  const wallet = useWallet()
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
  const model = navoiy ? 'Navoiy' : 'OmniVoice'
  const options = engine?.voices ?? []
  const selected =
    voice && options.some((o) => o.id === voice) ? voice : (engine?.default ?? null)
  const max = voices?.max_chars ?? DEFAULT_MAX
  const trimmed = text.trim()
  const running = busy || task?.status === 'queued' || task?.status === 'running'

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
    <Page className="mx-auto max-w-2xl space-y-8 py-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_ENTRANCE }}
        className="text-center"
      >
        <Waveform active={running} />
        <h1 className="mt-6 text-[1.9rem] font-semibold tracking-tight text-primary">
          Text to speech
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-secondary">
          Type or paste a script and get it back as natural speech. Uzbek is voiced by a model
          trained on native speech; every other language by a multilingual voice model.
        </p>
      </motion.section>

      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_ENTRANCE, delay: 0.08 }}
        className="card space-y-5 p-5"
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
            <label
              htmlFor="tts-text"
              className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted"
            >
              / Script
            </label>
            <span
              className={`font-mono text-[10px] ${
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
            className="focusable w-full resize-y rounded-2xl border border-subtle bg-sunken px-4 py-3 text-sm leading-relaxed text-primary outline-none placeholder:text-muted"
          />
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-muted">
              / {navoiy ? 'Style' : 'Voice'}
            </span>
            {voices && available && (
              <span className="rounded-pill border border-subtle bg-sunken px-2.5 py-0.5 font-mono text-[10px] text-muted">
                Model · {model}
              </span>
            )}
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
                      className="h-7 w-20 animate-pulse rounded-pill border border-subtle bg-sunken"
                    />
                  ))}
                </div>
              ) : (
                groups(options).map(([title, list]) => (
                  <div key={title ?? 'all'}>
                    {title && (
                      <p className="mb-1.5 font-mono text-[10px] text-muted">{title}</p>
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
                            className={`focusable rounded-pill border px-3 py-1 font-mono text-[11px] transition-colors ${
                              active
                                ? 'border-brand bg-brand/10 text-primary'
                                : 'border-subtle bg-sunken text-muted hover:text-primary'
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

        <button
          type="button"
          onClick={generate}
          disabled={!trimmed || running || !available || text.length > max}
          className="btn-primary w-full rounded-control py-2.5 font-mono text-xs font-medium disabled:cursor-not-allowed disabled:opacity-50"
        >
          {running ? 'Generating…' : 'Generate speech'}
        </button>

        {running && (
          <p className="text-center font-mono text-[11px] text-muted" aria-live="polite">
            Voicing your script. The first render can take a minute or two while the model
            starts.
          </p>
        )}

        {error && (
          <div
            role="alert"
            className="rounded-lg border border-subtle bg-sunken px-4 py-3 text-sm text-secondary"
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
          <div className="space-y-3 rounded-2xl border border-subtle bg-sunken p-4">
            <audio controls autoPlay src={audio} className="w-full" />
            <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-muted">
              <span>
                {task.duration?.toFixed(1)}s · {task.engine}
                {task.credits_charged != null && ` · ${task.credits_charged} credits`}
              </span>
              <a
                href={audio}
                download={`th-labs-speech-${task.id}.wav`}
                className="font-medium text-primary underline-offset-4 hover:underline"
              >
                Download WAV
              </a>
            </div>
          </div>
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
