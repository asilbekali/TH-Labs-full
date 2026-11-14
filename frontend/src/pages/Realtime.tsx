// Real-time translation playground.
//
// Two modes, decided by the account API (GET /v1/realtime/usage):
//
// * Live — when a Gemini key is configured. Start asks for the microphone,
//   then for a session (POST /v1/realtime/session, which checks the daily
//   allowance), then streams speech straight to Google's Live Translate model
//   and plays the translation back (lib/live-translate.ts). The source language
//   is detected by the model. Free while it is a playground: 5 minutes a
//   session, 15 a day, enforced by the API.
// * Preview — otherwise. Nothing is translated or sent; the conversation lines
//   are samples (lib/realtime-preview.ts), and the page says so.
//
// In both, the camera and screen previews are real but stay on the device,
// and the language list is the same catalog the Studio uses. "Notify me" is a
// real request — it goes to the staff inbox through POST /v1/feedback (kind
// FEATURE) — and is remembered on this device.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Page from '../components/Page'
import LanguageSelect from '../components/LanguageSelect'
import { MicMeter, StreamPreview } from '../components/LiveMedia'
import { sendFeedback } from '../lib/feedback-api'
import { LiveTranslateSession } from '../lib/live-translate'
import { EASE_ENTRANCE } from '../lib/motion'
import { useLanguages } from '../lib/queries'
import { getRealtimeUsage, startRealtimeSession } from '../lib/realtime-api'
import type { RealtimeUsage } from '../lib/realtime-api'
import { SAMPLE_COUNT, sampleLine } from '../lib/realtime-preview'
import { EDITOR_SHAPE } from '../lib/shape'

const NOTIFY_KEY = 'thlabs.realtime.notify'

// A pause this long between transcription pieces starts a new line.
const LINE_GAP_MS = 1500

/** One live exchange: what was heard and what was said in translation. */
interface LiveLine {
  heard: string
  said: string
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// How often a preview session moves on: a new line, or the translation of the
// line before it.
const TICK_MS = 1600

const VOICES = [
  { id: 'mine', label: 'My voice' },
  { id: 'natural', label: 'Natural voice' },
]

type Visual = 'camera' | 'screen'

/** One turn: a sample line by number, or something the user typed. */
interface Line {
  sample: number | null
  typed: string | null
  pending: boolean
}

function remembered(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1'
  } catch {
    return false
  }
}

function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

export default function Realtime() {
  const { data: languages = [] } = useLanguages()
  const [sourceLang, setSourceLang] = useState('auto')
  const [targetLang, setTargetLang] = useState('uz')
  const [voice, setVoice] = useState('mine')
  const [showOriginal, setShowOriginal] = useState(true)

  const [live, setLive] = useState(false)
  const [muted, setMuted] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [text, setText] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const [micStream, setMicStream] = useState<MediaStream | null>(null)
  const [visual, setVisual] = useState<Visual | null>(null)
  const [visualStream, setVisualStream] = useState<MediaStream | null>(null)

  const [asked, setAsked] = useState(remembered)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live translation (when the API has a Gemini key).
  const [usage, setUsage] = useState<RealtimeUsage | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [liveLines, setLiveLines] = useState<LiveLine[]>([])
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [leftToday, setLeftToday] = useState<number | null>(null)
  const sessionRef = useRef<LiveTranslateSession | null>(null)
  const lastPieceRef = useRef(0)
  const liveMode = usage?.configured === true

  const media = navigator.mediaDevices
  const canShareScreen = !!media?.getDisplayMedia
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [lines, liveLines])

  const refreshUsage = useCallback(() => {
    getRealtimeUsage()
      .then((u) => {
        setUsage(u)
        setLeftToday(Math.max(0, u.dailySeconds - u.usedSecondsToday))
      })
      .catch(() => setUsage(null)) // no API, or no route yet: stay a preview
  }, [])
  useEffect(refreshUsage, [refreshUsage])

  // Leaving the page ends a live session: mic, audio and socket.
  useEffect(() => () => sessionRef.current?.stop(), [])

  // The countdown of a live session. The session also ends itself at zero.
  useEffect(() => {
    if (!live || !liveMode) return
    const id = window.setInterval(() => setSecondsLeft((s) => (s == null ? s : Math.max(0, s - 1))), 1000)
    return () => window.clearInterval(id)
  }, [live, liveMode])

  // The browser's own "stop sharing" bar ends the track without going through
  // this page, so the preview has to listen for it.
  useEffect(() => {
    const track = visualStream?.getVideoTracks()[0]
    if (!track) return
    const ended = () => {
      setVisual(null)
      setVisualStream(null)
    }
    track.addEventListener('ended', ended)
    return () => track.removeEventListener('ended', ended)
  }, [visualStream])

  // Leaving the page must turn the camera and microphone off.
  useEffect(() => () => stopStream(micStream), [micStream])
  useEffect(() => () => stopStream(visualStream), [visualStream])

  useEffect(() => {
    micStream?.getAudioTracks().forEach((t) => {
      t.enabled = !muted
    })
  }, [micStream, muted])

  // The preview session: translate what is waiting, or else play the next sample.
  useEffect(() => {
    if (!live || muted || liveMode) return
    const id = window.setInterval(() => {
      setLines((prev) => {
        if (prev.some((l) => l.pending)) return prev.map((l) => ({ ...l, pending: false }))
        const played = prev.filter((l) => l.sample != null).length
        if (played >= SAMPLE_COUNT) return prev
        return [...prev, { sample: played, typed: null, pending: true }]
      })
    }, TICK_MS)
    return () => window.clearInterval(id)
  }, [live, muted, liveMode])

  const langName = useCallback(
    (code: string) => languages.find((l) => l.code === code)?.name ?? code.toUpperCase(),
    [languages],
  )
  const sourceName = sourceLang === 'auto' ? 'You' : langName(sourceLang)
  const targetName = langName(targetLang)
  // Samples need a language to be shown in, and Auto-detect has not detected one.
  const sampleSource = sourceLang === 'auto' ? 'en' : sourceLang
  const allPlayed = lines.filter((l) => l.sample != null).length >= SAMPLE_COUNT

  async function start() {
    setNotice(null)
    setLines([])
    setMuted(false)
    if (liveMode) {
      await startLive()
      return
    }
    setLive(true)
    try {
      setMicStream(await media.getUserMedia({ audio: true }))
    } catch {
      setNotice('The microphone is blocked. Allow it in your browser to see it react.')
    }
  }

  // Microphone first, then the session: a blocked microphone must not use up
  // any of the day's allowance.
  async function startLive() {
    setConnecting(true)
    setLiveLines([])
    let stream: MediaStream
    try {
      stream = await media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      setConnecting(false)
      setNotice('The microphone is blocked. Allow it in your browser to translate your speech.')
      return
    }
    try {
      const grant = await startRealtimeSession(targetLang)
      setSecondsLeft(grant.maxSeconds)
      setLeftToday(grant.remainingSecondsToday)
      lastPieceRef.current = 0
      const session = new LiveTranslateSession(grant, stream, {
        onState: (state) => {
          if (state === 'live') setConnecting(false)
        },
        onInput: (piece) => appendPiece('heard', piece),
        onOutput: (piece) => appendPiece('said', piece),
        onEnd: (reason) => {
          sessionRef.current = null
          setConnecting(false)
          setLive(false)
          setMicStream(null)
          setSecondsLeft(null)
          if (reason) setNotice(reason)
          refreshUsage()
        },
      })
      sessionRef.current = session
      setMicStream(stream)
      setLive(true)
      await session.start()
    } catch (e) {
      stopStream(stream)
      setConnecting(false)
      setNotice(e instanceof Error ? e.message : 'Could not start live translation.')
      refreshUsage()
    }
  }

  // Transcription arrives in pieces; a pause starts a new line.
  function appendPiece(field: keyof LiveLine, piece: string) {
    const now = Date.now()
    const fresh = now - lastPieceRef.current > LINE_GAP_MS
    lastPieceRef.current = now
    setLiveLines((prev) => {
      if (fresh || prev.length === 0) {
        return [...prev, { heard: '', said: '', [field]: piece }]
      }
      const last = prev[prev.length - 1]
      return [...prev.slice(0, -1), { ...last, [field]: last[field] + piece }]
    })
  }

  function stop() {
    sessionRef.current?.stop()
    setLive(false)
    setConnecting(false)
    setMicStream(null)
    setVisual(null)
    setVisualStream(null)
  }

  async function toggleVisual(next: Visual) {
    setNotice(null)
    if (visual === next) {
      setVisual(null)
      setVisualStream(null)
      return
    }
    try {
      const stream =
        next === 'camera'
          ? await media.getUserMedia({ video: true })
          : await media.getDisplayMedia({ video: true })
      setVisual(next)
      setVisualStream(stream)
    } catch {
      setNotice(next === 'camera' ? 'The camera is blocked. Allow it in your browser to use it.' : 'Screen sharing was not started.')
    }
  }

  function swapLangs() {
    if (sourceLang === 'auto') return
    setSourceLang(targetLang)
    setTargetLang(sourceLang)
  }

  function send(e: FormEvent) {
    e.preventDefault()
    const typed = text.trim()
    if (!typed) return
    setLines((prev) => [...prev, { sample: null, typed, pending: false }])
    setText('')
  }

  async function notify() {
    setBusy(true)
    setError(null)
    try {
      await sendFeedback({
        kind: 'FEATURE',
        message: 'Please notify me when real-time dubbing is available.',
      })
      try {
        localStorage.setItem(NOTIFY_KEY, '1')
      } catch {
        /* the request still went through */
      }
      setAsked(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send that. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const liveConversation = liveLines.length === 0 ? (
    <div className="grid h-full place-items-center px-6 py-10 text-center">
      <div>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-medium leading-tight text-primary">
          Speak in any language.
          <br />
          Hear it in {targetName}.
        </h2>
        <p className="mt-2 text-[15px] text-secondary">
          {connecting ? 'Connecting…' : live ? 'Listening… start talking.' : 'Press Start and allow the microphone.'}
        </p>
      </div>
    </div>
  ) : (
    <div className="space-y-3 p-4 sm:p-5">
      {liveLines.map((line, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.22, ease: EASE_ENTRANCE }}
          className="rounded-[12px] border border-subtle bg-sunken/60 px-4 py-3"
        >
          {showOriginal && line.heard && (
            <>
                  <p className="text-[12px] text-muted">Heard</p>
                  <p dir="auto" className="text-sm text-secondary">{line.heard}</p>
            </>
          )}
          <p className={`text-[12px] text-brand ${showOriginal && line.heard ? 'mt-2' : ''}`}>{targetName}</p>
          <p dir="auto" className={`text-[15px] ${line.said ? 'font-medium text-primary' : 'text-muted'}`}>
            {line.said || 'Translating…'}
          </p>
        </motion.div>
      ))}
    </div>
  )

  const conversation = liveMode ? liveConversation : lines.length === 0 ? (
    <div className="grid h-full place-items-center px-6 py-10 text-center">
      <div>
        <h2 className="text-[clamp(1.4rem,3vw,1.9rem)] font-medium leading-tight text-primary">
          Speak in your language.
          <br />
          They hear it in {targetName}.
        </h2>
        <p className="mt-2 text-[15px] text-secondary">
          {live ? 'Listening…' : 'Press Start to try it.'}
        </p>
      </div>
    </div>
  ) : (
    <div className="space-y-3 p-4 sm:p-5">
      <AnimatePresence initial={false}>
        {lines.map((line, i) => {
          const source = line.typed ?? sampleLine(line.sample ?? 0, sampleSource) ?? sampleLine(line.sample ?? 0, 'en')
          const target = line.sample == null ? null : sampleLine(line.sample, targetLang)
          return (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: EASE_ENTRANCE }}
              className="rounded-[12px] border border-subtle bg-sunken/60 px-4 py-3"
            >
              {showOriginal && (
                <>
                      <p className="text-[12px] text-muted">{sourceName}</p>
                      <p dir="auto" className="text-sm text-secondary">{source}</p>
                </>
              )}
              <p className={`text-[12px] text-brand ${showOriginal ? 'mt-2' : ''}`}>{targetName}</p>
              {line.pending ? (
                <p className="text-[15px] text-muted">Translating…</p>
              ) : target ? (
                <p dir="auto" className="text-[15px] font-medium text-primary">{target}</p>
              ) : (
                <p className="text-[15px] text-muted">
                  The {targetName} translation will appear here when real-time dubbing is ready.
                </p>
              )}
            </motion.div>
          )
        })}
      </AnimatePresence>
      {live && allPlayed && !muted && <p className="px-1 text-[13px] text-muted">Listening…</p>}
    </div>
  )

  const stage = (
    <section className={`card flex min-h-[70dvh] min-w-0 flex-col overflow-hidden transition-shadow lg:min-h-0 ${live ? 'running-halo' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle px-4 py-3 sm:px-5">
        <h1 className="text-[15px] font-semibold text-primary">Playground</h1>
        <span className="chip px-2 py-0.5 text-[12px] text-primary">Preview</span>
        <p className="order-last min-w-0 basis-full text-[13px] text-muted sm:order-none sm:flex-1 sm:basis-0 sm:truncate">
          {liveMode
            ? 'Preview — powered by Google Gemini Live Translate. Translations and voices may be imperfect.'
            : 'Sample lines only. Nothing you say is sent.'}
        </p>
        {liveMode && live && secondsLeft != null && (
          <span className="font-mono text-[13px] tabular-nums text-secondary" aria-label="Time left in this session">
            {clock(secondsLeft)}
          </span>
        )}
        {live && (
          <div className="ml-auto sm:ml-0">
            <MicMeter stream={micStream} muted={muted} />
          </div>
        )}
      </div>

      <div ref={scrollRef} className="no-scrollbar min-h-0 flex-1 overflow-y-auto">
        {conversation}
      </div>

      {visualStream && visual && (
        <div className="px-4 pb-3 sm:px-5">
          <StreamPreview stream={visualStream} label={visual === 'camera' ? 'Your camera' : 'Your screen'} />
        </div>
      )}

      <div className="border-t border-subtle p-3">
        {notice && <p className="mb-2 px-1 text-[13px] text-warn">{notice}</p>}
        <div className="flex flex-wrap items-center gap-2">
          {liveMode ? (
            // The live model takes speech only, so there is nothing to type.
            <p className="min-w-0 basis-full px-1 text-[13px] text-muted sm:flex-1 sm:basis-0">
              {leftToday != null && `${Math.floor(leftToday / 60)} min left today`}
            </p>
          ) : (
            <form onSubmit={send} className="min-w-0 basis-full sm:flex-1 sm:basis-0">
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Type something…"
                aria-label="Type something to translate"
                className="field h-11 w-full py-2"
              />
            </form>
          )}
          {live && (
            <RoundButton label={muted ? 'Turn the microphone on' : 'Mute the microphone'} active={muted} onClick={() => setMuted((m) => !m)}>
              <rect x="9" y="2" width="6" height="12" rx="3" />
              <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
              {muted && <path d="M3 3l18 18" />}
            </RoundButton>
          )}
          <RoundButton label={visual === 'camera' ? 'Turn the camera off' : 'Turn the camera on'} active={visual === 'camera'} onClick={() => void toggleVisual('camera')}>
            <rect x="2" y="6" width="14" height="12" rx="2" />
            <path d="m16 10 6-3v10l-6-3" />
          </RoundButton>
          {canShareScreen && (
            <RoundButton label={visual === 'screen' ? 'Stop sharing your screen' : 'Share your screen'} active={visual === 'screen'} onClick={() => void toggleVisual('screen')}>
              <rect x="2" y="4" width="20" height="13" rx="2" />
              <path d="M8 21h8M12 17v4" />
            </RoundButton>
          )}
          {live ? (
            <button type="button" onClick={stop} className="focusable ml-auto h-11 shrink-0 rounded-full bg-red-600 px-6 text-sm font-medium text-white hover:opacity-90 sm:ml-0">
              Stop
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void start()}
              disabled={connecting || (liveMode && leftToday === 0)}
              className="btn-primary focusable ml-auto h-11 shrink-0 px-6 text-sm disabled:opacity-50 sm:ml-0"
            >
              {connecting ? 'Connecting…' : 'Start'}
            </button>
          )}
        </div>
      </div>
    </section>
  )

  const settings = (
    <aside className="no-scrollbar min-h-0 min-w-0 space-y-3 lg:overflow-y-auto">
      <section className="card relative z-10 space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-primary">Settings</h2>
        {liveMode ? (
          <p className="text-[13px] text-secondary">The language you speak is detected automatically.</p>
        ) : (
          <>
            <div className="relative z-20">
              <LanguageSelect label="I speak" languages={languages} value={sourceLang} onChange={setSourceLang} allowAuto />
            </div>
            <div className="flex justify-center">
              <button
                type="button"
                onClick={swapLangs}
                disabled={sourceLang === 'auto'}
                aria-label="Swap the two languages"
                title={sourceLang === 'auto' ? 'Choose the language you speak to swap' : 'Swap the two languages'}
                className="focusable -my-2 grid h-9 w-9 place-items-center rounded-full border border-subtle bg-surface text-secondary transition-colors hover:border-brand/50 hover:text-brand disabled:opacity-40"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0-3 3m3-3 3 3" />
                </svg>
              </button>
            </div>
          </>
        )}
        <div className="relative z-10">
          {/* The session is locked to the language it started with. */}
          <fieldset disabled={liveMode && (live || connecting)} className="disabled:opacity-60">
            <LanguageSelect label="Translate into" languages={languages} value={targetLang} onChange={setTargetLang} />
          </fieldset>
        </div>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted">Voice</p>
          <div className="flex rounded-control border border-subtle bg-sunken p-1">
            {VOICES.map((v) => (
              <button
                key={v.id}
                type="button"
                aria-pressed={voice === v.id}
                onClick={() => setVoice(v.id)}
                className={`focusable flex-1 rounded-[8px] px-2 py-2 text-[13px] font-medium transition-colors ${
                  voice === v.id ? 'bg-brand/15 text-brand shadow-[inset_0_0_0_1px_rgb(var(--c-brand-500)/0.45)]' : 'text-muted hover:text-primary'
                }`}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-primary">
          Show what I said
          <input
            type="checkbox"
            checked={showOriginal}
            onChange={(e) => setShowOriginal(e.target.checked)}
            className="h-4 w-4 accent-[rgb(var(--c-brand-500))]"
          />
        </label>
      </section>

      {liveMode && usage ? (
        <section className="card p-5">
          <span className="chip px-2 py-0.5 text-[12px] text-primary">Free preview</span>
          <p className="mt-2.5 text-sm font-medium text-primary">Live translation is free while we test it</p>
          <p className="mt-1 text-[13px] leading-relaxed text-secondary">
            Up to {Math.round(usage.sessionSeconds / 60)} minutes a session and {Math.round(usage.dailySeconds / 60)} minutes a
            day. Your speech goes to Google to be translated and is not stored by us.
          </p>
          {leftToday != null && (
            <p className="mt-3 text-[13px] text-primary" aria-live="polite">
              {leftToday > 0 ? `${Math.floor(leftToday / 60)} min left today` : 'You’ve used today’s minutes. Come back tomorrow.'}
            </p>
          )}
        </section>
      ) : (
        <section className="card p-5">
          <span className="chip px-2 py-0.5 text-[12px] text-primary">In development</span>
          <p className="mt-2.5 text-sm font-medium text-primary">Real-time dubbing is coming soon</p>
          <p className="mt-1 text-[13px] leading-relaxed text-secondary">
            It will be open to every plan and paid for with tokens. Live pricing will be announced at launch.
          </p>
          {asked ? (
            <p className="mt-3 text-[13px] text-success" aria-live="polite">
              ✓ You’re on the list. We’ll notify you when it’s ready.
            </p>
        ) : (
            <button type="button" onClick={() => void notify()} disabled={busy} className="btn-primary focusable mt-3 h-10 w-full text-sm">
              {busy ? 'Sending…' : 'Notify me when it’s ready'}
            </button>
          )}
          {error && <p className="mt-2 text-[13px] text-danger">{error}</p>}
        </section>
      )}
    </aside>
  )

  return (
    <Page
      className="grid gap-3 lg:h-full lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_320px] lg:gap-4"
      style={EDITOR_SHAPE}
    >
      {stage}
      {settings}
    </Page>
  )
}

function RoundButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      className={`focusable grid h-11 w-11 shrink-0 place-items-center rounded-full border transition-colors ${
        active ? 'border-brand bg-brand/15 text-brand' : 'border-subtle text-secondary hover:border-strong hover:text-primary'
      }`}
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  )
}
