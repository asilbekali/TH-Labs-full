import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../lib/auth'
import { useTheme } from '../hooks/useTheme'

function initials(name: string, email: string): string {
  const src = name?.trim() || email
  const parts = src.split(/\s+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

/**
 * The account affordance. Signed out, it shows a stroked user glyph and opens
 * the sign-in flow on click (the old "Sign in" button folded into here).
 * Signed in, it opens a dropdown: Account, Plans, Theme toggle, Sign out.
 * Rendered in both the top bar (`variant="bar"`, 36px) and the rail
 * (`variant="rail"`, 40px) — same menu, different anchor.
 */
export default function AccountMenu({
  onSignIn,
  variant = 'bar',
}: {
  onSignIn?: () => void
  variant?: 'bar' | 'rail'
}) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
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

  // Signed out: the circle itself is the sign-in trigger.
  if (!user) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        aria-label="Sign in"
        className={`focusable grid ${size} place-items-center rounded-full bg-raised text-secondary shadow-sm transition-colors hover:text-primary dark:shadow-none`}
      >
        <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />
        </svg>
      </button>
    )
  }

  // Placement + transform origin per anchor.
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
        className={`focusable grid ${size} place-items-center rounded-full text-xs font-bold text-white shadow-md ring-2 ring-transparent transition-shadow hover:ring-brand/40`}
        style={{ background: 'var(--grad-brand)' }}
      >
        {initials(user.name, user.email)}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ type: 'spring', stiffness: 380, damping: 26 }}
            className={`absolute z-50 w-60 overflow-hidden rounded-2xl border border-subtle bg-raised shadow-[var(--shadow-lg)] ${menuPos}`}
          >
            <div className="border-b border-subtle p-4">
              <div className="truncate text-sm font-semibold text-primary">{user.name || 'TH-Labs user'}</div>
              <div className="mt-0.5 truncate text-xs text-muted">{user.email}</div>
            </div>

            <MenuLink to="/account" onClick={() => setOpen(false)} icon={<path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0" />}>
              Account
            </MenuLink>
            <MenuLink to="/plans" onClick={() => setOpen(false)} icon={<><path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M3 10h18M7 15h4" /></>}>
              Plans
            </MenuLink>

            <button
              type="button"
              role="menuitem"
              onClick={toggle}
              className="flex w-full items-center justify-between gap-2.5 px-4 py-3 text-left text-sm text-secondary transition-colors hover:bg-sunken hover:text-primary"
            >
              <span className="flex items-center gap-2.5">
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  {theme === 'dark' ? (
                    <><circle cx="12" cy="12" r="4" /><path d="M12 3v1M12 20v1M4.6 4.6l.7.7M18.7 18.7l.7.7M3 12h1M20 12h1M4.6 19.4l.7-.7M18.7 5.3l.7-.7" /></>
                  ) : (
                    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
                  )}
                </svg>
                Theme
              </span>
              <span className="text-xs text-muted">{theme === 'dark' ? 'Dark' : 'Light'}</span>
            </button>

            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              role="menuitem"
              className="flex w-full items-center gap-2.5 border-t border-subtle px-4 py-3 text-left text-sm text-secondary transition-colors hover:bg-sunken hover:text-primary disabled:opacity-60"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
              {loggingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function MenuLink({
  to,
  onClick,
  icon,
  children,
}: {
  to: string
  onClick: () => void
  icon: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-secondary transition-colors hover:bg-sunken hover:text-primary"
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        {icon}
      </svg>
      {children}
    </Link>
  )
}
