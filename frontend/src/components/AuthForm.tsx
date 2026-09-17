import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'

export type Mode = 'login' | 'register'

/**
 * The sign-in / register form itself, with no surrounding chrome.
 *
 * Shared by AuthModal (the dialog you can dismiss) and RequireAuth (the gate
 * in front of the Studio, which you cannot). One implementation so the two
 * cannot drift — a field added here shows up in both.
 */
export default function AuthForm({
  initialMode = 'login',
  onDone,
  submitLabel,
}: {
  initialMode?: Mode
  /** Called after a successful login or register. */
  onDone?: () => void
  /** Override the button copy, e.g. "Sign in and open the Studio". */
  submitLabel?: { login: string; register: string }
}) {
  const { login, register } = useAuth()
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setMode(initialMode)
  }, [initialMode])

  const isRegister = mode === 'register'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      if (isRegister) await register(name, email, password)
      else await login(email, password)
      onDone?.()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  const defaultLabel = isRegister ? 'Create account' : 'Sign in'
  const label = submitLabel ? submitLabel[mode] : defaultLabel

  return (
    <>
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
          {busy ? 'Please wait…' : label}
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
    </>
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
