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
