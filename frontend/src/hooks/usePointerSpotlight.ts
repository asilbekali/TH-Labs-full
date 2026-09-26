import { useCallback, useRef } from 'react'

/**
 * Writes the pointer's position into `--mx` / `--my` on the element, which the
 * `.spotlight` class reads to draw a pool of glaze under the cursor.
 *
 * The handler deliberately does nothing but set two custom properties: no
 * state, no re-render, no layout read beyond a single cached rect per enter.
 * Everything visible is the compositor's job.
 */
export function usePointerSpotlight<T extends HTMLElement>() {
  const ref = useRef<T | null>(null)
  const rectRef = useRef<DOMRect | null>(null)

  const onPointerEnter = useCallback(() => {
    rectRef.current = ref.current?.getBoundingClientRect() ?? null
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<T>) => {
    const el = ref.current
    const r = rectRef.current ?? el?.getBoundingClientRect()
    if (!el || !r) return
    rectRef.current = r
    el.style.setProperty('--mx', `${e.clientX - r.left}px`)
    el.style.setProperty('--my', `${e.clientY - r.top}px`)
  }, [])

  return { ref, onPointerEnter, onPointerMove }
}
