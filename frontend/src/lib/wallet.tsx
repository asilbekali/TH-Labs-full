// Credit wallet + active plan, backed by the real billing API
// (GET /v1/payments/credits and /v1/payments/subscription). The balance is
// server-authoritative — this just caches it in React and refetches when it can
// go stale: on sign-in, after a charge/purchase (the CREDITS_CHANGED_EVENT),
// and on window focus. Static plan metadata below is display-only.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from './auth'
import {
  getCredits,
  getSubscription,
  CREDITS_CHANGED_EVENT,
  type PlanTier,
} from './payments-api'

export type PlanId = 'free' | 'pro' | 'studio'

export interface Plan {
  id: PlanId
  name: string
  price: number // USD / month
  monthlyCredits: number
  features: string[]
  highlight?: boolean
}

export const PLANS: Plan[] = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    monthlyCredits: 60,
    features: ['60 credits / month', 'Fast & Balanced quality', 'Voice cloning', 'Standard queue'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 19,
    monthlyCredits: 600,
    features: ['600 credits / month', 'All qualities incl. Studio', 'Voice cloning + lip sync', 'Priority queue', 'Background separation'],
    highlight: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    price: 49,
    monthlyCredits: 2000,
    features: ['2000 credits / month', 'Everything in Pro', 'Batch dubbing', 'Highest fidelity output', 'Email support'],
  },
]

// One-off credit packs (display metadata). No API module backs these yet, so
// they are not purchasable — surfaced by Plans as "coming soon".
export const CREDIT_PACKS: { credits: number; price: number }[] = [
  { credits: 100, price: 5 },
  { credits: 500, price: 20 },
  { credits: 1200, price: 40 },
]

// Fallback credit cost per quality — display hint only. The server table
// (GET /payments/plans → qualityCost) is the authority used by can-dub.
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
  const [balance, setBalance] = useState(0)
  const [plan, setPlan] = useState<PlanId>('free')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!user) {
      setBalance(0)
      setPlan('free')
      return
    }
    setLoading(true)
    try {
      const [credits, sub] = await Promise.all([
        getCredits(1, 1),
        getSubscription().catch(() => ({ subscription: null })),
      ])
      setBalance(credits.balance)
      const tier = sub.subscription?.plan?.tier
      const active = sub.subscription?.status === 'ACTIVE'
      setPlan(tier && active ? TIER_TO_PLAN[tier] : 'free')
    } catch {
      /* leave the last known values in place on a transient failure */
    } finally {
      setLoading(false)
    }
  }, [user])

  // Refetch when auth resolves / the user changes.
  useEffect(() => {
    if (ready) void refresh()
  }, [ready, refresh])

  // Refetch after a charge/purchase and on window focus (cheap staleness guard).
  useEffect(() => {
    const onChange = () => void refresh()
    window.addEventListener(CREDITS_CHANGED_EVENT, onChange)
    window.addEventListener('focus', onChange)
    return () => {
      window.removeEventListener(CREDITS_CHANGED_EVENT, onChange)
      window.removeEventListener('focus', onChange)
    }
  }, [refresh])

  const value = useMemo<WalletContextValue>(() => {
    const planInfo = PLANS.find((p) => p.id === plan) ?? PLANS[0]
    return { balance, plan, planInfo, loading, refresh }
  }, [balance, plan, loading, refresh])

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext)
  if (!ctx) throw new Error('useWallet must be used within a WalletProvider')
  return ctx
}
