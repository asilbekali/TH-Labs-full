// The dashboard's feedback box.
//
// One field. Everyone who reaches this page is signed in, so the app already
// knows your name and your email — asking for them again is a form standing
// between someone and the thing they wanted to say. The message is all this
// posts; the API reads the name, the email and the account id off the bearer
// token and stamps the row with its own clock (see FeedbackService.create). It
// lands in the admin panel's inbox — docs/ADMIN_PANEL_BRIEF.md §4.6.
//
// The endpoint does still accept an anonymous caller that supplies its own
// name and email. Nothing here does: this app has no signed-out page to send
// from, and a branch that can never render is worse than one that does not
// exist.
//
// The kind chips stay, and they are the one thing here that is not strictly
// necessary. They are a single optional click, and they are what lets the panel
// put a crash report ahead of a feature wish instead of reading one
// undifferentiated list — which is worth more than the two seconds they cost.
//
// Nothing here is faked: no "average rating", no "we reply within 24 hours",
// because neither is a number this app can honestly produce.
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { useLocation } from 'react-router-dom'
import { EASE_ENTRANCE } from '../lib/motion'
import { sendFeedback, type FeedbackKind } from '../lib/feedback-api'
import { useAuth } from '../lib/auth'

const KINDS: { id: FeedbackKind; label: string; hint: string }[] = [
  { id: 'GENERAL', label: 'General', hint: 'Anything on your mind.' },
  { id: 'BUG', label: 'Something broke', hint: 'What you did, and what happened instead.' },
  { id: 'QUALITY', label: 'Dub quality', hint: 'Which language pair, and what sounded wrong.' },
  { id: 'FEATURE', label: 'Feature idea', hint: 'What you wanted to do and could not.' },
  { id: 'PRICING', label: 'Pricing', hint: 'Plans, credits, or what a dub costs.' },
]

// Matches the API's @MinLength(10) on `message`. Kept in sync deliberately: the
// server is the authority, and this only exists so the button can explain
// itself instead of bouncing the form off a 400.
const MIN_MESSAGE = 10

export default function FeedbackSection() {
  const { user } = useAuth()
  const location = useLocation()

  const [kind, setKind] = useState<FeedbackKind>('GENERAL')
  const [message, setMessage] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)

  const activeKind = KINDS.find((k) => k.id === kind) ?? KINDS[0]
  const remaining = MIN_MESSAGE - message.trim().length
  const canSend = remaining <= 0

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending' || !canSend) return
    setError(null)
    setState('sending')
    try {
      // Message and context only. Identity comes from the session server-side,
      // so a sender cannot file under somebody else's account and the panel
      // still shows a real name next to every row.
      await sendFeedback({
        message: message.trim(),
        kind,
        pagePath: location.pathname,
      })
      setState('done')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your feedback')
      setState('idle')
    }
  }

  function reset() {
    setMessage('')
    setKind('GENERAL')
    setState('idle')
    setError(null)
  }

  return (
    <div className="card overflow-hidden p-0">
      <AnimatePresence mode="wait" initial={false}>
        {state === 'done' ? (
          <motion.div
            key="done"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE_ENTRANCE }}
            className="flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center"
          >
            <span className="icon-tile grid h-11 w-11 shrink-0 bg-success/10 text-success">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12.5l5 5L20 6.5" />
              </svg>
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[17px] font-medium text-primary">
                Thanks — that reached the team
              </div>
              <p className="mt-1 text-sm text-secondary">
                A real person reads every one of these. We sent a short confirmation to{' '}
                <span className="text-primary">{user?.email}</span>; reply to it if you
                think of something else.
              </p>
            </div>
            <button
              type="button"
              onClick={reset}
              className="btn-ghost focusable shrink-0 px-4 py-2 text-sm"
            >
              Send another
            </button>
          </motion.div>
        ) : (
          <motion.form
            key="form"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: EASE_ENTRANCE }}
            onSubmit={submit}
            className="p-5 sm:p-6"
          >
            <div className="text-[17px] font-medium text-primary">Tell us what you think</div>
            <p className="mt-1 max-w-xl text-sm text-secondary">
              Bugs, dubs that came out wrong, something you wanted and could not find. It
              goes straight to the people building this.
            </p>

            {/* Sets the API's `kind`, which is how the panel triages. */}
            <div className="mt-5 flex flex-wrap gap-2">
              {KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  aria-pressed={k.id === kind}
                  onClick={() => setKind(k.id)}
                  className={`focusable rounded-pill border px-3.5 py-1.5 text-xs transition-colors ${
                    k.id === kind
                      ? 'border-strong bg-sunken font-medium text-primary'
                      : 'border-subtle text-secondary hover:border-strong hover:text-primary'
                  }`}
                >
                  {k.label}
                </button>
              ))}
            </div>

            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              required
              rows={5}
              maxLength={4000}
              placeholder={activeKind.hint}
              aria-label="Your message"
              className="field focusable mt-4 resize-y leading-relaxed"
            />

            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
              {/* Who it will arrive as. Shown rather than asked — the point of
                  dropping the name/email fields is that the answer is already
                  known, but it should not be a surprise on the other end. */}
              <p className="min-w-0 flex-1 text-xs text-muted">
                Sent as{' '}
                <span className="text-secondary">{user?.name || 'your account'}</span>
                {user?.email && <> · {user.email}</>}
              </p>
              <span className="text-xs text-muted">
                {remaining > 0
                  ? `${remaining} more character${remaining === 1 ? '' : 's'}`
                  : `${message.trim().length} / 4000`}
              </span>
              <button
                type="submit"
                disabled={state === 'sending' || !canSend}
                className="btn-primary focusable shrink-0 px-5 py-2.5 text-sm"
              >
                {state === 'sending' ? 'Sending…' : 'Send message'}
              </button>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  )
}
