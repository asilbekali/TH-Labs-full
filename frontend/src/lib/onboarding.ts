// First-run guidance state.
//
// The rule this file exists to enforce: the walkthrough opens by itself for a
// person who has *just created an account*, and never again. Signing in on a
// Tuesday morning must not replay it — that is the fastest way to make a good
// tour feel like an ad.
//
// Two independent facts decide "just created", because an account can be born
// in two places:
//
//   1. `markJustRegistered()` — registration happened in this browser. Set by
//      auth.register(), so any in-app signup is caught exactly, with no
//      guessing from timestamps.
//   2. `isFreshAccount(createdAt)` — the landing site registered the user and
//      handed the session over, so flag (1) was never written here. A server
//      `createdAt` inside the last week stands in for it.
//
// And one fact cancels both: `markTourSeen()`, written the moment the user
// finishes *or* skips. Skipping is a decision, and it sticks.
//
// Storage is localStorage, keyed per account id, so two people sharing a
// browser each get their own first run.

const STORAGE_KEY = 'th-labs.onboarding.v1'

/** Tour ids. Bump the version suffix only to deliberately re-show a rewritten tour. */
export const STUDIO_TOUR = 'studio.v1'

/** How long after signup a handed-over session still counts as "new". */
const FRESH_ACCOUNT_DAYS = 7

interface Store {
  /** account key → tour ids already finished or skipped */
  seen: Record<string, string[]>
  /** account key → epoch ms of a registration that happened in this browser */
  registered: Record<string, number>
}

const EMPTY: Store = { seen: {}, registered: {} }

function read(): Store {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<Store>
    return {
      seen: parsed.seen && typeof parsed.seen === 'object' ? parsed.seen : {},
      registered:
        parsed.registered && typeof parsed.registered === 'object' ? parsed.registered : {},
    }
  } catch {
    return EMPTY // unavailable or corrupt storage — behave like a clean slate
  }
}

function write(s: Store): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {
    /* private mode / quota — the tour simply won't be remembered */
  }
}

/** Stable per-account storage key. Signed-out visitors share one bucket. */
export function accountKey(id: number | null | undefined): string {
  return id ? `u${id}` : 'anon'
}

export function hasSeenTour(tour: string, key: string): boolean {
  return read().seen[key]?.includes(tour) === true
}

export function markTourSeen(tour: string, key: string): void {
  const s = read()
  const list = s.seen[key] ?? []
  if (list.includes(tour)) return
  s.seen[key] = [...list, tour]
  write(s)
}

/** Called by auth.register — the precise "this account was born here" signal. */
export function markJustRegistered(key: string): void {
  const s = read()
  s.registered[key] = Date.now()
  write(s)
}

function wasJustRegistered(key: string): boolean {
  const at = read().registered[key]
  if (!at) return false
  return Date.now() - at < FRESH_ACCOUNT_DAYS * 86_400_000
}

/** A server `createdAt` inside the freshness window. Missing/unparseable → false. */
export function isFreshAccount(createdAt: string | null | undefined): boolean {
  if (!createdAt) return false
  const t = Date.parse(createdAt)
  if (Number.isNaN(t)) return false
  return Date.now() - t < FRESH_ACCOUNT_DAYS * 86_400_000
}

/**
 * Should the tour open on its own right now?
 *
 * New account, and it has not been seen or skipped. Everyone else reaches it
 * only through the Guide button.
 */
export function shouldAutoStartTour(
  tour: string,
  key: string,
  createdAt: string | null | undefined,
): boolean {
  if (key === 'anon') return false
  if (hasSeenTour(tour, key)) return false
  return wasJustRegistered(key) || isFreshAccount(createdAt)
}
