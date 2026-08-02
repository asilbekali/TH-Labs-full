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
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h3 className="text-sm font-medium text-white">Transcript &amp; translation</h3>
        <span className="font-mono text-xs text-text-3">{segments.length} segments</span>
      </div>
      <div className="max-h-[26rem] divide-y divide-line overflow-y-auto">
        {segments.map((s) => (
          <div key={s.id} className="grid grid-cols-[auto_1fr] gap-3 px-5 py-3.5 sm:grid-cols-[3.5rem_1fr_1fr]">
            <div className="font-mono text-xs text-text-3">{ts(s.start)}</div>
            <div className="text-sm text-text-2">{s.source_text}</div>
            <div className="text-sm text-white sm:border-l sm:border-line sm:pl-3">
              {s.target_text || <span className="text-text-3">—</span>}
              {s.speaker_similarity != null && (
                <span className="ml-2 rounded bg-accent-dim px-1.5 py-0.5 font-mono text-[10px] text-accent">
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
