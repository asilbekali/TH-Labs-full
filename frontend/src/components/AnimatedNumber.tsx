import { useEffect, useRef, useState } from 'react'

// Decimal places to show for a value: whole numbers stay whole, anything with a
// fraction (a $19.50 price) keeps two places so it never reads as "19.5".
function decimalsFor(value: number): number {
  return Number.isInteger(value) ? 0 : 2
}

function format(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

// Tweens between the previous and next value so counters roll rather than snap.
//
// Intermediate frames are rounded to the TARGET's precision, and the last frame
// is the target itself. Rounding every frame to a whole number used to land a
// tween to 19.5 on 20 — so switching yearly → monthly showed Pro at $20.
export default function AnimatedNumber({
  value,
  duration = 600,
  decimals,
  className,
}: {
  value: number
  duration?: number
  /** Fixed decimal places. Defaults to 0 for whole values, 2 otherwise. */
  decimals?: number
  className?: string
}) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef<number | undefined>(undefined)

  const places = decimals ?? decimalsFor(value)

  useEffect(() => {
    const from = fromRef.current
    const to = value
    if (from === to) {
      setDisplay(to)
      return
    }

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce) {
      fromRef.current = to
      setDisplay(to)
      return
    }

    const step = Math.pow(10, places)
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      if (t >= 1) {
        fromRef.current = to
        setDisplay(to)
        return
      }
      const eased = 1 - Math.pow(1 - t, 3) // easeOutCubic
      setDisplay(Math.round((from + (to - from) * eased) * step) / step)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      // Interrupted mid-tween: the next one starts from where the target was
      // heading, and the display is pinned to it so nothing is left mid-roll.
      fromRef.current = to
      setDisplay(to)
    }
  }, [value, duration, places])

  return <span className={className}>{format(display, places)}</span>
}
