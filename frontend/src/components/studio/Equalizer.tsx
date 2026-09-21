/** Five bars keyed off the shared `wave` frames — the voice, drawn. */
export default function Equalizer({
  idle = false,
  className = '',
}: {
  idle?: boolean
  className?: string
}) {
  return (
    <span className={`eq ${className}`} data-idle={idle} aria-hidden>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
