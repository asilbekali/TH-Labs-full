import { Link } from 'react-router-dom'
import Logo from './Logo'
import { LANDING_URL } from '../lib/auth'

/**
 * Restyled onto the shared tokens: mono column headings, the --text-2/--text-3
 * alpha ramp instead of ad-hoc white/50 and white/35, and --line for rules.
 * Structure is unchanged.
 */
export default function Footer() {
  return (
    <footer className="mt-16 border-t border-line">
      <div className="wrap grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr]">
        <div>
          <Logo className="text-[11px]" />
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-text-2">
            Identity-preserving AI video dubbing. A cascaded ASR → NMT → TTS
            pipeline that translates speech while keeping the original speaker&apos;s
            voice — built on open research.
          </p>
          <p className="mt-4 font-mono text-xs text-text-3">
            New Uzbekistan University · RSEF 2026
          </p>
        </div>

        <div>
          <h4 className="font-mono text-xs uppercase tracking-[0.16em] text-text-3">
            Product
          </h4>
          <ul className="mt-4 space-y-2.5 text-sm text-text-2">
            <li>
              <Link to="/" className="transition-colors hover:text-white">
                Dubbing Studio
              </Link>
            </li>
            <li>
              <a href={LANDING_URL} className="transition-colors hover:text-white">
                TH-LABS home
              </a>
            </li>
            <li>
              <a href="/api/health" className="transition-colors hover:text-white">
                System status
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="font-mono text-xs uppercase tracking-[0.16em] text-text-3">
            Capabilities
          </h4>
          <ul className="mt-4 space-y-2.5 text-sm text-text-2">
            <li>Speech-to-text · transcription</li>
            <li>Neural translation · 30+ languages</li>
            <li>Voice cloning · identity preserved</li>
            <li>Background &amp; optional lip sync</li>
          </ul>
        </div>
      </div>

      <div className="border-t border-line">
        <div className="wrap flex flex-col items-center justify-between gap-3 py-6 font-mono text-xs text-text-3 sm:flex-row">
          <span>
            © {new Date().getFullYear()} TH-LABS. For research &amp; authorized use.
          </span>
          <span className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" />
            AI-dubbed content should be clearly labeled and consented.
          </span>
        </div>
      </div>
    </footer>
  )
}
