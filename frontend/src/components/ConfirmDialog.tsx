// "Are you sure?" for destructive actions, as a page dialog rather than the
// browser's window.confirm — which blocks the page, cannot be styled, and
// looks like a different program. Animated in and out with framer-motion.
//
//   const [confirmDialog, confirm] = useConfirm()
//   if (await confirm({ title: 'Delete this clip?', confirmLabel: 'Delete' })) …
//   return <>{…}{confirmDialog}</>
import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SQUARED } from '../lib/shape'

export interface ConfirmOptions {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red confirm button; true for anything that deletes. */
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void
}

export function useConfirm(): [ReactNode, (opts: ConfirmOptions) => Promise<boolean>] {
  const [pending, setPending] = useState<Pending | null>(null)

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ danger: true, ...opts, resolve })),
    [],
  )

  const close = useCallback(
    (ok: boolean) => {
      pending?.resolve(ok)
      setPending(null)
    },
    [pending],
  )

  return [<ConfirmDialog key="confirm" pending={pending} onClose={close} />, confirm]
}

function ConfirmDialog({
  pending,
  onClose,
}: {
  pending: Pending | null
  onClose: (ok: boolean) => void
}) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!pending) return
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose(false)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onClose(true)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending, onClose])

  return createPortal(
    <AnimatePresence>
      {pending && (
        <motion.div
          key="confirm"
          className="fixed inset-0 z-[100] grid place-items-center p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.16 } }}
          transition={{ duration: 0.18 }}
        >
          <motion.button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => onClose(false)}
            className="absolute inset-0 cursor-default bg-black/45 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.14 } }}
          />
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            style={SQUARED}
            className="relative w-full max-w-sm rounded-[18px] border border-subtle glass-thick p-5 shadow-(--shadow-lg)"
            initial={{ opacity: 0, scale: 0.92, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 6, transition: { duration: 0.14, ease: 'easeIn' } }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <div className="flex items-start gap-3">
              {pending.danger && (
                <motion.span
                  aria-hidden
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-danger/12 text-danger"
                  initial={{ rotate: -12, scale: 0.6 }}
                  animate={{ rotate: 0, scale: 1 }}
                  transition={{ type: 'spring', stiffness: 380, damping: 18, delay: 0.05 }}
                >
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                  </svg>
                </motion.span>
              )}
              <div className="min-w-0">
                <h2 id="confirm-title" className="text-[15px] font-medium text-primary">
                  {pending.title}
                </h2>
                {pending.body && (
                  <div className="mt-1.5 text-[13px] leading-relaxed text-secondary">{pending.body}</div>
                )}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <motion.button
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => onClose(false)}
                className="btn-primary focusable h-9 px-4 text-[13px]"
              >
                {pending.cancelLabel ?? 'Cancel'}
              </motion.button>
              <motion.button
                ref={confirmRef}
                type="button"
                whileTap={{ scale: 0.96 }}
                onClick={() => onClose(true)}
                className={`focusable h-9 rounded-full px-5 text-[13px] font-medium ${
                  pending.danger ? 'bg-danger text-white hover:bg-danger/90' : 'btn-primary'
                }`}
              >
                {pending.confirmLabel ?? 'Delete'}
              </motion.button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
