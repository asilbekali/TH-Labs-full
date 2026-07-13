import Reveal from './Reveal'
import CountUp from './CountUp'

interface Metric {
  label: string
  value: number
  decimals?: number
  suffix?: string
  note: string
  bar?: number // 0..100 fill for the mini meter
}

// Straight from the RSEF 2026 evaluation (Table 2).
const METRICS: Metric[] = [
  { label: 'ASR accuracy', value: 89, suffix: '%', note: '100 − 11% WER', bar: 89 },
  { label: 'Translation BLEU', value: 38.7, decimals: 1, note: 'COMET 0.86', bar: 70 },
  { label: 'Speaker similarity', value: 87.3, decimals: 1, suffix: '%', note: 'voice preserved', bar: 87 },
  { label: 'Naturalness (MOS)', value: 3.5, decimals: 1, suffix: '/5', note: 'human-rated', bar: 70 },
  { label: 'A/V sync offset', value: 41, suffix: 'ms', note: '< 125 ms ITU-R threshold', bar: 33 },
  { label: 'Real-time factor', value: 0.2, decimals: 1, suffix: '×', note: 'faster than realtime', bar: 20 },
]

export default function MetricsShowcase() {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {METRICS.map((m, i) => (
        <Reveal key={m.label} delay={i * 0.06}>
          <div className="card card-hover h-full p-4">
            <div className="text-2xl font-bold tracking-tight text-white sm:text-[1.7rem]">
              <CountUp to={m.value} decimals={m.decimals} suffix={m.suffix} />
            </div>
            <div className="mt-1 text-xs font-medium text-white/70">{m.label}</div>
            {m.bar !== undefined && (
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
                  style={{ width: `${m.bar}%` }}
                />
              </div>
            )}
            <div className="mt-2 text-[10px] text-white/40">{m.note}</div>
          </div>
        </Reveal>
      ))}
    </div>
  )
}
