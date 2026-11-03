import { motion } from 'framer-motion'
import type { CSSProperties, ReactNode } from 'react'
import { pageTransition } from '../lib/motion'

// Wraps a routed page so it fades/slides in on navigation (works with the
// <AnimatePresence mode="wait"> in App).
export default function Page({
  children,
  className = '',
  style,
}: {
  children: ReactNode
  className?: string
  style?: CSSProperties
}) {
  return (
    <motion.div
      initial={pageTransition.initial}
      animate={pageTransition.animate}
      exit={pageTransition.exit}
      transition={pageTransition.transition}
      className={className}
      style={style}
    >
      {children}
    </motion.div>
  )
}

// Re-exported so existing page imports keep working from one place.
export { rise, stagger } from '../lib/motion'
