import type { ReactNode } from 'react'
import { useAuth } from '../lib/auth'
import AuthForm from './AuthForm'
import LogoLoader from './brand/LogoLoader'
import LogoMark from './brand/LogoMark'

/**
 * Route guard. Renders `children` only for a signed-in account; everyone else
 * gets the sign-in / register form in its place.
 *
 * The Studio was reachable by anyone who knew the URL — and the welcome email's
 * button points straight at it, so people were landing inside the app with no
 * account at all. The gate goes here, on the route, rather than inside Studio:
 * page-level checks are easy to forget when the next protected page is added.
 *
 * Waiting on `ready` is the load-bearing part. The session is restored by an
 * async call to /auth/refresh with the httpOnly cookie, so a signed-in user is
 * momentarily indistinguishable from a signed-out one on every reload —
 * rendering the gate during that window would flash "sign in" at people who
 * are already signed in, and bounce them if it redirected.
 */
export default function RequireAuth({
  children,
  title = 'Sign in to continue',
  subtitle = 'Your TH-Labs account keeps your projects, credits and dubs together.',
}: {
  children: ReactNode
  title?: string
  subtitle?: string
}) {
  const { user, ready } = useAuth()

  if (!ready) {
    return (
      <div className="grid min-h-[60vh] place-items-center">
        <LogoLoader size="lg" className="text-brand" label="Checking your session" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="grid min-h-[60vh] place-items-center px-4 py-8">
        <div className="card w-full max-w-md p-6 sm:p-8">
          <div className="mb-5 flex justify-center">
            <LogoMark className="h-12 w-12 text-brand" title="TH-Labs" />
          </div>

          <p className="mb-5 text-center text-xs font-medium uppercase tracking-wider text-muted">
            {title}
          </p>
          <p className="sr-only">{subtitle}</p>

          {/* No onDone: signing in flips `user`, which re-renders this guard
              into `children` — the page they were already asking for. */}
          <AuthForm
            submitLabel={{
              login: 'Sign in and continue',
              register: 'Create account and continue',
            }}
          />
        </div>
      </div>
    )
  }

  return <>{children}</>
}
