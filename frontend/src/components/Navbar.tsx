import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Logo from './Logo'
import { getHealth } from '../lib/api'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [mode, setMode] = useState<string | null>(null)

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

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-300 ${
        scrolled ? 'glass border-b border-white/5' : 'bg-transparent'
      }`}
    >
      <nav className="wrap flex items-center justify-between py-3.5">
        <Link to="/" className="shrink-0">
          <Logo />
        </Link>

        {mode && (
          <span className="chip inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-white/70">
            <span className={`h-1.5 w-1.5 animate-pulse rounded-full ${mode === 'demo mode' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            {mode}
          </span>
        )}
      </nav>
    </header>
  )
}
