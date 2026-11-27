// Real-time translation playground.
//
// Two modes, decided by the account API (GET /v1/realtime/usage):
//
// * Live — when a Gemini key is configured. Start asks for the microphone,
//   then for a session (POST /v1/realtime/session, which checks the daily
//   allowance), then streams speech straight to Google's Live Translate model
//   and plays the translation back (lib/live-translate.ts). The source language
//   is detected by the model. Each day has free minutes, more on the first;
//   after them every minute is charged in tokens. The API decides both, and the
//   session carries on from one grant to the next by itself.
// * Preview — otherwise. Nothing is translated or sent; the conversation lines
//   are samples (lib/realtime-preview.ts), and the page says so.
//
// In both, the camera and screen previews are real but stay on the device,
// and the language list is the same catalog the Studio uses. "Notify me" is a
// real request — it goes to the staff inbox through POST /v1/feedback (kind
// FEATURE) — and is remembered on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { motion } from 'framer-motion'
import Page from '../components/Page'
import LanguageSelect from '../components/LanguageSelect'
import { MicMeter, StreamPreview } from '../components/LiveMedia'
import TourOverlay from '../components/onboarding/TourOverlay'
import type { TourStep } from '../components/onboarding/TourOverlay'
import { useAuth } from '../lib/auth'
import { sendFeedback } from '../lib/feedback-api'
import { startLive as beginLive } from '../lib/live-start'
import { LiveTranslateSession } from '../lib/live-translate'
import { EASE_ENTRANCE } from '../lib/motion'
import { REALTIME_TOUR, accountKey, hasSeenTour, markTourSeen } from '../lib/onboarding'
import { useLanguages } from '../lib/queries'
import { notifyCreditsChanged } from '../lib/payments-api'
import { getRealtimeUsage, startRealtimeSession } from '../lib/realtime-api'
import type { RealtimeSessionGrant, RealtimeUsage } from '../lib/realtime-api'
import { SAMPLE_COUNT, sampleLine } from '../lib/realtime-preview'
import { EDITOR_SHAPE } from '../lib/shape'

const NOTIFY_KEY = 'thlabs.realtime.notify'

// A pause this long between transcription pieces starts a new line.
const LINE_GAP_MS = 1500
// The API hands out no session shorter than this.
const MIN_FREE_SECONDS = 30
const EXTENSION_URL = 'https://chromewebstore.google.com/detail/ldchkkmimnmciglkoajfjmjlnlgdbmkk'

/** One live exchange: what was heard and what was said in translation. */
interface LiveLine {
  heard: string
  said: string
}

/** One row of the split view, whichever mode produced it. */
interface Row {
  heard: string
  said: string | null
  pending: boolean
}

/** What the right pane shows while a row has no translation yet. */
function translationPlaceholder(row: Row, targetName: string): string {
  if (row.pending) return 'Translating…'
  // Only the built-in sample lines carry translations in the preview.
  return `Typed lines get no ${targetName} translation in the preview.`
}

function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// How often a preview session moves on: a new line, or the translation of the
// line before it.
const TICK_MS = 1600

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
  const [paying, setPaying] = useState(false)
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
        setLeftToday(u.unlimited ? null : Math.max(0, u.dailySeconds - u.usedSecondsToday))
      })
      .catch(() => setUsage(null)) // no API, or no route yet: stay a preview
  }, [])
  useEffect(refreshUsage, [refreshUsage])

  // Leaving the page ends a live session — mic, audio and socket — and tells
  // a start still in flight not to carry on (lib/live-start.ts).
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      sessionRef.current?.stop()
    }
  }, [])

  // The countdown of the free time. A session paid with tokens has none.
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

  // ── Walkthrough ──────────────────────────────────────────────────────────
  // The Studio's spotlight tour, pointed at this page. Real-time is new to
  // everyone, so it opens by itself on an account's first visit here (not
  // only for new accounts, as the Studio does) and then only from Guide.
  const { user, ready: authReady } = useAuth()
  const tourKey = accountKey(user?.id)
  const [tourOpen, setTourOpen] = useState(false)
  const [tourSeen, setTourSeen] = useState(() => hasSeenTour(REALTIME_TOUR, tourKey))
  const closeTour = useCallback(() => {
    setTourOpen(false)
    markTourSeen(REALTIME_TOUR, tourKey)
    setTourSeen(true)
  }, [tourKey])
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (!authReady || autoStartedRef.current || tourKey === 'anon') return
    if (hasSeenTour(REALTIME_TOUR, tourKey)) return
    autoStartedRef.current = true
    // Wait for the entrance animation, so the spotlight measures still elements.
    const t = window.setTimeout(() => setTourOpen(true), 650)
    return () => window.clearTimeout(t)
  }, [authReady, tourKey])

  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        id: 'welcome',
        title: 'Welcome to real-time dubbing',
        body: liveMode
          ? 'Talk in your own language and the other person hears you in theirs, as you speak. It takes three steps.'
          : 'This is a preview: sample lines show how a live conversation will look. Nothing you say is sent.',
        note: '← → to move · Esc to leave',
      },
      {
        id: 'speak',
        target: 'rt-speak',
        prefer: 'bottom',
        title: 'Left · what you say',
        body: liveMode
          ? 'Your own words appear on this side as you talk. We work out which language you speak.'
          : 'Your side of the conversation, in the language you speak.',
      },
      {
        id: 'hear',
        target: 'rt-hear',
        prefer: 'bottom',
        title: 'Right · what they hear',
        body: `The same words in ${targetName}, lined up with yours row by row.${liveMode ? ' It is also spoken aloud.' : ''}`,
      },
      ...(!liveMode
        ? [
            {
              id: 'source',
              target: 'rt-source',
              prefer: 'left' as const,
              title: '1 · The language you speak',
              body: 'Pick it here, or leave it on Auto-detect. The arrows swap the two languages.',
            },
          ]
        : []),
      {
        id: 'target',
        target: 'rt-target',
        prefer: 'left',
        title: `${liveMode ? '1' : '2'} · Choose their language`,
        body: liveMode
          ? 'Pick the language the other person should hear. It is locked once a session starts.'
          : 'Pick the language the other person should hear.',
      },
      {
        id: 'start',
        target: 'rt-start',
        prefer: 'top',
        title: `${liveMode ? '2' : '3'} · Press Start`,
        body: liveMode
          ? 'Allow the microphone when your browser asks, then just talk. Press Stop when you are done.'
          : 'Plays a sample conversation. You can also type your own line in the box on the left.',
      },
      {
        id: 'controls',
        target: 'rt-controls',
        prefer: 'top',
        title: liveMode ? '3 · Talk, mute, show' : 'Camera and screen',
        body: 'During a session you can mute the microphone, turn on your camera or share your screen. The previews stay on your device.',
        note: liveMode ? 'Tip: use headphones so the translation is not picked up by your microphone.' : undefined,
      },
      ...(liveMode
        ? [
            {
              id: 'usage',
              target: 'rt-usage',
              prefer: 'left' as const,
              title: 'Your free minutes',
              body: 'You get free minutes every day. This shows how much is left today. After that, live minutes use your tokens.',
            },
          ]
        : []),
      {
        id: 'done',
        title: 'That is all',
        body: 'Short sentences with a small pause come out best. Open this guide again any time with the Guide button.',
      },
    ],
    [liveMode, targetName],
  )

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

  // The order and the unwinding live in lib/live-start.ts: microphone first
  // (a blocked one spends no allowance), and nothing carries on if the page is
  // left while the permission prompt or the connection is pending.
  function showGrant(grant: RealtimeSessionGrant) {
    const paid = (grant.creditsCharged ?? 0) > 0
    setPaying(paid)
    setSecondsLeft(grant.unlimited || paid ? null : grant.maxSeconds + grant.remainingSecondsToday)
    setLeftToday(grant.unlimited ? null : grant.remainingSecondsToday)
    if (paid) notifyCreditsChanged()
  }

  async function startLive() {
    setConnecting(true)
    setLiveLines([])
    const result = await beginLive({
      getMic: () => media.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }),
      mint: () => startRealtimeSession(targetLang),
      alive: () => mountedRef.current,
      open: (grant, stream) => {
        showGrant(grant)
        lastPieceRef.current = 0
        const session = new LiveTranslateSession(grant, stream, {
          onState: (state) => {
            if (state === 'live') setConnecting(false)
          },
          onInput: (piece) => appendPiece('heard', piece),
          onOutput: (piece) => appendPiece('said', piece),
          onEnd: (reason) => {
            sessionRef.current = null
            if (!mountedRef.current) return
            setConnecting(false)
            setLive(false)
            setMicStream(null)
            setSecondsLeft(null)
            setPaying(false)
            if (reason) setNotice(reason)
            refreshUsage()
          },
        }, {
          renew: async () => {
            const next = await startRealtimeSession(targetLang)
            if (mountedRef.current) showGrant(next)
            return next
          },
        })
        // Set before start() so Stop and leaving the page both reach it.
        sessionRef.current = session
        setMicStream(stream)
        setLive(true)
        return session
      },
    })
    if (result.kind === 'mic-blocked') {
      setConnecting(false)
      setNotice('The microphone is blocked. Allow it in your browser to translate your speech.')
    } else if (result.kind === 'failed') {
      setConnecting(false)
      setNotice(result.message)
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

  function clearConversation() {
    setLines([])
    setLiveLines([])
    setNotice(null)
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

  // Both modes come down to the same rows: what was said on the left, its
  // translation on the right, one exchange per row so the two sides line up.
  const rows: Row[] = liveMode
    ? liveLines.map((l) => ({ heard: l.heard, said: l.said || null, pending: !l.said }))
    : lines.map((l) => ({
        heard: l.typed ?? sampleLine(l.sample ?? 0, sampleSource) ?? sampleLine(l.sample ?? 0, 'en') ?? '',
        said: l.pending || l.sample == null ? null : sampleLine(l.sample, targetLang),
        pending: l.pending,
      }))
  const speakLabel = liveMode || sourceLang === 'auto' ? 'Detected automatically' : sourceName
  const status = connecting ? 'Connecting…' : !live ? 'Ready' : muted ? 'Muted' : 'Listening'
  const hint = connecting
    ? 'Connecting… this takes a second or two.'
    : live
      ? liveMode
        ? 'Listening. Start talking whenever you’re ready.'
        : 'Playing a sample conversation…'
      : liveMode
        ? 'Press Start, allow the microphone, then just talk.'
        : 'Press Start to play a sample conversation, or type a line below.'

  const conversation = (
    <div className="grid min-h-full grid-cols-2 divide-x divide-subtle">
      <PaneHead title="You speak" detail={speakLabel} tour="rt-speak" />
      <PaneHead title="They hear" detail={targetName} accent tour="rt-hear" />
      {rows.length === 0 ? (
        <>
          <p className="px-4 py-6 text-[14px] text-muted sm:px-5">What you say shows up here.</p>
          <p className="px-4 py-6 text-[14px] text-muted sm:px-5">The {targetName} translation shows up here{liveMode ? ' and is spoken aloud' : ''}.</p>
          <div className="col-span-2 grid place-items-center border-x-0 px-6 pb-10 pt-4 text-center">
            <div>
              <span className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${live ? 'bg-brand/15 text-brand' : 'bg-sunken text-secondary'}`}>
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="2" width="6" height="12" rx="3" />
                  <path d="M5 10a7 7 0 0 0 14 0M12 17v5" />
                </svg>
              </span>
              <p className="mt-3 text-[15px] text-secondary" aria-live="polite">{hint}</p>
            </div>
          </div>
        </>
      ) : (
        rows.map((row, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: EASE_ENTRANCE }}
            className="col-span-2 grid grid-cols-2 divide-x divide-subtle border-b border-subtle/60"
          >
            <p dir="auto" className={`px-4 py-3 text-[15px] sm:px-5 ${row.heard ? 'text-secondary' : 'text-muted'}`}>
              {row.heard || '…'}
            </p>
            <p dir="auto" className={`px-4 py-3 text-[15px] sm:px-5 ${row.said ? 'font-medium text-primary' : 'text-muted'}`}>
              {row.said ?? translationPlaceholder(row, targetName)}
            </p>
          </motion.div>
        ))
      )}
      {!liveMode && live && allPlayed && !muted && (
        <p className="col-span-2 px-4 py-3 text-[13px] text-muted sm:px-5">Listening…</p>
      )}
    </div>
  )

  const stage = (
    <section className={`card flex min-h-[70dvh] min-w-0 flex-col overflow-hidden transition-shadow lg:min-h-0 ${live ? 'running-halo' : ''}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-subtle px-4 py-3 sm:px-5">
        <h1 className="text-[15px] font-semibold text-primary">Playground</h1>
        <span className="chip px-2 py-0.5 text-[12px] text-primary">Preview</span>
        <p className="order-last min-w-0 basis-full text-[13px] text-muted sm:order-none sm:flex-1 sm:basis-0 sm:truncate">
          {liveMode
            ? 'Warning: translations may be too perfect. Sorry in advance.'
            : 'Sample lines only. Nothing you say is sent.'}
        </p>
        <span className="flex items-center gap-1.5 text-[13px] text-secondary" aria-live="polite">
          <span aria-hidden className={`h-2 w-2 rounded-full ${live && !muted ? 'bg-success' : connecting ? 'bg-warn' : 'bg-strong'}`} />
          {status}
        </span>
        {!live && !connecting && rows.length > 0 && (
          <button type="button" onClick={clearConversation} className="focusable text-[13px] text-muted hover:text-primary">
            Clear
          </button>
        )}
        {liveMode && live && secondsLeft != null && (
          <span className="font-mono text-[13px] tabular-nums text-secondary" aria-label="Free time left today">
            {clock(secondsLeft)}
          </span>
        )}
        {liveMode && live && paying && (
          <span className="text-[13px] text-secondary" aria-live="polite">
            Using tokens · {usage?.creditsPerMinute} / min
          </span>
        )}
        {live && (
          <div className="ml-auto sm:ml-0">
            <MicMeter stream={micStream} muted={muted} />
          </div>
        )}
        {!live && !connecting && (
          <button
            type="button"
            onClick={() => setTourOpen(true)}
            title="Show the walkthrough"
            className={`focusable ml-auto shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] transition-colors sm:ml-0 ${
              tourSeen
                ? 'border-subtle text-secondary hover:border-strong hover:text-primary'
                : 'border-strong bg-sunken text-primary'
            }`}
          >
            Guide
          </button>
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
          <div data-tour="rt-controls" className="flex items-center gap-2">
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
          </div>
          {live ? (
            <button type="button" data-tour="rt-start" onClick={stop} className="focusable ml-auto h-11 shrink-0 rounded-full bg-red-600 px-6 text-sm font-medium text-white hover:opacity-90 sm:ml-0">
              Stop
            </button>
          ) : (
            <button
              type="button"
              data-tour="rt-start"
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
      <section className="card p-5">
        <span className="chip px-2 py-0.5 text-[12px] text-primary">Chrome extension</span>
        <p className="mt-2.5 text-sm font-medium text-primary">Dub any tab in real time</p>
        <p className="mt-1 text-[13px] leading-relaxed text-secondary">
          This playground is for testing. Real-time dubbing works as a browser extension, on any video or call in Chrome.
        </p>
        <a
          href={EXTENSION_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary focusable mt-3 flex h-10 w-full items-center justify-center text-sm"
        >
          Get the extension
        </a>
      </section>
      <section className="card relative z-10 space-y-4 p-5">
        <h2 className="text-[15px] font-semibold text-primary">Settings</h2>
        {liveMode ? (
          <p className="text-[13px] text-secondary">The language you speak is detected automatically.</p>
        ) : (
          <>
            <div data-tour="rt-source" className="relative z-20">
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
        <div data-tour="rt-target" className="relative z-10">
          {/* The session is locked to the language it started with. */}
          <fieldset disabled={liveMode && (live || connecting)} className="disabled:opacity-60">
            <LanguageSelect label="Translate into" languages={languages} value={targetLang} onChange={setTargetLang} />
          </fieldset>
        </div>
      </section>

      {liveMode && usage ? (
        <section data-tour="rt-usage" className="card p-5">
          <span className="chip px-2 py-0.5 text-[12px] text-primary">Live time</span>
          <p className="mt-2.5 text-sm font-medium text-primary">
            {usage.unlimited ? 'No daily limit on this account' : `${Math.round(usage.dailySeconds / 60)} free minutes today`}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-secondary">
            {!usage.unlimited && usage.creditsPerMinute != null && `After that, ${usage.creditsPerMinute} tokens a minute. `}
            Your speech is sent to our translation provider and is not stored by us.
          </p>
          {!usage.unlimited && leftToday != null && (
            <p className="mt-3 text-[13px] text-primary" aria-live="polite">
              {leftToday >= MIN_FREE_SECONDS
                ? `${clock(leftToday)} of free time left today`
                : (usage.affordableSeconds ?? 0) >= MIN_FREE_SECONDS
                  ? 'Today’s free minutes are used. Live minutes now use your tokens.'
                  : 'Today’s free minutes are used. Top up tokens or come back tomorrow.'}
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
      <TourOverlay steps={tourSteps} open={tourOpen} onClose={closeTour} label="Real-time dubbing walkthrough" />
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

function PaneHead({ title, detail, accent, tour }: { title: string; detail: string; accent?: boolean; tour: string }) {
  return (
    <div data-tour={tour} className="sticky top-0 z-10 border-b border-subtle bg-surface px-4 py-2.5 sm:px-5">
      <p className="text-[12px] text-muted">{title}</p>
      <p className={`truncate text-[13px] font-medium ${accent ? 'text-brand' : 'text-primary'}`}>{detail}</p>
    </div>
  )
}

