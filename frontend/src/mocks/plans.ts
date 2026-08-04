// Subscription tiers, one-off credit packs, and the feature-comparison matrix
// for the Plans page (04). Purely presentational catalog data — the live balance
// and current plan come from the wallet (`lib/wallet`), never from here.
//
// Tier ids and creditsPerMonth intentionally mirror the wallet's PLANS so
// `choosePlan(id)` grants the right monthly allowance; the wallet stays the
// single source of truth for balance/plan, this file only describes pricing.

import type { PlanId } from '../lib/wallet'

export interface Tier {
  id: PlanId
  name: string
  prices: { weekly: number; monthly: number; yearly: number }
  creditsPerMonth: number
  features: string[]
  highlight?: boolean
}

export const TIERS: Tier[] = [
  {
    id: 'free',
    name: 'Free',
    prices: { weekly: 0, monthly: 0, yearly: 0 },
    creditsPerMonth: 60,
    features: ['Fast & Balanced quality', 'Voice cloning', 'Standard queue'],
  },
  {
    id: 'pro',
    name: 'Pro',
    prices: { weekly: 6, monthly: 19, yearly: 182 },
    creditsPerMonth: 600,
    features: ['All qualities incl. Studio', 'Voice cloning + lip sync', 'Priority queue', 'Background separation'],
    highlight: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    prices: { weekly: 15, monthly: 49, yearly: 470 },
    creditsPerMonth: 2000,
    features: ['Everything in Pro', 'Batch dubbing', 'Highest fidelity output', 'Email support'],
  },
]

export interface Pack {
  id: string
  credits: number
  price: number
  bestValue?: boolean
}

export const PACKS: Pack[] = [
  { id: 'pack-100', credits: 100, price: 5 },
  { id: 'pack-500', credits: 500, price: 20 },
  { id: 'pack-1200', credits: 1200, price: 40, bestValue: true },
  { id: 'pack-5000', credits: 5000, price: 150 },
]

// Feature matrix for the "Compare all features" disclosure. A boolean renders a
// check / dash; a string renders verbatim (e.g. the credit allowance).
export interface CompareRow {
  feature: string
  free: boolean | string
  pro: boolean | string
  studio: boolean | string
}

export const COMPARISON: CompareRow[] = [
  { feature: 'Monthly credits', free: '60', pro: '600', studio: '2,000' },
  { feature: 'Fast & Balanced quality', free: true, pro: true, studio: true },
  { feature: 'Studio quality', free: false, pro: true, studio: true },
  { feature: 'Voice cloning', free: true, pro: true, studio: true },
  { feature: 'Lip sync', free: false, pro: true, studio: true },
  { feature: 'Background separation', free: false, pro: true, studio: true },
  { feature: 'Priority queue', free: false, pro: true, studio: true },
  { feature: 'Batch dubbing', free: false, pro: false, studio: true },
  { feature: 'Highest fidelity output', free: false, pro: false, studio: true },
  { feature: 'Email support', free: false, pro: false, studio: true },
]
