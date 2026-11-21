# Backend contract for the Chrome extension

What the extension can rely on, read from the source on 2026-11-21. Every
claim names the file it came from. Section 7 lists what is missing or conflicts
with the brief; those need a decision before the audio pipeline is built.

Base: `https://th-labs.uz/v1` (NestJS account API, `api/`). Caddy routes
`/v1/*` there; everything else on `th-labs.uz` is the Next.js landing page
(separate repo, `ProLend`).

The FastAPI dubbing backend (`backend/`, on Modal) has **no live or WebSocket
endpoint**. Real-time translation lives in the account API instead (section 3).

---

## 1. Auth

Source: `api/src/auth/auth.controller.ts`, `auth.service.ts`,
`refresh-token.service.ts`, `dto/login.dto.ts`.

### POST /v1/auth/login

```http
POST /v1/auth/login
Content-Type: application/json

{ "email": "a@b.com", "password": "at-least-8-chars" }
```

200:

```json
{
  "accessToken": "<JWT>",
  "user": { "id": 1, "email": "a@b.com", "name": "Ali", "role": "USER", "createdAt": "..." }
}
```

- Plus `Set-Cookie: refresh_token=<opaque>; HttpOnly; Secure; SameSite=None; Path=/v1/auth`.
- 401 `{ "message": "Invalid email or password" }` covers both an unknown email and a wrong password.
- 400 if the DTO fails validation (bad email, password under 8 characters). The global pipe uses `forbidNonWhitelisted`, so extra body fields are also a 400.

### Tokens

| | Access token | Refresh token |
|---|---|---|
| Form | JWT HS256, claims `{ sub, email, role }` | opaque random string, only its hash is stored |
| Lifetime | `JWT_EXPIRES_IN`, default **15 min** | `JWT_REFRESH_EXPIRES_IN`, default **30 days** |
| Delivered | response body | **httpOnly cookie**, path `/v1/auth` |
| Sent back as | `Authorization: Bearer <jwt>` | the cookie, automatically, with `credentials: 'include'` |

### POST /v1/auth/refresh

No body. The refresh token is read **only from the cookie**, never from the body
or a header. Rotates the cookie and returns the same shape as login. 401 if the
cookie is missing, expired or revoked.

### POST /v1/auth/logout

No body. Revokes the cookie's refresh token and clears the cookie.

### GET /v1/auth/me (Bearer)

`{ id, email, name, role, createdAt }`. **No plan and no credits**; see section 2.

### Registration

`POST /v1/users/create-user` exists, but the brief sends users to the website to
register. On the website, registration is a **modal** (`ProLend/components/JoinModal.tsx`)
opened from a button. There is **no `/register` route**: `th-labs.uz/register`
hits `app/[slug]/page.tsx`, which 404s on any slug except `ru` and `uz`.

### Password reset

**Does not exist.** There is no forgot or reset endpoint in `api/` and no reset
page in `ProLend`. See question Q3.

### CORS

The allowlist in `api/src/main.ts` does not include `chrome-extension://…`.
That does not matter: requests from extension pages to a host listed in
`host_permissions` are exempt from CORS.

---

## 2. Plan, credits, usage (all Bearer)

| Endpoint | Returns | Use in the popup |
|---|---|---|
| `GET /v1/payments/entitlements` | `{ tier: "FREE"\|"PRO"\|"STUDIO", tierName: "Free"\|"Pro"\|"Studio Max", features, ... }` | plan name |
| `GET /v1/payments/credits?page=1&limit=1` | `{ balance, page, limit, total, entries }` | credit balance |
| `GET /v1/realtime/usage` | `{ configured, unlimited, usedSecondsToday, dailySeconds, sessionSeconds }` | **live minutes left today** |

Important: **live translation does not spend credits.** It is metered by a
separate daily allowance of seconds (section 3). A user with 0 credits can still
dub live, and a user with 10,000 credits is still stopped by the daily limit.

---

## 3. Real-time translation

Source: `api/src/realtime/*`, `frontend/src/lib/live-translate.ts`, `pcm.ts`,
`docs/superpowers/plans/2026-11-14-realtime-live-translate.md` (section "Task 1
findings", verified against the real API).

**The audio does not go to TH-Labs.** The account API mints a one-use Gemini
Live ephemeral token. The browser then opens **Google's** WebSocket and streams
audio to it directly. The Gemini API key stays on the server; the browser only
ever holds the short-lived token.

```
extension ──POST /v1/realtime/session──▶ th-labs.uz  (checks allowance, mints token)
extension ◀── { wsUrl, model, maxSeconds, ... } ──
extension ══ wss://generativelanguage.googleapis.com/… ══▶ Gemini Live Translate
```

### POST /v1/realtime/session (Bearer)

```json
{ "targetLanguage": "uz" }
```

`targetLanguage` is an app catalog code (section 4). The source language is not
a parameter. Success is **201 Created** (the route has no `@HttpCode`), so check
`res.ok`, not `=== 200`. Body:

```json
{
  "token": "auth_tokens/…",
  "model": "gemini-3.5-live-translate-preview",
  "wsUrl": "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=…",
  "targetLanguage": "uz",
  "expiresAt": "2026-11-21T10:05:00.000Z",
  "maxSeconds": 300,
  "remainingSecondsToday": 600,
  "unlimited": false
}
```

| Status | Meaning | Popup copy |
|---|---|---|
| 400 | language not supported, or a malformed body (`targetLanguage` must be a 2–10 character string; any extra field is rejected) | "That language isn't available for live dubbing." |
| 401 | access token bad or expired | refresh once, then log out |
| 429 | `{ message: "Daily live translation limit reached", remainingSeconds }` | "You've used today's live dubbing time. It resets at midnight UTC." |
| 502 | Google refused the token (the reservation is released) | "Live dubbing is unavailable right now. Try again shortly." |
| 503 | no `GEMINI_API_KEY` on the server | same as 502 |

### GET /v1/realtime/usage (Bearer)

Read-only. It mints nothing and reserves nothing, so it is safe to call every
time the popup opens. 200:

```json
{ "configured": true, "unlimited": false, "usedSecondsToday": 300, "dailySeconds": 900, "sessionSeconds": 300 }
```

- `configured: false` means the server has no Gemini key, so every `POST /session` would 503. Disable the toggle and say "Live dubbing is unavailable right now."
- Minutes left today = `max(0, dailySeconds - usedSecondsToday)`. If `unlimited` is true, show no limit.
- If fewer than 30 seconds are left (`MIN_GRANT_SECONDS`), the next `POST` will 429, so the toggle can be disabled up front.
- `usedSecondsToday` is the sum of **granted** seconds since 00:00 UTC.

### Checked against production (2026-11-21)

- `https://th-labs.uz/docs-json` lists both routes with bearer auth and the
  `StartSessionDto` body. **It has no response schemas** (both responses show
  an empty description), so the response shapes above come from
  `realtime.service.ts`, not from Swagger.
- With no token or a bad token, both routes answer
  `401 {"message":"Unauthorized","statusCode":401}`.
- `GET /v1/languages` returns exactly the 32 codes below, in the same order.
- `/v1/health` reports `pipeline: "down"`. That is the FastAPI dubbing
  pipeline on Modal and does **not** affect live translation, which needs only
  the account API, its database (`up`) and the Gemini key.
- No rate limiter is installed in `api/`. The per-user advisory lock and the
  daily allowance are the only limits.
- Not yet checked: whether production has `GEMINI_API_KEY` set
  (`usage.configured`). That needs a signed-in request.

### Limits (`realtime.service.ts`, `realtime.logic.ts`)

| Setting | Default | Effect |
|---|---|---|
| `REALTIME_SESSION_SECONDS` | **300** | each session is capped at 5 minutes |
| `REALTIME_DAILY_SECONDS` | **900** | 15 minutes per user per UTC day |
| `MIN_GRANT_SECONDS` | 30 | no session is granted with less than 30 s left |
| token `uses` | **1** | one token opens exactly one socket |
| token open window | 60 s | the socket must be opened within 60 s of minting |
| token expiry | grant + 30 s | Google closes the socket after that |
| `REALTIME_UNLIMITED_EMAILS` | (list) | listed accounts skip the daily cap, not the 5-minute cap |

The allowance counts **granted** seconds, not used seconds. The server never
sees how long a socket really ran, so every `POST /session` reserves up to 300 s
even if the socket dies after 2 s.

### WebSocket protocol (Gemini Live, v1beta, constrained endpoint)

1. Open `wsUrl` as given. Set `binaryType = 'arraybuffer'`: Google sends JSON as
   **binary frames**, which must be UTF-8 decoded before `JSON.parse`.
2. On open, send `{"setup":{"model":"models/<model>"}}`. The token already locks
   the target language and turns on both transcriptions.
3. Wait for `{"setupComplete":{}}`, then start sending audio.

**Audio in**, about every 100 ms:

```json
{ "realtimeInput": { "audio": { "data": "<base64>", "mimeType": "audio/pcm;rate=16000" } } }
```

16 kHz, mono, signed 16-bit **little-endian** PCM. 100 ms is 1,600 samples, or
3,200 bytes before base64.

**Server messages** (any combination per frame):

| Field | Meaning |
|---|---|
| `setupComplete` | ready for audio |
| `serverContent.modelTurn.parts[].inlineData.data` | dubbed audio, base64, **24 kHz mono s16le** |
| `serverContent.inputTranscription.text` | what the speaker said (appended pieces) |
| `serverContent.outputTranscription.text` | translation text (appended pieces) |
| `goAway` | Google is about to close the socket |
| `usageMetadata` | about 25 audio tokens per second each way (informational) |
| `sessionResumptionUpdate` | ignored by the Studio |

**Close**: code 1000 is a normal stop. Anything else carries `event.reason`.
Expect a close once `maxSeconds + 30` has passed.

**Source language**: always auto-detected. There is no parameter for it, so
the "Speaker language" dropdown from the brief is left out.

---

## 4. Languages

`GET /v1/languages` (public), backed by the `Language` table, `active: true` only:

```json
{ "languages": [ { "code": "uz", "name": "Uzbek", "native": "O'zbek", "flag": "…", ... } ] }
```

Live translation accepts these 32 codes (`realtime.logic.ts` `CATALOG`), and
the server maps two of them to Google's spelling itself:

`en uz ru es fr de it pt nl pl tr ar fa hi bn ur zh ja ko vi id th uk kk az sv cs el he ro hu fi`

(`zh` becomes `zh-Hans` and `pt` becomes `pt-BR`, server-side.) The extension
shows the intersection of `/v1/languages` and this list, and falls back to the
list with English names if the request fails.

---

## 5. Website paths

| Need | Path | Note |
|---|---|---|
| Create an account | `https://th-labs.uz/` | no `/register` page (see section 1) |
| Pricing / top up | `https://th-labs.uz/#pricing` | `ProLend/components/landing/pricing.tsx` |
| Forgot password | none | see Q3 |

---

## 6. Decisions (2026-11-21)

- **Q1:** go direct to Google with the per-session token. `PRIVACY.md` and the store listing disclose that audio goes to Google's Gemini API while dubbing is on.
- **Q2:** before the 5-minute cap, and after a dropped socket, mint a new session automatically. Keep going until the daily allowance runs out, then treat 429 as "out of time today".
- **Q3:** no "Forgot password?" link until a reset flow exists.
- **Q4:** "Create an account" opens `https://th-labs.uz/`.
- **Q5:** the popup shows live minutes left today prominently, with plan and credits smaller.

## 7. Gaps and conflicts with the brief (as raised)

**Q1. Audio goes to Google, not only to TH-Labs.** The brief says the extension
"talks only to the TH-Labs backend". With the current backend that is not true:
the extension must open a WebSocket to `generativelanguage.googleapis.com`.
No Google API key is in the extension, only the per-session token, so the
security rule about keys still holds. But `PRIVACY.md` and the store listing
must say that audio is sent to Google's Gemini API. Options:
(a) accept this and disclose it, or (b) add a TH-Labs WebSocket relay to
`api/` first. Option (b) changes code outside `extension/`.

**Q2. Calls longer than 5 minutes.** Sessions are capped at 300 s, the token
is single-use, and each new session reserves up to 300 s of a 900 s daily
allowance. So a normal user gets **at most 15 minutes of live dubbing per day,
in 5-minute pieces**, and a 30-minute Meet call is impossible. "Reconnect with
backoff, max 5 tries" would mean minting a new session on each try, and five
reconnects use up the whole day. Proposal: on a scheduled 5-minute rollover or
a dropped socket, mint a new session automatically until the allowance runs
out, show the minutes left in the popup, and treat 429 as "out of time today".
Raising the limits is a server config change (`REALTIME_*_SECONDS`).

**Q3. "Forgot password?" has nowhere to go.** No reset flow exists. Options:
leave the link out, point it at a support email, or build a reset flow first.

**Q4. "Create an account" cannot deep-link to a register page.** It would open
`https://th-labs.uz/`, where the user clicks the sign-up button. A `?join=1`
query that opens `JoinModal` would need a small change in `ProLend`.

**Q5. "Remaining credits" is the wrong number for this feature.** Proposal:
show the plan, the credit balance (small), and **live minutes left today**
(prominent, in the serif numerals), because that is what actually limits
dubbing.

**Q6. Refresh token handling.** The refresh token is an httpOnly cookie, so the
extension cannot read it or keep it in `chrome.storage`. Plan: keep the access
token (15 min) and the user in `chrome.storage.local`, and refresh through the
cookie with `credentials: 'include'` from the service worker. Two side effects
to know about:
- The cookie lives in the same browser cookie jar as the website's session, so
  logging out in the extension also signs the user out of `th-labs.uz` in that
  browser, and the reverse.
- Whether Chrome attaches a `SameSite=None` cookie to a service-worker fetch
  from an extension origin has to be checked in testing. If it does not, the
  fallback is to re-prompt for login every 15 minutes, which is poor. A
  body-based refresh for the extension would need an `api/` change.
