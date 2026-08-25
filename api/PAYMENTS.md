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

| Tier | Cycle | Price | Credits / grant | Grant every | Grants | **Total credits** |
|---|---|---|---|---|---|---|
| FREE | — | $0 | 60 | 30 days | 1 | 60 |
| PRO | WEEKLY | $6 | 300 | 7 days | 1 | **300** |
| PRO | MONTHLY | $19 | 1 200 | 30 days | 1 | **1 200** |
| PRO | YEARLY | $199 | 1 200 | 30 days | 12 | **14 400** |
| STUDIO | WEEKLY | $15 | 1 200 | 7 days | 1 | **1 200** |
| STUDIO | MONTHLY | $49 | 4 800 | 30 days | 1 | **4 800** |
| STUDIO | YEARLY | $499 | 4 800 | 30 days | 12 | **57 600** |

`priceCents` **must** match the Stripe Payment Link amount exactly — with no
`stripePriceId` seeded, the webhook resolves the plan by `amount_total`. A
mismatch means no credits are granted; `resolvePlan` logs the whole catalog
when that happens so the drift is visible in one line.

**Yearly bills once but the cron drips one allocation every `grantDays`** —
`Plan.grantsPerPeriod` (12) bounds it against `Subscription.grantsIssued`, so a
365-day period pays out exactly twelve months and not a thirteenth. Checkout and
each renewal reset the counter to 1, having already granted the first
allocation. See `payment.cron.ts`.

## Period end & the drop back to Free

`cyclePeriodEnd` steps by **calendar** units, not by 30/365 days: pay on Aug 25
and the period ends Sep 25 (Jan 31 clamps to Feb 28/29, as Stripe does).

Nothing stores a "current tier" — it is derived from the live `Subscription`
row. So when a period ends with no renewal, `expireLapsedSubscriptions` (hourly)
flips `ACTIVE`/`PAST_DUE` → `EXPIRED` and the user is back on Free. Because the
cron is hourly, `GET /payments/subscription` also reports a lapsed row as
`EXPIRED` on read, so the UI never shows a stale paid tier while waiting for the
sweep. A renewal that arrives late simply sets the row `ACTIVE` again.

**Unspent credits survive expiry** — they were paid for, and the cancel endpoint
makes the same promise.

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
| `checkout.session.completed` | Resolve user via `client_reference_id`, plan via amount → create/reactivate subscription, retire any other live subscription for that user, record `Payment` SUCCEEDED, grant allocation 1. |
| `invoice.paid` | Renewal: record payment, start a new period, reset `grantsIssued` to 1 and grant. Skips the initial `subscription_create` invoice (already granted at checkout). |
| `invoice.payment_failed` | Status → `PAST_DUE`. Credits kept. |
| `customer.subscription.updated` | Sync status / period / cancelAtPeriodEnd. |
| `customer.subscription.deleted` | Status → `CANCELED`. Unspent credits kept. |

Tier, cycle and amount are always derived from the Stripe object, never the client.

---

## Credit integrity

- `CreditEntry` is an append-only ledger; `User.credits` is a cached balance.
  Every mutation writes both inside one `$transaction`.
- `spendCredits` / `commit-dub` use a guarded `updateMany` (`credits >= amount`),
  so concurrent spends can never drive the balance negative — exactly one wins.
- `GET /payments/credits/reconcile` reports any drift between the two.
