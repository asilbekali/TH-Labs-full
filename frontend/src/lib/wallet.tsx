// Credit wallet + active plan, backed by the real billing API
// (GET /v1/payments/credits and /v1/payments/subscription).
//
// The balance is server-authoritative. TanStack Query owns the caching and
// refetching now — this context is a thin, typed read of those two queries so
// the top-bar pill and the Studio gate can stay simple. Staleness is handled
// for us: window focus (query defaults), a charge or purchase
// (usePaymentsInvalidation → CREDITS_CHANGED_EVENT), and sign-in/out (the
// queries are keyed off `enabled`).
import { createContext, useContext, useMemo } from 'react'
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

// Fallback credit cost per quality — a display hint for the Studio's estimate
// line before can-dub answers. The server table (GET /payments/plans →
// qualityCost) is the authority, and can-dub is what actually decides.
export const QUALITY_COST: Record<string, number> = {
  fast: 5,
  balanced: 10,
  studio: 20,
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

  const value = useMemo<WalletContextValue>(() => {
    const sub = subscription.data?.subscription
    const active = sub?.status === 'ACTIVE'
    const plan: PlanId = active && sub?.plan?.tier ? TIER_TO_PLAN[sub.plan.tier] : 'free'
    const freeGrant =
      plans.data?.plans.find((p) => p.tier === 'FREE' && p.cycle === 'MONTHLY')?.creditsGranted ?? 0
    return {
      balance: credits.data?.balance ?? 0,
      plan,
      planInfo: {
        id: plan,
        name: PLAN_NAMES[plan],
        creditsGranted: active ? (sub?.plan?.creditsGranted ?? 0) : freeGrant,
      },
      loading: credits.isPending || subscription.isPending,
      refresh: async () => {
        await qc.invalidateQueries({ queryKey: qk.payments() })
      },
    }
  }, [
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
