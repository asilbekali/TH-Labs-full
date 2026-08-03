// Server-side credit cost per dub quality. This MUST mirror the frontend
// `QUALITY_COST` (frontend/src/lib/wallet.tsx) — the client value is a display
// hint only; this table is the authority used by can-dub / spendCredits.
export const QUALITY_COST: Record<string, number> = {
  fast: 5,
  balanced: 10,
  studio: 20,
};

export const DEFAULT_DUB_COST = 10;

export function costForQuality(quality: string | undefined): number {
  if (!quality) return DEFAULT_DUB_COST;
  return QUALITY_COST[quality] ?? DEFAULT_DUB_COST;
}

// The single free dub every new user gets is capped at this source length.
export const FREE_DUB_MAX_SECONDS = 120;
