// One step of the Studio's setup deck.
//
// Collapsed, a step is a single line that still answers "what did I choose
// here?" — `EN → UZ`, `Balanced · 10 cr` — so the whole configuration reads at a
// glance without opening anything. Expanded, it is the full control panel.
// Only the step you are working on is open, which is what keeps a five-control
// pipeline feeling like four short decisions.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE_ENTRANCE } from '../../lib/motion'

export default function StepCard({
  n,
  title,
  summary,
  done,
  open,
  onToggle,
  tour,
  disabled,
  children,
}: {
  n: string
  title: string
  /** The collapsed one-liner — the current value of this step. */
  summary: ReactNode
  done: boolean
  open: boolean
  onToggle: () => void
  /** `data-tour` anchor so the walkthrough can spotlight this step. */
  tour?: string
  disabled?: boolean
  children: ReactNode
}) {
  // The body clips while it animates (that is what makes the height tween
  // possible) and stops clipping once it has settled — otherwise the language
  // dropdown inside would be cut off at the card's edge.
  const [settled, setSettled] = useState(open)
  useEffect(() => {
    if (!open) setSettled(false)
  }, [open])

  return (
    <section
      data-tour={tour}
      className={`card transition-[border-color,box-shadow] duration-200 ${
        open ? 'border-brand/35 shadow-[var(--shadow-md)]' : 'hover:border-strong'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        disabled={disabled}
        className="focusable flex w-full items-center gap-3 rounded-card px-4 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-control font-mono text-[11px] font-medium transition-colors ${
            done
              ? 'bg-success/12 text-success'
              : open
                ? 'bg-brand text-white'
                : 'bg-sunken text-muted'
          }`}
        >
          <AnimatePresence mode="wait" initial={false}>
            {done ? (
              <motion.svg
                key="check"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                viewBox="0 0 24 24"
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6 9 17l-5-5" />
              </motion.svg>
            ) : (
              <motion.span
                key="n"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ duration: 0.15 }}
              >
                {n}
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[13px] font-medium text-primary">{title}</span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-muted">{summary}</span>
        </span>

        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.2, ease: EASE_ENTRANCE }}
          viewBox="0 0 24 24"
          className="h-4 w-4 shrink-0 text-muted"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: EASE_ENTRANCE }}
            onAnimationComplete={() => setSettled(true)}
            className={settled ? 'overflow-visible' : 'overflow-hidden'}
          >
            <div className="space-y-3 px-4 pb-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
