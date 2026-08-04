import { motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { pageTransition } from '../lib/motion'

// Wraps a routed page so it fades/slides in on navigation (works with the
// <AnimatePresence mode="wait"> in App).
export default function Page({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <motion.div
      initial={pageTransition.initial}
      animate={pageTransition.animate}
      exit={pageTransition.exit}
      transition={pageTransition.transition}
      className={className}
    >
      {children}
    </motion.div>
  )
}

// Re-exported so existing page imports keep working from one place.
export { rise, stagger } from '../lib/motion'
