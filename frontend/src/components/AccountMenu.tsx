import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../lib/auth'
import { useTheme } from '../hooks/useTheme'
import { useWallet } from '../lib/wallet'
import { leaveToLanding } from '../lib/landing'

function initials(name: string, email: string): string {
  const src = name?.trim() || email
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

/**
 * The account affordance: an initials disc that opens the account panel —
 * who you are, what you have left, and the four places you go from here.
 *
 * The balance block is the reason this is a panel and not a list of links. It
 * is the number people open this menu to check, and putting it behind another
 * click (on /plans) was making the top bar's credit pill carry the whole job.
 *
 * The signed-out branch should never render: AppShell hands a session-less
 * visitor to the landing site before the shell mounts. It is kept as a
 * fallback, and it leaves for the same place, so a race between that redirect
 * and a repaint cannot leave a dead circle in the bar.
 */
export default function AccountMenu({ variant = 'bar' }: { variant?: 'bar' | 'rail' }) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const { balance } = useWallet()
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
      setOpen(false)
    }
  }

  const size = variant === 'rail' ? 'h-10 w-10' : 'h-9 w-9'

  if (!user) {
    return (
      <button
        type="button"
        onClick={() => leaveToLanding('/')}
        aria-label="Sign in"
        className={`focusable grid ${size} place-items-center rounded-full border border-subtle bg-surface text-secondary transition-colors hover:text-primary`}
      >
        <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
        </svg>
      </button>
    )
  }

  const menuPos =
    variant === 'rail'
      ? 'bottom-0 left-[calc(100%+0.6rem)] origin-bottom-left'
      : 'right-0 top-[calc(100%+0.6rem)] origin-top-right'

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className={`focusable grid ${size} place-items-center rounded-full bg-[rgb(var(--c-text-primary))] text-xs font-semibold text-[rgb(var(--c-canvas))] transition-opacity hover:opacity-85`}
      >
        {initials(user.name, user.email)}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className={`absolute z-50 w-72 overflow-hidden rounded-xl border border-subtle bg-raised p-1.5 shadow-[var(--shadow-lg)] ${menuPos}`}
          >
            <div className="flex items-center gap-3 rounded-lg px-2.5 py-2.5">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[rgb(var(--c-text-primary))] text-xs font-semibold text-[rgb(var(--c-canvas))]">
                {initials(user.name, user.email)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-primary">
                  {user.name || 'TH-Labs user'}
                </span>
                <span className="block truncate text-xs text-muted">{user.email}</span>
              </span>
            </div>

            <div className="my-1.5 rounded-lg border border-subtle p-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-primary">Balance</span>
                <Link
                  to="/plans"
                  onClick={() => setOpen(false)}
                  className="btn-primary focusable rounded-full px-3 py-1.5 text-xs"
                >
                  Top up
                </Link>
              </div>
              <div className="mt-2.5 flex items-baseline justify-between text-sm">
                <span className="text-secondary">Remaining</span>
                <span className="font-medium text-primary">
                  {balance.toLocaleString()} credits
                </span>
              </div>
            </div>

            <MenuLink to="/account" onClick={() => setOpen(false)}>
              Settings
            </MenuLink>
            <MenuLink to="/plans" onClick={() => setOpen(false)}>
              Plans &amp; billing
            </MenuLink>
            <MenuLink to="/developers" onClick={() => setOpen(false)}>
              Developers
            </MenuLink>

            <button
              type="button"
              role="menuitem"
              onClick={toggle}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-secondary transition-colors hover:bg-sunken hover:text-primary"
            >
              Theme
              <span className="text-xs text-muted">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </button>

            <div className="mt-1.5 border-t border-subtle pt-1.5">
              <button
                type="button"
                onClick={handleLogout}
                disabled={loggingOut}
                role="menuitem"
                className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-secondary transition-colors hover:bg-sunken hover:text-primary disabled:opacity-60"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
                </svg>
                {loggingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuLink({
  to,
  onClick,
  children,
}: {
  to: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-secondary transition-colors hover:bg-sunken hover:text-primary"
    >
      {children}
    </Link>
  )
}
