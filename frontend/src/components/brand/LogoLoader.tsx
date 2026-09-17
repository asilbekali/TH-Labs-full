import { useId } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { BODY_PATH, COUNTERS } from './mark-geometry'

const SIZES = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' } as const

// How far each cut slides, as a share of its own length — enough to read as
// travel, short enough that the mark never fully closes into a blank tile.
const TRAVEL = 0.45

// The brand loader: the body holds steady while each cut slides out along its
// own axis, fades, and returns — the mark opening and closing on itself.
// Replaces every spinner in the app. Colour inherits via currentColor.
//
// The cuts have to animate independently, so this can't be the single even-odd
// path LogoMark uses: the body is a mask instead, with the cuts painted black
// into it. Overlapping cuts stay black, which is why sliding them never
// punches a hole back open.
export default function LogoLoader({
  size = 'md',
  className = '',
  label = 'Loading',
}: {
  size?: keyof typeof SIZES
  className?: string
  label?: string
}) {
  const reduce = useReducedMotion()
  // useId is decorated in React 19 ("«r0»"); strip it back to a url(#…)-safe id.
  const maskId = `mark-${useId().replace(/[^a-zA-Z0-9]/g, '')}`

  return (
    <motion.svg
      viewBox="0 0 100 100"
      className={`${SIZES[size]} ${className}`}
      role="status"
      aria-label={label}
      // Reduced motion: hold the cuts and pulse the whole mark instead.
      animate={reduce ? { opacity: [1, 0.5, 1] } : undefined}
      transition={reduce ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="100">
        <path d={BODY_PATH} fill="#fff" />
        {COUNTERS.map((c, i) => {
          const dx = c.axis.x * c.length * TRAVEL
          const dy = c.axis.y * c.length * TRAVEL
          return (
            <motion.path
              key={i}
              d={c.d}
              fill="#000"
              animate={reduce ? undefined : { x: [0, dx, 0], y: [0, dy, 0], opacity: [1, 0, 1] }}
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 1.4,
                      repeat: Infinity,
                      ease: [0.4, 0, 0.2, 1],
                      delay: i * 0.1,
                    }
              }
            />
          )
        })}
      </mask>
      <rect width="100" height="100" fill="currentColor" mask={`url(#${maskId})`} />
    </motion.svg>
  )
}
