import { forwardRef, useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

// Fade only the edge that actually has clipped content, so the mask never
// appears without real overflow (§15.6).
function maskFor(top: boolean, bottom: boolean): string {
  const start = top ? 'transparent 0, black 14px' : 'black 0'
  const end = bottom ? 'black calc(100% - 14px), transparent 100%' : 'black 100%'
  return `linear-gradient(to bottom, ${start}, ${end})`
}

/**
 * An internally-scrolling column for the fixed-height app shell (§2).
 *
 * - `min-h-0` so it can actually shrink inside a CSS grid track (without this,
 *   grid children refuse to shrink and the whole shell overflows).
 * - Scrollbar hidden (`.no-scrollbar`) and a top/bottom fade mask that appears
 *   only when there is content clipped in that direction.
 * - Cards keep their natural heights — no flex-1, no spacers. The column ends
 *   level with its siblings because the shell fixes the height, not the content.
 */
const ScrollColumn = forwardRef<HTMLDivElement, {
  children: ReactNode
  className?: string
}>(function ScrollColumn({ children, className = '' }, forwardedRef) {
  const innerRef = useRef<HTMLDivElement | null>(null)
  const [fade, setFade] = useState({ top: false, bottom: false })

  const setRef = useCallback(
    (node: HTMLDivElement | null) => {
      innerRef.current = node
      if (typeof forwardedRef === 'function') forwardedRef(node)
      else if (forwardedRef) forwardedRef.current = node
    },
    [forwardedRef],
  )

  useEffect(() => {
    const el = innerRef.current
    if (!el) return
    const update = () => {
      const { scrollTop, scrollHeight, clientHeight } = el
      setFade({
        top: scrollTop > 1,
        bottom: scrollTop + clientHeight < scrollHeight - 1,
      })
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    Array.from(el.children).forEach((c) => ro.observe(c))
    return () => {
      el.removeEventListener('scroll', update)
      ro.disconnect()
    }
  }, [children])

  const mask = maskFor(fade.top, fade.bottom)

  return (
    <div
      ref={setRef}
      className={`no-scrollbar h-full min-h-0 overflow-y-auto ${className}`}
      style={{ WebkitMaskImage: mask, maskImage: mask }}
    >
      {children}
    </div>
  )
})

export default ScrollColumn
