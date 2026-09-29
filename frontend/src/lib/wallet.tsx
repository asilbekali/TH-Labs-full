// Credit wallet + active plan, backed by the real billing API
// (GET /v1/payments/credits and /v1/payments/subscription).
//
// The balance is server-authoritative. TanStack Query owns the caching and
// refetching now — this context is a thin, typed read of those two queries so
// the top-bar pill and the Studio gate can stay simple. Staleness is handled
// for us: window focus (query defaults), a charge or purchase
// (usePaymentsInvalidation → CREDITS_CHANGED_EVENT), and sign-in/out (the
// queries are keyed off `enabled`).
import { createContext, useContext, useEffect, useMemo } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './auth'
import { qk } from './query'
import { useCredits, usePlans, useSubscription } from './queries'
import type { PlanTier } from './payments-api'

export type PlanId = 'free' | 'pro' | 'studio'

export interface Plan {
  id: PlanId
  name: string
  /** Credits the active plan grants per billing period, per the server. */
  creditsGranted: number
}

// Display names for the three tiers. Prices, credit grants and features are
// NOT duplicated here — the Plans page reads all of that from
// GET /v1/payments/plans, which is the only source that can be wrong-by-drift.
const PLAN_NAMES: Record<PlanId, string> = { free: 'Free', pro: 'Pro', studio: 'Studio' }

// Fallback credits-per-MINUTE per quality — a display hint for the Studio's
// estimate line before can-dub answers. The server table (GET /payments/plans →
// qualityCost) is the authority, and can-dub is what actually decides.
//
// These were flat per-dub costs (5/10/20), which meant the Studio quoted the
// same price for a 20-second clip and an hour-long film. Cost is per second now;
// see api/src/payment/quality-cost.ts.
export const CREDITS_PER_MINUTE_BY_QUALITY: Record<string, number> = {
  fast: 10,
  balanced: 20,
  studio: 40,
}

/**
 * Credits `seconds` of source costs at `quality`. Mirrors costForDub() on the
 * server — prorated per second, rounded up, minimum 1 for any real length.
 * A quote, not a charge: can-dub is what decides.
 */
export function estimateDubCost(
  seconds: number,
  quality: string,
  ratePerMinute: Record<string, number> = CREDITS_PER_MINUTE_BY_QUALITY,
): number {
  const rate = ratePerMinute[quality] ?? CREDITS_PER_MINUTE_BY_QUALITY.balanced
  if (!Number.isFinite(seconds) || seconds <= 0) return 0
  return Math.max(1, Math.ceil((seconds * rate) / 60))
}

/** Seconds of dubbing `balance` credits buys at `quality`. Mirrors the server. */
export function affordableSeconds(
  balance: number,
  quality: string,
  ratePerMinute: Record<string, number> = CREDITS_PER_MINUTE_BY_QUALITY,
): number {
  const rate = ratePerMinute[quality] ?? CREDITS_PER_MINUTE_BY_QUALITY.balanced
  if (!Number.isFinite(balance) || balance <= 0) return 0
  return Math.floor((balance * 60) / rate)
}

const TIER_TO_PLAN: Record<PlanTier, PlanId> = {
  FREE: 'free',
  PRO: 'pro',
  STUDIO: 'studio',
}

interface WalletContextValue {
  balance: number
  plan: PlanId
  planInfo: Plan
  loading: boolean
  refresh: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function WalletProvider({ children }: { children: ReactNode }) {
  const { user, ready } = useAuth()
  const qc = useQueryClient()
  const signedIn = ready && !!user

  // limit=1: this only needs the balance, not the ledger. The Plans page asks
  // for a real page of entries under its own key.
  const credits = useCredits(1, 1, signedIn)
  const subscription = useSubscription(signedIn)
  // Only consulted for the Free tier's grant — a paid subscription carries its
  // own plan row, so the catalog is not on the critical path for those users.
  const plans = usePlans()

  // Drop the previous account's billing data the moment the session ends.
  //
  // Disabling a query does NOT discard what it already fetched: TanStack keeps
  // the last response under the same key, so after sign-out the top-bar pill
  // went on showing that session's balance (60 credits on a free account), and
  // the next person to sign in on this device would have seen it too until the
  // first refetch landed. Only the account-scoped keys go — the plan catalog is
  // public and worth keeping warm.
  useEffect(() => {
    if (signedIn) return
    qc.removeQueries({ queryKey: qk.creditsAll() })
    qc.removeQueries({ queryKey: qk.historyAll() })
    qc.removeQueries({ queryKey: qk.subscription() })
  }, [signedIn, qc])

  const value = useMemo<WalletContextValue>(() => {
    const sub = signedIn ? subscription.data?.subscription : null
    const active = sub?.status === 'ACTIVE'
    const plan: PlanId = active && sub?.plan?.tier ? TIER_TO_PLAN[sub.plan.tier] : 'free'
    const freeGrant =
      plans.data?.plans.find((p) => p.tier === 'FREE' && p.cycle === 'MONTHLY')?.creditsGranted ?? 0
    return {
      // Belt and braces: even in the render that happens before the effect
      // above runs, a signed-out visitor has no balance.
      balance: signedIn ? (credits.data?.balance ?? 0) : 0,
      plan,
      planInfo: {
        id: plan,
        name: PLAN_NAMES[plan],
        creditsGranted: active ? (sub?.plan?.creditsGranted ?? 0) : freeGrant,
      },
      // A signed-out visitor is not "still loading" — those queries are off.
      loading: signedIn && (credits.isPending || subscription.isPending),
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: qk.payments() })
      },
    }
  }, [
    signedIn,
    credits.data,
    credits.isPending,
    subscription.data,
    subscription.isPending,
    plans.data,
    qc,
  ])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
