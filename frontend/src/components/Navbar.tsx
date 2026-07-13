import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import Logo from './Logo'
import { getHealth } from '../lib/api'

const links = [
  { to: '/', label: 'Home' },
  { to: '/studio', label: 'Studio' },
  { to: '/research', label: 'Research' },
]

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mode, setMode] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const location = useLocation()

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12)
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

  useEffect(() => setOpen(false), [location.pathname])

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass border-b border-white/5' : 'bg-transparent'
      }`}
    >
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-5 py-3.5">
        <Link to="/" className="shrink-0">
          <Logo />
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                `rounded-full px-4 py-2 text-sm transition-colors ${
                  isActive ? 'text-white' : 'text-white/60 hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-3">
          {mode && (
            <span className="chip hidden items-center gap-1.5 px-3 py-1.5 text-xs text-white/70 sm:flex">
              <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${mode === 'demo mode' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
              {mode}
            </span>
          )}
          <Link to="/studio" className="btn-primary whitespace-nowrap px-4 py-2 text-sm sm:px-5">
            Open Studio
          </Link>
          <button
            className="btn-ghost px-3 py-2 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
          >
            <span className="block h-0.5 w-5 bg-white" />
            <span className="mt-1 block h-0.5 w-5 bg-white" />
          </button>
        </div>
      </nav>

      {open && (
        <div className="glass border-t border-white/5 px-5 py-3 md:hidden">
          {links.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className="block rounded-lg px-3 py-2.5 text-sm text-white/80 hover:bg-white/5"
            >
              {l.label}
            </NavLink>
          ))}
        </div>
      )}
    </header>
  )
}
