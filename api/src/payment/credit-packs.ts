// One-time credit packs: buying credits outright, with no subscription.
//
// The live catalog is the `CreditPack` table — an ADMIN edits it from the
// panel, and nothing here is consulted at request time. What stays in code is
// the STARTING catalog, used by prisma/seed.ts to create the four rows a fresh
// database needs, and the tariff the estimator quotes with.
//
// Seeding never overwrites a pack an admin has since edited (see seed.ts): the
// point of moving this into the database was that the panel wins.
//
// The three prices below are the ones on the pricing page ($1.19 / $4.99 /
// $17.99), and match the Lemon Squeezy products. What a purchase GRANTS is
// decided by the order's variant id, not by these numbers.

export interface CreditPackSeed {
  slug: string;
  credits: number;
  priceCents: number;
  currency: string;
  popular?: boolean;
  /** Lemon Squeezy share link and the variant it sells (test mode). */
  checkoutUrl: string;
  lsVariantId: string;
}

export const CREDIT_PACK_SEED: CreditPackSeed[] = [
  {
    // "Starter" on the pricing page. 100 credits is 5 minutes at 20 a minute.
    slug: 'pack_100',
    credits: 100,
    priceCents: 119,
    currency: 'usd',
    checkoutUrl:
      'https://th-labs.lemonsqueezy.com/checkout/buy/158094fd-d3ba-4dfd-8e9d-f9d713036ea4',
    lsVariantId: '2203420',
  },
  {
    // "Creator" — 25 minutes. The middle pack is the one to push.
    slug: 'pack_500',
    credits: 500,
    priceCents: 499,
    currency: 'usd',
    popular: true,
    checkoutUrl:
      'https://th-labs.lemonsqueezy.com/checkout/buy/a6fbdc9a-72fd-41ed-b280-4871d78a94f6',
    lsVariantId: '2203424',
  },
  {
    // "Pro" — 100 minutes, and the cheapest per minute at $0.18.
    slug: 'pack_2000',
    credits: 2000,
    priceCents: 1799,
    currency: 'usd',
    checkoutUrl:
      'https://th-labs.lemonsqueezy.com/checkout/buy/5b957817-415b-4822-bb44-ae521847222f',
    lsVariantId: '2203428',
  },
];

// The tariff itself now lives in quality-cost.ts, which is also what can-dub
// and commit-dub charge with — the estimator on the Plans page and the actual
// charge can no longer drift apart, because they read the same numbers.
//
// 20 a minute is the headline the pricing page is built on ("1 minute of dubbed
// video = 20 credits"), and every pack above divides into it exactly:
// 100 → 5 min, 500 → 25 min, 2000 → 100 min.
export { CREDITS_PER_MINUTE, QUALITY_MULTIPLIER } from './quality-cost';
