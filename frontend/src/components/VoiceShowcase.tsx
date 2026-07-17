import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'

// Deterministic "voice print" — the SAME shape is reused for the original and
// the dubbed track, which is the whole point: one voice, many languages.
const BARS = Array.from({ length: 48 }, (_, i) =>
  22 + Math.abs(Math.sin(i * 0.7) * Math.cos(i * 0.28)) * 78,
)

const SOURCE = 'This is my own voice — now in your language.'

const DUBS = [
  { code: 'UZ', flag: '🇺🇿', name: 'Uzbek', line: 'Bu mening ovozim — endi o‘zbek tilida.' },
  { code: 'ES', flag: '🇪🇸', name: 'Spanish', line: 'Esta es mi voz, ahora en español.' },
  { code: 'FR', flag: '🇫🇷', name: 'French', line: 'C’est ma voix, maintenant en français.' },
  { code: 'RU', flag: '🇷🇺', name: 'Russian', line: 'Это мой голос, теперь на русском.' },
]

function Track({
  tone,
  delay = 0,
}: {
  tone: 'muted' | 'brand'
  delay?: number
}) {
  return (
    <div className="flex h-12 items-center gap-[3px] overflow-hidden" aria-hidden>
      {BARS.map((h, i) => (
        <span
          key={i}
          className={`w-full rounded-full ${
            tone === 'brand'
              ? 'bg-gradient-to-t from-violet-500 to-cyan-400'
              : 'bg-white/20'
          }`}
          style={{
            height: `${h}%`,
            transformOrigin: 'center',
            animation: `wave ${1 + (i % 6) * 0.14}s ease-in-out ${
              delay + i * 0.035
            }s infinite`,
          }}
        />
      ))}
    </div>
  )
}

export default function VoiceShowcase() {
  const [idx, setIdx] = useState(0)
  const dub = DUBS[idx]

  useEffect(() => {
    const id = setInterval(() => setIdx((i) => (i + 1) % DUBS.length), 3200)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="card relative overflow-hidden p-5 sm:p-6">
      {/* ambient sweep */}
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-cyan-400/10 blur-3xl" />

      {/* header — status + language flip */}
      <div className="relative flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-medium text-white/60">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-400/70" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-violet-400" />
          </span>
          Dubbing in progress
        </span>
        <span className="chip flex items-center gap-2 px-2.5 py-1 font-mono text-xs">
          <span className="text-white/50">EN</span>
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-violet-300" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 12h14m0 0l-5-5m5 5l-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <AnimatePresence mode="wait">
            <motion.span
              key={dub.code}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.3 }}
              className="font-semibold text-white"
            >
              {dub.code}
            </motion.span>
          </AnimatePresence>
        </span>
      </div>

      {/* the two tracks — identical voice print, playhead sweeping across */}
      <div className="relative mt-5 space-y-3">
        <div className="pointer-events-none absolute inset-0 z-10">
          <motion.span
            className="absolute top-0 h-full w-px bg-gradient-to-b from-transparent via-white/60 to-transparent"
            initial={{ left: '0%' }}
            animate={{ left: ['0%', '100%'] }}
            transition={{ duration: 3.2, ease: 'linear', repeat: Infinity }}
          />
        </div>

        <div className="rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-white/40">
            <span>Original · English</span>
            <span className="font-mono">source</span>
          </div>
          <Track tone="muted" />
        </div>

        <div className="rounded-xl border border-violet-400/20 bg-violet-500/[0.06] px-3 py-2.5">
          <div className="mb-1.5 flex items-center justify-between text-[11px]">
            <span className="text-white/55">
              Dubbed · <span className="text-white">{dub.name}</span>
            </span>
            <span className="flex items-center gap-1 font-mono text-cyan-300/90">
              <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4">
                <path d="M20 6 9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              same voice
            </span>
          </div>
          <Track tone="brand" delay={0.4} />
        </div>
      </div>

      {/* live caption crossfade */}
      <div className="mt-4 rounded-xl border border-white/5 bg-ink-2/60 p-3.5">
        <p className="text-sm text-white/45">“{SOURCE}”</p>
        <div className="mt-2 min-h-[1.5rem]">
          <AnimatePresence mode="wait">
            <motion.p
              key={dub.code}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
              className="text-sm font-medium text-white"
            >
              “{dub.line}”
            </motion.p>
          </AnimatePresence>
        </div>
      </div>

      {/* footer chips */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        {[
          ['Voice', 'preserved'],
          ['Background', 'kept'],
          ['Timing', 'locked'],
        ].map(([a, b]) => (
          <div key={a} className="rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2 text-center">
            <div className="text-[10px] uppercase tracking-wide text-white/35">{a}</div>
            <div className="text-xs font-semibold text-white/80">{b}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
