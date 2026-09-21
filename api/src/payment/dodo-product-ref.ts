// Turning whatever someone pasted into .env into the two things the app needs:
// a Dodo product id and a checkout link.
//
// The dashboard hands out both forms — the product page shows `pdt_…`, the
// "share" button copies a full `https://checkout.dodopayments.com/buy/pdt_…`
// URL — and an operator filling in DODO_PRODUCT_PRO_MONTHLY should not have to
// know which one we wanted. So every env var accepts either, and the missing
// half is derived here rather than in each caller.
//
// This file is imported by prisma/seed.ts as well as the API, so it must stay
// free of Nest imports.

export type DodoEnvironmentName = 'test_mode' | 'live_mode';

const CHECKOUT_HOST: Record<DodoEnvironmentName, string> = {
  live_mode: 'https://checkout.dodopayments.com',
  test_mode: 'https://test.checkout.dodopayments.com',
};

export interface DodoProductRef {
  productId: string;
  /** Static payment link for the product, in the given environment. */
  linkUrl: string;
}

/**
 * Could this be a Dodo product id?
 *
 * Deliberately a shape check, not a `pdt_` prefix check — the prefix is a
 * convention, not a guarantee, and rejecting a valid id would be worse than
 * accepting an odd one. What it does catch is the value that is clearly not an
 * id at all: a half-pasted sentence, a placeholder, a link with a space in it.
 * Those must fail here, where the seed reports them as missing, rather than
 * become a checkout URL that 404s in front of a customer.
 */
function isPlausibleProductId(value: string): boolean {
  return /^[A-Za-z0-9_-]{3,100}$/.test(value);
}

/** The static payment link for a product id, e.g. `…/buy/pdt_abc`. */
export function paymentLinkFor(
  productId: string,
  environment: DodoEnvironmentName,
): string {
  return `${CHECKOUT_HOST[environment]}/buy/${productId}`;
}

/** A checkout URL served by Dodo's test host takes test cards only. */
export function isTestCheckoutUrl(url: string | null | undefined): boolean {
  return /^https:\/\/test\.(checkout\.)?dodopayments\.com\//.test(url ?? '');
}

/**
 * Read one env value as a product reference, or null when it is unset.
 *
 * Accepts a bare product id (`pdt_…`) or any Dodo checkout URL containing one.
 * Query parameters on a pasted link are dropped: the ones we care about
 * (metadata, the return URL) are added per checkout, and keeping a stale
 * `?quantity=3` from the dashboard would silently triple every purchase.
 */
export function parseProductRef(
  raw: string | null | undefined,
  environment: DodoEnvironmentName,
): DodoProductRef | null {
  const value = raw?.trim();
  if (!value) return null;

  if (!value.includes('://')) {
    if (!isPlausibleProductId(value)) return null;
    return { productId: value, linkUrl: paymentLinkFor(value, environment) };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  // …/buy/<product id>, with anything after it ignored.
  const segments = url.pathname.split('/').filter(Boolean);
  const buyAt = segments.indexOf('buy');
  const productId =
    buyAt >= 0 ? segments[buyAt + 1] : segments[segments.length - 1];
  if (!productId || !isPlausibleProductId(productId)) return null;

  // Keep the host that was pasted — a live link stays live even if this
  // process is pointed at test mode, so the mismatch is visible rather than
  // silently rewritten to a product id that does not exist on the other side.
  return { productId, linkUrl: `${url.origin}/buy/${productId}` };
}
