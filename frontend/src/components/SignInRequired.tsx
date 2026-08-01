import { LANDING_URL } from '../lib/auth'

/**
 * What a signed-out visitor gets instead of the Studio.
 *
 * There is deliberately no sign-in form here. Accounts live on the landing
 * page, which owns every credential path (password, Google) and hands the
 * session over through a one-time code — see lib/auth.ts. A second login form
 * on this origin would mean a second place for passwords to be typed, and
 * nothing would be gained by it.
 */
export default function SignInRequired({ reason }: { reason?: string }) {
  return (
    <div className="wrap flex min-h-[70vh] flex-col items-center justify-center py-20 text-center">
      {/* Dither field behind the panel — the landing page's texture motif. */}
      <div className="relative">
        <div
          aria-hidden="true"
          className="dither-dots pointer-events-none absolute -inset-16 z-base text-accent/25 [mask-image:radial-gradient(circle_at_50%_50%,black,transparent_72%)]"
        />

        <div className="z-content relative mx-auto max-w-md">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-3">
            Studio
          </p>

          <h1 className="mt-4 text-2xl font-semibold text-white sm:text-3xl">
            Sign in to continue
          </h1>

          <p className="mt-4 text-sm leading-relaxed text-text-2">
            {reason ??
              'The dubbing Studio runs on a GPU and keeps your uploads private to your account, so it needs a signed-in session.'}
          </p>

          <a
            href={LANDING_URL}
            className="btn-primary focus-ring mt-8 inline-flex h-11 items-center justify-center px-6 text-sm"
          >
            Sign in at TH-LABS
          </a>

          <p className="mt-4 font-mono text-xs text-text-3">
            You&apos;ll be brought straight back here.
          </p>
        </div>
      </div>
    </div>
  )
}
