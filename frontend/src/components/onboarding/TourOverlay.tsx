// A spotlight walkthrough: dim the page, cut a hole around one real element,
// and park a card next to it.
//
// It points at live DOM rather than screenshots or a written list, so the guide
// can never drift out of step with the UI — a step whose target is not on
// screen simply centres itself instead of pointing at nothing.
//
// The cutout is an SVG mask (one white page-sized rect, one black rounded rect)
// rather than four dimming divs, so the hole animates between targets as four
// plain numbers and stays perfectly square-cornered at any radius.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { EASE_ENTRANCE } from '../../lib/motion'

export interface TourStep {
  id: string
  /** `data-tour` value of the element to spotlight. Omitted → a centred card. */
  target?: string
  title: string
  body: string
  /** Small mono line under the body — a keyboard hint or an aside. */
  note?: string
  /** Preferred side; the overlay still flips it when there is no room. */
  prefer?: Side
  /** Run when the step becomes active — used to open the panel it describes. */
  onEnter?: () => void
}

type Side = 'right' | 'left' | 'top' | 'bottom'

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

const PAD = 10 // breathing room between the element and the edge of the hole
const GAP = 16 // distance from the hole to the card
const MARGIN = 16 // keep the card this far off the viewport edges
const CARD_W = 336

function sameRect(a: Rect | null, b: Rect | null): boolean {
  if (!a || !b) return a === b
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  )
}

function measure(target: string | undefined): Rect | null {
  if (!target) return null
  const el = document.querySelector<HTMLElement>(`[data-tour="${target}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null // display:none (e.g. the other breakpoint)
  return {
    x: r.left - PAD,
    y: r.top - PAD,
    w: r.width + PAD * 2,
    h: r.height + PAD * 2,
  }
}

/** Where the card goes: the first side with room, preference first. */
function place(
  rect: Rect | null,
  prefer: Side | undefined,
  vw: number,
  vh: number,
  cardH: number,
): { x: number; y: number; side: Side | 'center' } {
  const cardW = Math.min(CARD_W, vw - MARGIN * 2)
  if (!rect) {
    return { x: (vw - cardW) / 2, y: Math.max(MARGIN, (vh - cardH) / 2), side: 'center' }
  }

  const room: Record<Side, number> = {
    right: vw - (rect.x + rect.w) - GAP - MARGIN,
    left: rect.x - GAP - MARGIN,
    bottom: vh - (rect.y + rect.h) - GAP - MARGIN,
    top: rect.y - GAP - MARGIN,
  }
  const order: Side[] = prefer
    ? [prefer, ...(['right', 'left', 'bottom', 'top'] as Side[]).filter((s) => s !== prefer)]
    : ['right', 'left', 'bottom', 'top']

  const fits = (s: Side) => (s === 'right' || s === 'left' ? room[s] >= cardW : room[s] >= cardH)
  // Nothing fits on a small screen — fall back to whichever side has the most
  // room and let the clamp below keep the card on screen.
  const side =
    order.find(fits) ?? order.reduce((best, s) => (room[s] > room[best] ? s : best), order[0])

  const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)
  let x: number
  let y: number
  if (side === 'right' || side === 'left') {
    x = side === 'right' ? rect.x + rect.w + GAP : rect.x - GAP - cardW
    y = rect.y + rect.h / 2 - cardH / 2
  } else {
    x = rect.x + rect.w / 2 - cardW / 2
    y = side === 'bottom' ? rect.y + rect.h + GAP : rect.y - GAP - cardH
  }
  return {
    x: clamp(x, MARGIN, Math.max(MARGIN, vw - cardW - MARGIN)),
    y: clamp(y, MARGIN, Math.max(MARGIN, vh - cardH - MARGIN)),
    side,
  }
}

export default function TourOverlay({
  steps,
  open,
  onClose,
}: {
  steps: TourStep[]
  open: boolean
  /** Fired for finish *and* skip — both mean "do not open this again". */
  onClose: () => void
}) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [cardH, setCardH] = useState(220)
  const cardRef = useRef<HTMLDivElement>(null)
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  const step = steps[Math.min(index, steps.length - 1)]
  const last = index >= steps.length - 1

  const finish = useCallback(() => {
    setIndex(0)
    onClose()
  }, [onClose])

  const next = useCallback(() => {
    if (last) finish()
    else setIndex((i) => i + 1)
  }, [last, finish])

  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), [])

  // Restart from the top every time the tour is opened, including a replay from
  // the Guide button.
  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  // Measure before the browser paints the new step, so the hole is never drawn
  // one frame behind — the rAF loop below only has to keep it there.
  useLayoutEffect(() => {
    if (!open) return
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    setRect((prev) => {
      const nextRect = measure(stepsRef.current[index]?.target)
      return sameRect(prev, nextRect) ? prev : nextRect
    })
  }, [open, index])

  // Let the step reveal what it is about to describe, then bring it into view.
  useEffect(() => {
    if (!open) return
    const s = stepsRef.current[index]
    s?.onEnter?.()
    if (!s?.target) return
    const el = document.querySelector<HTMLElement>(`[data-tour="${s.target}"]`)
    el?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' })
  }, [open, index])

  // One rAF loop owns every measurement. The target can move for reasons no
  // event reports — an accordion expanding above it, a column scrolling, a
  // layout animation still settling — so polling the rect is both simpler and
  // more accurate than stitching together scroll/resize/observer callbacks.
  useEffect(() => {
    if (!open) return
    let frame = 0
    const tick = () => {
      const target = stepsRef.current[index]?.target
      setRect((prev) => {
        const nextRect = measure(target)
        return sameRect(prev, nextRect) ? prev : nextRect
      })
      setViewport((prev) =>
        prev.w === window.innerWidth && prev.h === window.innerHeight
          ? prev
          : { w: window.innerWidth, h: window.innerHeight },
      )
      const h = cardRef.current?.offsetHeight
      if (h) setCardH((prev) => (Math.abs(prev - h) < 1 ? prev : h))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [open, index])

  // Keyboard: the tour is modal, so it owns the arrows while it is up.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        finish()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        next()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        back()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, next, back, finish])

  // The desktop shell already locks the body; this covers the mobile document,
  // where the page would otherwise scroll out from under the spotlight.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [open])

  if (typeof document === 'undefined') return null

  const vw = viewport.w || (typeof window !== 'undefined' ? window.innerWidth : 0)
  const vh = viewport.h || (typeof window !== 'undefined' ? window.innerHeight : 0)
  const pos = place(rect, step?.prefer, vw, vh, cardH)
  const cardW = Math.min(CARD_W, Math.max(240, vw - MARGIN * 2))

  // Caret: sits on the card edge facing the target, aligned to the target's
  // centre but never past the card's own corners.
  const caret = (() => {
    if (!rect || pos.side === 'center') return null
    const cx = rect.x + rect.w / 2
    const cy = rect.y + rect.h / 2
    if (pos.side === 'right' || pos.side === 'left') {
      const top = Math.min(Math.max(cy - pos.y, 20), cardH - 20)
      return { top, left: pos.side === 'right' ? 0 : cardW, side: pos.side }
    }
    const left = Math.min(Math.max(cx - pos.x, 20), cardW - 20)
    return { top: pos.side === 'bottom' ? 0 : cardH, left, side: pos.side }
  })()

  return createPortal(
    <AnimatePresence>
      {open && step && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25, ease: EASE_ENTRANCE }}
          className="fixed inset-0 z-[100]"
          role="dialog"
          aria-modal="true"
          aria-label="Studio walkthrough"
        >
          {/* Dim + hole. Swallows clicks: during the tour the only controls are
              the tour's own, so a half-pressed button can't leave the user in a
              state the next step no longer describes. */}
          <svg className="absolute inset-0 h-full w-full" aria-hidden>
            <defs>
              <mask id="th-tour-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                {rect && (
                  <motion.rect
                    initial={false}
                    animate={{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
                    transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                    rx="16"
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgb(12 10 9 / 0.62)"
              mask="url(#th-tour-mask)"
            />
            {rect && (
              <motion.rect
                initial={false}
                animate={{ x: rect.x, y: rect.y, width: rect.w, height: rect.h }}
                transition={{ type: 'spring', stiffness: 320, damping: 34 }}
                rx="16"
                fill="none"
                stroke="rgb(var(--c-brand-400))"
                strokeWidth="2"
              />
            )}
          </svg>

          <motion.div
            ref={cardRef}
            initial={false}
            animate={{ x: pos.x, y: pos.y }}
            transition={{ type: 'spring', stiffness: 320, damping: 34 }}
            style={{ width: cardW, position: 'absolute', left: 0, top: 0 }}
            className="rounded-card border border-subtle bg-raised p-5 shadow-[var(--shadow-lg)]"
          >
            {caret && (
              <span
                aria-hidden
                style={{ top: caret.top, left: caret.left }}
                className={`absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rotate-45 border-subtle bg-raised ${
                  caret.side === 'right'
                    ? 'border-b border-l'
                    : caret.side === 'left'
                      ? 'border-r border-t'
                      : caret.side === 'bottom'
                        ? 'border-l border-t'
                        : 'border-b border-r'
                }`}
              />
            )}

            <div className="flex items-center justify-between gap-3">
              <span className="font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-brand">
                / Guide · {String(index + 1).padStart(2, '0')} of{' '}
                {String(steps.length).padStart(2, '0')}
              </span>
              <button
                type="button"
                onClick={finish}
                className="focusable -mr-1 rounded-lg px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:text-primary"
              >
                Skip
              </button>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2, ease: EASE_ENTRANCE }}
              >
                <h2 className="mt-2.5 font-mono text-[15px] font-medium leading-snug text-primary">
                  {step.title}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-secondary">{step.body}</p>
                {step.note && (
                  <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted">
                    {step.note}
                  </p>
                )}
              </motion.div>
            </AnimatePresence>

            <div className="mt-4 flex items-center gap-3">
              <div className="flex flex-1 gap-1.5">
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    aria-current={i === index}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? 'w-5 bg-brand' : i < index ? 'w-1.5 bg-brand/40' : 'w-1.5 bg-strong'
                    }`}
                  />
                ))}
              </div>
              {index > 0 && (
                <button
                  type="button"
                  onClick={back}
                  className="btn-ghost focusable px-3 py-1.5 font-mono text-xs"
                >
                  Back
                </button>
              )}
              <button
                type="button"
                onClick={next}
                autoFocus
                className="btn-primary focusable px-4 py-1.5 font-mono text-xs"
              >
                {last ? 'Got it' : 'Next →'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
