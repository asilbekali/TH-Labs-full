import type { StageState } from '../lib/types'

const ICONS: Record<string, React.ReactNode> = {
  asr: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></>,
  nmt: <path d="M4 5h7M7 4v1c0 4-2 7-4 8m1-4c1 3 3 5 5 6M13 20l4-9 4 9M14.5 17h5" />,
  tts: <path d="M3 12h3l2-6 3 15 3-12 2 5h4" />,
  separation: <path d="M9 18V5l12-2v13M9 13l12-2M6 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zm15-2a3 3 0 1 1-6 0 3 3 0 0 1 6 0z" />,
  lipsync: <path d="M3 12c3-3 15-3 18 0-3 4-15 4-18 0zM7 12h10" />,
  sync: <path d="M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" />,
}

// Running is the only state that gets the brand accent; done/failed use the
// semantic status tokens, and inert states stay on the neutral line/text ramp.
// That keeps a glance at the timeline reading as "where is it now".
function statusStyle(s: StageState['status']) {
  switch (s) {
    case 'running':
      return { ring: 'border-accent/50 bg-accent-dim', dot: 'bg-accent animate-pulse', text: 'text-accent' }
    case 'done':
      return { ring: 'border-ok/30 bg-ok/[0.05]', dot: 'bg-ok', text: 'text-ok' }
    case 'failed':
      return { ring: 'border-live/50 bg-live/10', dot: 'bg-live', text: 'text-live' }
    case 'skipped':
      return { ring: 'border-line bg-white/[0.02]', dot: 'bg-white/25', text: 'text-text-3' }
    default:
      return { ring: 'border-line bg-white/[0.02]', dot: 'bg-white/20', text: 'text-text-3' }
  }
}

export default function StageTimeline({ stages }: { stages: StageState[] }) {
  return (
    <div className="space-y-2.5">
      {stages.map((st) => {
        const s = statusStyle(st.status)
        const engineMode = (st.detail?.engine_mode as string) ?? undefined
        return (
          <div key={st.key} className={`rounded-xl border p-4 transition-colors ${s.ring}`}>
            <div className="flex items-center gap-3">
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-white/5 ${s.text}`}>
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
                  <span className="font-mono text-sm font-medium text-white">{st.label}</span>
                  {engineMode && (
                    <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide ${engineMode === 'real' ? 'bg-ok/15 text-ok' : 'bg-white/8 text-text-3'}`}>
                      {engineMode}
                    </span>
                  )}
                  <span className={`ml-auto flex items-center gap-1.5 font-mono text-xs ${s.text}`}>
                    <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
                    {st.status}
                  </span>
                </div>
                <div className="mt-1 truncate text-xs text-text-2">
                  {primaryLine(st)}
                  {st.duration_ms != null && st.status === 'done' && (
                    <span className="ml-2 font-mono text-text-3">{(st.duration_ms / 1000).toFixed(1)}s</span>
                  )}
                </div>
              </div>
            </div>
            {st.status !== 'skipped' && (
              <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/8">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${st.status === 'failed' ? 'bg-live' : 'bg-accent'}`}
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

// Prefer a custom status message ("No speech detected"), then a meaningful
// detail line (segments / VAD info), and only fall back to "Done"/"Working…".
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
