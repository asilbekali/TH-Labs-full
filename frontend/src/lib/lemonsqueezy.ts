// What the browser needs to know about Lemon Squeezy — which is almost
// nothing, and that is the point.
//
// Checkout is a Lemon Squeezy share link. `GET /v1/payments/checkout` returns
// it with this account's email prefilled, and we navigate there, so LS owns the
// card form, 3-D Secure, tax and the whole PCI scope. There is no client SDK,
// no key, and nothing in this bundle that could be edited to change what a
// purchase grants — that is decided by the order's variant, read by the API.
//
// The browser cannot tell whether billing is configured or whether this is
// test mode, and it does not guess: the API reports both on
// `GET /v1/payments/plans` (`checkout`). The helpers below just read that.

import type { CheckoutInfo } from './payments-api'

/** Test/live as the server reports it, or null before the catalog loads. */
export function checkoutMode(
  info: CheckoutInfo | undefined,
): CheckoutInfo['mode'] | null {
  return info?.mode ?? null
}

/**
 * Why checkout is unavailable, or null when it is fine. The Plans page shows
 * this instead of a button that would fail on click.
 *
 * No API key is the worse of the two failures: a purchase would go through and
 * could never be verified, so the money would leave the customer's card and no
 * credits would arrive. The server refuses to hand out a link in that state;
 * this is the matching message.
 */
export function checkoutUnavailableReason(
  info: CheckoutInfo | undefined,
): string | null {
  if (!info) return null // catalog still loading — don't disable anything yet
  if (!info.canGrantCredits) {
    return 'Payments are turned off: the server has no Lemon Squeezy API key, so a purchase could not be confirmed and credits could not be granted. Set LEMONSQUEEZY_API_KEY on the API.'
  }
  if (!info.configured) {
    return 'No Lemon Squeezy checkout link is configured for any paid plan yet — add the link and variant id in the admin panel.'
  }
  return null
}

/** Plans that loaded fine but cannot be bought, as `TIER/CYCLE` strings. */
export function unbuyablePlans(info: CheckoutInfo | undefined): string[] {
  return info?.missingProducts ?? []
}
