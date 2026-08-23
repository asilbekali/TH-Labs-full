# Payments, credits & the free-dub gate

Auth, plans, a credit ledger, and six Stripe Payment Links wired to an
idempotent webhook that grants credits. Everything below lives in `api/`.

The API is URI-versioned (`defaultVersion: '1'`), so every path is prefixed with
`/v1`. Swagger UI is at **`/docs`**.

---

## Setup

```bash
# 1. env — copy the template and fill in secrets
cp .env.example .env        # then set STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET

# 2. schema + seed (creates the 7 Plan rows from the env links)
npx prisma migrate deploy
npx prisma db seed

# 3. run
yarn start:dev              # http://localhost:3001  (Swagger at /docs)
```

## Plan matrix (seeded from `prisma/seed.ts`)

| Tier | Cycle | Price | Credits / grant | Grant every |
|---|---|---|---|---|
| FREE | — | $0 | 60 | 30 days |
| PRO | WEEKLY | $6 | 150 | 7 days |
| PRO | MONTHLY | $19 | 600 | 30 days |
| PRO | YEARLY | $182 | 600 | 30 days ×12 |
| STUDIO | WEEKLY | $15 | 500 | 7 days |
| STUDIO | MONTHLY | $49 | 2000 | 30 days |
| STUDIO | YEARLY | $470 | 2000 | 30 days ×12 |

**Yearly bills once but the cron drips one allocation every `grantDays`** — see
`payment.cron.ts`.

---

## Endpoints (curl)

Assume `TOKEN` holds an access token and `BASE=http://localhost:3001/v1`.

### Auth

Auth is cookie-based: `login` and `create-user` return `{ accessToken, user }`
in the body (keep the access token in memory) and set an **httpOnly refresh
cookie** scoped to `/v1/auth`. `POST /auth/refresh` rotates that cookie and
returns a fresh access token; `GET /auth/me` returns the current user. Use
`-c/-b` with curl to persist the cookie across calls.

```bash
# register (registration == create-user) → { accessToken, user } + Set-Cookie
curl -sX POST $BASE/users/create-user -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","password":"password123"}'

# login → { accessToken, user } + Set-Cookie (refresh_token, httpOnly)
curl -sX POST $BASE/auth/login -c cookies.txt \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"password123"}'

# refresh → new { accessToken, user }, rotates the cookie
curl -sX POST $BASE/auth/refresh -b cookies.txt -c cookies.txt
```

### Plans (public)

```bash
curl -s $BASE/payments/plans
# → { plans:[...], qualityCost:{fast:5,balanced:10,studio:20}, freeDubMaxSeconds:120 }
```

### Checkout (auth) — returns the Stripe Payment Link with client_reference_id

```bash
curl -s "$BASE/payments/checkout?tier=PRO&cycle=MONTHLY" \
  -H "Authorization: Bearer $TOKEN"
# → { url: "https://buy.stripe.com/test_...?client_reference_id=<id>&prefilled_email=..." }
# Redirect the user to `url`; on payment the webhook grants credits.
```

### The free-dub gate (auth)

```bash
# preflight — read-only, charges nothing
curl -sX POST $BASE/payments/can-dub \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"durationSeconds":90,"quality":"balanced"}'
# fresh user → { allowed:true, isFreeDub:true, cost:0, balance:60 }

# commit — charges (or consumes the free dub); idempotent on jobId
curl -sX POST $BASE/payments/commit-dub \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jobId":"job_1","durationSeconds":90,"quality":"balanced"}'
# → { charged:false, isFreeDub:true, cost:0, balance:60 }   (free dub consumed)
```

### Subscription / history / ledger (auth)

```bash
curl -s $BASE/payments/subscription        -H "Authorization: Bearer $TOKEN"
curl -sX POST $BASE/payments/subscription/cancel -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/payments/history?page=1&limit=20"  -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/payments/credits?page=1&limit=20"  -H "Authorization: Bearer $TOKEN"
curl -s $BASE/payments/credits/reconcile   -H "Authorization: Bearer $TOKEN"  # dev drift check
```

---

## Webhook

Stripe posts to `POST /v1/payments/webhook`. It is public but every request is:

1. **Signature-verified** with `STRIPE_WEBHOOK_SECRET` against the raw body
   (enabled by `rawBody: true` in `main.ts`). Bad signature → `400`, nothing written.
2. **Idempotency-guarded** by the `WebhookEvent.stripeEventId` unique constraint,
   before any business logic — a Stripe retry can never double-credit.

Test locally:

```bash
stripe listen --forward-to localhost:3001/v1/payments/webhook
# copy the printed whsec_... into STRIPE_WEBHOOK_SECRET, restart the API, then
# pay through a checkout `url` with test card 4242 4242 4242 4242.
```

| Event | Effect |
|---|---|
| `checkout.session.completed` | Resolve user via `client_reference_id`, plan via amount → create/reactivate subscription, record `Payment` SUCCEEDED, grant first allocation. |
| `invoice.paid` | Renewal: record payment, grant next allocation, extend period. Skips the initial `subscription_create` invoice (already granted at checkout). |
| `invoice.payment_failed` | Status → `PAST_DUE`. Credits kept. |
| `customer.subscription.updated` | Sync status / period / cancelAtPeriodEnd. |
| `customer.subscription.deleted` | Status → `CANCELED`. Unspent credits kept. |

Tier, cycle and amount are always derived from the Stripe object, never the client.

---

## Where the gate is enforced

`can-dub` / `commit-dub` are called **twice**, and that is deliberate:

| Caller | Why |
|---|---|
| The Studio (`frontend/src/pages/Studio.tsx`) | Fast feedback — refuses before uploading and shows the real cost in the library. |
| The dubbing API (`backend/app/billing.py`) | The one that actually protects the GPU. A bearer token proves *who* is asking, not that they have paid; without this check anyone holding a valid access token can `POST /api/jobs` directly and dub for free. |

`commit-dub` is idempotent on `jobId`, so both callers charging the same job is
harmless — exactly one `CreditEntry` is written.

Server-side enforcement turns on when the dubbing API has
`TH_LABS_ACCOUNT_API_URL` set (to this API's base URL, including `/v1`). It is
unset for local runs and docker-compose, which have no account API to ask, and
set in `deploy/modal/modal_app.py`, where the GPU costs real money. When it is
on, every failure path **denies** the dub: an unreachable billing API returns
`503` rather than becoming a free GPU.

---

## Credit integrity

- `CreditEntry` is an append-only ledger; `User.credits` is a cached balance.
  Every mutation writes both inside one `$transaction`.
- `spendCredits` / `commit-dub` use a guarded `updateMany` (`credits >= amount`),
  so concurrent spends can never drive the balance negative — exactly one wins.
- `GET /payments/credits/reconcile` reports any drift between the two.
