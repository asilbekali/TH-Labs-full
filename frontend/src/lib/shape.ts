// Soft corners instead of pills.
//
// This theme rounds every control and chip fully (--radius-control and
// --radius-pill are 999px), so a button, a tag or a small box comes out as a
// pill or a capsule. The product does not want those shapes. Setting this on a
// container redefines the radii for everything inside it, so the shared
// classes (.btn-primary, .chip, rounded-control, …) render as rectangles with
// soft corners there, and nothing outside it changes.
import type { CSSProperties } from 'react'

// The pill radius stays small because it is used on tags as short as 18px,
// where anything past half the height is a capsule again.
export const SQUARED = {
  '--radius-pill': '6px',
  '--radius-control': '10px',
  '--radius-inner': '12px',
} as CSSProperties

// The two editors are one window of panels, so the cards inside it soften too.
export const EDITOR_SHAPE = { ...SQUARED, '--radius-card': '14px' } as CSSProperties
