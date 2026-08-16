// Stripe configuration for the browser.
//
// Only the PUBLISHABLE key lives here (VITE_STRIPE_PUBLISHABLE_KEY). Vite
// inlines it into the bundle, which is fine — publishable keys are designed to
// be public and can do nothing on their own. The secret key never leaves the
// API server.
//
// Checkout is a Stripe-hosted Payment Link: GET /v1/payments/checkout returns
// the URL and we navigate to it, so Stripe owns the card form, 3-D Secure and
// PCI scope. That means the app needs no Stripe.js bundle. The publishable key
// is still worth reading because it tells the UI two useful things: whether
// billing is configured at all, and whether this build points at live or test
// mode — a test-mode build must say so loudly, or someone will "buy" a plan
// with 4242 4242 4242 4242 and expect real credits.

const KEY: string = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim()

export const stripePublishableKey = KEY

/** False when VITE_STRIPE_PUBLISHABLE_KEY is unset — upgrade CTAs disable. */
export const isStripeConfigured = /^pk_(live|test)_/.test(KEY)

/** True only for a real-money key. Unset/misconfigured is treated as not-live. */
export const isStripeLiveMode = KEY.startsWith('pk_live_')

/** True when this build will charge Stripe test cards, not real ones. */
export const isStripeTestMode = KEY.startsWith('pk_test_')

/**
 * Why checkout is unavailable, or null when it is fine. The Plans page shows
 * this instead of a button that would 503 on click.
 */
export function stripeUnavailableReason(): string | null {
  if (!KEY) {
    return 'Payments are not configured for this build — VITE_STRIPE_PUBLISHABLE_KEY is unset.'
  }
  if (!isStripeConfigured) {
    return 'The configured Stripe key is not a publishable key (it must start with pk_live_ or pk_test_).'
  }
  return null
}
