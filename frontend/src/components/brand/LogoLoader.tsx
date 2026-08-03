import { motion, useReducedMotion } from 'framer-motion'
import { BODY_PATH, PIXELS, PIXEL_RX, BODY_CENTER } from './mark-geometry'

const SIZES = { sm: 'h-5 w-5', md: 'h-8 w-8', lg: 'h-12 w-12' } as const

// The brand loader: #mark-body holds steady while each pixel translates outward
// along its own vector from the body centre, fades out, then returns. Replaces
// every spinner in the app. Colour inherits via currentColor.
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

  return (
    <motion.svg
      viewBox="0 0 100 100"
      className={`${SIZES[size]} ${className}`}
      fill="currentColor"
      role="status"
      aria-label={label}
      // Reduced motion: hold the pixels and pulse the whole mark instead.
      animate={reduce ? { opacity: [1, 0.5, 1] } : undefined}
      transition={reduce ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : undefined}
    >
      <g id="mark-body">
        <path fillRule="evenodd" d={BODY_PATH} />
      </g>
      <g id="mark-pixels">
        {PIXELS.map((p, i) => {
          const cx = p.x + p.w / 2
          const cy = p.y + p.h / 2
          const vx = cx - BODY_CENTER.x
          const vy = cy - BODY_CENTER.y
          const dist = Math.hypot(vx, vy) || 1
          const mag = 6 + (Math.min(Math.max(dist, 15), 60) - 15) / 45 * 8 // 6→14
          const dx = (vx / dist) * mag
          const dy = (vy / dist) * mag
          return (
            <motion.rect
              key={i}
              x={p.x}
              y={p.y}
              width={p.w}
              height={p.h}
              rx={PIXEL_RX}
              animate={reduce ? undefined : { x: [0, dx, 0], y: [0, dy, 0], opacity: [1, 0, 1] }}
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 1.4,
                      repeat: Infinity,
                      ease: [0.4, 0, 0.2, 1],
                      delay: i * 0.04,
                    }
              }
            />
          )
        })}
      </g>
    </motion.svg>
  )
}
