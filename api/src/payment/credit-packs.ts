import { CreditWallet } from '@prisma/client';

// One-time credit packs: buying credits outright, with no subscription.
//
// The live catalog is the `CreditPack` table — an ADMIN edits it from the
// panel, and nothing here is consulted at request time. What stays in code is
// the STARTING catalog, used by prisma/seed.ts to create the rows a fresh
// database needs, and the tariff the estimator quotes with.
//
// Seeding never overwrites a pack an admin has since edited (see seed.ts): the
// point of moving this into the database was that the panel wins.
//
// The three `pack_` prices below are the ones on the pricing page ($1.19 / $4.99 /
// $17.99), and match the Lemon Squeezy products. What a purchase GRANTS is
// decided by the order's variant id, not by these numbers.

export interface CreditPackSeed {
  slug: string;
  credits: number;
  priceCents: number;
  currency: string;
  popular?: boolean;
  /**
   * Lemon Squeezy share link and the variant it sells (test mode). Left out
   * until the product exists: the pack is listed but cannot be bought.
   */
  checkoutUrl?: string;
  lsVariantId?: string;
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
  // Real-time minutes, at 35¢ a minute. For these `credits` is SECONDS of
  // live dubbing for the real-time wallet (see packWallet), not tokens: a pack
  // sells exactly the minutes in its name. The `realtime_` prefix is also what
  // puts a pack in the Plans page's real-time section.
  //
  // Unlike the packs above these are LIVE-mode products: only a live-mode
  // LEMONSQUEEZY_API_KEY can see their orders, so a test key never credits them.
  {
    slug: 'realtime_10',
    credits: 10 * 60,
    priceCents: 350,
    currency: 'usd',
    checkoutUrl:
      'https://th-labs.lemonsqueezy.com/checkout/buy/a18edc14-6e2d-4696-975e-d133796f4eb8',
    lsVariantId: '2390008',
  },
  {
    slug: 'realtime_30',
    credits: 30 * 60,
    priceCents: 1050,
    currency: 'usd',
    popular: true,
    checkoutUrl:
      'https://th-labs.lemonsqueezy.com/checkout/buy/0de5be7b-f40e-428e-958e-8e53acbeb0a4',
    lsVariantId: '2390012',
  },
  {
    slug: 'realtime_60',
    credits: 60 * 60,
    priceCents: 2100,
    currency: 'usd',
    checkoutUrl:
      'https://th-labs.lemonsqueezy.com/checkout/buy/daceefed-4880-4757-9797-38b915838094',
    lsVariantId: '2390013',
  },
];

/**
 * The wallet a pack lands in. The `realtime_` slug prefix is the one rule, for
 * seeded packs and for any an admin adds later: those packs grant seconds of
 * live dubbing (their `credits` is seconds), every other pack grants tokens
 * that only pay for AI dubbing.
 */
export function packWallet(slug: string): CreditWallet {
  return slug.startsWith('realtime_')
    ? CreditWallet.REALTIME
    : CreditWallet.DUB;
}

// The tariff itself now lives in quality-cost.ts, which is also what can-dub
// and commit-dub charge with — the estimator on the Plans page and the actual
// charge can no longer drift apart, because they read the same numbers.
//
// 20 a minute is the headline the pricing page is built on ("1 minute of dubbed
// video = 20 credits"), and every `pack_` above divides into it exactly:
// 100 → 5 min, 500 → 25 min, 2000 → 100 min.
export { CREDITS_PER_MINUTE, QUALITY_MULTIPLIER } from './quality-cost';
