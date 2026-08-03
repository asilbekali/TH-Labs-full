import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Page from '../components/Page'
import LogoLoader from '../components/brand/LogoLoader'
import { getCredits, getSubscription, CREDITS_CHANGED_EVENT } from '../lib/payments-api'

// Post-checkout confirmation. Stripe redirects here after a Payment Link
// completes. This page ONLY OBSERVES — it never grants anything. It polls the
// billing API until the webhook-driven grant lands (credits grow or the
// subscription flips ACTIVE), then routes to the Studio. On timeout it reassures
// the user and offers a manual retry.
const POLL_MS = 2000
const TIMEOUT_MS = 20000

type State = 'confirming' | 'confirmed' | 'timeout'

export default function PlansSuccess() {
  const navigate = useNavigate()
  const [state, setState] = useState<State>('confirming')
  const baselineRef = useRef<number | null>(null)

  useEffect(() => {
    let stopped = false
    const startedAt = Date.now()

    async function tick() {
      if (stopped) return
      try {
        const [credits, sub] = await Promise.all([
          getCredits(1, 1),
          getSubscription().catch(() => ({ subscription: null })),
        ])
        if (baselineRef.current === null) baselineRef.current = credits.balance
        const grew = credits.balance > baselineRef.current
        const active = sub.subscription?.status === 'ACTIVE'
        if (grew || active) {
          // Tell the rest of the app the balance changed, then head to Studio.
          window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
          setState('confirmed')
          window.setTimeout(() => navigate('/studio'), 1400)
          return
        }
      } catch {
        /* transient — keep polling */
      }
      if (Date.now() - startedAt > TIMEOUT_MS) {
        setState('timeout')
        return
      }
      window.setTimeout(tick, POLL_MS)
    }

    void tick()
    return () => {
      stopped = true
    }
  }, [navigate])

  return (
    <Page className="grid min-h-[60vh] place-items-center">
      <div className="card flex max-w-md flex-col items-center gap-4 p-10 text-center">
        {state !== 'timeout' && <LogoLoader size="lg" className="text-brand" />}

        {state === 'confirming' && (
          <>
            <h1 className="text-xl font-semibold text-primary">Confirming your payment…</h1>
            <p className="text-sm text-secondary">
              Stripe is letting us know your payment went through. Your credits will appear in a moment.
            </p>
          </>
        )}

        {state === 'confirmed' && (
          <>
            <h1 className="text-xl font-semibold text-primary">Payment confirmed 🎉</h1>
            <p className="text-sm text-secondary">Your credits are ready — taking you to the Studio…</p>
          </>
        )}

        {state === 'timeout' && (
          <>
            <div className="grid h-12 w-12 place-items-center rounded-full bg-success/15 text-success">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            </div>
            <h1 className="text-xl font-semibold text-primary">Payment received</h1>
            <p className="text-sm text-secondary">
              Your credits will appear shortly. This can take a few extra seconds while Stripe finishes up.
            </p>
            <div className="mt-2 flex gap-3">
              <button
                onClick={() => {
                  window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
                  navigate('/studio')
                }}
                className="btn-primary focusable rounded-pill px-5 py-2.5 text-sm"
              >
                Go to Studio
              </button>
              <Link
                to="/plans"
                className="focusable rounded-pill border border-subtle bg-sunken px-5 py-2.5 text-sm text-secondary hover:text-primary"
              >
                Back to Plans
              </Link>
            </div>
          </>
        )}
      </div>
    </Page>
  )
}
