# Payments, credits & the free-dub gate

Auth, plans, a credit ledger, and Dodo Payments products wired to an idempotent
webhook that grants credits. Everything below lives in `api/`.

The API is URI-versioned (`defaultVersion: '1'`), so every path is prefixed with
`/v1`. Swagger UI is at **`/docs`**.

Dodo Payments is a **merchant of record**: it owns the checkout page, the card
data, tax and the invoice. This app never sees a card number and ships no
payment SDK to the browser.

---

## Setup

```bash
# 1. env — copy the template and fill in the Dodo values
cp .env.example .env        # DODO_PAYMENTS_API_KEY / DODO_WEBHOOK_SECRET / DODO_PRODUCT_*

# 2. schema + seed (writes the products from .env onto the Plan rows)
npx prisma migrate deploy
npx prisma db seed

# 3. run
yarn start:dev              # http://localhost:3001  (Swagger at /docs)
```

### Two ways to configure a product

**From the admin panel** (`PATCH /v1/admin/billing/plans/:id`) — an ADMIN
pastes the Dodo product link, saves, and the site sells it on the next
request. No deploy, no re-seed. This is the normal path; see
[Admin billing API](#admin-billing-api) below.

**From the environment** — the `DODO_PRODUCT_*` variables below are read by
`prisma/seed.ts` and written onto the rows. Useful for bringing a fresh
environment up with products already attached; after that the panel is
authoritative and re-seeding leaves edited rows alone.

### The three things to configure

| Variable | Where it comes from | What breaks without it |
|---|---|---|
| `DODO_PAYMENTS_API_KEY` | Dashboard → Settings → API keys | Checkout falls back to static payment links; cancel and the customer portal 503 |
| `DODO_WEBHOOK_SECRET` | Dashboard → Settings → Webhooks, on the endpoint | **Every webhook is rejected — a customer can pay and never get credits** |
| `DODO_PRODUCT_<TIER>_<CYCLE>` | Dashboard → Products | `/payments/checkout` 400s for that plan |

`DODO_PAYMENTS_ENVIRONMENT` is `test_mode` (default) or `live_mode`. It selects
the Dodo host, so the key and the products must come from the same side.

Each `DODO_PRODUCT_*` accepts **either** a product id (`pdt_…`) **or** the whole
payment link copied out of the dashboard — `parseProductRef` derives the other
half. Products are read by `prisma/seed.ts` at *seed* time, not on boot:
re-run `yarn prisma:seed` after editing them.

## Plan matrix (seeded from `prisma/seed.ts`)

| Tier | Cycle | Price | Credits / grant | Grant every | Grants | **Total credits** |
|---|---|---|---|---|---|---|
| FREE | — | $0 | 60 | 30 days | 1 | 60 |
| PRO | WEEKLY | $6 | 300 | 7 days | 1 | **300** |
| PRO | MONTHLY | $19.50 | 1 200 | 30 days | 1 | **1 200** |
| PRO | YEARLY | $199 | 1 200 | 30 days | 12 | **14 400** |
| STUDIO | WEEKLY | $15 | 1 200 | 7 days | 1 | **1 200** |
| STUDIO | MONTHLY | $49.50 | 4 800 | 30 days | 1 | **4 800** |
| STUDIO | YEARLY | $499 | 4 800 | 30 days | 12 | **57 600** |

Set each Dodo product's price to match `priceCents`. Unlike the old Stripe
setup, the amount is **not** how a payment is resolved to a plan — the product
id is — so a mismatch no longer silently withholds credits. It is still a lie
to the customer, who was quoted the number on this page.

**Yearly bills once but the cron drips one allocation every `grantDays`** —
`Plan.grantsPerPeriod` (12) bounds it against `Subscription.grantsIssued`, so a
365-day period pays out exactly twelve months and not a thirteenth. Each
successful charge resets the counter to 1, having already granted the first
allocation. See `payment.cron.ts`.

**Set the Dodo subscription period longer than the payment frequency.** A
product with period = frequency is valid for a single cycle and then `expired`
instead of renewing. For an ongoing monthly plan use a long period (e.g. 20
years) with a monthly payment frequency.

## Period end & the drop back to Free

`cyclePeriodEnd` steps by **calendar** units, not by 30/365 days: pay on Aug 25
and the period ends Sep 25 (Jan 31 clamps to Feb 28/29). It is only a fallback
— when the API key is set, the period end is Dodo's own `next_billing_date`.

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

### Catalog (public)

```bash
curl -s $BASE/payments/plans
# → { plans:[...], qualityCost:{...}, freeDubMaxSeconds:120,
#     checkout:{ provider:"dodo", mode:"test", configured:true,
#                missingProducts:[], apiConfigured:true, webhookConfigured:true } }

curl -s $BASE/payments/credit-packs
# → { packs:[{id,credits,priceCents,currency,available}], creditsPerMinute, qualityMultiplier }
```

`checkout` is how the UI knows whether to offer a buy button at all. The browser
cannot work this out for itself — there is no publishable key to inspect — so
the server reports it.

### Checkout (auth)

```bash
curl -s "$BASE/payments/checkout?tier=PRO&cycle=MONTHLY" \
  -H "Authorization: Bearer $TOKEN"
# → { url: "https://test.checkout.dodopayments.com/session/cks_...", tier, cycle, ... }

curl -s "$BASE/payments/checkout/credits?pack=pack_500" \
  -H "Authorization: Bearer $TOKEN"
# → { url, packId, credits, priceCents }
```

Redirect the user to `url`; on payment the webhook grants credits.

### Subscription / portal / history / ledger (auth)

```bash
curl -s $BASE/payments/subscription        -H "Authorization: Bearer $TOKEN"
curl -sX POST $BASE/payments/subscription/cancel -H "Authorization: Bearer $TOKEN"
curl -s $BASE/payments/portal              -H "Authorization: Bearer $TOKEN"  # Dodo customer portal
curl -s "$BASE/payments/history?page=1&limit=20"  -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/payments/credits?page=1&limit=20"  -H "Authorization: Bearer $TOKEN"
curl -s $BASE/payments/credits/reconcile   -H "Authorization: Bearer $TOKEN"  # dev drift check
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

---

## Admin billing API

Everything an ADMIN needs to run billing without a deploy. Staff-only
(`JwtAuthGuard` + `RolesGuard`); SUPERADMIN satisfies ADMIN everywhere, and
deleting a credit pack is SUPERADMIN alone.

```bash
# Health: mode, what is wired up, what is missing. Render a status page off this.
curl -s $BASE/admin/billing/overview -H "Authorization: Bearer $TOKEN"
# → { provider, mode:"test"|"live", apiConfigured, webhookConfigured,
#     plans:{ total, sellable, unconfigured:["PRO/MONTHLY", …] },
#     creditPacks:{ total, active, unconfigured:["pack_500", …] },
#     links:{ live, test, mixed }, qualityCost, tariff }
```

**Read `webhookConfigured` first.** False means a customer can pay and never
receive credits — the one failure that is invisible until someone is charged.
`links.mixed` is the other one worth surfacing: a live-mode API pointed at
test checkout links, or the reverse.

### Plans

```bash
curl -s $BASE/admin/billing/plans -H "Authorization: Bearer $TOKEN"
# → { plans:[ { id, tier, cycle, priceCents, creditsGranted, grantDays,
#               grantsPerPeriod, dodoProductId, dodoLinkUrl, active,
#               configured, sellable, creditsPerPeriod, linkIsTestMode } ] }

# Put a plan on sale — paste the link OR the product id, either works
curl -sX PATCH $BASE/admin/billing/plans/<id> \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"dodoProduct":"https://checkout.dodopayments.com/buy/pdt_abc","priceCents":1900}'

# Take it off sale without deactivating it: clear the product
curl -sX PATCH $BASE/admin/billing/plans/<id> … -d '{"dodoProduct":""}'
```

Every field is optional — send only what changed. `dodoProduct` accepts a
product id (`pdt_…`) or a full payment link and derives the other half;
anything it cannot read is a `400` rather than a silent save.

### Credit packs (one-time credit purchases)

The catalog is a table, not code, so packs are created and priced from the
panel:

```bash
curl -s  $BASE/admin/billing/credit-packs -H "Authorization: Bearer $TOKEN"
curl -sX POST $BASE/admin/billing/credit-packs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"pack_3000","credits":3000,"priceCents":13900,"dodoProduct":"pdt_xyz"}'
curl -sX PATCH  $BASE/admin/billing/credit-packs/<id> … -d '{"priceCents":12900}'
curl -sX DELETE $BASE/admin/billing/credit-packs/<id> …   # SUPERADMIN only
```

`slug` is permanent: it travels in the checkout metadata and is what the
webhook reads back, so renaming one would orphan a checkout already in flight.
Retiring a pack means `{"active":false}`, not delete — a deleted slug can no
longer be resolved and a payment still in flight would arrive with nothing to
grant.

**One Dodo product sells exactly one thing.** Attaching a product already used
by another plan or pack is a `409`, checked across both tables — otherwise a
payment could not be resolved back to what was bought.

---

## Activity log (admin panel feed)

Every state-changing request is recorded: **who did what to whom**, when, from
where, and whether it worked. Written by a global interceptor, so a route added
later is covered without anyone remembering to opt in.

```
16:51:59  super@gmail.com  SUPERADMIN  user.delete       user: audit-final@example.com  200
16:51:58  super@gmail.com  SUPERADMIN  billing.pack.update  creditPack: pack_2000        200
16:51:55  super@gmail.com  SUPERADMIN  user.role.change  user: audit-final@example.com  200
```

…which the panel can render straight as sentences:

> **super@gmail.com** — Deleted the account audit-final@example.com
> **super@gmail.com** — Changed the role of audit-final@example.com

```bash
# The feed. Filters compose.
curl -s "$BASE/admin/logs?limit=50" -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/admin/logs?action=billing&success=false" -H "…"   # failed billing actions
curl -s "$BASE/admin/logs?actorId=7&from=2026-09-01T00:00:00Z"   -H "…"   # what one admin did
curl -s "$BASE/admin/logs?targetLabel=ada@example.com"           -H "…"   # what was done TO an account
curl -s "$BASE/admin/logs?targetType=user"                       -H "…"   # account actions only
curl -s "$BASE/admin/logs?targetId=42"                           -H "…"   # one row's whole history
curl -s "$BASE/admin/logs?q=ada@example.com"                     -H "…"   # BOTH sides at once

# Counts over time + busiest actors/actions. bucket = second|minute|hour|day
curl -s "$BASE/admin/logs/stats?bucket=hour" -H "Authorization: Bearer $TOKEN"

# Distinct action names, for a filter dropdown
curl -s $BASE/admin/logs/actions -H "Authorization: Bearer $TOKEN"

# One row, with its full redacted request detail
curl -s $BASE/admin/logs/<id> -H "Authorization: Bearer $TOKEN"

# Live feed (SSE) — rows arrive as they are written
curl -sN $BASE/admin/logs/stream -H "Authorization: Bearer $TOKEN"
```

| Field | Meaning |
|---|---|
| `action` | Stable name (`auth.login`, `billing.plan.update`). Never contains an id, so it groups and filters cleanly. Prefix-matched: `action=billing` returns every `billing.*`. |
| `targetType` / `targetId` / `targetLabel` | **Who it was done TO.** `user`/`admin`/`plan`/`creditPack`/`language`, the id, and a human label — the affected account's email, `PRO/MONTHLY`, a pack slug. Resolved **before** the handler runs, so a deletion still names the account it destroyed. |
| `actorId` / `actorEmail` / `actorRole` | Copied in at write time, not joined — the trail stays true after a rename or a deletion. Null for an anonymous caller (a failed login, a provider webhook). |
| `success` / `statusCode` | Rejected actions are recorded too. A `403` is exactly what an admin wants to see. |
| `meta` | Request body and query, with every credential-shaped field replaced by `[redacted]`. |

Notes worth knowing before wiring up the panel:

* **Reads are not logged** by default — polling would drown the feed. The GETs
  that are really actions (`/payments/checkout`, `/payments/portal`) are always
  recorded. Set `AUDIT_LOG_READS=true` to log every GET as well; expect a lot
  of rows.
* **EventSource cannot set an `Authorization` header.** The SSE endpoint needs
  the token supplied another way — a proxy that adds it, or a fetch-based SSE
  client.
* **Nothing can edit or delete a row** through the API. An audit trail staff
  can edit is not an audit trail. A daily 3am cron prunes past
  `AUDIT_LOG_RETENTION_DAYS` (default 90).
* Reading the log is not itself logged, or the feed would feed on itself.
* `targetLabel` is a **snapshot**, like the actor fields — resolved once at
  write time and never joined. Renaming or deleting an account afterwards does
  not rewrite the history of what was done to it.
* Resolving that label costs one indexed read before a targeted mutation
  (`PATCH /users/:id`, `DELETE …`). Routes without a target pay nothing.

---

## Webhook

Dodo posts to `POST /v1/payments/webhook`. It is public but every request is:

1. **Signature-verified** against `DODO_WEBHOOK_SECRET` using the
   [Standard Webhooks](https://www.standardwebhooks.com/) scheme — the
   `webhook-id`, `webhook-timestamp` and `webhook-signature` headers over the
   raw body (kept intact by `rawBody: true` in `main.ts`). Bad signature → `400`,
   nothing written.
2. **Idempotency-guarded** by the `WebhookEvent.eventId` unique constraint on
   the `webhook-id` header, before any business logic — a retry can never
   double-credit.

### Which event grants credits

**Only `payment.succeeded`.** It is the one event that means money actually
moved, and it fires uniformly for the first charge *and* every renewal — where
the subscription events split the same moment across `subscription.active` and
`subscription.renewed`. The `subscription.*` events never grant; they only keep
status, period and plan in sync. A mandate that authorises and then fails to
charge therefore cannot hand out a month of credits.

| Event | Effect |
|---|---|
| `payment.succeeded` (with `subscription_id`) | Resolve the user and plan → create/reactivate the subscription, retire any other live one, record `Payment` SUCCEEDED, start a new period, grant allocation 1. |
| `payment.succeeded` (no `subscription_id`) | One-time credit pack: resolve the pack from metadata, record the payment, grant its credits. |
| `payment.failed` | Logged with Dodo's `error_message`. No state change. |
| `subscription.active` / `renewed` / `updated` / `plan_changed` / `unpaused` | Sync status, period end and plan. Opens the row if the payment event has not landed yet, with `grantsIssued: 0` and no grant. |
| `subscription.past_due` / `on_hold` / `paused` | Status → `PAST_DUE`. Credits kept. A `past_due_ends_at` grace deadline becomes the period end, so access ends when Dodo says it does. |
| `subscription.cancelled` | Status → `CANCELED`. Unspent credits kept. |
| `subscription.expired` / `failed` | Status → `EXPIRED`. Unspent credits kept. |

Tier, cycle and amount are always derived from the Dodo object, never the
client.

### Who paid

Plan resolution: checkout metadata `th_plan_id` → `Plan.dodoProductId` →
price match, in that order.

User resolution is deliberately more suspicious. The metadata `th_user_id` is
authoritative on a **hosted checkout session**, where it was set server-side.
But on the **static-link fallback** it is a query parameter the customer can
edit, so the handler cross-checks it against the email that actually paid:

* metadata and email agree, or there is no email → take the metadata.
* they disagree → credit the **payer**, and log the mismatch.
* no usable metadata → fall back to the account matching the paying email.
* neither → log an error and grant nothing.

### Testing locally

Point a Dodo test-mode webhook endpoint at your machine (any tunnel works):

```bash
# whatever exposes localhost:3001 to the internet
cloudflared tunnel --url http://localhost:3001
# then Dashboard → Settings → Webhooks → add https://<tunnel>/v1/payments/webhook
# copy the signing secret into DODO_WEBHOOK_SECRET and restart the API
```

Then buy a plan with a Dodo test card. The Dodo CLI can also replay events at a
local endpoint — see `dodo webhooks` in their docs.

---

## Credit integrity

- `CreditEntry` is an append-only ledger; `User.credits` is a cached balance.
  Every mutation writes both inside one `$transaction`.
- `spendCredits` / `commit-dub` use a guarded `updateMany` (`credits >= amount`),
  so concurrent spends can never drive the balance negative — exactly one wins.
- Webhook grants ride in the same transaction as the `Payment` row whose
  `dodoPaymentId` unique constraint guards them, so a replayed event with a
  fresh `webhook-id` still cannot double-grant.
- `GET /payments/credits/reconcile` reports any drift between the two.
