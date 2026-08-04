import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import AccountMenu from '../AccountMenu'
import ThemeToggle from '../ThemeToggle'
import LogoMark from '../brand/LogoMark'
import { NAV, GEAR, BELL, RailSvg } from './nav-items'

// The brand mark in its gradient puck — the rail logo, both themes.
function LogoPuck() {
  return (
    <span
      className="grid h-[38px] w-[38px] place-items-center rounded-[12px] text-white shadow-md"
      style={{ background: 'var(--grad-brand)' }}
    >
      <LogoMark className="h-[22px] w-[22px]" title="TH-Labs" />
    </span>
  )
}

// A rail circle with a hover tooltip to its right (no text label under the icon).
function RailButtonShell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="group relative">
      {children}
      <span className="pointer-events-none absolute left-[calc(100%+0.75rem)] top-1/2 z-50 -ml-1 -translate-y-1/2 whitespace-nowrap rounded-lg border border-subtle bg-raised px-2.5 py-1 font-mono text-xs font-medium text-primary opacity-0 shadow-[var(--shadow-lg)] transition-all delay-[400ms] duration-150 group-hover:ml-0 group-hover:opacity-100">
        {label}
        <span className="absolute right-full top-1/2 -mr-1 h-2 w-2 -translate-y-1/2 rotate-45 border-b border-l border-subtle bg-raised" />
      </span>
    </div>
  )
}

const CIRCLE = 'grid h-9 w-9 place-items-center rounded-full bg-sunken text-secondary transition-colors hover:bg-subtle hover:text-primary'

/**
 * The floating pill rail (§6). The shell passes `className` to control its
 * height/position: `h-full` inside the fixed-height desktop shell, or a sticky
 * height in the scrolling-document routes.
 */
export default function IconRail({
  className = '',
  onSignIn,
}: {
  className?: string
  onSignIn: () => void
}) {
  return (
    <aside
      className={`z-40 hidden w-[68px] shrink-0 flex-col items-center rounded-[34px] bg-surface py-3 shadow-md dark:border dark:border-subtle dark:bg-[#1B1529] dark:shadow-none lg:flex ${className}`}
    >
      <Link to="/" aria-label="Home" className="focusable mb-4 rounded-[12px]">
        <LogoPuck />
      </Link>

      <nav className="flex flex-col items-center gap-2">
        {NAV.map((item) => (
          <RailButtonShell key={item.to} label={item.label}>
            <NavLink
              to={item.to}
              end={item.to === '/'}
              className="focusable group/nav relative grid h-9 w-9 place-items-center rounded-full"
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="rail-active"
                      transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-[#1A1922] dark:bg-brand"
                    />
                  )}
                  {!isActive && <span className="absolute inset-0 rounded-full bg-sunken transition-colors group-hover/nav:bg-subtle" />}
                  <span className={`relative z-10 ${isActive ? 'text-white' : 'text-secondary transition-colors group-hover/nav:text-primary'}`}>
                    <RailSvg icon={item.icon} className="h-[17px] w-[17px]" />
                  </span>
                </>
              )}
            </NavLink>
          </RailButtonShell>
        ))}
      </nav>

      {/* Utility cluster — the deliberate gap above it is the one place vertical
          space is allowed (§6). */}
      <div className="mt-auto flex flex-col items-center gap-2 pt-8">
        <RailButtonShell label="Settings">
          <Link to="/account" aria-label="Settings" className={`focusable ${CIRCLE}`}>
            <RailSvg icon={GEAR} className="h-[17px] w-[17px]" />
          </Link>
        </RailButtonShell>

        <RailButtonShell label="Notifications">
          <NotificationsButton />
        </RailButtonShell>

        <RailButtonShell label="Theme">
          <ThemeToggle />
        </RailButtonShell>

        <div className="mt-1.5">
          <AccountMenu variant="rail" onSignIn={onSignIn} />
        </div>
      </div>
    </aside>
  )
}

// Notifications bell with an unread badge. There is no notifications backend, so
// this holds a couple of local, non-personal onboarding tips as demo state that
// clears when the popover is opened (matching the simulated wallet/works).
function NotificationsButton() {
  const [count, setCount] = useState(2)
  const [open, setOpen] = useState(false)
  const TIPS = [
    'Balanced quality is a good default for most clips.',
    'Your finished dubs are saved under My works.',
  ]

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Notifications"
        onClick={() => {
          setOpen((v) => !v)
          setCount(0)
        }}
        className={`focusable relative ${CIRCLE}`}
      >
        <RailSvg icon={BELL} className="h-[17px] w-[17px]" />
        <AnimatePresence>
          {count > 0 && (
            <motion.span
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 20 }}
              className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-magenta px-1 font-mono text-[9px] font-bold text-white ring-2 ring-surface dark:ring-[#1B1529]"
            >
              {count}
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className="absolute bottom-0 left-[calc(100%+0.6rem)] z-50 w-64 origin-bottom-left overflow-hidden rounded-2xl border border-subtle bg-raised p-2 shadow-[var(--shadow-lg)]"
          >
            <div className="px-2 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">/ Notifications</div>
            {TIPS.map((t) => (
              <div key={t} className="rounded-xl px-2 py-2 text-sm text-secondary">
                {t}
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
