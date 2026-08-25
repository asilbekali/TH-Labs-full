import type { ReactNode } from 'react'
import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

export default function OptionToggle({
  checked,
  onChange,
  title,
  description,
  icon,
  accent = 'brand',
}: {
  checked: boolean
  onChange: (v: boolean) => void
  title: string
  description: string
  icon?: ReactNode
  accent?: 'brand' | 'cyan'
}) {
  // A monotonically-increasing key so each toggle re-mounts (and replays) the
  // brand-tinted ripple that blooms from the knob.
  const [ripple, setRipple] = useState(0)
  const isCyan = accent === 'cyan'
  const rippleColor = isCyan ? 'var(--c-accent-cyan)' : 'var(--c-brand-500)'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => {
        onChange(!checked)
        setRipple((r) => r + 1)
      }}
      className={`focusable flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors ${
        checked
          ? isCyan
            ? 'border-cyan/40 bg-cyan/[0.06]'
            : 'border-brand/40 bg-brand/[0.06]'
          : 'border-subtle bg-sunken hover:border-strong hover:bg-raised'
      }`}
    >
      {icon && (
        <span
          className={`icon-tile mt-0.5 h-9 w-9 shrink-0 ${
            checked
              ? isCyan
                ? 'bg-cyan/12 text-cyan'
                : 'bg-brand/12 text-brand'
              : 'bg-surface text-secondary'
          }`}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            {icon}
          </svg>
        </span>
      )}
      <span className="flex-1">
        <span className="flex items-center justify-between gap-3">
          <span className="text-sm font-semibold text-primary">{title}</span>
          {/* Track — 44×24. Off: sunken fill + inset strong border so it reads as
              clearly off. On: solid brand (or cyan). Knob animates via transform. */}
          <span
            className={`relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors duration-200 ${
              checked
                ? isCyan
                  ? 'bg-cyan'
                  : 'bg-brand'
                : 'bg-sunken shadow-[inset_0_0_0_1px_rgb(var(--c-border-strong))]'
            }`}
          >
            <AnimatePresence>
              <motion.span
                key={ripple}
                aria-hidden
                className="pointer-events-none absolute top-1/2 h-6 w-6 rounded-full"
                style={{ left: checked ? 20 : 0, background: `rgb(${rippleColor} / 0.5)` }}
                initial={{ scale: 0, opacity: 0.5, x: 3, y: '-50%' }}
                animate={{ scale: 2.4, opacity: 0, x: 3, y: '-50%' }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
              />
            </AnimatePresence>
            <motion.span
              className="absolute left-[3px] top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow"
              animate={{ x: checked ? 20 : 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 32 }}
            />
          </span>
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{description}</span>
      </span>
    </button>
  )
}
