# Realtime Live Translate Playground Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Realtime page into a working live-translation playground. A signed-in user speaks and hears Gemini's live translation.

**Architecture:** The account API (NestJS) mints a one-use Gemini ephemeral token per session, after checking a per-user daily allowance recorded in Postgres. The browser opens the Live API WebSocket with that token, streams 16 kHz PCM from the mic, and plays the 24 kHz PCM it gets back. No audio passes through our servers.

**Tech Stack:** NestJS + Prisma (api/), React + Vite + TS (frontend/), Gemini Live API v1beta, Web Audio (AudioWorklet), Node 24 built-in test runner for frontend pure helpers, Jest for the API.

**Spec:** `docs/superpowers/specs/2026-11-14-realtime-live-translate-design.md`

## Global Constraints
- Model: `gemini-3.5-live-translate-preview`. API version `v1beta` only.
- Audio in: 16 kHz, mono, 16-bit little-endian PCM, ~100 ms chunks, mime `audio/pcm;rate=16000`. Audio out: 24 kHz mono 16-bit LE PCM.
- `GEMINI_API_KEY` exists only in server env (`api/.env` locally, the compose env on the VPS). It never appears in the frontend, in responses or in logs.
- Defaults: `REALTIME_SESSION_SECONDS=300`, `REALTIME_DAILY_SECONDS=900`, `REALTIME_MODEL=gemini-3.5-live-translate-preview`.
- Free while it is a playground: no credit ledger entries.
- The daily allowance counts **granted** seconds per UTC day.
- No new npm dependencies in either package.

## Review Focus
1. **Mic permission denied or no mic.** The user sees a plain error and the session state resets. No token is minted before the mic is granted, so a denied mic does not burn allowance. Test: in Task 6, the session is requested only after `getUserMedia` resolves.
2. **Google rejects the token or the setup** (preview model changed, key out of credit, HTTP 402). The socket closes with a reason. The page shows the reason and does not hang in "connecting". Test: `LiveTranslateSession` emits `end` with the close reason (Task 5, manual check by revoking: pass a bogus token).
3. **The user leaves the page mid-session.** The mic tracks stop, the AudioContext closes and the socket closes. Test: the unmount cleanup in Task 6 calls `session.stop()`; manual check that the browser mic indicator turns off.
4. **Two tabs or rapid Start clicks.** Each Start grants a new 300 s, so the allowance must stop the user at 900 s regardless. Test: Task 3 service test "fourth session in a day is refused".
5. **Unsupported target language** (an app code with no Google equivalent). It is refused before calling Google. Test: Task 2 `toGoogleLanguage('xx')` returns null, and Task 3 returns 400.

---

### Task 1: Real smoke test against Google (de-risk the wire format)

The docs do not pin down the token WebSocket URL or the constraint shape. Settle both against the real API before writing product code.

**Files:**
- Create: `api/scripts/gemini-live-smoke.mjs`

**Interfaces:**
- Produces, recorded as a note at the bottom of this plan:
  - `WS_URL_TEMPLATE`, the working token WebSocket URL
  - `CONSTRAINTS_SHAPE`, the `liveConnectConstraints` body Google accepted
  - which setup fields the client must send

- [ ] **Step 1: Write the script.** It reads `GEMINI_API_KEY` from `api/.env`, then:
  - POSTs `https://generativelanguage.googleapis.com/v1beta/auth_tokens` with:
    - `uses: 1`
    - `expireTime` of now + 330 s
    - `newSessionExpireTime` of now + 60 s
    - `liveConnectConstraints: { model: "models/gemini-3.5-live-translate-preview", config: { responseModalities: ["AUDIO"], inputAudioTranscription: {}, outputAudioTranscription: {}, translationConfig: { targetLanguageCode: "uz" } } }`
  - opens `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<name>` (Node 24 global `WebSocket`)
  - sends a `setup` with `model` only, waits for `setupComplete`
  - streams 3 s of `pcm16k.raw` in 100 ms base64 chunks
  - counts audio bytes received and prints any input and output transcription
  - never prints the key or the token
- [ ] **Step 2: Make the input audio.**
  `ffmpeg -y -i ../backend/data/assets/sample_source.mp4 -t 4 -ac 1 -ar 16000 -f s16le <scratch>/pcm16k.raw` (the male English lecture).
- [ ] **Step 3: Run it.** Run: `node api/scripts/gemini-live-smoke.mjs <scratch>/pcm16k.raw`
  Expected: `setupComplete`, audio bytes received > 0, and an Uzbek output transcription.
  - If the token POST rejects `translationConfig` inside the constraints, retry with `generationConfig: { translationConfig }`.
  - Failing that, lock `model` only and send `translationConfig` in the client setup, with `lockAdditionalFields: []`.
  - If the URL fails, try `v1alpha` and the non-`Constrained` method.
  - Record what worked below.
- [ ] **Step 4: Commit.**
  `git add api/scripts/gemini-live-smoke.mjs docs/superpowers/plans/2026-11-14-realtime-live-translate.md && git commit -m "chore(realtime): Gemini Live Translate smoke test"`

### Task 2: API pure logic (allowance + token request + language map)

**Files:**
- Create: `api/src/realtime/realtime.logic.ts`
- Test: `api/src/realtime/realtime.logic.spec.ts`

**Interfaces:**
- Produces:
  - `utcDayStart(now: Date): Date`
  - `allowance(usedSeconds: number, dailySeconds: number, sessionSeconds: number): { ok: boolean; remainingSeconds: number; grantSeconds: number }`. `grantSeconds = min(sessionSeconds, remaining)`, and `ok` is true when `grantSeconds >= 30`.
  - `toGoogleLanguage(code: string): string | null`. Maps the app's 32 codes, with `zh→zh-Hans`, `pt→pt-BR`; every other app code passes through; unknown codes return `null`.
  - `tokenRequestBody(now: Date, model: string, targetLanguage: string, grantSeconds: number): object`. The `CONSTRAINTS_SHAPE` from Task 1, with `expireTime = now + grantSeconds + 30 s` and `newSessionExpireTime = now + 60 s`, as ISO strings.

- [ ] **Step 1: Write the failing tests.**
  - `allowance(0,900,300)` gives `{ok:true, remainingSeconds:900, grantSeconds:300}`
  - `allowance(800,900,300)` gives `grantSeconds:100`
  - `allowance(880,900,300)` gives `ok:false`
  - `allowance(900,900,300)` gives `ok:false, remainingSeconds:0`
  - `utcDayStart(new Date('2026-11-14T23:30:00+05:00'))` gives `2026-11-14T00:00:00.000Z`
  - `toGoogleLanguage('uz')==='uz'`, `('zh')==='zh-Hans'`, `('pt')==='pt-BR'`, `('xx')===null`
  - `tokenRequestBody(fixedNow,'m','uz',300)` has `uses:1`, `expireTime` of fixedNow + 330 s, `newSessionExpireTime` of fixedNow + 60 s, model `models/m`, target `uz`
- [ ] **Step 2: Run them to see them fail.** Run: `cd api && npx jest src/realtime/realtime.logic.spec.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement `realtime.logic.ts`.** The language list is the same 32 codes as `backend/app/languages.py`.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(realtime): allowance, language map and token request`

### Task 3: API module (model, service, endpoints, config)

**Files:**
- Modify: `api/prisma/schema.prisma`. Add `model RealtimeSession { id String @id @default(cuid()); userId Int; targetLanguage String; grantedSeconds Int; createdAt DateTime @default(now()); user User @relation(fields:[userId], references:[id], onDelete: Cascade); @@index([userId, createdAt]) }` plus the back-relation on `User`.
- Create: `api/prisma/migrations/20261114120000_realtime_sessions/migration.sql` (generated with `npx prisma migrate dev --create-only --name realtime_sessions`, then renamed to match the timestamp style)
- Create: `api/src/realtime/realtime.service.ts`, `realtime.controller.ts`, `realtime.module.ts`, `dto/start-session.dto.ts` (`targetLanguage: string`, IsString + Length 2-10)
- Modify: `api/src/app.module.ts` (import RealtimeModule)
- Modify: `api/src/config/env.validation.ts`. Add optional `GEMINI_API_KEY`, `REALTIME_MODEL`, and `REALTIME_SESSION_SECONDS` / `REALTIME_DAILY_SECONDS` (toInt with defaults 300/900).
- Modify: `api/.env.example`, `deploy/server/docker-compose.yml`. Pass `GEMINI_API_KEY: ${GEMINI_API_KEY:-}` and the two seconds settings with defaults, with a comment.
- Test: `api/src/realtime/realtime.service.spec.ts`

**Interfaces:**
- Consumes: Task 2 functions.
- Produces:
  - `POST /v1/realtime/session` (JwtAuthGuard), body `{ targetLanguage }`, returns `{ token: string; model: string; wsUrl: string; targetLanguage: string; expiresAt: string; maxSeconds: number; remainingSecondsToday: number }`. `wsUrl` is `WS_URL_TEMPLATE` with the token filled in.
  - `GET /v1/realtime/usage` (JwtAuthGuard) returns `{ configured: boolean; usedSecondsToday: number; dailySeconds: number; sessionSeconds: number }`.
  - Errors:
    - 503 `Live translation is not configured` when there is no key
    - 400 for an unsupported language
    - 429 `Daily live translation limit reached` with `remainingSeconds`
    - 502 when Google refuses; the body is logged without the key and the user gets a generic message
- `RealtimeService.startSession(userId: number, targetLanguage: string)` and `usage(userId: number)`. Google is called with global `fetch`, injected as a constructor-overridable property `fetchImpl` so tests can stub it.

- [ ] **Step 1: Write the failing service tests** (Prisma and fetch stubbed):
  - no key gives `ServiceUnavailableException`, and fetch is not called
  - `'xx'` gives `BadRequestException`
  - 600 s already granted today: grants 300, writes a row with `grantedSeconds:300`, and returns `remainingSecondsToday:0`
  - a fourth session in a day (900 used) gives `HttpException` 429, with no row written and fetch not called
  - Google 402: `BadGatewayException`, no row kept (the row is written only after the token succeeds)
  - the success response's `wsUrl` contains `access_token=` and the token, and no response field contains the API key
- [ ] **Step 2: Run them to see them fail.** Run: `npx jest src/realtime/realtime.service.spec.ts`. Expected: FAIL.
- [ ] **Step 3: Implement the schema, migration, service, controller, module, env and compose changes.** Used seconds = sum of `grantedSeconds` where `createdAt >= utcDayStart(now)`.
- [ ] **Step 4: Run the API tests and build.** Run: `cd api && npx prisma generate && npx jest && npx tsc --noEmit -p tsconfig.build.json`. Expected: all pass, no type errors.
- [ ] **Step 5: Commit.** `feat(realtime): session endpoint with daily allowance and Gemini ephemeral tokens`

### Task 4: Frontend pure audio helpers

**Files:**
- Create: `frontend/src/lib/pcm.ts`
- Test: `frontend/src/lib/pcm.test.ts` (run with `node --test`; type-only imports only)

**Interfaces:**
- Produces:
  - `downsampleTo16k(input: Float32Array, inputRate: number): Int16Array` (averaging decimation; clamps to [-1, 1])
  - `int16ToBase64(pcm: Int16Array): string`
  - `base64ToFloat32(b64: string): Float32Array` (little-endian Int16 / 32768)

- [ ] **Step 1: Write the failing tests.**
  - 48 kHz → 16 kHz: 480 input samples become 160
  - a constant 0.5 maps to ≈16384
  - values beyond ±1 clamp to 32767 / -32768
  - a round trip `base64ToFloat32(int16ToBase64(x))` recovers x/32768 within 1e-4
  - 16000 → 16000 is an identity length
- [ ] **Step 2: Run them to see them fail.** Run: `cd frontend && node --test src/lib/pcm.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Base64 uses `btoa`/`atob` over byte strings built in 32 KB slices.
- [ ] **Step 4: Run them to see them pass.** Same command. Expected: PASS.
- [ ] **Step 5: Commit.** `feat(realtime): PCM helpers for the live session`

### Task 5: Frontend live session client

**Files:**
- Create: `frontend/src/lib/realtime-api.ts`:
  - `startRealtimeSession(targetLanguage: string): Promise<RealtimeSessionGrant>` via `authJson('/realtime/session', POST)`
  - `getRealtimeUsage(): Promise<RealtimeUsage>`
  - the types mirror Task 3
- Create: `frontend/src/lib/live-translate.ts`, with `class LiveTranslateSession`:
  - `constructor(grant: RealtimeSessionGrant, stream: MediaStream, handlers: { onState(s: 'connecting'|'live'|'ended'): void; onInput(text: string): void; onOutput(text: string): void; onLevel?(rms: number): void; onEnd(reason: string | null): void })`
  - `start(): Promise<void>`
  - `stop(reason?: string): void`

**Interfaces:**
- Consumes: Task 4 helpers, the Task 3 response shape, the Task 1 setup fields.
- Behaviour that must hold:
  - The AudioWorklet module is created from an inline Blob URL and posts Float32 frames.
  - Frames are buffered to 100 ms at 16 kHz before sending `{ realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } } }`.
  - Output chunks are scheduled on a 24 kHz AudioContext at `max(ctx.currentTime, nextStart)` for gapless playback.
  - Input and output transcription text is appended.
  - The session stops itself at `grant.maxSeconds`.
  - `stop()` is idempotent: it stops tracks, disconnects nodes, closes both AudioContexts and closes the socket.
  - `onEnd` fires exactly once, with the close reason when Google closed the socket.

- [ ] **Step 1: Implement both files.** These are browser-only APIs with no unit tests. Typecheck with `cd frontend && npx tsc -b`. Expected: no errors.
- [ ] **Step 2: Commit.** `feat(realtime): browser client for Gemini Live Translate`

### Task 6: Realtime page wiring

**Files:**
- Modify: `frontend/src/pages/Realtime.tsx`

**Interfaces:**
- Consumes: Task 5.
- Behaviour:
  - Signed in and `usage.configured`: Start calls `getUserMedia({audio:true})` first, then `startRealtimeSession(lang)`, then `new LiveTranslateSession(...).start()`.
  - The conversation list shows live lines: input as "heard", output as the translation. The sample-line loop runs only when not live.
  - It shows a `m:ss` countdown from `maxSeconds` and "N min left today" from `remainingSecondsToday`.
  - Errors from 429, 503, a denied mic and the close reason show in the existing error area.
  - Unmount calls `session.stop()`.
  - Signed out, a "Sign in to try live translation" prompt replaces Start.
  - The label reads: "Preview — powered by Google Gemini Live Translate. Translations and voices may be imperfect."
  - The existing camera, screen and "My voice" controls are untouched.

- [ ] **Step 1: Implement.** Then run `cd frontend && npx tsc -b && npx oxlint src/pages/Realtime.tsx src/lib/live-translate.ts src/lib/realtime-api.ts src/lib/pcm.ts`. Expected: no errors.
- [ ] **Step 2: Build.** Run: `npx vite build`. Expected: success.
- [ ] **Step 3: Commit.** `feat(realtime): live translation on the Realtime page`

### Task 7: End-to-end check

- [ ] **Step 1: Run the full suites.** Run: `cd api && npx jest` and `cd frontend && node --test src/lib/*.test.ts && npx vite build`. Expected: all green, apart from any failure that already exists on main, which is reported by name.
- [ ] **Step 2: Run the token path for real.**
  - Run the API locally against a dev Postgres (`docker compose` db service, or a throwaway container) with `api/.env`.
  - `POST /v1/realtime/session` with a dev user's token gives 200 and a `wsUrl`.
  - Feed that `wsUrl` to the smoke script (`--ws-url` flag) and get translated audio back.
- [ ] **Step 3: Test in the browser.** Run the frontend dev server pointed at the local API. Speak, hear the translation, see the countdown, Stop, and check the mic indicator turns off.
- [ ] **Step 4: Hand back** a list of what is needed to go live:
  - `GEMINI_API_KEY` in `/srv/th-labs/.env`
  - the API image rebuild and pull
  - a Modal redeploy of the frontend from main

---

## Task 1 findings (filled in during execution)
Verified 2026-11-14 with the real key. 4 s of English became 7.5 s of Uzbek audio, with transcripts "Welcome everyone. Today we will" → "Xush kelibsizlar. Bugun biz".

- **WS_URL_TEMPLATE:**
  `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained?access_token=<url-encoded token name>`
- **CONSTRAINTS_SHAPE:** the REST field is `bidiGenerateContentSetup`. `liveConnectConstraints` is the SDK name, and REST rejects it with 400 "Unknown name". Shape:
  `{ model: "models/<model>", generationConfig: { responseModalities: ["AUDIO"], translationConfig: { targetLanguageCode } }, inputAudioTranscription: {}, outputAudioTranscription: {} }`
- **Token response:** `{ name }` only.
- **Client setup fields:** `{ setup: { model: "models/<model>" } }` is enough. The locked config (target language, transcriptions) applies from the token.
- **Server messages seen:**
  - `setupComplete`
  - `serverContent.{inputTranscription,outputTranscription}.text`
  - `serverContent.modelTurn.parts[].inlineData.data`
  - `usageMetadata` (25 audio tokens per second, each way)
  - `sessionResumptionUpdate` (ignored for now)
