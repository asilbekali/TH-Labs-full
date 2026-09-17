// Client for the billing/credits API (NestJS, /v1/payments). Every call rides
// the shared authenticated fetch (Bearer access token + httpOnly refresh cookie,
// with one silent-refresh retry on 401). getPlans is public; the rest need auth.
import { authJson } from './http'

export type PlanTier = 'FREE' | 'PRO' | 'STUDIO'
export type BillingCycle = 'WEEKLY' | 'MONTHLY' | 'YEARLY'
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
   * Allocations per paid period: 1 for weekly/monthly, 12 for yearly.
   *
   * Optional because an API deployed before the grant-allocation change simply
   * omits it. Treat a missing value as 1 — never multiply by it unguarded, or
   * every credit figure in the UI renders as NaN.
   */
  grantsPerPeriod?: number
  stripePriceId: string | null
  stripeLinkUrl: string | null
  active: boolean
}

export interface PlansResponse {
  plans: ServerPlan[]
  qualityCost: Record<string, number>
  freeDubMaxSeconds: number
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
 * The catalog below is a PLACEHOLDER. GET /v1/payments/credit-packs does not
 * exist yet; getCreditPacks() asks for it and falls back to these numbers, so
 * the page is complete today and switches to real server pricing the moment the
 * endpoint ships — no UI change needed. `fromServer` says which one you are
 * looking at.
 */

export interface CreditPack {
  id: string
  credits: number
  priceCents: number
  currency: string
  /** Marks the pack the page highlights. */
  popular?: boolean
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

const DEFAULT_CREDIT_PACKS: Omit<CreditPacksResponse, 'fromServer'> = {
  packs: [
    { id: 'pack_120', credits: 120, priceCents: 699, currency: 'usd' },
    { id: 'pack_240', credits: 240, priceCents: 1345, currency: 'usd', popular: true },
    { id: 'pack_600', credits: 600, priceCents: 3190, currency: 'usd' },
    { id: 'pack_1500', credits: 1500, priceCents: 7450, currency: 'usd' },
  ],
  // 53 credits a minute at Balanced: a 4½-minute clip lands on the 240-credit
  // pack from both directions — the estimator rounds 238.5 up to 240, and the
  // 240 pack advertises ≈4.5 minutes back.
  creditsPerMinute: 53,
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

export interface CanDubResult {
  allowed: boolean
  reason: 'FREE_DUB_LENGTH_EXCEEDED' | 'INSUFFICIENT_CREDITS' | null
  cost: number
  isFreeDub: boolean
  balance: number
}

export interface CommitDubResult {
  jobId: string
  charged: boolean
  isFreeDub: boolean
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
 * A missing endpoint is the expected case right now, not an error worth
 * surfacing: anything that fails falls through to the defaults above so the
 * page still renders real numbers. Only a response that actually carries packs
 * is treated as the server's.
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
