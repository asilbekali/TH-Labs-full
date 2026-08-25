# TH-Labs — how the whole thing works

Two products, two repos, two hosts, one account system.

* **The landing page** (`ProLend` repo, Next.js) — the doorway. Marketing, waitlist,
  sign-up, sign-in. Runs in Docker on the VPS behind Caddy at `th-labs.uz` /
  `aytingchi.uz`.
* **The account API** (`api/`, NestJS + PostgreSQL) — the only thing that owns
  users, sessions, credits and money. Same VPS, same Caddy, published at `/v1`.
* **The Studio** (`frontend/` + `backend/`, React + FastAPI) — the actual product.
  Runs on **Modal**, on an L4 GPU, at
  `https://isoqovjorabek2--th-labs-dubbing-web.modal.run`.

The Studio has **no user database and no login of its own**. It verifies tokens the
account API mints. That single fact is what shapes most of the design below.

---

## 1. The map

```mermaid
flowchart TB
    subgraph browser["Browser"]
        L["Landing page<br/>th-labs.uz"]
        S["Studio SPA<br/>*.modal.run"]
    end

    subgraph vps["VPS — Docker"]
        CADDY["solpro-caddy-1<br/>TLS, from /opt/solpro"]
        subgraph thlabs["compose project: th-labs"]
            WEB["thlabs-web:3000<br/>Next.js landing"]
            API["thlabs-api:3000<br/>NestJS account API"]
            DB[("postgres 16<br/>internal network only")]
        end
    end

    subgraph modal["Modal — th-labs-dubbing"]
        FAST["FastAPI + React dist<br/>L4 GPU · max_containers=1"]
        VOL[("Volume: media<br/>/data")]
    end

    STRIPE["Stripe"]

    L -->|"HTTPS"| CADDY
    S -->|"HTTPS /api, /media<br/>(same origin)"| FAST
    S -->|"HTTPS /v1/* — cross-origin, CORS"| CADDY

    CADDY -->|"/v1/*, /docs*"| API
    CADDY -->|"/*"| WEB
    WEB -->|"http://api:3000/v1<br/>server-side, never leaves Docker"| API
    API --> DB
    FAST --- VOL

    STRIPE -->|"webhook POST /v1/payments/webhook"| CADDY
    API -->|"Payment Links"| STRIPE
```

**Routing rules** (`deploy/server/aytingchi.caddy`, longest match wins):

| Path | Goes to |
|---|---|
| `/v1/*` | `thlabs-api:3000` — the account API |
| `/docs*` | the same API's Swagger UI |
| `/*` | `thlabs-web:3000` — the landing page |

Nothing in the `th-labs` compose project publishes a host port. The stack joins
solpro's external network `solpro_default` under `thlabs-` aliases, and the only
way in is through Caddy. The database is on a private `internal` network and is
unreachable even from solpro's own containers.

`/v1` being public is **load-bearing, not incidental**: the Studio is a different
origin with no session of its own, so it calls this API **from the browser** to
redeem its handoff code and to refresh afterwards. Remove that handle and a user
who signs in on the landing page arrives at a Studio that cannot log them in.

---

## 2. Sign-in: how a session crosses origins

The landing page and the Studio are different origins, so a cookie set on
`th-labs.uz` cannot be read on `*.modal.run`. The session has to travel in the
redirect. What travels is a **one-time code**, never a token.

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant L as Landing (browser)
    participant R as Next.js route handler<br/>(server-side)
    participant A as Account API
    participant S as Studio (browser)

    U->>L: email + password
    L->>R: POST /api/auth/login
    R->>A: POST /v1/auth/login (over Docker net)
    A-->>R: accessToken + Set-Cookie refresh
    R->>A: POST /v1/auth/handoff (Bearer accessToken)
    A-->>R: { code, expiresIn: 60 }
    Note over R: the access token stops here
    R-->>L: { user, code, expiresIn } + forwarded Set-Cookie
    L->>S: location.replace(studio + "?code=…")
    S->>A: POST /v1/auth/handoff/exchange<br/>credentials: "include"
    A-->>S: accessToken + Set-Cookie refresh
    Note over S: code stripped from the URL,<br/>token kept in memory only
```

Why it is shaped this way:

* **The code is the only thing the browser ever sees.** 32 CSPRNG bytes,
  base64url, 60-second TTL, exactly one redemption. Only its SHA-256 is stored.
  The copy that lands in browser history and in Modal's ingress log is already
  dead by the time anyone could read it.
* **Single-use is enforced by the database, not by an `if`.** Redemption is one
  `updateMany` with `usedAt: null` and `expiresAt > now` inside the `WHERE`, so
  two simultaneous requests cannot both pass.
* **Every failure returns the same message.** Unknown, expired and already-spent
  are indistinguishable, so the endpoint cannot be used to probe which codes existed.
* **This replaced tokens-in-the-query-string.** The old version put a 7-day
  self-renewing refresh token in the address bar. That is gone, and with it the
  `localStorage` copy — no token is exposed to client-side JS on the landing origin.

Access tokens are HS256, 15 minutes, held **in memory only**. The refresh token is
an opaque httpOnly cookie scoped to `/v1/auth`, `SameSite=None; Secure` in production.

### Silent resume, when the third-party cookie is blocked

From `*.modal.run`, the account API's cookie is third-party — Safari blocks those
outright, Chrome is winding them down. So the Studio can be unable to refresh even
though the user is perfectly signed in.

```mermaid
sequenceDiagram
    participant S as Studio
    participant L as Landing (?studio=1)
    participant A as Account API

    S->>L: redirect, one-shot flag set
    L->>A: POST /v1/auth/refresh (same-origin — cookie rides along)
    A-->>L: accessToken
    L->>A: POST /v1/auth/handoff
    A-->>L: { code }
    L->>S: redirect back with ?code=…
```

The landing origin *is* first-party to that cookie, so it can still see the
session. If the refresh fails the user really is signed out: `?studio=1` is
stripped and the normal page renders, and the Studio's one-shot flag stops a
ping-pong loop.

---

## 3. A dub, end to end

```mermaid
sequenceDiagram
    autonumber
    participant U as User
    participant S as Studio SPA
    participant A as Account API (/v1)
    participant F as FastAPI (/api, Modal L4)

    U->>S: pick file, language, quality
    S->>S: probe duration locally
    S->>A: POST /v1/payments/can-dub
    A-->>S: { allowed, cost, balance, reason? }
    Note over A: read-only — charges nothing
    S->>F: POST /api/jobs (multipart, Bearer)
    F-->>S: { id, job }
    S->>A: POST /v1/payments/commit-dub (idempotent on jobId)
    S->>F: GET /api/jobs/{id}/events?access_token=…
    loop each stage
        F-->>S: SSE job snapshot
    end
    Note over S: SSE fails → falls back to polling GET /api/jobs/{id}
    S->>F: GET /media/outputs/{id}.mp4
```

Two details worth knowing:

* **The gate and the charge are separate calls.** `can-dub` is a read-only
  preflight; `commit-dub` runs only once the job exists, is idempotent on
  `jobId`, and is fire-and-forget so it never blocks the pipeline UI.
* **The SSE stream takes the token in the query string.** `EventSource` cannot
  send an `Authorization` header — the browser API takes a URL and nothing else.
  This is the one place a token legitimately appears in a URL: it is the
  short-lived access token, never the refresh token, and the request is
  same-origin. Everything else uses the header.

Every route under `/api/jobs` requires a bearer token (`backend/app/auth.py`)
and is scoped to its owner. Someone else's job returns **404, not 403** — job ids
are random, so "this exists but is not yours" is information the caller has no
way to obtain and no reason to receive.

---

## 4. The pipeline

`backend/app/pipeline/orchestrator.py`. Each stage runs its real engine when
available and a simulation fallback otherwise, so the orchestrator behaves
identically either way — only the `simulated` flag differs.

```mermaid
flowchart LR
    IN["upload<br/>or sample"] --> ASR
    ASR["1 ASR<br/>Whisper + silero-VAD"] --> NMT
    NMT["2 NMT<br/>NLLB-200-distilled-600M"] --> TTS
    TTS["3 TTS + voice clone"] --> SEP
    SEP["4 Separation<br/>Demucs htdemucs"] --> LIP
    LIP["5 Lip-sync<br/>Wav2Lip · optional"] --> SYNC
    SYNC["6 Sync + mux<br/>ffmpeg"] --> OUT["/media/outputs/{id}.mp4"]
```

| Stage | What it does | Notes |
|---|---|---|
| **ASR** | Whisper, VAD-gated | model by quality: `fast`→base, `balanced`→small, `studio`→medium |
| **NMT** | NLLB-200 distilled 600M | length-compatibility scoring; falls back to simulation on error |
| **TTS** | OmniVoice → edge-tts → tone | first engine that produces audio wins |
| **Separation** | Demucs, keeps music/FX, drops source speech | **skipped in `fast`** |
| **Lip-sync** | Wav2Lip | opt-in per job |
| **Sync** | mix dubbed voice over background, mux | `voice_gain` / `background_gain` |

The TTS chain is the subtle one:

1. **OmniVoice** clones the source speaker directly. Needs `transformers>=5.3` —
   which is the entire reason the Studio runs in the cloud rather than on the dev box.
2. Otherwise **edge-tts** gives a real neural voice per language, and then
   **OpenVoice** clones the source speaker's timbre onto it. Skipped in `fast`
   mode, where CPU cloning is too slow.
3. Otherwise a placeholder tone.

**Real ASR never fabricates a transcript.** If VAD-gated Whisper finds no speech,
the job says so — it does not silently fall back to the canned demo scenario.

Every stage emits a progress snapshot over SSE, with a heartbeat that nudges the
bar every ~4s so a 15-minute transcription stays visibly alive and the stream
doesn't idle out.

---

## 5. Money

Credits are the unit. `User.credits` is a **cached balance**; the `CreditEntry`
ledger is the truth, and `/v1/payments/credits/reconcile` reports drift.

| Quality | Cost | | |
|---|---|---|---|
| fast | 5 | Free dub | one per user, source ≤ **120 s** |
| balanced | 10 | Signup grant | 60 credits |
| studio | 20 | Authority | `api/src/payment/quality-cost.ts` |

The frontend's `QUALITY_COST` is a **display hint only** — the server table is
what `can-dub` and `commit-dub` enforce.

```mermaid
flowchart LR
    P["GET /v1/payments/checkout"] --> SL["Stripe Payment Link"]
    SL --> PAY["user pays"]
    PAY --> WH["POST /v1/payments/webhook"]
    WH --> V{"signature<br/>verified?"}
    V -->|no| R400["400, never processed"]
    V -->|yes| ID{"stripeEventId<br/>already seen?"}
    ID -->|yes| DUP["ignored as duplicate"]
    ID -->|no| D["dispatch → grant credits,<br/>update subscription"]
    CRON["hourly cron"] --> G["grant due subscriptions<br/>every plan.grantDays"]
```

**Stripe lives entirely on the account API.** Neither `backend/` nor
`deploy/modal/` contains a single Stripe reference — the Studio only calls
`/v1/payments/*` and follows the URL it is handed. Configuring Stripe on Modal
does nothing.

* **Missing Stripe config fails quiet.** The API boots without it and still
  serves `/payments/plans`, so the Plans page looks healthy. But
  `STRIPE_WEBHOOK_SECRET` absent means `constructEvent` throws before any
  dispatch — and webhooks are the only thing that grants credits, so a user pays
  and receives nothing. `STRIPE_LINK_*` absent means `seed.ts` writes
  `stripeLinkUrl: null` and `/payments/checkout` 400s before the user even
  reaches Stripe. Both must be passed through `deploy/server/docker-compose.yml`
  to reach the container; see `deploy/server/README.md` § 6.
* **`client_reference_id` is how a payment finds its user.** `getCheckoutUrl`
  appends it to the Payment Link; the webhook reads it back. An event without it
  is logged and ignored.
* **Idempotency is a unique constraint**, not an `if` — `WebhookEvent.stripeEventId`.
  That is what makes Stripe's retries safe. If dispatch throws, the marker is
  deleted so the retry reprocesses it.
* **The hourly cron is what makes yearly plans drip.** Stripe bills once; credits
  are handed out every `plan.grantDays`. Without it a user could buy a year, burn
  24 000 credits in a week, and cancel.
* Handled events: `checkout.session.completed`, `invoice.paid`,
  `invoice.payment_succeeded`, `invoice.payment_failed`,
  `customer.subscription.updated`, `customer.subscription.deleted`.

**Data model** (`api/prisma/schema.prisma`): `User`, `Admin`, `Waitlist`, `Plan`,
`Subscription`, `Payment`, `CreditEntry`, `RefreshToken`, `HandoffCode`,
`WebhookEvent`.

---

## 6. Deploy

```mermaid
flowchart LR
    subgraph gh["GitHub"]
        R1["TH-Labs-full<br/>api/**"] --> W1["api image workflow"]
        R2["ProLend"] --> W2["web image workflow"]
    end
    W1 --> G1["ghcr.io/asilbekali/th-labs-full/api"]
    W2 --> G2["ghcr.io/asilbekali/prolend/web"]
    G1 --> SRV["/srv/th-labs<br/>docker compose pull && up -d"]
    G2 --> SRV
    W1 -.->|"SSH"| SRV

    DEV["laptop"] -->|"modal deploy — manual"| MOD["Modal th-labs-dubbing"]
```

* **The VPS is push-to-deploy.** A push to `main` touching `api/**` builds the
  image, pushes to GHCR, then SSHes in and rolls it out. The server needs no
  checkout, no toolchain, no Node — only `docker-compose.yml` and `.env`. Rollback
  is one line: `API_IMAGE=…:sha-<commit> docker compose up -d api`.
* **Modal is not.** The Studio ships with `modal deploy deploy/modal/modal_app.py`,
  run by hand. Model weights (~6 GB) are baked into the image at build time so
  cold starts don't re-download them; uploads and finished dubs live on a Volume
  at `/data` so they survive a scale-down.
* `NEXT_PUBLIC_*` and `VITE_*` are **build args, not runtime env** — both bundlers
  inline them, so changing one means rebuilding the image.

---

## 7. The seams — what breaks if these drift

These are the couplings that are invisible until they fail. Each has bitten already.

| Contract | Between | Symptom when it breaks |
|---|---|---|
| `JWT_SECRET` ≡ `TH_LABS_JWT_SECRET` | Account API ↔ FastAPI | every `/api/jobs` call 401s. Blank on the Modal side → 503, deliberately failing closed |
| `VITE_ACCOUNT_API` | `modal_app.py` ↔ `frontend/src/lib/http.ts` | **silent.** Unset, it resolves to the Studio's own `/v1`, which is the SPA catch-all; sign-in POSTs get 405 and the form just never logs you in. The name must match exactly — it was once `VITE_ACCOUNT_API_URL` and did precisely this |
| CORS allowlist names the Studio origin | Account API | handoff exchange fails cross-origin; user lands signed-out |
| `NEXT_PUBLIC_MAIN_APP_URL` | Landing → Studio | redirect goes nowhere real. Defaults to the live Modal URL rather than a placeholder |
| `QUALITY_COST` server ≡ client | `quality-cost.ts` ↔ `wallet.tsx` | UI quotes one price, server charges another |
| `max_containers=1` | Modal | the job store is an in-memory dict. A second container has its own empty store and returns "Job not found" mid-job. To scale out, move it to a `modal.Dict` first |
| `sub` claim is numeric | NestJS ↔ PyJWT | PyJWT ≥ 2.10 enforces RFC 7519's string `sub` and rejects every genuine token; `verify_sub` is off and the type normalised instead |
| Volume mounted outside the repo | Modal | mounting on `backend/data/` (which ships `.gitkeep`s) crash-loops the container — Modal refuses a non-empty mount path |

---

## 8. Local development

| Piece | Command | Port |
|---|---|---|
| Account API | `cd api && yarn start:dev` | 3001 |
| Studio backend | `cd backend && python run.py` | 8000 |
| Studio frontend | `cd frontend && npm run dev` | 5173 → proxies `/v1`, `/api`, `/media` |
| Landing | `cd ../ProLend && npm run dev` | 3000 |

In dev everything is same-site, so cookies are `SameSite=Lax` and `VITE_ACCOUNT_API`
can stay unset — the Vite proxy resolves `/v1`. Both of those stop being true in
production, which is why the seams above exist.

The Studio also serves its own built SPA from FastAPI when `frontend/dist` is
present, so the whole app is one port. That is what makes the single-container
Modal deploy (and the Colab notebook) work.
