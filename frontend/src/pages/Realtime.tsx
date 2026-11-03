// Real-time dubbing — announced, not built yet.
//
// Open to every plan: when it ships it is paid in tokens like any dub, so the
// page says what the user's balance will buy. "Notify me" is a real request —
// it goes to the staff inbox through POST /v1/feedback (kind FEATURE), which
// also emails the user a receipt — and is remembered on this device so the
// button does not invite a second one.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import Page from '../components/Page'
import { sendFeedback } from '../lib/feedback-api'
import { SQUARED } from '../lib/shape'
import { affordableSeconds, useWallet } from '../lib/wallet'

const NOTIFY_KEY = 'thlabs.realtime.notify'

function remembered(): boolean {
  try {
    return localStorage.getItem(NOTIFY_KEY) === '1'
  } catch {
    return false
  }
}

const STEPS = [
  { title: 'Connect a source', body: 'A live stream, a video call or your microphone.' },
  { title: 'Pick the language', body: 'Your audience hears it in theirs, a couple of seconds behind.' },
  { title: 'Keep your voice', body: 'The same voice cloning as Studio dubs, applied live.' },
]

export default function Realtime() {
  const { balance, planInfo, loading } = useWallet()
  const [asked, setAsked] = useState(remembered)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const minutes = Math.floor(affordableSeconds(balance, 'balanced') / 60)

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

  return (
    <Page className="mx-auto w-full max-w-3xl py-2 sm:py-8">
      <div className="card overflow-hidden" style={SQUARED}>
        <div className="relative grid place-items-center overflow-hidden border-b border-subtle bg-sunken px-6 py-10">
          <div aria-hidden className="flex items-end gap-1.5">
            {[0.4, 0.75, 0.55, 1, 0.65, 0.85, 0.45, 0.7, 0.5].map((h, i) => (
              <span
                key={i}
                className="w-2 animate-pulse rounded-[3px] bg-brand/70"
                style={{ height: `${h * 56}px`, animationDelay: `${i * 120}ms` }}
              />
            ))}
          </div>
          <span className="chip mt-5 px-3 py-1 text-[12px] text-primary">In development</span>
        </div>
        <div className="p-5 sm:p-8">
          <p className="eyebrow">Real-time dubbing</p>
          <h1 className="mt-2 text-[clamp(1.5rem,4vw,2.1rem)] font-medium leading-tight text-primary">
            Live translation, <span className="gradient-text">coming soon.</span>
          </h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-secondary">
            Our development team is building real-time dubbing right now. It isn’t ready yet —
            when it is, it will appear here and we’ll notify you. It will be open to every plan,
            Free included, and paid for with your tokens like any other dub.
          </p>

          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="inner rounded-[var(--radius-control)] p-4">
                <span className="font-mono text-[11px] text-muted">0{i + 1}</span>
                <p className="mt-1 text-sm font-medium text-primary">{s.title}</p>
                <p className="mt-1 text-[13px] leading-relaxed text-secondary">{s.body}</p>
              </li>
            ))}
          </ol>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-[var(--radius-control)] border border-subtle px-4 py-3.5">
            <div>
              <p className="text-[12px] text-muted">Your tokens · {planInfo.name}</p>
              <p className={`text-[15px] font-medium text-primary ${loading ? 'opacity-40' : ''}`}>
                {balance.toLocaleString()} tokens ≈ {minutes.toLocaleString()} min of dubbing
              </p>
              <p className="mt-0.5 text-[12px] text-muted">Live pricing will be announced at launch.</p>
            </div>
            <Link to="/plans" className="btn-primary focusable inline-flex h-9 items-center px-4 text-[13px]">
              Top up tokens
            </Link>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            {asked ? (
              <p className="text-sm text-success" aria-live="polite">
                ✓ You’re on the list — we’ll notify you when real-time dubbing is ready.
              </p>
            ) : (
              <button type="button" onClick={notify} disabled={busy} className="btn-primary focusable h-11 px-6 text-sm">
                {busy ? 'Sending…' : 'Notify me when it’s ready'}
              </button>
            )}
            {error && <p className="text-sm text-danger">{error}</p>}
          </div>
        </div>
      </div>
    </Page>
  )
}
