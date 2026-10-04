// The in-app sign-in screen. Reached only when LOCAL_AUTH is on — see
// src/lib/landing.ts for why that flag exists and when it is set.
//
// This is deliberately NOT a product page. The deployed Studio has exactly one
// front door (the landing site signs you in and hands a one-time code back),
// and nothing here is routed, linked or reachable in a production build. It
// exists so a dev server is usable at all: without it a signed-out localhost
// visitor is redirected straight off the origin.
//
// It calls the same `login` / `register` on the auth context that the rest of
// the app does, so there is no second auth path to keep in step — the httpOnly
// refresh cookie, the in-memory access token and the first-run onboarding flag
// are all set exactly as a real sign-in sets them.
import { useState } from 'react'
import { motion } from 'framer-motion'
import LogoMark from '../components/brand/LogoMark'
import MagneticButton from '../components/MagneticButton'
import { useAuth } from '../lib/auth'
import { LANDING_URL } from '../lib/landing'

type Mode = 'signin' | 'register'

export default function SignIn() {
  const { login, register } = useAuth()

  const [mode, setMode] = useState<Mode>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    setBusy(true)
    try {
      if (mode === 'register') await register(name.trim(), email.trim(), password)
      else await login(email.trim(), password)
      // No navigation on success. AppShell's gate is driven by `user`, so the
      // moment the context has a session this screen is replaced by the app on
      // whatever route the address bar already holds.
    } catch (err) {
      // The account API writes these for a person — "Invalid credentials",
      // "Email is already in use" — so they are shown as sent rather than
      // flattened into one generic line.
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.')
    } finally {
      setBusy(false)
    }
  }

  // Switching tabs keeps the email and clears the rest: the usual reason to
  // switch is "this account does not exist yet", and retyping the address you
  // just typed is the one thing that makes that annoying.
  function switchTo(next: Mode) {
    setMode(next)
    setError(null)
    setPassword('')
    if (next === 'signin') setName('')
  }

  const registering = mode === 'register'

  return (
    <div className="grid min-h-screen place-items-center px-6 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="w-full max-w-sm"
      >
        <div className="flex flex-col items-center text-center">
          <LogoMark className="h-10 w-10 text-primary" />
          <h1 className="mt-4 text-2xl font-bold text-primary">
            {registering ? 'Create an account' : 'Sign in to TH-Labs'}
          </h1>
          <p className="mt-1.5 text-sm text-secondary">
            {registering
              ? 'New accounts start with 20 credits — one free minute of dubbing.'
              : 'Local development sign-in.'}
          </p>
        </div>

        {/* Tabs. A segmented control rather than a "no account? sign up" link,
            because in testing you switch between the two constantly. */}
        <div
          role="tablist"
          aria-label="Sign in or register"
          className="mt-7 grid grid-cols-2 gap-1 rounded-xl border border-subtle bg-sunken p-1"
        >
          {(
            [
              ['signin', 'Sign in'],
              ['register', 'Register'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              type="button"
              aria-selected={mode === value}
              onClick={() => switchTo(value)}
              className={`focusable rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                mode === value
                  ? 'bg-raised text-primary shadow-[var(--shadow-sm)]'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <form onSubmit={onSubmit} className="card mt-4 space-y-4 p-6">
          {registering && (
            <Field
              label="Full name"
              type="text"
              value={name}
              onChange={setName}
              autoComplete="name"
              placeholder="Ada Lovelace"
              required
            />
          )}
          <Field
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            placeholder="you@example.com"
            required
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            // `new-password` on the register tab stops the browser filling the
            // field with a saved credential for a DIFFERENT account, which is
            // the whole point of making a new one here.
            autoComplete={registering ? 'new-password' : 'current-password'}
            placeholder="••••••••"
            required
          />

          {error && (
            <p
              role="alert"
              className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <MagneticButton
            type="submit"
            disabled={busy}
            className="btn-primary focusable w-full justify-center px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {busy
              ? registering
                ? 'Creating account…'
                : 'Signing in…'
              : registering
                ? 'Create account'
                : 'Sign in'}
          </MagneticButton>
        </form>

        <p className="mt-5 text-center text-xs text-muted">
          This screen is development-only. The deployed Studio signs you in at{' '}
          <a
            href={LANDING_URL}
            className="focusable underline decoration-dotted underline-offset-2 hover:text-secondary"
          >
            {LANDING_URL.replace(/^https?:\/\//, '')}
          </a>
          .
        </p>
      </motion.div>
    </div>
  )
}

function Field({
  label,
  type,
  value,
  onChange,
  autoComplete,
  placeholder,
  required,
}: {
  label: string
  type: string
  value: string
  onChange: (v: string) => void
  autoComplete: string
  placeholder?: string
  required?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        placeholder={placeholder}
        required={required}
        className="focusable w-full rounded-xl border border-subtle bg-sunken px-3.5 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-brand/60"
      />
    </label>
  )
}
