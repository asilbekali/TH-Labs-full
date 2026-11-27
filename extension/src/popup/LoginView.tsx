import { useState, type FormEvent } from 'react'
import { SIGNUP_URL } from '../config'
import { ask } from '../lib/messages'
import { EyeIcon, EyeOffIcon } from './icons'

export function LoginView() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      // On success the background stores the session and App switches screens.
      await ask({ type: 'auth/login', email: email.trim(), password })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not log in. Try again.')
      setBusy(false)
    }
  }

  return (
    <>
      <h1 className="title">Hear any call or stream in your language</h1>
      <p className="muted">Log in with your TH-Labs account to start.</p>
      <form className="glass card form" onSubmit={submit}>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" autoFocus required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <span className="input-wrap">
            <input
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <button
              type="button"
              className="reveal"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              onClick={() => setShowPassword((v) => !v)}
            >
              {showPassword ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </span>
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Logging in...' : 'Log in'}
        </button>
      </form>
      <button className="btn btn-ghost wide" type="button" onClick={() => void chrome.tabs.create({ url: SIGNUP_URL })}>
        Create an account
      </button>
    </>
  )
}
