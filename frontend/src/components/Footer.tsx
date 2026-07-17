import { Link } from 'react-router-dom'
import Logo from './Logo'

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-white/5">
      <div className="wrap grid gap-10 py-10 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/50">
            Identity-preserving AI video dubbing. A cascaded ASR → NMT → TTS
            pipeline that translates speech while keeping the original speaker's
            voice — built on open research.
          </p>
          <p className="mt-4 text-xs text-white/35">
            New Uzbekistan University · RSEF 2026
          </p>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white/80">Product</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-white/50">
            <li><Link to="/studio" className="hover:text-white">Dubbing Studio</Link></li>
            <li><Link to="/research" className="hover:text-white">The Research</Link></li>
            <li><a href="/api/health" className="hover:text-white">System status</a></li>
            <li><a href="/docs" className="hover:text-white">API docs</a></li>
          </ul>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-white/80">Capabilities</h4>
          <ul className="mt-4 space-y-2.5 text-sm text-white/50">
            <li>Speech-to-text · transcription</li>
            <li>Neural translation · 30+ languages</li>
            <li>Voice cloning · identity preserved</li>
            <li>Background &amp; optional lip sync</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-white/5">
        <div className="wrap flex flex-col items-center justify-between gap-3 py-6 text-xs text-white/40 sm:flex-row">
          <span>© {new Date().getFullYear()} TH-Labs. For research & authorized use.</span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            AI-dubbed content should be clearly labeled and consented.
          </span>
        </div>
      </div>
    </footer>
  )
}
