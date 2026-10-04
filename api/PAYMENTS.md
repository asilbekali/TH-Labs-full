# Payments, credits & the dub gate

Auth, plans, a credit ledger, and **Lemon Squeezy share links**, verified by
reading the order back from the LS API. Everything below lives in `api/`.

The API is URI-versioned (`defaultVersion: '1'`), so every path is prefixed with
`/v1`. Swagger UI is at **`/docs`**.

Lemon Squeezy owns the checkout page, the card data, tax and the receipt. This
app never sees a card number and ships no payment SDK to the browser.

## There is no webhook (yet)

A share link never calls this API, and LS's redirect back carries no order id.
So "was this paid, and by whom?" is answered by *asking LS*:

```
  Buy button
      │  GET /v1/payments/checkout?tier=PRO&cycle=MONTHLY
      ▼
  { url: "https://th-labs.lemonsqueezy.com/checkout/buy/<uuid>
          ?checkout[email]=<account email>&checkout[custom][user_id]=46…" }
      │       (also stamps User.lsCheckoutStartedAt = now)
      ▼  browser → lemonsqueezy.com, customer pays
      │
      ├─► buyer returns to /plans/success ──► POST /v1/payments/claim  (polls ~60 s)
      └─► cron, every 5 min, for 24 h after the checkout was opened
                         │
                         ▼
  API ──https──► LS: GET /orders?filter[store_id]&filter[user_email]=<account email>
      ◄───────── status, first_order_item.variant_id, total_usd, created_at
      │
      ├─ status ≠ paid?                 skipped (pending → "ask again")
      ├─ variant matches no row?        skipped, logged loudly (support settles)
      ├─ order older than the account?  skipped
      └─ new paid order ──► credits + Payment row (UNIQUE lsOrderId), one transaction
```

Renewals are not orders: LS records them as **subscription invoices**. An hourly
cron asks LS about every subscription at the end of its period and credits each
paid `renewal` invoice once (UNIQUE `Payment.lsInvoiceId`), moving the period to
LS's `renews_at`.

### What is trusted

| Value | Comes from | Trusted for |
|---|---|---|
| order `status` | LS | **whether money moved.** Only `paid` grants. |
| `first_order_item.variant_id` | LS | **what was bought.** Matched to `Plan.lsVariantId` / `CreditPack.lsVariantId`. The buyer cannot change it. |
| order email | LS (prefilled by us) | **whose it is.** Emails are unique here; an order older than the account is ignored. |
| `total_usd` | LS | Logged when it differs >10% from `priceCents`; never refuses (LS localises prices, discounts are legitimate). |
| `checkout[custom]` | the URL | nothing today — it is there for the future webhook. |

**The one gap:** a buyer who changes the email on the LS form is not matched
automatically. The success page says so; support credits them by hand.

### Adding the webhook later

Point it at the **API** (e.g. `https://<api-host>/v1/payments/webhook`), not at a
Studio page, and grant through the same `grantPlanOrder` / `grantPackOrder` /
`grantRenewal` paths. The UNIQUE order and invoice ids mean the webhook and the
polling can both run and still pay out once.

---

## Setup

```bash
# api/.env
LEMONSQUEEZY_API_KEY=…      # Settings → API. TEST-mode key while the links are test-mode.
LEMONSQUEEZY_STORE_ID=      # only if the key sees more than one store

npx prisma migrate deploy   # (or psql — see the migration notes)
npx prisma db seed          # fills empty checkoutUrl / lsVariantId from the seed
yarn start:dev
```

Per LS product (optional but faster): set its redirect / confirmation button
link to `${APP_URL}/plans/success`. Without it the buyer is still credited by
the cron within ~5 minutes.

**Keys are per-mode.** A test-mode key only sees test orders. When going live:
copy the products to live mode (new variant ids), paste the new links and
variant ids in the admin panel, and swap the key.

| Variable | What breaks without it |
|---|---|
| `LEMONSQUEEZY_API_KEY` | **Nothing can be verified, so nothing can be credited.** Buy buttons 503 instead. |

### Catalog (test mode)

| Item | Variant | Grants |
|---|---|---|
| PRO monthly | 2203365 | 1 200 |
| STUDIO monthly | 2203401 | 4 800 |
| PRO yearly | 2203407 | 1 200 × 12 (monthly drip) |
| STUDIO yearly | 2203414 | 4 800 × 12 (monthly drip) |
| pack_100 | 2203420 | 100 |
| pack_500 | 2203424 | 500 |
| pack_2000 | 2203428 | 2 000 |

Change any of it from the admin panel: `PATCH /v1/admin/billing/plans/:id` or
`/credit-packs/:id` with `checkoutUrl`, `lsVariantId`, `creditsGranted`,
`priceCents`. An item is sold only when it has **both** a link and a variant id.

## Plan matrix (seeded from `prisma/seed.ts`)

| Tier | Cycle | Price | Credits / grant | Grant every | Grants | **Total credits** |
|---|---|---|---|---|---|---|
| FREE | — | $0 | 60 | 30 days | 1 | 60 |
| PRO | MONTHLY | $19.50 | 1 200 | 30 days | 1 | **1 200** |
| PRO | YEARLY | $199 | 1 200 | 30 days | 12 | **14 400** |
| STUDIO | MONTHLY | $49.50 | 4 800 | 30 days | 1 | **4 800** |
| STUDIO | YEARLY | $499 | 4 800 | 30 days | 12 | **57 600** |

**Set each Stripe product's price to match `priceCents` exactly.** This is
enforced, not cosmetic: a claim compares `amount_total` from Stripe against the
catalog price and refuses to grant credits when they differ. That check is what
makes `client_reference_id` safe to use (see above), so it cannot be relaxed —
which means a mispriced product does not quietly give the wrong credits, it
stops purchases and logs loudly.

**Yearly bills once but the cron drips one allocation every `grantDays`** —
`Plan.grantsPerPeriod` (12) bounds it against `Subscription.grantsIssued`, so a
365-day period pays out exactly twelve months and not a thirteenth. Each
successful charge resets the counter to 1, having already granted the first
allocation. See `payment.cron.ts`.

**Renewals are not detected.** With no webhook, nothing tells this API that
Stripe charged a card a second time. So a purchase opens ONE paid period and the
user buys again from the same link when it lapses — see the next section. A
Payment Link created in Stripe's *subscription* mode will keep billing them;
`POST /payments/subscription/cancel` says so in its message and points them at
their Stripe receipt, because this side cannot stop that charge.

## Period end & the drop back to Free

`cyclePeriodEnd` steps by **calendar** units, not by 30/365 days: pay on Aug 25
and the period ends Sep 25 (Jan 31 clamps to Feb 28/29). It is computed at claim
time and it is the only word on when access ends — there is no renewal event to
correct it with.

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
# → { plans:[...], qualityCost:{...}, creditsPerMinute:20,
#     freeMinuteSeconds:60, signupBonusCredits:20,
#     checkout:{ provider:"stripe", mode:"test"|"live"|"unconfigured",
#                configured:true, missingProducts:[], canGrantCredits:true } }

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
# → { url: "https://buy.stripe.com/test_...?client_reference_id=th.46.plan.<id>
#            &prefilled_email=...", tier, cycle, priceCents, creditsGranted }

curl -s "$BASE/payments/checkout/credits?pack=pack_500" \
  -H "Authorization: Bearer $TOKEN"
# → { url, packId, credits, priceCents }
```

Send the browser to `url`. Stripe takes the payment and redirects back to
`/plans/success?session_id=…`, which claims it:

```bash
# the ONLY call that grants credits for money. Idempotent on sessionId.
curl -sX POST $BASE/payments/stripe/claim \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sessionId":"cs_test_a1b2c3..."}'
# → { claimed:true,  alreadyClaimed:false, creditsGranted:1200, balance:1243,
#     description:"PRO MONTHLY — 1200 credits", subscription:{...} }
# → { claimed:false, alreadyClaimed:true,  creditsGranted:0, ... }  (reloaded page)
# 409 the session is not paid yet, or its amount does not match the item
# 404 Stripe does not know it, or it belongs to another account
# 503 no STRIPE_SECRET_KEY, or Stripe is unreachable — the money is safe, retry
```

### Subscription / portal / history / ledger (auth)

```bash
curl -s $BASE/payments/subscription        -H "Authorization: Bearer $TOKEN"
curl -sX POST $BASE/payments/subscription/cancel -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/payments/history?page=1&limit=20"  -H "Authorization: Bearer $TOKEN"
curl -s "$BASE/payments/credits?page=1&limit=20"  -H "Authorization: Bearer $TOKEN"
curl -s $BASE/payments/credits/reconcile   -H "Authorization: Bearer $TOKEN"  # dev drift check
```

### The dub gate (auth)

Priced per second — 20 credits a minute at Balanced, times the quality
multiplier. There is no "one free dub" special case any more: a new account is
granted 20 credits (one minute) and the balance alone decides from then on.

```bash
# preflight — read-only, charges nothing. durationSeconds is a REAL number:
# ffprobe reports 49.017, never a whole number.
curl -sX POST $BASE/payments/can-dub \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"durationSeconds":49.017,"quality":"balanced"}'
# → { allowed:true, cost:17, balance:60, billableSeconds:49.017,
#     billableCost:17, trimmed:false, affordableSeconds:180,
#     creditsPerMinute:20 }

# a short wallet is not a refusal — it buys the FRONT of the video
# 10 credits, 49s clip → { allowed:true, billableSeconds:30, billableCost:10,
#                          trimmed:true, affordableSeconds:30 }
# the caller trims to billableSeconds and charges for that.

# commit — charges for the seconds actually dubbed. Idempotent on jobId.
curl -sX POST $BASE/payments/commit-dub \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"jobId":"job_1","durationSeconds":30,"quality":"balanced"}'
# → { jobId:"job_1", charged:true, cost:10, balance:0, idempotent:false }
```

---

## Admin billing API

Everything an ADMIN needs to run billing without a deploy. Staff-only
(`JwtAuthGuard` + `RolesGuard`); SUPERADMIN satisfies ADMIN everywhere, and
deleting a credit pack is SUPERADMIN alone.

```bash
# Health: mode, what is wired up, what is missing. Render a status page off this.
curl -s $BASE/admin/billing/overview -H "Authorization: Bearer $TOKEN"
# → { provider:"stripe", mode:"test"|"live"|"unconfigured", canGrantCredits,
#     successUrl:"https://th-labs.uz/plans/success?session_id={CHECKOUT_SESSION_ID}",
#     webhook:{ required:false, note:"…" },
#     plans:{ total, sellable, unconfigured:["PRO/MONTHLY", …] },
#     creditPacks:{ total, active, unconfigured:["pack_500", …] },
#     links:{ live, test, mixed }, qualityCost, tariff }
```

**Read `canGrantCredits` first.** False (no `STRIPE_SECRET_KEY`) means a
purchase could never be verified, so nothing could be credited — the Buy button
503s rather than taking the money. Show `successUrl` somewhere copyable: it is
the redirect every Payment Link needs, and the one piece of Stripe-side setup
that silently breaks a purchase if it is wrong. `links.mixed` is the other flag
worth surfacing: a live key pointed at test links, or the reverse, which charges
the card and then cannot credit it.

### Plans

```bash
curl -s $BASE/admin/billing/plans -H "Authorization: Bearer $TOKEN"
# → { plans:[ { id, tier, cycle, priceCents, creditsGranted, grantDays,
#               grantsPerPeriod, stripePaymentLink, stripeProductId, active,
#               configured, sellable, creditsPerPeriod, linkIsTestMode } ] }

# Put a plan on sale, and set what it grants and costs. This is the whole job.
curl -sX PATCH $BASE/admin/billing/plans/<id> \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"stripePaymentLink":"https://buy.stripe.com/test_8x27sNc6m4U6buM11q6AM01",
       "creditsGranted":1500,"priceCents":1950}'
# → { plan:{…}, warning:"priceCents is 1950. It must equal what the Stripe
#                        product charges, to the cent — …" }

# Take it off sale without deactivating it: clear the link
curl -sX PATCH $BASE/admin/billing/plans/<id> … -d '{"stripePaymentLink":""}'
```

Every field is optional — send only what changed, and it takes effect on the
next request with no deploy and no re-seed. **Changing `creditsGranted` from
1200 to 1500 is exactly this call.**

`stripePaymentLink` must be a `https://buy.stripe.com/…` URL; anything else is a
`400` rather than a silent save, because a wrong value here is a Buy button that
sends a paying customer somewhere unintended.

`stripeProductId` normally needs no attention: the first completed purchase
records it automatically (`PaymentService.learnProductId`). It is writable for
the case where a product is re-created in the dashboard and the stored id has to
be corrected.

### Credit packs (one-time credit purchases)

The catalog is a table, not code, so packs are created and priced from the
panel:

```bash
curl -s  $BASE/admin/billing/credit-packs -H "Authorization: Bearer $TOKEN"
curl -sX POST $BASE/admin/billing/credit-packs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"slug":"pack_3000","credits":3000,"priceCents":13900,
       "stripePaymentLink":"https://buy.stripe.com/test_…"}'
curl -sX PATCH  $BASE/admin/billing/credit-packs/<id> … -d '{"priceCents":12900}'
curl -sX DELETE $BASE/admin/billing/credit-packs/<id> …   # SUPERADMIN only
```

`slug` is permanent: it travels to Stripe as the session's
`client_reference_id` and is read back on the claim, so renaming one would
orphan a checkout already in flight. Retiring a pack means `{"active":false}`,
not delete — a deleted slug can no longer be resolved, and a payment still in
flight would arrive with nothing to grant. (A claim deliberately ignores
`active`: someone who has already paid for a pack retired mid-checkout still
gets their credits.)

**One Stripe product sells exactly one thing.** Attaching a product already used
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

## Claiming a purchase

`POST /v1/payments/stripe/claim` is the only path that turns money into credits.
It is **authenticated** — the credits have to land on a specific account — and
idempotent on the session id.

### What it checks, in order

1. **Already claimed?** A `Payment` row with this `stripeCheckoutSessionId`
   means we have been here. Returns `alreadyClaimed: true` and grants nothing.
   A row belonging to a *different* user is a `404`, not a `403`: that it exists
   at all is not information this caller can otherwise obtain.
2. **Paid?** `checkout.sessions.retrieve`, then `payment_status`. `paid` and
   `no_payment_required` (a 100 % coupon) count; anything else is a `409` with
   Stripe's own word for the state.
3. **Which account?** `client_reference_id` is decoded (`th.<userId>.plan|pack.<id>`)
   and cross-checked against the bearer token. A mismatch is a `404`.
4. **How much?** `amount_total` and `currency` must equal the catalog row,
   exactly. A mismatch is a `409`, logged with both figures and the Stripe
   product ids. **This is the check that makes step 3 safe** — editing the
   reference to name a bigger pack still pays the smaller product's price.
5. **Grant.** The `Payment` row and the credit grant are written in **one
   transaction**, so the UNIQUE index on the session id is what guarantees
   exactly-once — not a check-then-write.

### Why there is no webhook

Covered at the top of this file. Briefly: it removes the only public endpoint
that could move credits, the signing secret, the replay-dedupe table and the
failure mode where a missed delivery means a customer paid and got nothing.

The trade is that the grant needs the buyer's browser to come back. It is not
lost if it does not: the session id stays claimable, `/plans/success` keeps it on
screen, and the claim can be replayed safely at any time.

### Status codes, and what they mean to the customer

| Code | Cause | What the page says |
|---|---|---|
| `200 claimed` | all good | "1,200 credits added" |
| `200 alreadyClaimed` | page reloaded | "Already added. Nothing was charged twice." |
| `409` | not paid yet, or amount mismatch | Stripe's state, or "does not match the item" |
| `404` | Stripe does not know the session, or it is another user's | "If you were charged, contact support" |
| `503` | no `STRIPE_SECRET_KEY`, or Stripe unreachable | "Your money is safe — reload in a moment" |

Every 4xx/5xx body is written for the person reading it, and the success page
keeps the `session_id` visible on failure so support has the receipt.

### Testing locally

No tunnel, and nothing to forward — that is the point. With a test key and test
Payment Links:

```bash
# 1. a test key is enough; a restricted key with
#    "Checkout Sessions: read" is better
STRIPE_SECRET_KEY=rk_test_... yarn start:dev

# 2. the link's redirect must point at YOUR dev origin:
#      http://localhost:5173/plans/success?session_id={CHECKOUT_SESSION_ID}
#    Stripe allows an http://localhost redirect on a test-mode link.

# 3. buy with 4242 4242 4242 4242, any future expiry, any CVC
```

The claim is replayable, so a session id from the Stripe Dashboard can be posted
by hand to re-test the whole path without paying again:

```bash
curl -sX POST http://localhost:3001/v1/payments/stripe/claim \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"sessionId":"cs_test_..."}'
```

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
- Purchase grants ride in the same transaction as the `Payment` row whose
  `stripeCheckoutSessionId` UNIQUE constraint guards them, so a reloaded success
  page, a double-clicked button and a replayed session id all pay out once.
- Every interactive transaction runs on the budget set in `PrismaService`
  (`DB_TX_MAX_WAIT_MS` / `DB_TX_TIMEOUT_MS`, default 15 s / 20 s) and is retried
  on a transient database failure. Prisma's own 2 s/5 s defaults are sized for a
  Postgres on localhost and were too tight for this one — `commit-dub` threw
  P2028 and surfaced as a 500.
- `GET /payments/credits/reconcile` reports any drift between the two.
