// The Studio's loading signal: a globe of small dots, slowly turning.
//
// Deliberately not a progress indicator. A spinner or a bar claims to know a
// rate; the pipeline's stages take wildly different times, so the honest cue is
// "this is being worked on", which is exactly what a turning globe says. Where
// a real percentage exists it is printed next to the orb as text.
//
// This file owns only the DOT POSITIONS. Each dot is one <i> whose transform
// puts it on the surface of a real sphere — `rotateY(lon) rotateX(lat)
// translateZ(r)` inside a preserve-3d box — and the parent's single rotateY
// turns the globe (see the THINKING ORBS block at the foot of index.css).
// Nothing animates in JS.
import { useMemo } from 'react'

/**
 * How many rings, and how many dots around the equator, at a given box size.
 *
 * Tiered rather than continuous: a 16px chip has room for about thirty dots
 * before it turns to mush, and the 132px hero needs four hundred before the
 * silhouette reads as a solid globe rather than a scattering. Each tier is the
 * densest that still resolves at that size.
 */
function density(size: number): { rings: number; equator: number } {
  if (size < 28) return { rings: 7, equator: 12 }
  if (size < 72) return { rings: 12, equator: 22 }
  return { rings: 18, equator: 34 }
}

/**
 * Rings of latitude from -80° to +80°, each holding a count proportional to
 * cos(lat) so the spacing stays even instead of crowding at the poles. Odd
 * rings are offset by half a step, which breaks up the vertical seams a plain
 * grid would show every time the globe turns past front-centre.
 */
function dots(size: number): { lat: number; lon: number }[] {
  const { rings, equator } = density(size)
  const out: { lat: number; lon: number }[] = []
  for (let i = 0; i < rings; i++) {
    const lat = -80 + (160 * i) / (rings - 1)
    const count = Math.max(5, Math.round(equator * Math.cos((lat * Math.PI) / 180)))
    for (let j = 0; j < count; j++) {
      out.push({ lat, lon: (360 * j) / count + (i % 2 ? 180 / count : 0) })
    }
  }
  return out
}

export default function ThinkingOrbs({
  /** Box size in px — radius, dot size and dot count all scale from it. */
  size = 64,
  /** Seconds for one full turn. Slower reads calmer; 7s is the default. */
  speed,
  className = '',
  label,
}: {
  size?: number
  speed?: number
  className?: string
  /** Screen-reader text. Omit inside an element that already announces state. */
  label?: string
}) {
  const points = useMemo(() => dots(size), [size])

  return (
    <span
      className={`orbs ${className}`}
      style={
        {
          '--orb-size': `${size}px`,
          ...(speed ? { '--orb-spin': `${speed}s` } : null),
        } as React.CSSProperties
      }
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <span className="orbs__sphere">
        {points.map((p, i) => (
          <i
            key={i}
            style={{
              transform: `rotateY(${p.lon}deg) rotateX(${p.lat}deg) translateZ(var(--orb-r))`,
            }}
          />
        ))}
      </span>
    </span>
  )
}
