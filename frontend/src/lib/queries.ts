// TanStack Query hooks over the two backends.
//
// The transport still lives in the thin clients (api.ts → FastAPI for jobs and
// media, but the account API for health and languages; auth-api.ts and
// payments-api.ts → the NestJS CRUD API documented at <host>/docs). This
// module owns caching, loading/error state, invalidation and refetch policy, so
// no page has to hand-roll a useEffect + useState + "did it fail?" triangle.
//
// Invalidation rule of thumb: a mutation invalidates the narrowest prefix that
// still covers everything the server changed. Checkout and cancel both move
// credits AND the subscription, so they invalidate qk.payments() wholesale.
import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import { useEffect, useRef } from 'react'

import { qk } from './query'
import { getHealth, getLanguages, FALLBACK_LANGUAGES } from './api'
import type { Health, Language } from './types'
import { me, updateAccount, type AccountUser } from './auth-api'
import {
  cancelSubscription,
  canDub,
  checkoutStartedAt,
  claimPurchases,
  clearCheckoutStarted,
  getEntitlements,
  commitDub,
  getCheckoutUrl,
  getCreditCheckoutUrl,
  getCreditPacks,
  getCredits,
  getHistory,
  getPlans,
  getSubscription,
  CREDITS_CHANGED_EVENT,
  type BillingCycle,
  type DubFeatures,
  type EntitlementsResponse,
  type CanDubResult,
  type CheckoutResponse,
  type CommitDubResult,
  type CreditCheckoutResponse,
  type CreditPacksResponse,
  type CreditsResponse,
  type HistoryResponse,
  type PlansResponse,
  type PlanTier,
  type Subscription,
} from './payments-api'

/* ── Service status & catalog (account API) ──────────────────────────────── */

/**
 * GET /v1/health — this API, its database, and the pipeline it probes on our
 * behalf. Polled while the tab is visible so the Home strip and the Studio chip
 * reflect a pipeline that comes back up without a reload.
 *
 * isError here means the ACCOUNT API is unreachable. A pipeline that is merely
 * down resolves normally with `pipeline: 'down'` — use pipelineDown(), not
 * isError, to decide whether dubbing is possible.
 */
export function useHealth(): UseQueryResult<Health> {
  return useQuery({
    queryKey: qk.health(),
    queryFn: getHealth,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })
}

/**
 * GET /v1/languages — the catalog, from the account API's database. Effectively
 * static, so it is cached for the session; `placeholderData` keeps the target
 * picker usable while the first request is in flight and after a failure (see
 * FALLBACK_LANGUAGES — the same codes the API seeds, not invented content).
 */
export function useLanguages(): UseQueryResult<Language[]> {
  return useQuery({
    queryKey: qk.languages(),
    queryFn: getLanguages,
    staleTime: Infinity,
    gcTime: Infinity,
    placeholderData: FALLBACK_LANGUAGES,
  })
}

/* ── Account API (CRUD) ──────────────────────────────────────────────────── */

/** GET /v1/auth/me. Only runs when there is a session to ask about. */
export function useMe(enabled: boolean): UseQueryResult<AccountUser> {
  return useQuery({ queryKey: qk.me(), queryFn: me, enabled })
}

/** PATCH /v1/users/:id. Writes the server's response straight into the cache. */
export function useUpdateAccount(): UseMutationResult<
  AccountUser,
  Error,
  { id: number; name?: string; email?: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }) => updateAccount(id, data),
    onSuccess: (user) => {
      qc.setQueryData(qk.me(), user)
    },
  })
}

/* ── Billing ─────────────────────────────────────────────────────────────── */

/** GET /v1/payments/plans — the public price catalog. */
export function usePlans(): UseQueryResult<PlansResponse> {
  return useQuery({ queryKey: qk.plans(), queryFn: getPlans, staleTime: 5 * 60_000 })
}

/**
 * GET /v1/payments/credit-packs — the one-time credit catalog.
 *
 * Never fails: the client falls back to the built-in pricing when the endpoint
 * is not deployed, so this query has no error state to render. Cached like the
 * plan catalog because it changes about as often.
 */
export function useCreditPacks(): UseQueryResult<CreditPacksResponse> {
  return useQuery({
    queryKey: qk.creditPacks(),
    queryFn: getCreditPacks,
    staleTime: 5 * 60_000,
  })
}

/** GET /v1/payments/subscription. */
export function useSubscription(enabled = true): UseQueryResult<{ subscription: Subscription | null }> {
  return useQuery({ queryKey: qk.subscription(), queryFn: getSubscription, enabled })
}

/** GET /v1/payments/credits — balance plus a page of the ledger. */
export function useCredits(page = 1, limit = 20, enabled = true): UseQueryResult<CreditsResponse> {
  return useQuery({
    queryKey: qk.credits(page, limit),
    queryFn: () => getCredits(page, limit),
    enabled,
  })
}

/** GET /v1/payments/history — the user's payment rows. */
export function useHistory(page = 1, limit = 20, enabled = true): UseQueryResult<HistoryResponse> {
  return useQuery({
    queryKey: qk.history(page, limit),
    queryFn: () => getHistory(page, limit),
    enabled,
  })
}

/**
 * Ask the API for this plan's Lemon Squeezy checkout link. A mutation rather
 * than a query because it is a deliberate user action with a side effect (the
 * API starts watching this account for the order) and must never be replayed
 * from cache.
 */
export function useCheckout(): UseMutationResult<
  CheckoutResponse,
  Error,
  { tier: Exclude<PlanTier, 'FREE'>; cycle: BillingCycle }
> {
  return useMutation({ mutationFn: ({ tier, cycle }) => getCheckoutUrl(tier, cycle) })
}

/** Same as useCheckout, for a one-time credit pack rather than a subscription. */
export function useCreditCheckout(): UseMutationResult<
  CreditCheckoutResponse,
  Error,
  { packId: string }
> {
  return useMutation({ mutationFn: ({ packId }) => getCreditCheckoutUrl(packId) })
}

/** POST /v1/payments/subscription/cancel (at period end). */
export function useCancelSubscription() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: cancelSubscription,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.payments() })
    },
  })
}

/** GET /v1/payments/entitlements — the tier and what it unlocks in the Studio. */
export function useEntitlements(enabled = true): UseQueryResult<EntitlementsResponse> {
  return useQuery({ queryKey: qk.entitlements(), queryFn: getEntitlements, enabled })
}

/** POST /v1/payments/can-dub — the read-only credit + plan gate. Charges nothing. */
export function useCanDub(): UseMutationResult<
  CanDubResult,
  Error,
  { durationSeconds: number; quality: string; features?: DubFeatures }
> {
  return useMutation({
    mutationFn: ({ durationSeconds, quality, features }) =>
      canDub(durationSeconds, quality, features),
  })
}

/** POST /v1/payments/commit-dub — the charge. Idempotent on jobId. */
export function useCommitDub(): UseMutationResult<
  CommitDubResult,
  Error,
  { jobId: string; durationSeconds: number; quality: string; features?: DubFeatures }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, durationSeconds, quality, features }) =>
      commitDub(jobId, durationSeconds, quality, features),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.payments() })
    },
  })
}

/**
 * Bridge the imperative CREDITS_CHANGED_EVENT into cache invalidation.
 *
 * payments-api.ts fires that event from plain (non-hook) call sites, and the
 * balance also moves outside this page — /plans/success credits the account when
 * the buyer returns from Lemon Squeezy. Mounted once at the
 * app root.
 */
export function usePaymentsInvalidation(): void {
  const qc = useQueryClient()
  useEffect(() => {
    const invalidate = () => void qc.invalidateQueries({ queryKey: qk.payments() })
    window.addEventListener(CREDITS_CHANGED_EVENT, invalidate)
    return () => window.removeEventListener(CREDITS_CHANGED_EVENT, invalidate)
  }, [qc])
}

/**
 * Credit a purchase the moment the buyer is back, wherever they land.
 *
 * While a checkout opened from this browser is recent (markCheckoutStarted),
 * this claims when the app is shown again — focus, tab switch, Back from
 * Lemon Squeezy (pageshow) — and every few seconds while visible. It stops as
 * soon as a purchase is credited. The claim is idempotent server-side, so this
 * racing the success page, the webhook or the cron pays out once.
 */
export function usePendingCheckoutClaim(signedIn: boolean): void {
  const qc = useQueryClient()
  const inFlight = useRef(false)
  useEffect(() => {
    if (!signedIn) return
    const tryClaim = async () => {
      if (inFlight.current || document.visibilityState !== 'visible') return
      const startedAt = checkoutStartedAt()
      if (startedAt === null) return
      inFlight.current = true
      try {
        const res = await claimPurchases()
        // Done when this call credited something, or something was credited
        // since the checkout opened (by the webhook, the cron, another tab).
        // An older purchase from earlier in the hour does not count.
        const creditedSince = res.recent.some(
          (r) => new Date(r.createdAt).getTime() >= startedAt - 60_000,
        )
        if (res.claimed || creditedSince) {
          clearCheckoutStarted()
          void qc.invalidateQueries({ queryKey: qk.payments() })
        }
      } catch {
        /* LS unreachable for a moment — the next tick tries again */
      } finally {
        inFlight.current = false
      }
    }
    void tryClaim()
    const onVisible = () => void tryClaim()
    window.addEventListener('focus', onVisible)
    window.addEventListener('pageshow', onVisible)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(() => void tryClaim(), 8000)
    return () => {
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('pageshow', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [signedIn, qc])
}
