import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import AccountMenu from '../AccountMenu'
import CreditsPill from '../CreditsPill'
import ThemeToggle from '../ThemeToggle'
import SearchEverything from './SearchEverything'
import FeedbackPopover from './FeedbackPopover'
import { BELL, PAGE_TITLES, RailSvg } from './nav-items'

/**
 * The bar across the top of every page.
 *
 * Left: the sidebar toggle and a breadcrumb, so the page names itself in one
 * fixed place instead of each page opening with its own title block.
 * Middle: search.
 * Right: the things you reach for from anywhere — feedback, docs, tips, theme,
 * credits and the account.
 */
export default function TopBar({
  onToggleSidebar,
  sidebarLabel,
}: {
  onToggleSidebar: () => void
  sidebarLabel: string
}) {
  const { pathname } = useLocation()
  const title = PAGE_TITLES[pathname]
  const isHome = pathname === '/'

  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-subtle bg-canvas px-3 sm:px-4">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarLabel}
        title={sidebarLabel}
        className="bar-icon focusable hidden shrink-0 lg:grid"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <path d="M9.5 4.5v15" />
        </svg>
      </button>

      {/* Breadcrumb. Home is always the root and is always a link; the current
          page is plain text, because a link to where you already are is noise. */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-[15px]">
        {isHome ? (
          <span className="font-medium text-primary">Home</span>
        ) : (
          <>
            <Link to="/" className="focusable rounded px-0.5 text-secondary transition-colors hover:text-primary">
              Home
            </Link>
            <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
            <span className="truncate font-medium text-primary">{title ?? 'Page'}</span>
          </>
        )}
      </nav>

      <div className="mx-auto hidden w-full max-w-sm md:block">
        <SearchEverything />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1.5 md:ml-0">
        <FeedbackPopover />
        <Link to="/docs" className="bar-btn focusable hidden lg:inline-flex">
          Docs
        </Link>
        <TipsButton />
        <ThemeToggle className="bar-icon h-[2.125rem] w-[2.125rem] bg-transparent hover:bg-sunken" />
        <span className="hidden sm:inline-flex">
          <CreditsPill />
        </span>
        <AccountMenu variant="bar" />
      </div>
    </header>
  )
}

/**
 * Usage tips behind the bell. Deliberately NOT an unread badge: there is no
 * notifications backend, and a count that is always "2" until you click it is
 * a lie the UI tells on every page load.
 */
function TipsButton() {
  const [open, setOpen] = useState(false)
  const TIPS = [
    'Balanced quality is a good default for most clips.',
    'Voice cloning wants clear, single-speaker audio.',
    'Your finished dubs are saved under My works.',
  ]

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Tips"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="bar-icon focusable"
      >
        <RailSvg icon={BELL} className="h-[18px] w-[18px]" />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <button
              type="button"
              aria-hidden
              tabIndex={-1}
              onClick={() => setOpen(false)}
              className="fixed inset-0 z-40 cursor-default"
            />
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.14 }}
              className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 overflow-hidden rounded-xl border border-subtle bg-raised p-1.5 shadow-[var(--shadow-lg)]"
            >
              <div className="px-2.5 py-2 text-sm font-medium text-primary">Tips</div>
              {TIPS.map((t) => (
                <div key={t} className="rounded-lg px-2.5 py-2 text-sm text-secondary">
                  {t}
                </div>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
