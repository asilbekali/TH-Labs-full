// One-time credit packs: buying credits outright, with no subscription.
//
// The live catalog is the `CreditPack` table — an ADMIN edits it from the
// panel, and nothing here is consulted at request time. What stays in code is
// the STARTING catalog, used by prisma/seed.ts to create the four rows a fresh
// database needs, and the tariff the estimator quotes with.
//
// Seeding never overwrites a pack an admin has since edited (see seed.ts): the
// point of moving this into the database was that the panel wins.

export interface CreditPackSeed {
  slug: string;
  credits: number;
  priceCents: number;
  currency: string;
  popular?: boolean;
  /** Optional env var holding a Dodo product id — a convenience for first boot. */
  productEnv: string;
}

export const CREDIT_PACK_SEED: CreditPackSeed[] = [
  {
    // "Starter" on the pricing page. 100 credits is 5 minutes at 20 a minute.
    slug: 'pack_100',
    credits: 100,
    priceCents: 119,
    currency: 'usd',
    productEnv: 'DODO_PRODUCT_PACK_100',
  },
  {
    // "Creator" — 25 minutes. The middle pack is the one to push.
    slug: 'pack_500',
    credits: 500,
    priceCents: 499,
    currency: 'usd',
    popular: true,
    productEnv: 'DODO_PRODUCT_PACK_500',
  },
  {
    // "Pro" — 100 minutes, and the cheapest per minute at $0.18.
    slug: 'pack_2000',
    credits: 2000,
    priceCents: 1799,
    currency: 'usd',
    productEnv: 'DODO_PRODUCT_PACK_2000',
  },
];

// Credits a minute of source burns at Balanced quality, and the multiplier per
// quality. Used by the estimator on the Plans page — a quote, not a charge:
// what a dub actually costs is QUALITY_COST in quality-cost.ts.
//
// 20 a minute is the headline tariff the pricing page is built on ("1 minute of
// dubbed video = 20 credits"), and every pack above divides into it exactly:
// 100 → 5 min, 500 → 25 min, 2000 → 100 min.
export const CREDITS_PER_MINUTE = 20;
export const QUALITY_MULTIPLIER: Record<string, number> = {
  fast: 0.5,
  balanced: 1,
  studio: 2,
};
