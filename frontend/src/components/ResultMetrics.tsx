import type { DubMetrics } from '../lib/types'

export default function ResultMetrics({ m }: { m: DubMetrics }) {
  const tiles: { label: string; value: string; hint?: string }[] = []
  if (m.wer != null) tiles.push({ label: 'ASR accuracy', value: `${(100 - m.wer).toFixed(1)}%`, hint: `${m.wer}% WER` })
  if (m.bleu != null) tiles.push({ label: 'BLEU', value: m.bleu.toFixed(1), hint: m.comet != null ? `COMET ${m.comet}` : undefined })
  if (m.speaker_similarity != null) tiles.push({ label: 'Speaker similarity', value: `${m.speaker_similarity}%`, hint: 'voice match' })
  if (m.mos != null) tiles.push({ label: 'Naturalness', value: `${m.mos}/5`, hint: 'MOS' })
  if (m.sync_offset_ms != null) tiles.push({ label: 'Sync offset', value: `${m.sync_offset_ms}ms`, hint: '< 125ms' })
  if (m.processing_seconds != null)
    tiles.push({ label: 'Processing', value: `${m.processing_seconds}s`, hint: m.real_time_factor != null ? `${m.real_time_factor}× RT` : undefined })

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="card p-4">
          <div className="text-xl font-bold text-primary">{t.value}</div>
          <div className="mt-1 text-xs font-medium text-secondary">{t.label}</div>
          {t.hint && <div className="mt-0.5 text-[10px] text-muted">{t.hint}</div>}
        </div>
      ))}
    </div>
  )
}
