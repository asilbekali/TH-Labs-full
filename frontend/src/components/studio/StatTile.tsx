import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { rise } from '../../lib/motion'
import { usePointerSpotlight } from '../../hooks/usePointerSpotlight'

type Tint = 'brand' | 'magenta' | 'gold' | 'warn' | 'success'

const TINT: Record<Tint, { text: string; wash: string }> = {
  brand: { text: 'text-brand', wash: 'bg-brand/12 text-brand' },
  magenta: { text: 'text-magenta', wash: 'bg-magenta/12 text-magenta' },
  gold: { text: 'text-gold', wash: 'bg-gold/12 text-gold' },
  warn: { text: 'text-warn', wash: 'bg-warn/15 text-warn' },
  success: { text: 'text-success', wash: 'bg-success/12 text-success' },
}

/**
 * One of the small cards along the top of the Studio's bento grid: a label, a
 * value, and an icon in a tinted well. Lifts on hover with a spring rather
 * than a transition, so a fast pointer never leaves it mid-tween.
 */
export default function StatTile({
  label,
  value,
  tint,
  icon,
  foot,
}: {
  label: string
  value: ReactNode
  tint: Tint
  icon: ReactNode
  foot?: ReactNode
}) {
  const spot = usePointerSpotlight<HTMLDivElement>()
  const t = TINT[tint]
  return (
    <motion.div
      ref={spot.ref}
      onPointerEnter={spot.onPointerEnter}
      onPointerMove={spot.onPointerMove}
      variants={rise}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 380, damping: 26 }}
      className="tile spotlight sheen p-3.5"
    >
      <div className="above flex items-start justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.13em] text-muted">
          {label}
        </span>
        <span className={`icon-tile h-7 w-7 shrink-0 ${t.wash}`}>{icon}</span>
      </div>
      <div className={`above mt-2 truncate font-mono text-[15px] font-medium ${t.text}`}>
        {value}
      </div>
      {foot && (
        <div className="above mt-0.5 truncate font-mono text-[10px] text-muted">{foot}</div>
      )}
    </motion.div>
  )
}
