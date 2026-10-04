// Client for the billing/credits API (NestJS, /v1/payments). Every call rides
// the shared authenticated fetch (Bearer access token + httpOnly refresh cookie,
// with one silent-refresh retry on 401). getPlans is public; the rest need auth.
import { authJson } from './http'

export type PlanTier = 'FREE' | 'PRO' | 'STUDIO'
export type BillingCycle = 'MONTHLY' | 'YEARLY'
export type SubscriptionStatus = 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'EXPIRED'
export type PaymentStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'REFUNDED'

export interface ServerPlan {
  id: string
  tier: PlanTier
  cycle: BillingCycle
  priceCents: number
  /** Credits in ONE allocation. The advertised total is this × grantsPerPeriod. */
  creditsGranted: number
  grantDays: number
  /**
   * Allocations per paid period: 1 for monthly, 12 for yearly.
   *
   * Optional because an API deployed before the grant-allocation change simply
   * omits it. Treat a missing value as 1 — never multiply by it unguarded, or
   * every credit figure in the UI renders as NaN.
   */
  grantsPerPeriod?: number
  /** The Lemon Squeezy share link this plan is sold through. Null: cannot be bought. */
  checkoutUrl: string | null
  /** The LS variant behind that link — what a paid order is matched on. */
  lsVariantId: string | null
  active: boolean
}

/**
 * Whether money can actually move, as the API reports it.
 *
 * The browser cannot work this out for itself — there is no publishable key
 * and no client SDK — and guessing was the old bug: a build could show a
 * confident "live payments" badge over a checkout that took test cards.
 */
export interface CheckoutInfo {
  provider: 'lemonsqueezy'
  /** Read by the server off the catalog's LS variants, not from this bundle. */
  mode: 'test' | 'live' | 'unknown' | 'unconfigured'
  /** True when at least one paid plan has a checkout link to open. */
  configured: boolean
  /** `TIER/CYCLE` for each paid plan still missing one. */
  missingProducts: string[]
  /**
   * False when the API holds no Lemon Squeezy key. A purchase then cannot be verified,
   * so it cannot be credited — the UI disables Buy rather than taking money it
   * has no way to honour. This is the one to check first.
   */
  canGrantCredits: boolean
}

export interface PlansResponse {
  plans: ServerPlan[]
  /** Credits a MINUTE of dubbing costs, per quality. Was a flat per-dub cost. */
  qualityCost: Record<string, number>
  /** Balanced-quality tariff: credits per minute of source. */
  creditsPerMinute?: number
  qualityMultiplier?: Record<string, number>
  /** Seconds of dubbing the signup bonus buys — the free minute. */
  freeMinuteSeconds?: number
  signupBonusCredits?: number
  /** Absent on an API deployed before the payments rework. */
  checkout?: CheckoutInfo
}

export interface CheckoutResponse {
  url: string
  tier: PlanTier
  cycle: BillingCycle
  priceCents: number
  creditsGranted: number
}

/* ── One-time credit packs ──────────────────────────────────────────────────
 * Buying credits outright, with no subscription: someone with a single 4-minute
 * video to dub should be able to pay for that video and leave.
 *
 * GET /v1/payments/credit-packs serves this catalog, and the copy below is the
 * fallback for an API deployed before that endpoint existed. The two must stay
 * in step with api/src/payment/credit-packs.ts — the server's numbers are what
 * a purchase actually grants. `fromServer` says which one you are looking at.
 */

export interface CreditPack {
  id: string
  credits: number
  priceCents: number
  currency: string
  /** Marks the pack the page highlights. */
  popular?: boolean
  /**
   * False when the API knows this pack but has no checkout link for it, or
   * holds no Lemon Squeezy key. The price is still real information worth showing — the
   * button is not. Undefined from the built-in fallback catalog, where nothing
   * is known.
   */
  available?: boolean
}

export interface CreditPacksResponse {
  packs: CreditPack[]
  /** Credits a minute of source burns at Balanced quality. */
  creditsPerMinute: number
  /** Multiplier on creditsPerMinute, per quality key. */
  qualityMultiplier: Record<string, number>
  /** False when these are the built-in defaults rather than the API's. */
  fromServer: boolean
}

export interface CreditCheckoutResponse {
  url: string
  packId: string
  credits: number
  priceCents: number
}

/** What POST /v1/payments/claim answers. */
export interface ClaimResponse {
  /** True when THIS call credited at least one purchase. */
  claimed: boolean
  /** Each purchase this call credited, in the API's words. */
  granted: { orderId: string; description: string; creditsGranted: number }[]
  /** Sum of `granted` — 0 when nothing new was found. */
  creditsGranted: number
  /** The balance after the grant — authoritative, not a local sum. */
  balance: number
  /** LS has an order still processing — ask again in a few seconds. */
  pending: boolean
  /** Paid orders that match nothing in the catalog. Support settles these. */
  unmatched: number
  /**
   * Purchases credited in the last hour, by this call or an earlier one (the
   * server also checks every few minutes). How a reload, or a buyer who comes
   * back after the server already credited them, still sees "done".
   */
  recent: { description: string; createdAt: string }[]
  subscription: unknown | null
}

const DEFAULT_CREDIT_PACKS: Omit<CreditPacksResponse, 'fromServer'> = {
  packs: [
    { id: 'pack_100', credits: 100, priceCents: 119, currency: 'usd' },
    { id: 'pack_500', credits: 500, priceCents: 499, currency: 'usd', popular: true },
    { id: 'pack_2000', credits: 2000, priceCents: 1799, currency: 'usd' },
  ],
  // 20 credits a minute at Balanced, so each pack is a round number of minutes
  // in both directions: 100 → 5 min, 500 → 25 min, 2000 → 100 min.
  creditsPerMinute: 20,
  qualityMultiplier: { fast: 0.5, balanced: 1, studio: 2 },
}

/**
 * What a clip of this length costs in credits, rounded to a figure a human can
 * hold in their head. Kept here next to the tariff it uses, so the estimator on
 * the Plans page and any other caller cannot drift apart.
 */
export function creditsForMinutes(
  minutes: number,
  quality: string,
  tariff: Pick<CreditPacksResponse, 'creditsPerMinute' | 'qualityMultiplier'>,
): number {
  const raw = minutes * tariff.creditsPerMinute * (tariff.qualityMultiplier[quality] ?? 1)
  return Math.max(10, Math.round(raw / 10) * 10)
}

/** The cheapest pack that covers `credits`, or the largest one if none does. */
export function packFor(credits: number, packs: CreditPack[]): CreditPack | undefined {
  const sorted = [...packs].sort((a, b) => a.credits - b.credits)
  return sorted.find((p) => p.credits >= credits) ?? sorted[sorted.length - 1]
}

export interface Subscription {
  id: string
  userId: number
  planId: string
  status: SubscriptionStatus
  currentPeriodStart: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  createdAt: string
  plan?: ServerPlan
}

export interface CreditsResponse {
  balance: number
  page: number
  limit: number
  total: number
  entries: {
    id: string
    delta: number
    balance: number
    reason: string
    refId: string | null
    note: string | null
    createdAt: string
  }[]
}

export interface PaymentRow {
  id: string
  amountCents: number
  currency: string
  status: PaymentStatus
  description: string
  createdAt: string
}

export interface HistoryResponse {
  page: number
  limit: number
  total: number
  items: PaymentRow[]
}

// The gate's answer is no longer yes/no. Credits are priced per second, so a
// balance that cannot pay for a whole video still pays for the front of it:
// `allowed` means "some of this can be dubbed", and `trimmed` means "not all of
// it". Only a balance that buys nothing at all comes back as allowed: false.
export interface CanDubResult {
  allowed: boolean
  reason: 'INSUFFICIENT_CREDITS' | null
  /** Credits the FULL clip would cost. */
  cost: number
  balance: number
  /** Length asked about, echoed back. */
  durationSeconds: number
  /** Seconds that will actually be dubbed and charged. */
  billableSeconds: number
  /** Credits for `billableSeconds` — what the charge will be. */
  billableCost: number
  /** True when the dub will be cut short to fit the balance. */
  trimmed: boolean
  /** Longest clip this balance could dub at this quality. */
  affordableSeconds: number
  creditsPerMinute: number
}

export interface CommitDubResult {
  jobId: string
  charged: boolean
  /** Seconds charged for — post-trim, so not always the source length. */
  durationSeconds: number
  cost: number
  balance: number
  idempotent: boolean
}

// Fired whenever a call changes the credit balance, so the wallet can refetch
// and the top-bar pill updates without a manual page refresh.
export const CREDITS_CHANGED_EVENT = 'th:credits-changed'
function notifyCreditsChanged(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT))
  }
}

// ── Catalog (public) ────────────────────────────────────────────────────────
export function getPlans(): Promise<PlansResponse> {
  return authJson<PlansResponse>('/payments/plans', {}, 'Could not load plans')
}

/**
 * The one-time credit catalog, server-first.
 *
 * Anything that fails falls through to the defaults above so the page still
 * renders real numbers rather than an error. Only a response that actually
 * carries packs is treated as the server's.
 */
export async function getCreditPacks(): Promise<CreditPacksResponse> {
  try {
    const res = await authJson<Partial<CreditPacksResponse>>(
      '/payments/credit-packs',
      {},
      'Could not load credit packs',
    )
    if (Array.isArray(res.packs) && res.packs.length > 0) {
      return {
        packs: res.packs,
        creditsPerMinute:
          Number(res.creditsPerMinute) || DEFAULT_CREDIT_PACKS.creditsPerMinute,
        qualityMultiplier: res.qualityMultiplier ?? DEFAULT_CREDIT_PACKS.qualityMultiplier,
        fromServer: true,
      }
    }
  } catch {
    /* endpoint not deployed yet, or the user is signed out — use the defaults */
  }
  return { ...DEFAULT_CREDIT_PACKS, fromServer: false }
}

// ── Checkout ──────────────────────────────────────────────────────────────
export function getCheckoutUrl(
  tier: Exclude<PlanTier, 'FREE'>,
  cycle: BillingCycle,
): Promise<CheckoutResponse> {
  return authJson<CheckoutResponse>(
    `/payments/checkout?tier=${tier}&cycle=${cycle}`,
    {},
    'Could not start checkout',
  )
}

/** Checkout for a single credit pack — a one-off payment, no subscription. */
export function getCreditCheckoutUrl(packId: string): Promise<CreditCheckoutResponse> {
  return authJson<CreditCheckoutResponse>(
    `/payments/checkout/credits?pack=${encodeURIComponent(packId)}`,
    {},
    'Could not start checkout for this credit pack',
  )
}

// ── Subscription ────────────────────────────────────────────────────────────
export function getSubscription(): Promise<{ subscription: Subscription | null }> {
  return authJson('/payments/subscription', {}, 'Could not load subscription')
}

export async function cancelSubscription(): Promise<{ subscription: Subscription; message: string }> {
  const res = await authJson<{ subscription: Subscription; message: string }>(
    '/payments/subscription/cancel',
    { method: 'POST' },
    'Could not cancel subscription',
  )
  notifyCreditsChanged()
  return res
}

/**
 * The claim. Ask the API to credit this account's paid Lemon Squeezy orders.
 *
 * Takes no input on purpose: LS's return trip carries no order id, and nothing
 * the browser could send would be trusted anyway. The API asks LS for the
 * orders filed under this account's email and credits each new one, once.
 * The server also does this on its own every few minutes after a checkout is
 * opened, so this call only makes it instant — it is not the only chance.
 */
export function claimPurchases(): Promise<ClaimResponse> {
  return authJson<ClaimResponse>(
    '/payments/claim',
    { method: 'POST' },
    'Could not confirm your payment',
  )
}

// ── Credits & history ───────────────────────────────────────────────────────
export function getCredits(page = 1, limit = 20): Promise<CreditsResponse> {
  return authJson<CreditsResponse>(
    `/payments/credits?page=${page}&limit=${limit}`,
    {},
    'Could not load credits',
  )
}

export function getHistory(page = 1, limit = 20): Promise<HistoryResponse> {
  return authJson<HistoryResponse>(
    `/payments/history?page=${page}&limit=${limit}`,
    {},
    'Could not load payment history',
  )
}

// ── The free-dub / credit gate ──────────────────────────────────────────────
export function canDub(durationSeconds: number, quality: string): Promise<CanDubResult> {
  return authJson<CanDubResult>(
    '/payments/can-dub',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ durationSeconds, quality }),
    },
    'Could not verify your credits',
  )
}

export async function commitDub(
  jobId: string,
  durationSeconds: number,
  quality: string,
): Promise<CommitDubResult> {
  const res = await authJson<CommitDubResult>(
    '/payments/commit-dub',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, durationSeconds, quality }),
    },
    'Could not charge the dub',
  )
  notifyCreditsChanged()
  return res
}
