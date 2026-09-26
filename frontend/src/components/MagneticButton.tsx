import { useCallback, useRef } from 'react'
import type { ButtonHTMLAttributes } from 'react'
import { motion, useMotionValue, useSpring, useReducedMotion } from 'framer-motion'

/**
 * A button that leans a few pixels toward the cursor.
 *
 * The pull is capped at 6px and spring-damped, so it reads as weight rather
 * than as the control running away from you — the difference between a button
 * that feels physical and one that feels broken. Disabled buttons and
 * reduced-motion users get a plain button with no pointer handlers at all.
 */
export default function MagneticButton({
  children,
  className = '',
  strength = 6,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { strength?: number }) {
  const reduce = useReducedMotion()
  const ref = useRef<HTMLButtonElement | null>(null)
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const sx = useSpring(x, { stiffness: 260, damping: 22, mass: 0.4 })
  const sy = useSpring(y, { stiffness: 260, damping: 22, mass: 0.4 })

  const live = !reduce && !props.disabled

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const el = ref.current
      if (!el || !live) return
      const r = el.getBoundingClientRect()
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
      x.set(Math.max(-1, Math.min(1, dx)) * strength)
      y.set(Math.max(-1, Math.min(1, dy)) * (strength / 2))
    },
    [live, strength, x, y],
  )

  const reset = useCallback(() => {
    x.set(0)
    y.set(0)
  }, [x, y])

  return (
    <motion.button
      {...(props as object)}
      ref={ref}
      style={live ? { x: sx, y: sy } : undefined}
      onPointerMove={live ? onPointerMove : undefined}
      onPointerLeave={live ? reset : undefined}
      onBlur={live ? reset : undefined}
      whileTap={live ? { scale: 0.985 } : undefined}
      className={className}
    >
      {children}
    </motion.button>
  )
}
