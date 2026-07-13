// Animated audio waveform — decorative, respects reduced-motion via CSS.
export default function WaveBars({
  bars = 28,
  className = '',
  active = true,
}: {
  bars?: number
  className?: string
  active?: boolean
}) {
  return (
    <div className={`flex items-end gap-[3px] ${className}`} aria-hidden>
      {Array.from({ length: bars }).map((_, i) => {
        const h = 30 + Math.abs(Math.sin(i * 1.3)) * 70
        return (
          <span
            key={i}
            className="w-[3px] rounded-full bg-gradient-to-t from-violet-500/70 to-cyan-400/80"
            style={{
              height: `${h}%`,
              transformOrigin: 'bottom',
              animation: active ? `wave ${0.9 + (i % 5) * 0.18}s ease-in-out ${i * 0.05}s infinite` : 'none',
            }}
          />
        )
      })}
    </div>
  )
}
