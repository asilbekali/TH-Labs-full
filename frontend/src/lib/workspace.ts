// What the sidebar's workspace card says, and what colour its disc is.
//
// The card used to read "TH-Labs Studio" for everybody, which made it a logo
// with extra steps. It now states the one fact about the account that changes
// what the app will let you do: staff role if there is one, otherwise the
// billing tier.
//
// Role wins over plan deliberately. An ADMIN on the Free tier is an admin — the
// thing worth showing is the elevated access, not the subscription, and showing
// "TH-Labs Free" to someone who can read the whole feedback inbox would be the
// less useful of the two facts.
import { useAuth } from './auth'
import { useWallet, type PlanId } from './wallet'
import type { Role } from './auth-api'

export interface Workspace {
  label: string
  /** A CSS `background` value for the disc on the card. */
  gradient: string
  /** True for ADMIN/SUPERADMIN, so callers can treat staff differently. */
  staff: boolean
}

// Each identity gets its own disc. In light mode the old card put a near-black
// circle on white, which read as a hole punched in the sidebar; these are the
// one spot of real colour in the chrome, and they double as the fastest way to
// tell at a glance which account a window is signed into.
const PLAN_LOOK: Record<PlanId, { label: string; gradient: string }> = {
  free: {
    label: 'TH-Labs Free',
    gradient: 'linear-gradient(135deg, #38bdf8 0%, #6366f1 100%)',
  },
  pro: {
    label: 'TH-Labs Pro',
    gradient: 'linear-gradient(135deg, #a855f7 0%, #ec4899 100%)',
  },
  studio: {
    label: 'TH-Labs Studio',
    gradient: 'linear-gradient(135deg, #fbbf24 0%, #f43f5e 100%)',
  },
}

const ROLE_LOOK: Partial<Record<Role, { label: string; gradient: string }>> = {
  ADMIN: {
    label: 'Admin',
    gradient: 'linear-gradient(135deg, #34d399 0%, #0d9488 100%)',
  },
  SUPERADMIN: {
    label: 'Superadmin',
    gradient: 'linear-gradient(135deg, #f59e0b 0%, #b91c1c 100%)',
  },
}

/**
 * The current account's workspace identity.
 *
 * Falls back to the Free look while the subscription query is still in flight,
 * which is the right guess: `useWallet` already reports `free` until a paid
 * subscription comes back ACTIVE, so this never briefly claims a tier the
 * account does not have.
 */
export function useWorkspace(): Workspace {
  const { user } = useAuth()
  const { plan } = useWallet()

  const role = user?.role
  const staffLook = role ? ROLE_LOOK[role] : undefined
  const look = staffLook ?? PLAN_LOOK[plan] ?? PLAN_LOOK.free

  return { label: look.label, gradient: look.gradient, staff: !!staffLook }
}
