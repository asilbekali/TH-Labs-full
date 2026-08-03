import { BODY_PATH, PIXELS, PIXEL_RX } from './mark-geometry'

// The TH-Labs mark (mark only — the wordmark never appears in the UI).
// All paths use currentColor so it inverts between themes and sits on the
// gradient puck. Split into #mark-body and #mark-pixels for animation.
export default function LogoMark({
  className = 'h-6 w-6',
  title,
}: {
  className?: string
  title?: string
}) {
  return (
    <svg viewBox="0 0 100 100" className={className} fill="currentColor" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true}>
      {title && <title>{title}</title>}
      <g id="mark-body">
        <path fillRule="evenodd" d={BODY_PATH} />
      </g>
      <g id="mark-pixels">
        {PIXELS.map((p, i) => (
          <rect key={i} x={p.x} y={p.y} width={p.w} height={p.h} rx={PIXEL_RX} />
        ))}
      </g>
    </svg>
  )
}

// Section divider: four of the mark's pixels as a compact cascade, in the
// current text colour. Replaces the old gradient rule in section kickers.
export function MarkDivider({ className = 'h-3 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 34 12" className={className} fill="currentColor" aria-hidden>
      <rect x="0" y="3.5" width="5" height="5" rx="1" />
      <rect x="8" y="1.5" width="6" height="6" rx="1" />
      <rect x="17.5" y="3" width="4.5" height="4.5" rx="1" />
      <rect x="25" y="0.5" width="3.5" height="3.5" rx="1" />
    </svg>
  )
}
