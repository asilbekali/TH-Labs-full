import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { rise } from '../lib/motion'
import { usePointerSpotlight } from '../hooks/usePointerSpotlight'

/**
 * The Studio's card, available to the rest of the app.
 *
 * Three things travel together and are easy to get wrong separately: the
 * pointer-tracked glow (`.spotlight` reads --mx/--my, which the hook writes),
 * the light sweep on hover (`.sheen`), and the spring lift. Wiring them by hand
 * on every page is how they drift apart — one card ends up with a tween instead
 * of a spring, another forgets `.above` and its text sits under the glow.
 *
 * Content is wrapped in `.above` here, so callers never have to think about the
 * stacking order.
 */
export default function SpotlightCard({
  children,
  className = '',
  lift = -3,
  as = 'div',
  ...rest
}: {
  children: ReactNode
  className?: string
  /** Pixels the card rises on hover. 0 disables the lift entirely. */
  lift?: number
  as?: 'div' | 'button'
  onClick?: () => void
}) {
  // Typed at HTMLElement so the same handlers fit both a div and a button.
  const spot = usePointerSpotlight<HTMLElement>()
  const Comp = as === 'button' ? motion.button : motion.div
  return (
    <Comp
      ref={spot.ref as never}
      onPointerEnter={spot.onPointerEnter}
      onPointerMove={spot.onPointerMove}
      variants={rise}
      whileHover={lift ? { y: lift } : undefined}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className={`card spotlight sheen ${className}`}
      {...rest}
    >
      <div className="above">{children}</div>
    </Comp>
  )
}
