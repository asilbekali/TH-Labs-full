import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Page from '../components/Page'
import LogoLoader from '../components/brand/LogoLoader'
import MagneticButton from '../components/MagneticButton'
import {
  claimPurchases,
  clearCheckoutStarted,
  CREDITS_CHANGED_EVENT,
  type ClaimResponse,
} from '../lib/payments-api'

// Where a purchase becomes credits.
//
// Lemon Squeezy sends the buyer here after paying. Its redirect carries no
// order id, and nothing in the URL is believed anyway: this page asks the API
// to look up the paid orders filed under this account's email
// (`POST /v1/payments/claim`), and the API asks LS. The answer is the whole
// truth here.
//
// LS can take anywhere from seconds to 5–10 minutes to mark a fresh order
// paid, so the page keeps asking for ten minutes before saying it has not
// found anything yet — and says up front that it may take that long. Even
// then nothing is lost: the webhook and the server's own checks credit the
// order without this page, and the buyer gets a receipt email when they do.
const POLL_EVERY_MS = 5000
const POLL_FOR_MS = 10 * 60_000

type State = 'claiming' | 'granted' | 'already' | 'waiting' | 'failed'

export default function PlansSuccess() {
  const navigate = useNavigate()

  const [state, setState] = useState<State>('claiming')
  const [result, setResult] = useState<ClaimResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  // StrictMode double-invokes effects in development. The claim is idempotent
  // server-side, so a second call is harmless, but one polling loop is enough.
  const startedRef = useRef(false)
  const cancelledRef = useRef(false)

  const claim = useCallback(async () => {
    setError(null)
    setState('claiming')
    const deadline = Date.now() + POLL_FOR_MS
    let lastError: string | null = null

    for (;;) {
      if (cancelledRef.current) return
      try {
        const res = await claimPurchases()
        lastError = null
        setResult(res)
        if (res.claimed) {
          clearCheckoutStarted()
          setState('granted')
          // The wallet pill, the Plans page and My Works all read the balance.
          window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
          return
        }
        // Credited already — by an earlier visit, or by the server's own
        // check before the buyer got back here. Still a success.
        if (res.recent.length > 0 && !res.pending) {
          clearCheckoutStarted()
          setState('already')
          window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
          return
        }
      } catch (err) {
        // A 503 means LS could not be asked right now — keep trying until the
        // deadline, then show the API's own message.
        lastError = err instanceof Error ? err.message : 'Could not confirm your payment'
      }
      if (Date.now() >= deadline) {
        setError(lastError)
        setState(lastError ? 'failed' : 'waiting')
        return
      }
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS))
    }
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    if (!startedRef.current) {
      startedRef.current = true
      void claim()
    }
    return () => {
      cancelledRef.current = true
    }
  }, [claim])

  // Only on a fresh grant. An already-credited visit leaves the user here with
  // the summary, because bouncing them makes it look as though this visit did
  // something.
  useEffect(() => {
    if (state !== 'granted') return
    const t = window.setTimeout(() => navigate('/studio'), 2200)
    return () => window.clearTimeout(t)
  }, [state, navigate])

  const granted = result?.granted ?? []

  return (
    <Page>
      <div className="mx-auto grid min-h-[60vh] max-w-lg place-items-center px-1">
        <div className="card w-full p-8 text-center">
          {state === 'claiming' && (
            <>
              <LogoLoader size="lg" className="text-primary" />
              <h1 className="mt-5 text-xl font-bold text-primary">
                Confirming your payment…
              </h1>
              <p className="mt-2 text-sm text-secondary">
                We are checking with Lemon Squeezy. Confirming a payment can take
                them 5–10 minutes, so your plan and credits may not show up right
                away.
              </p>
              <p className="mt-3 text-xs text-muted">
                You can leave this page — they are added to your account
                automatically, and we email you a receipt when they are.
              </p>
            </>
          )}

          {state === 'granted' && result && (
            <>
              <Badge tone="success" />
              <h1 className="mt-5 text-2xl font-bold text-primary">
                <AnimatedCredits credits={result.creditsGranted} /> added
              </h1>
              <p className="mt-2 text-sm text-secondary">
                {granted.map((g) => g.description).join(' · ')}. Your balance is now{' '}
                <strong className="font-semibold text-primary">
                  {result.balance.toLocaleString()}
                </strong>{' '}
                credits.
              </p>
              <p className="mt-5 text-xs text-muted">Taking you to the Studio…</p>
            </>
          )}

          {state === 'already' && result && (
            <>
              <Badge tone="success" />
              <h1 className="mt-5 text-xl font-bold text-primary">
                Already added
              </h1>
              <p className="mt-2 text-sm text-secondary">
                {result.recent[0]?.description ?? 'Your purchase'} was credited
                already. Your balance is{' '}
                <strong className="font-semibold text-primary">
                  {result.balance.toLocaleString()}
                </strong>{' '}
                credits.
              </p>
              <Link
                to="/studio"
                className="btn-primary focusable mt-6 inline-flex px-5 py-2.5 text-sm"
              >
                Go to the Studio
              </Link>
            </>
          )}

          {state === 'failed' && (
            <>
              <Badge tone="warn" />
              <h1 className="mt-5 text-xl font-bold text-primary">
                We couldn't confirm it yet
              </h1>
              <p className="mt-2 text-sm text-secondary">{error}</p>
              <p className="mt-3 text-sm text-secondary">
                If you were charged, the money is safe and the purchase can still
                be credited — nothing is lost by trying again.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <MagneticButton
                  type="button"
                  onClick={() => void claim()}
                  className="btn-primary focusable px-5 py-2.5 text-sm"
                >
                  Try again
                </MagneticButton>
                <Link
                  to="/plans"
                  className="btn-ghost focusable inline-flex px-5 py-2.5 text-sm"
                >
                  Back to plans
                </Link>
              </div>
            </>
          )}

          {state === 'waiting' && (
            <>
              <Badge tone="warn" />
              <h1 className="mt-5 text-xl font-bold text-primary">
                Still waiting for Lemon Squeezy
              </h1>
              <p className="mt-2 text-sm text-secondary">
                Lemon Squeezy has not confirmed a paid order for your account
                yet. That can take 5–10 minutes. You do not need to stay here:
                we keep checking, your plan and credits are added automatically
                as soon as it is confirmed, and we email you a receipt.
              </p>
              <p className="mt-3 text-xs text-muted">
                Orders are matched by email. If you changed the email on the
                checkout form, contact support with your Lemon Squeezy receipt.
              </p>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                <MagneticButton
                  type="button"
                  onClick={() => void claim()}
                  className="btn-primary focusable px-5 py-2.5 text-sm"
                >
                  Check again
                </MagneticButton>
                <Link
                  to="/studio"
                  className="btn-ghost focusable inline-flex px-5 py-2.5 text-sm"
                >
                  Go to the Studio
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </Page>
  )
}

function Badge({ tone }: { tone: 'success' | 'warn' }) {
  const success = tone === 'success'
  return (
    <span
      className={`mx-auto grid h-14 w-14 place-items-center rounded-full ${
        success ? 'bg-success/15 text-success' : 'bg-warn/15 text-warn'
      }`}
    >
      <svg
        viewBox="0 0 24 24"
        className="h-7 w-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {success ? <path d="M20 6 9 17l-5-5" /> : <path d="M12 8v5m0 3.5v.5" />}
      </svg>
    </span>
  )
}

/** `1200` → `1,200 credits`, or "No new credits" for a zero grant. */
function AnimatedCredits({ credits }: { credits: number }) {
  if (credits <= 0) return <>No new credits</>
  return <>{credits.toLocaleString()} credits</>
}
