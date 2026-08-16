// TanStack Query hooks over the two backends.
//
// The transport still lives in the thin clients (api.ts → FastAPI, auth-api.ts
// and payments-api.ts → the NestJS CRUD API documented at <host>/docs). This
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
import { useEffect } from 'react'

import { qk } from './query'
import { getHealth, getLanguages, FALLBACK_LANGUAGES } from './api'
import type { Health, Language } from './types'
import { me, updateAccount, type AccountUser } from './auth-api'
import {
  cancelSubscription,
  canDub,
  commitDub,
  getCheckoutUrl,
  getCredits,
  getHistory,
  getPlans,
  getSubscription,
  CREDITS_CHANGED_EVENT,
  type BillingCycle,
  type CanDubResult,
  type CheckoutResponse,
  type CommitDubResult,
  type CreditsResponse,
  type HistoryResponse,
  type PlansResponse,
  type PlanTier,
  type Subscription,
} from './payments-api'

/* ── Dubbing API ─────────────────────────────────────────────────────────── */

/**
 * Live pipeline status. Polled while the tab is visible so the Home strip and
 * the Studio chip reflect a service that comes back up without a reload.
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
 * The language catalog. Effectively static, so it is cached for the session;
 * `placeholderData` keeps the target picker usable while the first request is
 * in flight and after a failure (see FALLBACK_LANGUAGES — the same codes the
 * backend ships, not invented content).
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

/** GET /v1/payments/history — Stripe payment rows. */
export function useHistory(page = 1, limit = 20, enabled = true): UseQueryResult<HistoryResponse> {
  return useQuery({
    queryKey: qk.history(page, limit),
    queryFn: () => getHistory(page, limit),
    enabled,
  })
}

/**
 * Ask the API for a Stripe-hosted checkout URL. A mutation rather than a query
 * because it is a deliberate user action with a side effect (the URL carries
 * the user's client_reference_id) and must never be replayed from cache.
 */
export function useCheckout(): UseMutationResult<
  CheckoutResponse,
  Error,
  { tier: Exclude<PlanTier, 'FREE'>; cycle: BillingCycle }
> {
  return useMutation({ mutationFn: ({ tier, cycle }) => getCheckoutUrl(tier, cycle) })
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

/** POST /v1/payments/can-dub — the read-only credit gate. Charges nothing. */
export function useCanDub(): UseMutationResult<
  CanDubResult,
  Error,
  { durationSeconds: number; quality: string }
> {
  return useMutation({ mutationFn: ({ durationSeconds, quality }) => canDub(durationSeconds, quality) })
}

/** POST /v1/payments/commit-dub — the charge. Idempotent on jobId. */
export function useCommitDub(): UseMutationResult<
  CommitDubResult,
  Error,
  { jobId: string; durationSeconds: number; quality: string }
> {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, durationSeconds, quality }) => commitDub(jobId, durationSeconds, quality),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.payments() })
    },
  })
}

/**
 * Bridge the imperative CREDITS_CHANGED_EVENT into cache invalidation.
 *
 * payments-api.ts fires that event from plain (non-hook) call sites, and the
 * balance also moves outside this app entirely — a Stripe webhook credits the
 * account after checkout completes on Stripe's domain. Mounted once at the
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
