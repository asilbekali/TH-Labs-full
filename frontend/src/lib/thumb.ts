// Deterministic artwork for items that have no real thumbnail yet.
//
// A dub's thumbnail would ideally be a frame from the source video, but the
// pipeline does not extract one, so a card falls back to a gradient derived
// from the job id: same id → same artwork, forever, with no image request.
// Hues stay inside the warm copper family — rose (350°) through terracotta
// and copper (20-28°) to sand (38°) — so a wall of these reads as one palette
// with the brand instead of a fruit salad. No violet: it was dropped from the
// palette, and nothing here crosses into blue or purple.
const HUES = [350, 8, 18, 24, 30, 38]

function hash(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/**
 * A two-stop gradient for an id. Consumers set `background-size: 200%` (see the
 * `.thumb-grad` class) so the position can drift on hover.
 */
export function gradientFor(id: string): string {
  const h = hash(id)
  const a = HUES[h % HUES.length]
  const b = HUES[(h >>> 5) % HUES.length]
  const angle = 115 + (h % 90)
  const hueB = a === b ? (b + 14) % 360 : b
  return `linear-gradient(${angle}deg, hsl(${a} 58% 56%), hsl(${hueB} 44% 34%))`
}
