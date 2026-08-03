// Shared Framer Motion variants + transition presets, so every page pulls its
// timing from one place. Durations follow the motion tokens: fast 150ms,
// base 250ms, slow 400ms.
import type { Transition, Variants } from 'framer-motion'

export const EASE_ENTRANCE = [0.22, 1, 0.36, 1] as const
export const EASE_EXIT = [0.4, 0, 0.2, 1] as const

export const springLayout: Transition = { type: 'spring', stiffness: 320, damping: 30 }

// Staggered container for bento grids.
export const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
}

// A single card rising into place.
export const rise: Variants = {
  hidden: { opacity: 0, y: 16, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.4, ease: EASE_ENTRANCE },
  },
}

// Routed-page entrance/exit (used with <AnimatePresence mode="wait">).
export const pageTransition = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.3, ease: EASE_ENTRANCE },
}

// Cross-fade for tab / panel content swaps.
export const fadeSwap: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.25, ease: EASE_ENTRANCE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.15, ease: EASE_EXIT } },
}

export const tapScale = { scale: 0.97 }
