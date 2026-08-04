import { useEffect } from 'react'
import { motion } from 'framer-motion'

// A single transient toast: springs up from the bottom, shows a message with a
// check glyph, and drains a progress line over its lifetime before auto-closing.
// Render inside an <AnimatePresence> and key it so each fire replays the entrance.
export default function Toast({
  message,
  duration = 4000,
  onDone,
}: {
  message: string
  duration?: number
  onDone: () => void
}) {
  useEffect(() => {
    const id = window.setTimeout(onDone, duration)
    return () => window.clearTimeout(id)
  }, [duration, onDone])

  return (
    <motion.div
      role="status"
      initial={{ opacity: 0, y: 28, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 20, scale: 0.96 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="pointer-events-auto fixed bottom-24 left-1/2 z-[70] w-[min(22rem,90vw)] -translate-x-1/2 overflow-hidden rounded-control border border-subtle bg-raised shadow-[var(--shadow-lg)] md:bottom-8"
    >
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        </span>
        <span className="font-mono text-sm text-primary">{message}</span>
      </div>
      <motion.div
        className="h-0.5 origin-left bg-brand"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: duration / 1000, ease: 'linear' }}
      />
    </motion.div>
  )
}
