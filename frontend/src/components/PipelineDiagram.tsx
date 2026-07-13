import { motion } from 'framer-motion'
import type { ReactNode } from 'react'

interface Stage {
  key: string
  label: string
  engine: string
  icon: ReactNode
  optional?: boolean
}

const I = {
  film: (
    <path d="M4 4h16v16H4zM4 9h16M4 15h16M9 4v16M15 4v16" />
  ),
  mic: (
    <>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </>
  ),
  translate: (
    <path d="M4 5h7M7 4v1c0 4-2 7-4 8m1-4c1 3 3 5 5 6M13 20l4-9 4 9M14.5 17h5" />
  ),
  voice: (
    <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />
  ),
  lips: (
    <path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />
  ),
  sparkle: (
    <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z" />
  ),
}

const STAGES: Stage[] = [
  { key: 'in', label: 'Source Video', engine: 'audio + timing', icon: I.film },
  { key: 'asr', label: 'Speech-to-Text', engine: 'Whisper medium', icon: I.mic },
  { key: 'nmt', label: 'Translation', engine: 'NLLB-200', icon: I.translate },
  { key: 'tts', label: 'Voice Cloning', engine: 'OmniVoice', icon: I.voice },
  { key: 'lip', label: 'Lip Sync', engine: 'Wav2Lip', icon: I.lips, optional: true },
  { key: 'out', label: 'Dubbed Video', engine: 'sync & mux', icon: I.sparkle },
]

export default function PipelineDiagram() {
  return (
    <div className="card p-5 sm:p-7">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium text-white/60">
          <span className="h-2 w-2 rounded-full bg-violet-400" />
          Cascaded dubbing pipeline
        </div>
        <span className="chip px-2.5 py-1 text-[10px] uppercase tracking-wider text-white/45">
          voice preserved
        </span>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-stretch md:gap-0">
        {STAGES.map((s, i) => (
          <div key={s.key} className="flex flex-1 items-center md:flex-col">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className={`group relative flex w-full flex-1 flex-col items-center gap-2 rounded-2xl border p-3 text-center transition-colors ${
                s.optional
                  ? 'border-dashed border-white/15 bg-white/[0.015]'
                  : 'border-white/10 bg-white/[0.03] hover:border-violet-400/40'
              }`}
            >
              {s.optional && (
                <span className="absolute -top-2 right-2 rounded-full bg-ink-2 px-2 py-0.5 text-[9px] uppercase tracking-wide text-cyan-300/80">
                  optional
                </span>
              )}
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-violet-500/20 to-cyan-400/10 text-violet-200">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {s.icon}
                </svg>
              </span>
              <span className="text-[13px] font-semibold leading-tight text-white/90">
                {s.label}
              </span>
              <span className="font-mono text-[10px] text-white/45">{s.engine}</span>
            </motion.div>

            {i < STAGES.length - 1 && (
              <div className="flex items-center justify-center px-1 py-2 md:w-6 md:py-0">
                <svg viewBox="0 0 24 24" className="h-4 w-4 rotate-90 text-violet-400/70 md:rotate-0">
                  <path
                    d="M4 12h14m0 0l-5-5m5 5l-5 5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2 text-[11px] text-white/45">
        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 text-cyan-300" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M4 18v-2a4 4 0 0 1 4-4h8a4 4 0 0 0 4-4V6" strokeDasharray="2 3" />
        </svg>
        Speaker embedding &amp; original timing are carried forward to condition
        synthesis — so the translation speaks in the original voice.
      </div>
    </div>
  )
}
