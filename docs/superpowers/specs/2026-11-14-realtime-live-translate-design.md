# Realtime page: live translation playground (Gemini Live Translate)

Status: approved 2026-11-14.

## Intent
The Realtime page (`frontend/src/pages/Realtime.tsx`) is a preview: the mic,
camera and screen previews are real, but the conversation lines are canned
samples. The goal is to make it a working playground, in the style of Google's
AI Studio Live Translate demo: you speak and hear the translation. The team
tries it on the website and decides product changes afterwards.

## Goals
- A signed-in user picks a target language, presses Start, speaks, and hears
  the translation live. The source language is detected automatically.
- Show the original speech and the translation as running text when the model
  returns transcriptions.
- Keep Google spend bounded while it is free to use.

## Non-goals (for this round)
- Charging credits. It is free while it is a playground.
- Two-way conversation (two simultaneous streams), call or system-audio
  capture, and wiring camera or screen into the translation.
- "My voice" cloning. The toggle stays as it is. Google warns that voice
  replication is inconsistent.

## Anti-goals
- The Gemini API key must never reach the browser, the frontend bundle or git.
- Audio must not be relayed through Modal or the VPS: that adds latency, and a
  Modal GPU container would be billed to sit idle.

## Constraints
- Model `gemini-3.5-live-translate-preview` (public preview). Audio in is
  16 kHz mono 16-bit PCM in ~100 ms chunks; audio out is 24 kHz mono 16-bit
  PCM. One target language per session. Audio only.
- Price is about $0.037 per minute. The Tier 1 monthly cap ($250) is a hard
  ceiling on the Google side.
- Ephemeral tokens work only on the `v1beta` API. They are created with
  `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens`
  (header `x-goog-api-key`), using `uses`, `expireTime`,
  `newSessionExpireTime` and `liveConnectConstraints`. The token is in
  `name`. The client passes it as `access_token` on the WebSocket.

## Approaches
1. **Ephemeral token from the account API; the browser talks to Google
   directly.** Chosen: lowest latency, no relay server, and the key stays
   server-side. The minting endpoint is where limits are enforced.
2. **Relay audio through the Studio backend on Modal.** Rejected: an extra
   network hop, the cost of a GPU container, and long-lived WebSockets on a
   container that scales to zero.
3. **API key in the frontend.** Rejected: anyone could take the key and spend
   the Google balance.

## Design
**Account API (`api/`, NestJS), new `realtime` module**
- `POST /v1/realtime/session` (JwtAuthGuard).
  - Checks the user's usage for today (UTC). If granting another session
    would exceed the daily allowance, it returns 429 with the remaining
    seconds.
  - Otherwise it records a `RealtimeSession` row (userId, targetLanguage,
    grantedSeconds, createdAt).
  - It mints an ephemeral token with:
    - `uses: 1`
    - `newSessionExpireTime` of now + 60 s
    - `expireTime` of now + session cap (300 s) + 30 s slack
    - constraints locking `model` to the translate model and `targetLanguageCode`
  - It returns `{ token, model, wsUrl, targetLanguage, expiresAt, maxSeconds,
    remainingSecondsToday }`.
- `GET /v1/realtime/usage`: the seconds used today and the daily allowance.
- Usage is counted as **granted** seconds (300 per session), not measured
  ones. The browser talks to Google directly, so the server cannot see actual
  use. Granted seconds are the conservative bound.
- Config:
  - `GEMINI_API_KEY` (optional; without it the endpoint returns 503
    "not configured")
  - `REALTIME_SESSION_SECONDS` (default 300)
  - `REALTIME_DAILY_SECONDS` (default 900)
  - `REALTIME_MODEL` (default `gemini-3.5-live-translate-preview`)
- Prisma migration adds `RealtimeSession`. `docker-entrypoint.sh` already runs
  `prisma migrate deploy`.
- `deploy/server/docker-compose.yml` passes `GEMINI_API_KEY` through (optional,
  default empty), and `api/.env.example` documents it.

**Frontend (`frontend/`)**
- `lib/realtime-api.ts` calls the endpoint through the existing `authFetch`.
- `lib/live-translate.ts` is a small client:
  - opens the WebSocket
  - sends the `setup` message with `translationConfig.targetLanguageCode` and
    input/output transcription on
  - captures the mic with an AudioWorklet, downsamples to 16 kHz Int16, and
    sends ~100 ms base64 chunks as `realtimeInput.audio`
  - schedules incoming 24 kHz PCM on an AudioContext for gapless playback
  - surfaces transcription events
  - stops at `maxSeconds`, on Stop, or on socket close
- On `Realtime.tsx`, the sample-line loop is replaced by the live session when
  the user is signed in and the API reports it configured. It shows a
  countdown and the minutes left today, labels the page as a preview of
  Google's model, and keeps the existing language selector (BCP-47 codes from
  the shared catalog). Signed out, it shows a "Sign in to try it" prompt.

## Left to the builder
- Exact UI layout within the existing page style.
- Mapping of app language codes to Google's BCP-47 codes where they differ
  (for example `zh` to `zh-Hans`, `pt` to `pt-BR`, `no` to `nb`).
- Error copy.
- Whether to reconnect if Google sends `goAway` before the cap. Default: end
  the session cleanly and let the user start another.

## Verification
- API unit tests:
  - daily-allowance arithmetic
  - token request body
  - the 429 and 503 paths
- One real smoke test with the key: mint a token, open the WebSocket with it,
  send 2 s of speech audio, and receive translated audio. This confirms the
  WebSocket URL and constraint format, which the docs leave unspecified.
- A manual browser test on the dev build.
