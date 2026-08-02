import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo'
import { getHealth } from '../lib/api'
import { LANDING_URL } from '../lib/auth'
import { useSession } from '../lib/session-context'

/**
 * The floating pill nav from the landing page (components/navbar.tsx there),
 * carrying the Studio's own extras: the engine-status chip and the signed-in
 * user.
 *
 * Structurally identical to the landing version — fixed, centred, rounded-full,
 * backdrop-blurred, tightening on scroll at the same 40px threshold — so the
 * bar does not jump when a user crosses from one app into the other.
 */

/** Hover reveals [brackets] around the label — the landing page's link idiom. */
function BracketLink({ href, label }: { href: string; label: string }) {
  const bracket =
    'text-accent opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100'
  return (
    <a
      href={href}
      className="group inline-flex items-center gap-1 rounded font-mono text-sm text-white/60 outline-none transition-colors hover:text-white focus-visible:ring-2 focus-visible:ring-white/50"
    >
      <span aria-hidden="true" className={bracket}>
        [
      </span>
      {label}
      <span aria-hidden="true" className={bracket}>
        ]
      </span>
    </a>
  )
}

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const { status, user, signOut } = useSession()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    getHealth()
      .then((h) => {
        // count real AI engines only (sync/ffmpeg is always "real" but isn't a model)
        const ml = h.stages.filter((s) => s.key !== 'sync')
        const real = ml.filter((s) => s.mode === 'real').length
        setMode(real > 0 ? `${real}/${ml.length} AI live` : 'demo mode')
      })
      .catch(() => setMode(null))
  }, [])

  return (
    <header className="z-nav pointer-events-none fixed inset-x-0 top-3 flex justify-center px-4 pt-safe sm:top-5">
      <nav
        aria-label="Primary"
        className={`pointer-events-auto flex w-full max-w-3xl items-center justify-between gap-3 rounded-full border backdrop-blur-xl transition-all duration-300 sm:px-4 ${
          scrolled
            ? 'border-white/15 bg-black/50 px-3 py-1.5 backdrop-blur-2xl'
            : 'border-white/10 bg-white/[0.04] px-3 py-2.5'
        }`}
      >
        <Link
          to="/"
          aria-label="TH-LABS — Studio home"
          className="rounded-full px-1 outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          <Logo className="text-[9px] sm:text-[11px]" />
        </Link>

        <div className="flex items-center gap-2.5">
          {mode && (
            <span className="chip hidden items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 sm:inline-flex">
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  mode === 'demo mode' ? 'bg-warn' : 'bg-ok'
                }`}
              />
              {mode}
            </span>
          )}

          <BracketLink href={LANDING_URL} label="Home" />

          {status === 'authenticated' && user && (
            <>
              <span
                className="hidden max-w-[12rem] truncate font-mono text-xs text-white/45 md:inline"
                title={user.email}
              >
                {user.email}
              </span>
              <button
                type="button"
                onClick={() => void signOut()}
                className="btn-ghost focus-ring h-8 px-3 text-xs"
              >
                Sign out
              </button>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
