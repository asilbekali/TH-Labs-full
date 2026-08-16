// The shared QueryClient and the key namespace every hook builds on.
import { QueryClient } from '@tanstack/react-query'

// A 401 that survived http.ts's silent-refresh retry means the session is
// genuinely gone; retrying makes the user wait for three more failures before
// seeing the sign-in prompt. Same for a 404. Everything else gets two retries.
function shouldRetry(failureCount: number, error: unknown): boolean {
  const msg = error instanceof Error ? error.message : ''
  if (/unauthor|401|403|404|not found|session/i.test(msg)) return false
  return failureCount < 2
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      // Billing and job data change server-side (webhooks, the pipeline), so a
      // short window keeps navigation instant without serving stale credits.
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
})

/**
 * Query keys, namespaced by API surface. Always spread from these rather than
 * writing array literals inline — invalidation depends on the prefixes lining
 * up, and a typo silently produces a key that nothing ever invalidates.
 */
export const qk = {
  // Dubbing API (FastAPI)
  health: () => ['dub', 'health'] as const,
  languages: () => ['dub', 'languages'] as const,
  job: (id: string) => ['dub', 'job', id] as const,

  // Account API (NestJS /v1)
  me: () => ['account', 'me'] as const,

  // Billing (NestJS /v1/payments)
  payments: () => ['payments'] as const,
  plans: () => ['payments', 'plans'] as const,
  subscription: () => ['payments', 'subscription'] as const,
  credits: (page: number, limit: number) => ['payments', 'credits', page, limit] as const,
  history: (page: number, limit: number) => ['payments', 'history', page, limit] as const,
} as const
