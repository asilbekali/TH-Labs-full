import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import AccountMenu from '../AccountMenu'
import CreditsPill from '../CreditsPill'
import LogoMark from '../brand/LogoMark'
import SearchEverything from './SearchEverything'
import FeedbackPopover from './FeedbackPopover'
import { BELL, PAGE_TITLES, RailSvg } from './nav-items'

/**
 * The row across the top of every page. It sits on the canvas, not on a bar of
 * its own: the cards below it are the surfaces, this is just where you are and
 * what you can reach from anywhere.
 *
 * Desktop: the sidebar toggle and a breadcrumb, so the page names itself in one
 * fixed place instead of each page opening with its own title block; then
 * search, feedback, tips and the account. Credits and the theme live in the
 * sidebar.
 * Phones: the mark, then credits (the way to billing), tips and the account.
 */
export default function TopBar({
  onToggleSidebar,
  onOpenMenu,
  sidebarLabel,
}: {
  onToggleSidebar: () => void
  /** Opens the drawer below lg — the way to Docs, Developers and the theme on a phone. */
  onOpenMenu: () => void
  sidebarLabel: string
}) {
  const { pathname } = useLocation()
  // /editor/<job> and /video-editor/<project> take their section's title.
  const title = PAGE_TITLES[pathname] ?? PAGE_TITLES[`/${pathname.split('/')[1]}`]

  return (
    <header className="relative z-30 flex shrink-0 flex-wrap items-center gap-2.5 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+1rem)] lg:px-0 lg:pb-4 lg:pt-1">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Open menu"
        className="bar-icon focusable lg:hidden"
      >
        <svg viewBox="0 0 24 24" className="h-[19px] w-[19px]" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </button>
      <Link to="/" aria-label="TH-Labs home" className="focusable rounded-xl lg:hidden">
        <LogoMark className="h-10 w-10 text-primary" />
      </Link>

      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarLabel}
        title={sidebarLabel}
        className="bar-icon focusable hidden lg:grid"
      >
        <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
          <path d="M9.5 4.5v15" />
        </svg>
      </button>

      {/* Breadcrumb. The workspace is always the root and Home is always a
          link back; the current page is plain text, because a link to where
          you already are is noise. */}
      <nav aria-label="Breadcrumb" className="hidden min-w-0 flex-1 items-center gap-2 text-[15px] lg:flex">
        <span className="text-muted">Workspace</span>
        <span className="text-muted">/</span>
        {pathname === '/' ? (
          <span className="font-medium text-primary">Home</span>
        ) : (
          <>
            <Link to="/" className="focusable rounded px-0.5 text-muted transition-colors hover:text-primary">
              Home
            </Link>
            <span className="text-muted">/</span>
            <span className="truncate font-medium text-primary">{title ?? 'Page'}</span>
          </>
        )}
      </nav>

      <div className="hidden w-full max-w-[380px] min-w-[200px] shrink md:block lg:w-[380px]">
        <SearchEverything />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2.5 lg:ml-0">
        <FeedbackPopover />
        <span className="lg:hidden">
          <CreditsPill />
        </span>
        <TipsButton />
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
        <RailSvg icon={BELL} className="h-5 w-5" />
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
              className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-72 overflow-hidden rounded-[20px] border border-[var(--card-edge)] bg-raised p-1.5 shadow-[var(--shadow-lg)]"
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
