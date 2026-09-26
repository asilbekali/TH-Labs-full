// What the browser needs to know about Dodo Payments — which is almost
// nothing, and that is the point.
//
// Checkout is entirely Dodo-hosted: GET /v1/payments/checkout returns a URL and
// we navigate to it, so Dodo owns the card form, 3-D Secure and the PCI scope.
// There is no client SDK and no publishable key to ship.
//
// That also means the browser has no way of its own to tell whether billing is
// configured or whether this is test mode. It doesn't guess: the API reports
// both on GET /v1/payments/plans (`checkout`), because the server is the only
// side that knows which products are actually wired up. The helpers below just
// read that block.

import type { CheckoutInfo } from './payments-api'

/**
 * Whether a checkout URL is served by Dodo's test host.
 *
 * Test checkouts live on `test.checkout.dodopayments.com`, live ones on
 * `checkout.dodopayments.com`. Worth checking independently of the API's
 * reported mode: a link pasted into .env keeps whatever host it was copied
 * from, so a live-mode deployment can still be handing out test links.
 */
export function isTestCheckoutUrl(url: string | null | undefined): boolean {
  return /^https:\/\/test\.(checkout\.)?dodopayments\.com\//.test(url ?? '')
}

/** Test/live as the server reports it, or null before the catalog loads. */
export function checkoutMode(info: CheckoutInfo | undefined): 'test' | 'live' | null {
  return info?.mode ?? null
}

/**
 * Why checkout is unavailable, or null when it is fine. The Plans page shows
 * this instead of a button that would 400 on click.
 *
 * The two failures are different and worth separating: no product configured
 * means nothing can be bought at all, while no webhook secret means a purchase
 * would go through and never grant the credits it paid for — the worse of the
 * two, and invisible until someone has already been charged.
 */
export function checkoutUnavailableReason(
  info: CheckoutInfo | undefined,
): string | null {
  if (!info) return null // catalog still loading — don't disable anything yet
  if (!info.configured) {
    return 'No Dodo Payments product is configured for any paid plan yet — set the DODO_PRODUCT_* variables on the API and re-run its seed.'
  }
  if (!info.webhookConfigured) {
    return 'Payments are configured but DODO_WEBHOOK_SECRET is not, so a purchase could not grant credits. Checkout is disabled until the API has it.'
  }
  return null
}

/** Plans that loaded fine but cannot be bought, as `TIER/CYCLE` strings. */
export function unbuyablePlans(info: CheckoutInfo | undefined): string[] {
  return info?.missingProducts ?? []
}
