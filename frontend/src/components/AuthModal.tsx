import { useEffect, useState } from 'react'
import AuthForm, { type Mode } from './AuthForm'
import LogoMark from './brand/LogoMark'

// Sign-in / register dialog. Deliberately static — no transitions or motion.
// The form itself lives in AuthForm, shared with the Studio's RequireAuth gate.
export default function AuthModal({
  open,
  onClose,
  initialMode = 'login',
}: {
  open: boolean
  onClose: () => void
  initialMode?: Mode
}) {
  // Remounting the form on each open is what resets the fields — the key
  // changes, React throws the old instance away, and AuthForm keeps its state
  // entirely local.
  const [openCount, setOpenCount] = useState(0)
  useEffect(() => {
    if (open) setOpenCount((n) => n + 1)
  }, [open])

  // Close on Escape.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={initialMode === 'register' ? 'Create account' : 'Sign in'}
    >
      <div
        className="card relative w-full max-w-md p-6 sm:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="focusable absolute right-4 top-4 grid h-8 w-8 place-items-center rounded-lg border border-subtle text-muted hover:text-primary"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>

        <div className="mb-5 flex justify-center">
          <LogoMark className="h-12 w-12 text-brand" title="TH-Labs" />
        </div>

        <AuthForm key={openCount} initialMode={initialMode} onDone={onClose} />
      </div>
    </div>
  )
}
