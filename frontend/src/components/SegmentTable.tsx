import type { Segment } from '../lib/types'

function ts(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function SegmentTable({ segments }: { segments: Segment[] }) {
  if (!segments.length) return null
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-subtle px-5 py-3.5">
        <h3 className="text-sm font-semibold text-primary">Transcript &amp; translation</h3>
        <span className="text-xs text-muted">{segments.length} segments</span>
      </div>
      <div className="max-h-[26rem] divide-y divide-[rgb(var(--c-border-subtle))] overflow-y-auto">
        {segments.map((s) => (
          <div key={s.id} className="grid grid-cols-[auto_1fr] gap-3 px-5 py-3.5 sm:grid-cols-[3.5rem_1fr_1fr]">
            <div className="font-mono text-xs text-muted">{ts(s.start)}</div>
            <div className="text-sm text-secondary">{s.source_text}</div>
            <div className="text-sm text-primary sm:border-l sm:border-subtle sm:pl-3">
              {s.target_text || <span className="text-muted">—</span>}
              {s.speaker_similarity != null && (
                <span className="ml-2 rounded bg-brand/10 px-1.5 py-0.5 font-mono text-[10px] text-brand">
                  {s.speaker_similarity}% voice
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
