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
    slug: 'pack_120',
    credits: 120,
    priceCents: 699,
    currency: 'usd',
    productEnv: 'DODO_PRODUCT_PACK_120',
  },
  {
    slug: 'pack_240',
    credits: 240,
    priceCents: 1345,
    currency: 'usd',
    popular: true,
    productEnv: 'DODO_PRODUCT_PACK_240',
  },
  {
    slug: 'pack_600',
    credits: 600,
    priceCents: 3190,
    currency: 'usd',
    productEnv: 'DODO_PRODUCT_PACK_600',
  },
  {
    slug: 'pack_1500',
    credits: 1500,
    priceCents: 7450,
    currency: 'usd',
    productEnv: 'DODO_PRODUCT_PACK_1500',
  },
];

// Credits a minute of source burns at Balanced quality, and the multiplier per
// quality. Used by the estimator on the Plans page — a quote, not a charge:
// what a dub actually costs is QUALITY_COST in quality-cost.ts.
export const CREDITS_PER_MINUTE = 53;
export const QUALITY_MULTIPLIER: Record<string, number> = {
  fast: 0.5,
  balanced: 1,
  studio: 2,
};
