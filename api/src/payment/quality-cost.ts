// The dubbing tariff: what a dub costs, and how much dubbing a balance buys.
//
// Cost is DURATION-BASED. It used to be a flat 5/10/20 per dub regardless of
// length, which made a 30-second clip and a 60-minute film cost the same — and
// made "enough credits for one minute" impossible to express, since a balance
// no longer mapped to an amount of video. Every plan in the catalog is already
// priced on minutes (PRO = 1200 credits = 60 min, STUDIO = 4800 = 240 min), and
// the pricing page has always advertised "1 minute of dubbed video = 20
// credits", so this table is what the product was already describing.
//
// This module is the AUTHORITY. The frontend's copies (frontend/src/lib/wallet.tsx)
// are display hints for the estimate line; can-dub and commit-dub decide.

/** Credits a minute of source burns at Balanced quality. */
export const CREDITS_PER_MINUTE = 20;

/** Multiplier on the per-minute rate, per quality tier. */
export const QUALITY_MULTIPLIER: Record<string, number> = {
  fast: 0.5,
  balanced: 1,
  studio: 2,
};

export const DEFAULT_QUALITY = 'balanced';

/** The one free minute every new account is given. See SIGNUP_BONUS_CREDITS. */
export const FREE_MINUTE_SECONDS = 60;

/**
 * Credits granted at registration: exactly one minute of Balanced dubbing.
 * Written to the ledger as a SIGNUP_BONUS entry so the cached balance and the
 * ledger agree from the account's first moment (see UsersService.create).
 */
export const SIGNUP_BONUS_CREDITS =
  CREDITS_PER_MINUTE * (60 / FREE_MINUTE_SECONDS);

/** Credits per minute at a given quality. `fast` 10, `balanced` 20, `studio` 40. */
export function rateFor(quality: string | undefined): number {
  const mult = QUALITY_MULTIPLIER[quality ?? DEFAULT_QUALITY] ?? 1;
  return CREDITS_PER_MINUTE * mult;
}

/**
 * What dubbing `durationSeconds` of source costs at `quality`.
 *
 * Prorated per second and rounded UP, so a 61-second clip costs 21 rather than
 * being billed as two whole minutes. Any non-zero duration costs at least one
 * credit — a 0-credit charge would leave no ledger trace of a real dub.
 */
export function costForDub(
  durationSeconds: number,
  quality: string | undefined,
): number {
  const seconds = Number(durationSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.ceil((seconds * rateFor(quality)) / 60));
}

/**
 * The inverse: how many whole seconds of source `balance` credits can pay for.
 *
 * This is what the trim rule is built on — a balance that cannot cover the
 * whole video still buys the first N seconds of it. Floored, so the returned
 * length is always actually affordable: costForDub(affordableSeconds(b, q), q)
 * is never greater than `b`.
 */
export function affordableSeconds(
  balance: number,
  quality: string | undefined,
): number {
  const credits = Number(balance);
  if (!Number.isFinite(credits) || credits <= 0) return 0;
  return Math.floor((credits * 60) / rateFor(quality));
}

/**
 * The published per-minute price list, for the pricing page and the admin
 * panel. Replaces the old flat per-dub `QUALITY_COST`.
 */
export const CREDITS_PER_MINUTE_BY_QUALITY: Record<string, number> =
  Object.fromEntries(
    Object.keys(QUALITY_MULTIPLIER).map((q) => [q, rateFor(q)]),
  );
