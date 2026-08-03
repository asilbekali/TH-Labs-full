import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import LogoMark from './brand/LogoMark'

type Mode = 'login' | 'register'

// Sign-in / register dialog. Deliberately static — no transitions or motion.
export default function AuthModal({
  open,
  onClose,
  initialMode = 'login',
}: {
  open: boolean
  onClose: () => void
  initialMode?: Mode
}) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset the form each time the dialog is opened.
  useEffect(() => {
    if (open) {
      setMode(initialMode)
      setName('')
      setEmail('')
      setPassword('')
      setError(null)
      setBusy(false)
    }
  }, [open, initialMode])

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

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (mode === 'login') await login(email, password)
      else await register(name, email, password)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={isRegister ? 'Create account' : 'Sign in'}
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

        <h2 className="text-center text-2xl font-bold tracking-tight text-primary">
          {isRegister ? 'Create your account' : 'Welcome back'}
        </h2>
        <p className="mt-1.5 text-center text-sm text-secondary">
          {isRegister
            ? 'Sign up to save your dubbing projects.'
            : 'Sign in to your TH-Labs account.'}
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          {isRegister && (
            <Field
              label="Full name"
              type="text"
              value={name}
              onChange={setName}
              placeholder="Jane Doe"
              autoComplete="name"
              minLength={2}
            />
          )}
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            placeholder="you@example.com"
            autoComplete="email"
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            placeholder="At least 8 characters"
            autoComplete={isRegister ? 'new-password' : 'current-password'}
            minLength={8}
          />

          {error && (
            <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="btn-primary focusable w-full py-3 text-sm disabled:opacity-60"
          >
            {busy
              ? 'Please wait…'
              : isRegister
                ? 'Create account'
                : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-secondary">
          {isRegister ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            onClick={() => {
              setMode(isRegister ? 'login' : 'register')
              setError(null)
            }}
            className="font-semibold text-brand hover:opacity-80"
          >
            {isRegister ? 'Sign in' : 'Create one'}
          </button>
        </p>
      </div>
    </div>
  )
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  autoComplete,
  minLength,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  autoComplete?: string
  minLength?: number
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        minLength={minLength}
        required
        className="focusable w-full rounded-xl border border-subtle bg-sunken px-3.5 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-brand/60"
      />
    </label>
  )
}
