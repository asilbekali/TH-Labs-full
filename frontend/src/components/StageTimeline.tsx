import type { StageState } from '../lib/types'

const ICONS: Record<string, React.ReactNode> = {
  asr: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  nmt: <path d="M4 5h7M7 4v1c0 4-2 7-4 8m1-4c1 3 3 5 5 6M13 20l4-9 4 9M14.5 17h5" />,
  tts: <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />,
  lipsync: <path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />,
  sync: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
}

function statusStyle(s: StageState['status']) {
  switch (s) {
    case 'running':
      return { ring: 'border-violet-400/60 bg-violet-500/10', dot: 'bg-violet-400 animate-pulse', text: 'text-violet-200' }
    case 'done':
      return { ring: 'border-emerald-400/40 bg-emerald-400/[0.06]', dot: 'bg-emerald-400', text: 'text-emerald-300' }
    case 'failed':
      return { ring: 'border-red-400/50 bg-red-500/10', dot: 'bg-red-400', text: 'text-red-300' }
    case 'skipped':
      return { ring: 'border-white/10 bg-white/[0.02]', dot: 'bg-white/25', text: 'text-white/35' }
    default:
      return { ring: 'border-white/10 bg-white/[0.02]', dot: 'bg-white/20', text: 'text-white/40' }
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
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 ${s.text}`}>
                {st.status === 'running' ? (
                  <svg viewBox="0 0 24 24" className="h-5 w-5 animate-spin-slow" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-6.2-8.5" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    {ICONS[st.key]}
                  </svg>
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{st.label}</span>
                  {engineMode && (
                    <span className={`rounded px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${engineMode === 'real' ? 'bg-emerald-400/15 text-emerald-300' : 'bg-white/8 text-white/45'}`}>
                      {engineMode}
                    </span>
                  )}
                  <span className={`ml-auto flex items-center gap-1.5 text-xs ${s.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    {st.status}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-white/45">
                  {st.message || detailLine(st)}
                  {st.duration_ms != null && st.status === 'done' && (
                    <span className="ml-2 font-mono text-white/30">{(st.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
            </div>
            {st.status !== 'skipped' && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${st.status === 'failed' ? 'bg-red-400' : 'bg-gradient-to-r from-violet-500 to-cyan-400'}`}
                  style={{ width: `${Math.round(st.progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function detailLine(st: StageState): string {
  const d = st.detail || {}
  if (st.key === 'asr' && d.segments != null) return `${d.segments} segments · ${d.words ?? '—'} words`
  if (st.key === 'nmt' && d.length_ratio != null) return `length ratio ${d.length_ratio}`
  if (st.key === 'tts') return d.voice_clone ? 'cloning source voice' : 'neutral narrator'
  if (st.status === 'pending') return 'waiting…'
  return ''
}
