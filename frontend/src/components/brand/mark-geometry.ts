// Vector geometry for the TH-Labs mark, traced from public/logo.png and
// normalized to a 100×100 viewBox. Shared by LogoMark, LogoLoader and the
// section divider so there is a single source of truth for the paths.

// The body: a square with three rounded corners. The bottom-right stays sharp —
// that asymmetry is what makes the mark read as a glyph rather than an app tile,
// so it must survive any future retracing.
export const BODY_PATH =
  'M31.82,3.15 H68.18 A28.82,28.82 0 0 1 97,31.97 V96.85 H31.82 ' +
  'A28.82,28.82 0 0 1 3,68.03 V31.97 A28.82,28.82 0 0 1 31.82,3.15 Z'

export interface Counter {
  /** Subpath knocked out of the body (even-odd). */
  d: string
  /** Unit vector along the counter's length, pointing at its open end. */
  axis: { x: number; y: number }
  /** Long-axis length in viewBox units. */
  length: number
}

// The three cuts, in reading order: the two slashes of the chevron (30° and 60°
// off vertical, meeting at a single point near 29.41,54.89) and the bar that
// runs out through the right edge. All three carry the same 14.4-unit weight.
export const COUNTERS: Counter[] = [
  {
    d: 'M31.89,21.64 L44.43,28.87 L29.41,54.89 L16.84,47.66 Z',
    axis: { x: 0.5, y: -0.866 },
    length: 30.05,
  },
  {
    d: 'M68.53,32.35 L75.8,44.96 L36.63,67.59 L29.41,54.89 Z',
    axis: { x: 0.866, y: -0.5 },
    length: 45.19,
  },
  {
    // Stops dead on the body's right edge: pushed past it, the even-odd fill
    // would paint the overhang instead of cutting it.
    d: 'M36.74,67.87 L97,67.87 L97,82.29 L36.74,82.29 Z',
    axis: { x: 1, y: 0 },
    length: 60.26,
  },
]

// The whole mark as one even-odd path — body first, then the cuts.
export const MARK_PATH = [BODY_PATH, ...COUNTERS.map((c) => c.d)].join(' ')
