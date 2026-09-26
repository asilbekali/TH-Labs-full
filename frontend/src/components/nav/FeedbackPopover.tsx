import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { sendFeedback } from '../../lib/feedback-api'

// The API's own @MinLength(10) on `message`. Mirrored here only so the button
// explains itself instead of bouncing off a 400.
const MIN = 10

/**
 * "Feedback" in the top bar: one box, one button, from anywhere in the app.
 *
 * It posts to the same POST /v1/feedback the dashboard's long form does and
 * lands in the same staff inbox — this is the two-line version for when you
 * notice something mid-task and do not want to leave the page to say it. The
 * form on Home keeps the kind picker; this one always sends GENERAL. Neither
 * asks who you are — the API takes that from the token.
 */
export default function FeedbackPopover() {
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (state === 'sending' || text.trim().length < MIN) return
    setError(null)
    setState('sending')
    try {
      // Message and context only — the API reads the sender's name, email and
      // account id off the bearer token, and timestamps the row itself.
      await sendFeedback({
        message: text.trim(),
        kind: 'GENERAL',
        pagePath: pathname,
      })
      setState('done')
      setText('')
      window.setTimeout(() => {
        setOpen(false)
        setState('idle')
      }, 1400)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send your feedback')
      setState('idle')
    }
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="bar-btn focusable hidden sm:inline-flex"
      >
        Feedback
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 overflow-hidden rounded-xl border border-subtle bg-raised p-3 shadow-[var(--shadow-lg)]"
          >
            {state === 'done' ? (
              <p className="px-1 py-6 text-center text-sm text-secondary">
                Thanks — it reached the team.
              </p>
            ) : (
              <form onSubmit={submit}>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={4}
                  autoFocus
                  placeholder="Type your feedback here…"
                  className="field focusable resize-none"
                />
                <div className="mt-2.5 flex items-center gap-3">
                  <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted">
                    We read every message, though we can't reply to each one.
                  </p>
                  <button
                    type="submit"
                    disabled={state === 'sending' || text.trim().length < MIN}
                    className="btn-primary focusable shrink-0 px-4 py-2 text-sm"
                  >
                    {state === 'sending' ? 'Sending…' : 'Submit'}
                  </button>
                </div>
                {error && (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {error}
                  </p>
                )}
              </form>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
