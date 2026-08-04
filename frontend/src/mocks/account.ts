// Account-level facts for the Plans balance card (04). The live plan + balance
// are owned by the wallet (`lib/wallet`); this mock only supplies the things the
// wallet doesn't track — namely when credits were last topped up. `currentTier`
// is kept here as the account's default/seed, but the page reads the wallet's
// live `plan` so the "Current plan" highlight follows real selections.
import type { PlanId } from '../lib/wallet'

export const ACCOUNT: { currentTier: PlanId; lastTopUpAt: string } = {
  currentTier: 'pro',
  lastTopUpAt: new Date(Date.now() - 4 * 86_400_000).toISOString(),
}
