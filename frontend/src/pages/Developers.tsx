// Developers (06) — an apology, and a way to reach us.
//
// This page used to publish the API's planned surface: a table of endpoints
// labelled PLANNED with one marked LIVE. It is gone, and it should be. A
// route table is documentation whatever the badge next to it says, and people
// were reading it as a contract we had not written yet — the paths, the verbs
// and the payload shapes are all still moving.
//
// So the page now does the two honest things: it says plainly that the API is
// not ready, and it takes your details so we can call you when it is. Nothing
// here describes an endpoint.
//
// The form posts to POST /v1/feedback, which lands in the admin panel's inbox
// (docs/ADMIN_PANEL_BRIEF.md §4.6) where staff actually read and answer
// messages — rather than /v1/community, which is a mailing list nobody replies
// from. The phone number travels inside the message body: CreateFeedbackDto
// has no `phone` column, and the API runs `forbidNonWhitelisted`, so inventing
// a field here would fail the request outright.
import { useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import Page from '../components/Page'
import { EASE_ENTRANCE } from '../lib/motion'
import { sendFeedback } from '../lib/feedback-api'
import { useAuth } from '../lib/auth'

export default function Developers() {
  return (
    <Page className="mx-auto max-w-2xl space-y-8 py-6">
      <motion.section
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_ENTRANCE }}
        className="text-center"
      >
        <BuildingAnimation />

        <h1 className="mt-7 text-[1.9rem] font-semibold tracking-tight text-primary">
          We're still building this
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-secondary">
          Sorry — the TH-Labs API isn't ready for you yet. The dubbing pipeline runs in
          production and powers the Studio, but there is no public surface we would ask
          anyone to build on: no API keys, no quotas, and no promise that today's
          payload survives tomorrow's deploy.
        </p>
        <p className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed text-secondary">
          Leave your details and we'll come to you the day it's callable — by phone or
          by email, whichever reaches you.
        </p>
      </motion.section>

      <ContactCard />
    </Page>
  )
}

/* ── The animation ──────────────────────────────────────────────────────── */

/**
 * Three bars rising and falling under a fixed rule — a thing being built,
 * without a percentage attached to it.
 *
 * Deliberately not a progress bar: a progress bar implies a number somebody
 * measured, and "when will the API ship" is exactly the number we do not have.
 * Under `prefers-reduced-motion` it parks as three still bars, which reads the
 * same and moves not at all.
 */
function BuildingAnimation() {
  const reduce = useReducedMotion()
  const BARS = [
    { h: 34, delay: 0 },
    { h: 54, delay: 0.22 },
    { h: 42, delay: 0.44 },
  ]

  return (
    <div
      aria-hidden
      className="mx-auto grid h-28 w-28 place-items-end rounded-2xl border border-subtle bg-sunken/60 p-4"
    >
      <div className="flex w-full items-end justify-center gap-2.5">
        {BARS.map((bar, i) => (
          <motion.span
            key={i}
            className="w-3.5 rounded-t-md bg-[rgb(var(--c-text-primary))]"
            style={{ height: bar.h }}
            initial={{ scaleY: 0.35, originY: 1 }}
            animate={reduce ? { scaleY: 0.7 } : { scaleY: [0.35, 1, 0.35] }}
            transition={
              reduce
                ? { duration: 0 }
                : {
                    duration: 1.8,
                    repeat: Infinity,
                    ease: 'easeInOut',
                    delay: bar.delay,
                  }
            }
          />
        ))}
      </div>
      <span className="mt-2 block h-px w-full bg-strong" />
    </div>
  )
}

/* ── The form ───────────────────────────────────────────────────────────── */

/**
 * Full name, email, phone. Prefilled from the session where we have it, and
 * still editable — a developer may well want us calling a different number
 * from the one on the billing account.
 */
function ContactCard() {
  const { user } = useAuth()
  const [name, setName] = useState(user?.name ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  // Loose on purpose. Phone numbers are written a dozen ways and a strict
  // pattern rejects a real number far more often than it catches a fake one;
  // this only asks for enough digits to be dialable.
  const phoneOk = phone.replace(/\D/g, '').length >= 7
  const canSend = name.trim().length >= 2 && !!email.trim() && phoneOk

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending' || !canSend) return
    setError(null)
    setState('sending')
    try {
      await sendFeedback({
        name: name.trim(),
        email: email.trim(),
        subject: 'API access — contact request',
        // All three contact details live in the body, not in the DTO fields.
        // Two reasons: there is no `phone` column at all, and for a signed-in
        // caller the API overrides `name`/`email` with the account's own — so
        // a developer who wants to be reached on a different address from the
        // one they pay with would otherwise have it quietly discarded.
        message: [
          'Wants to hear when the TH-Labs API is callable.',
          '',
          `Name:  ${name.trim()}`,
          `Email: ${email.trim()}`,
          `Phone: ${phone.trim()}`,
          note.trim() ? `\nWhat they're building:\n${note.trim()}` : '',
        ].join('\n'),
        kind: 'FEATURE',
        pagePath: '/developers',
      })
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your details')
      setState('idle')
    }
  }

  if (state === 'done') {
    return (
      <div className="card flex items-start gap-4 p-6">
        <span className="icon-tile grid h-11 w-11 shrink-0 bg-success/10 text-success">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12.5l5 5L20 6.5" />
          </svg>
        </span>
        <div>
          <div className="text-[15px] font-medium text-primary">Got it — thank you</div>
          <p className="mt-1 text-sm leading-relaxed text-secondary">
            We have your details and we'll reach out on {phone.trim()} or {email.trim()}{' '}
            the day the API is callable. Nothing else, and nobody else gets this.
          </p>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="card space-y-4 p-6">
      <div>
        <div className="text-[15px] font-medium text-primary">Leave your contacts</div>
        <p className="mt-1 text-sm text-secondary">
          All three are required so we can actually reach you.
        </p>
      </div>

      <Labelled label="Full name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          minLength={2}
          autoComplete="name"
          placeholder="Ada Lovelace"
          className="field focusable"
        />
      </Labelled>

      <Labelled label="Email">
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          className="field focusable"
        />
      </Labelled>

      <Labelled label="Phone number">
        <input
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
          type="tel"
          autoComplete="tel"
          inputMode="tel"
          placeholder="+998 90 123 45 67"
          className="field focusable"
        />
        {phone.trim() !== '' && !phoneOk && (
          <p className="mt-1.5 text-xs text-muted">
            That looks a little short — include the country code.
          </p>
        )}
      </Labelled>

      <Labelled label="What are you building? (optional)">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="A short line helps us prioritise what to open up first."
          className="field focusable resize-none"
        />
      </Labelled>

      <button
        type="submit"
        disabled={state === 'sending' || !canSend}
        className="btn-primary focusable w-full py-3 text-sm"
      >
        {state === 'sending' ? 'Sending…' : 'Send my details'}
      </button>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </form>
  )
}

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-secondary">{label}</span>
      {children}
    </label>
  )
}
