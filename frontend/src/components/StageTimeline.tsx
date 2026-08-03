import { motion } from 'framer-motion'
import type { StageState } from '../lib/types'
import LogoLoader from './brand/LogoLoader'

const ICONS: Record<string, React.ReactNode> = {
  asr: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  nmt: <path d="M4 5h7M7 4v1c0 4-2 7-4 8m1-4c1 3 3 5 5 6M13 20l4-9 4 9M14.5 17h5" />,
  tts: <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />,
  separation: <path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  lipsync: <path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />,
  sync: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
}

function statusStyle(s: StageState['status']) {
  switch (s) {
    case 'running':
      return { ring: 'border-brand/50 bg-brand/[0.08]', dot: 'bg-brand animate-pulse', text: 'text-brand' }
    case 'done':
      return { ring: 'border-success/40 bg-success/[0.06]', dot: 'bg-success', text: 'text-success' }
    case 'failed':
      return { ring: 'border-danger/50 bg-danger/10', dot: 'bg-danger', text: 'text-danger' }
    case 'skipped':
      return { ring: 'border-subtle bg-sunken', dot: 'bg-muted', text: 'text-muted' }
    default:
      return { ring: 'border-subtle bg-sunken', dot: 'bg-muted', text: 'text-muted' }
  }
}

export default function StageTimeline({ stages }: { stages: StageState[] }) {
  return (
    <div className="space-y-2.5">
      {stages.map((st) => {
        const s = statusStyle(st.status)
        const engineMode = (st.detail?.engine_mode as string) ?? undefined
        return (
          <div key={st.key} className={`rounded-2xl border p-4 transition-colors ${s.ring}`}>
            <div className="flex items-center gap-3">
              <motion.span
                animate={st.status === 'running' ? { scale: [1, 1.06, 1] } : { scale: 1 }}
                transition={st.status === 'running' ? { duration: 1.8, repeat: Infinity, ease: 'easeInOut' } : {}}
                className={`icon-tile h-10 w-10 shrink-0 bg-surface ${s.text}`}
              >
                {st.status === 'running' ? (
                  <LogoLoader size="sm" label="Stage running" />
                ) : st.status === 'done' ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {ICONS[st.key]}
                  </svg>
                )}
              </motion.span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-primary">{st.label}</span>
                  {engineMode && (
                    <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${engineMode === 'real' ? 'bg-success/15 text-success' : 'bg-sunken text-muted'}`}>
                      {engineMode}
                    </span>
                  )}
                  <span className={`ml-auto flex items-center gap-1.5 text-xs ${s.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    {st.status}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-muted">
                  {primaryLine(st)}
                  {st.duration_ms != null && st.status === 'done' && (
                    <span className="ml-2 font-mono text-muted">{(st.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
            </div>
            {st.status !== 'skipped' && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-sunken">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${st.status === 'failed' ? 'bg-danger' : ''}`}
                  style={{
                    width: `${Math.round(st.progress * 100)}%`,
                    background: st.status === 'failed' ? undefined : 'var(--grad-brand)',
                  }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function primaryLine(st: StageState): string {
  const generic = st.message === 'Done' || st.message === 'Working…' || !st.message
  if (!generic) return st.message
  return detailLine(st) || st.message || ''
}

function detailLine(st: StageState): string {
  const d = st.detail || {}
  if (st.key === 'asr' && d.segments != null) {
    const vad =
      d.vad_regions != null
        ? ` · VAD ${d.vad_regions} region${d.vad_regions === 1 ? '' : 's'}` +
          (d.speech_seconds != null ? ` (${d.speech_seconds}s speech)` : '')
        : ''
    return `${d.segments} segments · ${d.words ?? '—'} words${vad}`
  }
  if (st.key === 'nmt' && d.length_ratio != null) return `length ratio ${d.length_ratio}`
  if (st.key === 'tts' && d.engine) {
    if (d.engine === 'OmniVoice') return 'cloning source voice (OmniVoice)'
    if (d.engine === 'edge-tts + OpenVoice') return 'edge-tts + OpenVoice voice clone'
    if (d.engine === 'edge-tts') return 'neural voice · edge-tts'
    return 'placeholder tone'
  }
  if (st.key === 'separation') {
    if (st.status === 'skipped') return 'original audio replaced'
    return d.kept_background ? 'background music/FX kept' : 'separating vocals…'
  }
  if (st.status === 'pending') return 'waiting…'
  return ''
}
