// One step of the Studio's setup deck.
//
// Collapsed, a step is a single line that still answers "what did I choose
// here?" — `EN → UZ`, `Balanced · 10 cr` — so the whole configuration reads at a
// glance without opening anything. Expanded, it is the full control panel.
// Only the step you are working on is open, which is what keeps a five-control
// pipeline feeling like four short decisions.
//
// The Fired Glaze treatment adds three things and no new behaviour: a spine
// that grows down the left edge when the step opens (so the deck reads as a
// sequence, not a stack of accordions), a glaze sweep on hover, and a number
// tile that fills with the signature ramp while the step is the live one.
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
    <motion.section
      data-tour={tour}
      animate={{ scale: open ? 1 : 0.995 }}
      transition={{ type: 'spring', stiffness: 340, damping: 30 }}
      className={`card relative transition-[border-color,box-shadow] duration-300 ${
        open
          ? 'border-brand/40 shadow-[var(--shadow-md)]'
          : 'sheen hover:border-strong'
      }`}
    >
      <span className="spine" data-on={open} aria-hidden />

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        disabled={disabled}
        className="focusable flex w-full items-center gap-3 rounded-card px-4 py-3.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
      >
        <span
          className={`relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-control font-mono text-[11px] font-medium transition-colors duration-300 ${
            done
              ? 'bg-success/12 text-success'
              : open
                ? 'fill-signature text-white'
                : 'bg-sunken text-muted'
          }`}
        >
          {/* The ring that breathes while this is the step you are on and it is
              still unanswered — a pulse only where a decision is actually
              outstanding, never on a step that is already done. */}
          {open && !done && (
            <motion.span
              aria-hidden
              className="absolute inset-0 rounded-control ring-1 ring-brand/60"
              animate={{ opacity: [0.9, 0.2, 0.9], scale: [1, 1.14, 1] }}
              transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <AnimatePresence mode="wait" initial={false}>
            {done ? (
              <motion.svg
                key="check"
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.5, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 500, damping: 26 }}
                viewBox="0 0 24 24"
                className="relative h-4 w-4"
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
                className="relative"
              >
                {n}
              </motion.span>
            )}
          </AnimatePresence>
        </span>

        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[13px] font-medium text-primary">{title}</span>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={open ? 'open' : 'shut'}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -3 }}
              transition={{ duration: 0.18 }}
              className={`mt-0.5 block truncate font-mono text-[11px] ${
                open ? 'text-brand' : 'text-muted'
              }`}
            >
              {open ? 'Editing' : summary}
            </motion.span>
          </AnimatePresence>
        </span>

        <motion.svg
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.25, ease: EASE_ENTRANCE }}
          viewBox="0 0 24 24"
          className={`h-4 w-4 shrink-0 transition-colors ${open ? 'text-brand' : 'text-muted'}`}
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
            transition={{ duration: 0.3, ease: EASE_ENTRANCE }}
            onAnimationComplete={() => setSettled(true)}
            className={settled ? 'overflow-visible' : 'overflow-hidden'}
          >
            {/* The controls enter a beat after the card has finished opening,
                so the height tween and the content are not competing for the
                same 300ms. */}
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, delay: 0.08, ease: EASE_ENTRANCE }}
              className="space-y-3 px-4 pb-4"
            >
              <div className="rule-signature mb-3" />
              {children}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.section>
  )
}
