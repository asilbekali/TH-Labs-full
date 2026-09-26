// Client for the two "tell us something" endpoints on the account API (/v1).
//
// Both are PUBLIC — no token required — but `POST /v1/feedback` is guarded by
// the API's OptionalJwtAuthGuard, which attributes the message to the account
// when a bearer token happens to be present. That is why feedback goes through
// authFetch (which attaches the token if there is one) rather than a plain
// fetch: signed out it behaves identically, signed in the admin panel gets to
// see which account wrote it.
//
// They land in different places by design:
//   /v1/community → a contact list (name + email), triggers the welcome email.
//   /v1/feedback  → an inbox of messages staff read, triage and answer.
import { apiUrl, authFetch, readError } from './http'

export type FeedbackKind = 'GENERAL' | 'BUG' | 'FEATURE' | 'PRICING' | 'QUALITY'

export interface FeedbackInput {
  /**
   * Both optional, and normally omitted. The API takes the sender's name and
   * email off the account behind the bearer token — see FeedbackService.create
   * — so the app posts a message and nothing else, and the panel still shows
   * who wrote it. Only an anonymous caller has to supply them.
   */
  name?: string
  email?: string
  subject?: string
  message: string
  kind?: FeedbackKind
  /** 1-5, or omitted. Never required — see the API's CreateFeedbackDto. */
  rating?: number
  /** Which page it was sent from. Diagnostics for a bug report. */
  pagePath?: string
}

export interface FeedbackReceipt {
  id: number
  createdAt: string
  message: string
}

/** POST /v1/feedback — leave a message. */
export async function sendFeedback(input: FeedbackInput): Promise<FeedbackReceipt> {
  const res = await authFetch('/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  // NestJS validation errors arrive as `{message: string[]}`; readError joins
  // them, so "email must be an email" reaches the form instead of "failed".
  if (!res.ok) throw new Error(await readError(res, 'Could not send your feedback'))
  return res.json() as Promise<FeedbackReceipt>
}

export interface CommunityInput {
  /** The API's DTO calls this `userName`, not `name`. */
  userName: string
  email: string
}

/**
 * POST /v1/community — join the community list.
 *
 * This is the endpoint the landing page's signup form posts to. It used to be
 * `/v1/wait-list`; the table and the route were renamed together (see the
 * `Community` model). There has never been a `/api/waitlist` — `/api` is the
 * FastAPI dubbing pipeline, which serves jobs and media and nothing else, so a
 * call there 404s no matter what the path says.
 *
 * Plain fetch, not authFetch: joining is anonymous and there is nothing for a
 * token to add.
 */
export async function joinCommunity(input: CommunityInput): Promise<{ id: number }> {
  const res = await fetch(apiUrl('/community'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    // 409 is the one worth rewording: "Email is already in the community" is
    // accurate but reads like a rejection, and being on the list already is the
    // outcome the person wanted.
    if (res.status === 409) throw new Error("You're already on the list — nothing more to do.")
    throw new Error(await readError(res, 'Could not add you to the list'))
  }
  return res.json() as Promise<{ id: number }>
}
