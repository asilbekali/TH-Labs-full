# TH-Labs Admin Panel — build brief

Paste this whole file into Claude Code in the admin-panel project.

---

You are building the **admin panel** for TH-Labs, an AI dubbing platform. The
backend already exists and is **finished** — it is a NestJS API in a separate
repo. Your job is the panel only: **do not write any backend code**, and do not
invent endpoints. Everything below is the real, verified contract.

## 1. The API

| | |
|---|---|
| Base URL (dev) | `http://localhost:3001/v1` |
| Base URL (prod) | `https://th-labs.uz/v1` |
| Swagger | `<host>/docs` — browse it, but call `/v1` |
| Versioning | URI. **Every path is prefixed `/v1`.** `/docs` is a page for humans, never the API base. |

Put the base URL in an env var. Do not hardcode it.

## 2. Auth — read this carefully, it is the part that breaks

Cookie + bearer hybrid:

```
POST /v1/auth/login   { email, password }
  → 200 { accessToken, user: { id, email, name, role } }
  → also sets an httpOnly refresh cookie, scoped to path /v1/auth

POST /v1/auth/refresh    (no body; sends the cookie)  → { accessToken, user }
GET  /v1/auth/me                                      → current user
POST /v1/auth/logout                                  → clears + revokes
```

Rules:

1. **Keep `accessToken` in memory only.** Not localStorage — it is short-lived
   (15m) and the refresh cookie is the durable half.
2. Send it as `Authorization: Bearer <accessToken>` on every admin call.
3. **Every fetch needs `credentials: 'include'`**, or the refresh cookie never
   travels and the user is logged out on reload.
4. On a `401`, call `POST /v1/auth/refresh` **once**, then retry the original
   request. If the refresh also 401s, send them to the login screen. Never
   retry-loop.
5. On app boot, call `refresh` before rendering — that is how a page reload
   restores the session.

**Two things must be true on the server or nothing works cross-origin.** Tell
the operator, do not try to fix it from the panel:

- The panel's origin must be in the API's `CORS_ORIGINS` (comma-separated).
- The refresh cookie is `SameSite=None; Secure` when `APP_URL` is https or
  `NODE_ENV=production`, and `SameSite=Lax` otherwise. So **in production the
  panel must be served over HTTPS**, or the browser silently drops the cookie
  and every reload logs the admin out.

## 3. Roles

`User.role` is `USER | ADMIN | SUPERADMIN`. The API's guard treats
**SUPERADMIN as satisfying every role**, so never check `role === 'ADMIN'` —
check "is staff" as `role === 'ADMIN' || role === 'SUPERADMIN'`.

Gate the whole panel: a `USER` who logs in must be refused at the door with a
clear message, not shown a broken dashboard.

Mirror the API's split in the UI — hide or disable what the role cannot do,
**and** still handle the `403` (the server is the authority):

| Action | Role |
|---|---|
| Everything below unless noted | ADMIN |
| Change a user's role | **SUPERADMIN** |
| Create / edit / delete admin accounts (`/admin`) | **SUPERADMIN** |
| Delete a credit pack | **SUPERADMIN** |
| Delete a community entry | **SUPERADMIN** |
| Delete a feedback message | **SUPERADMIN** |

## 4. Endpoints

### 4.1 Billing — the main screen

```
GET    /v1/admin/billing/overview
GET    /v1/admin/billing/plans
PATCH  /v1/admin/billing/plans/:id
GET    /v1/admin/billing/credit-packs
POST   /v1/admin/billing/credit-packs
PATCH  /v1/admin/billing/credit-packs/:id
DELETE /v1/admin/billing/credit-packs/:id        # SUPERADMIN
```

`overview` returns:

```jsonc
{
  "provider": "dodo",
  "mode": "test" | "live",
  "apiConfigured": true,      // false → static links only, cancel/portal off
  "webhookConfigured": false, // false → A PAYMENT CAN NEVER GRANT CREDITS
  "plans":       { "total": 7, "sellable": 6, "unconfigured": ["PRO/MONTHLY"] },
  "creditPacks": { "total": 4, "active": 4, "unconfigured": ["pack_240"] },
  "links":       { "live": 0, "test": 4, "mixed": false },
  "qualityCost": { "fast": 5, "balanced": 10, "studio": 20 },
  "tariff":      { "creditsPerMinute": 53, "qualityMultiplier": {...} }
}
```

Render this as a **status page at the top of the billing screen**, with
severity:

- `webhookConfigured: false` → **red, loudest thing on the page.** Copy:
  "Payments are accepted but no credits will be granted. Set
  `DODO_WEBHOOK_SECRET` on the API." This is the only failure that is invisible
  until a customer has already been charged.
- `plans.unconfigured` / `creditPacks.unconfigured` non-empty → amber, list them.
- `links.mixed: true` → amber: "Live mode is pointed at test checkout links."
- `mode: "test"` → a persistent badge. Never let test mode be a surprise.

**Plan row** (`GET .../plans`):

```jsonc
{
  "id": "clx…", "tier": "PRO", "cycle": "MONTHLY",
  "priceCents": 1900, "creditsGranted": 1200,
  "grantDays": 30, "grantsPerPeriod": 1,
  "dodoProductId": "pdt_…", "dodoLinkUrl": "https://checkout.dodopayments.com/buy/pdt_…",
  "active": true,
  "configured": true,          // false → cannot be bought
  "sellable": true,            // false for the FREE tier
  "creditsPerPeriod": 1200,    // creditsGranted × grantsPerPeriod
  "linkIsTestMode": false
}
```

`PATCH` body — **all fields optional, send only what changed**:

```jsonc
{
  "dodoProduct": "https://checkout.dodopayments.com/buy/pdt_abc",  // or just "pdt_abc"
  "priceCents": 1900, "creditsGranted": 1200,
  "grantDays": 30, "grantsPerPeriod": 1, "active": true
}
```

`dodoProduct` accepts **either** a bare product id **or** a full payment link —
the server derives the other half. `""` clears it (takes the plan off sale
without deactivating it). So the form field should be one text input labelled
"Dodo product id or payment link", with a hint that both work.

**Credit pack** (`slug`, `credits`, `priceCents`, `currency`, `popular`,
`sortOrder`, `active`, `dodoProductId`, `dodoLinkUrl`, `configured`,
`linkIsTestMode`). On create, `slug` is required and matches
`^[a-z0-9_-]{3,60}$`. **`slug` is permanent** — it travels in checkout metadata
and the webhook reads it back, so it is not editable after create. Make that
obvious in the UI. To retire a pack use `active: false`; only offer delete to a
SUPERADMIN, with a confirm that says a payment still in flight would arrive
with nothing to grant.

Errors to surface verbatim — they are written for the admin:

- `400` — unreadable product value.
- `409` — that Dodo product is already attached to another plan or pack.

### 4.2 Activity log

```
GET /v1/admin/logs           ?page &limit(≤200) &actorId &actorEmail &role
                             &action &method &targetType &targetId &targetLabel
                             &success &from &to &q
GET /v1/admin/logs/stats     ?bucket=second|minute|hour|day &from &to &action &actorId
GET /v1/admin/logs/actions   distinct action names — use for the filter dropdown
GET /v1/admin/logs/:id       one row, full redacted request detail
GET /v1/admin/logs/stream    Server-Sent Events, live
```

A row is **who did what to whom**:

```jsonc
{
  "id": "clx…", "createdAt": "2026-09-21T16:51:59.000Z",
  "actorId": 1, "actorEmail": "super@gmail.com", "actorRole": "SUPERADMIN",
  "action": "user.role.change",          // stable, never contains an id
  "method": "PATCH", "path": "/users/42",
  "statusCode": 200, "durationMs": 120, "success": true,
  "targetType": "user",                  // user|admin|plan|creditPack|language
  "targetId": "42",
  "targetLabel": "ada@example.com",      // the human one
  "summary": "Changed the role of ada@example.com",
  "meta": { "body": { "role": "ADMIN" } },   // secrets already [redacted]
  "ip": "…", "userAgent": "…"
}
```

Build it as a **feed**, not a raw table: `{actorEmail} — {summary}`, with time,
a red marker when `success: false`, and the row expanding to show `meta`.

- `action` filters by **prefix**: `action=billing` matches every `billing.*`.
- `q` searches summary, path, action, **and both the actor and target emails** —
  so one search box answers "everything about this person", both what they did
  and what was done to them.
- Give one-click filters: "failures only" (`success=false`), "this admin"
  (`actorId`), "this account" (`targetLabel`).

`stats` returns `{ from, to, bucket, total, counted, truncated, failed,
successRate, avgDurationMs, series: [{at,total,failed}], topActions, topActors }`.
Chart `series`; show `truncated: true` honestly as "showing the first 50 000
events" rather than implying the chart is the whole window.

⚠️ **SSE gotcha:** browser `EventSource` cannot set an `Authorization` header.
Either use a fetch-based SSE reader that can, or proxy the stream server-side
in the panel's own backend. Do not put the token in the query string. If live
streaming is awkward in your stack, poll `GET /admin/logs?limit=50` every few
seconds instead — say which you chose and why.

Reads of the log are not themselves logged, and nothing can edit or delete a
row. Do not build UI that implies otherwise.

### 4.3 Users

```
GET    /v1/users/all-users-data      ADMIN — every user, full records
GET    /v1/users/:id                 ADMIN (a USER may read only themselves)
PATCH  /v1/users/:id                 ADMIN
DELETE /v1/users/:id                 ADMIN
PATCH  /v1/users/:id/role            SUPERADMIN   body { role }
POST   /v1/users/create-user         public (registration)
```

`user`: `{ id, email, name, role, credits, freeDubUsed, dodoCustomerId,
createdAt, updatedAt }`.

There is **no pagination or search** on the users endpoint — it returns
everything. Paginate and filter client-side, and if the list is large say so
rather than pretending the API supports it.

### 4.4 Admin accounts (`Admin` table — separate from `User`)

```
GET/POST/PATCH/DELETE /v1/admin[/:id]     SUPERADMIN only, whole controller
```

⚠️ This is a **different table** from `User`. Panel login and roles run off
`User.role`; this `Admin` table is a separate records list. Label it clearly so
nobody thinks editing it changes who can sign in. **If it is not obviously
useful, ask before building a screen for it.**

### 4.5 Community (landing-page signups)

```
GET    /v1/community        ADMIN — list
GET    /v1/community/:id    ADMIN
PATCH  /v1/community/:id    ADMIN
DELETE /v1/community/:id    SUPERADMIN
```

### 4.6 Feedback (in-app messages) — build this as an inbox

```
POST   /v1/feedback         PUBLIC — the app's Home page posts here
GET    /v1/feedback         ADMIN — paginated list
GET    /v1/feedback/:id     ADMIN
PATCH  /v1/feedback/:id     ADMIN — triage only
DELETE /v1/feedback/:id     SUPERADMIN
```

**This is not the same thing as Community.** Community (§4.5) is a contact list:
a name and an email somebody left on the landing page. Feedback is a stream of
messages people wrote from inside the app, each of which needs reading and may
need answering. Do not merge the two screens.

A row:

```jsonc
{
  "id": 42,
  "userId": 7,                  // null when the sender was signed out
  "name": "Ada Lovelace",
  "email": "ada@example.com",   // snapshot — survives the account being deleted
  "subject": "Uzbek dub drifts out of sync",   // may be null
  "message": "The Uzbek voice starts fine but by minute three…",
  "kind": "BUG",                // GENERAL | BUG | FEATURE | PRICING | QUALITY
  "rating": 4,                  // 1-5, or null — it is optional on the form
  "status": "NEW",              // NEW | READ | IN_PROGRESS | RESOLVED | SPAM
  "adminNote": null,            // private staff note, never shown to the sender
  "pagePath": "/studio",        // where it was sent from
  "userAgent": "Mozilla/5.0 …",
  "createdAt": "2026-09-26T09:14:02.000Z",
  "updatedAt": "2026-09-26T09:14:02.000Z"
}
```

`GET /v1/feedback` takes `?page &limit(≤200) &status &kind &q` and returns:

```jsonc
{ "items": [...], "total": 214, "page": 1, "limit": 25, "pages": 9, "newCount": 6 }
```

`newCount` is the count of `status: "NEW"` across the **whole** table, not the
current filter — it is there so you can put an unread badge on the nav item
without it changing depending on which tab is open.

`q` searches the subject, the message body, the name and the email.

**`PATCH` accepts `status` and `adminNote` and nothing else.** The sender's words
are not editable, and the API rejects any other field with a `400` rather than
ignoring it. Build the row detail so this is obvious: the message is displayed,
not put in a textarea.

Notes for the UI:

- Default the list to `status=NEW`, and make `kind` a filter. A `BUG` sitting
  behind forty `GENERAL` messages is the failure mode to design against.
- `userId: null` means the sender had no session. Show that as "not signed in",
  not as a missing value — it is a real and expected state.
- `rating` is null on most rows. Do not render an empty five-star widget for
  those, and do not compute an "average rating" anywhere: the field is optional,
  so the average is over a self-selected subset and means nothing.
- `pagePath` and `userAgent` belong in the expanded row, next to the message, as
  diagnostics for a bug report. They are not analytics — do not chart them.
- `adminNote` must be visibly labelled private.
- Triage ends at `RESOLVED` or `SPAM`. **Delete is not part of triage** — offer
  it only to a SUPERADMIN, and only with a confirm that names the sender.
- The sender already got an automatic "we got it" email from the API. Do not
  build a reply feature that implies the panel can email them; replying happens
  in whatever mail client the staff member uses.

Every one of these writes shows up in the activity log (§4.2) as
`feedback.triage` / `feedback.delete`. The public `POST` is logged as
`feedback.create` with **no actor** when the sender was signed out — that is
correct, not a bug in the feed.

### 4.7 Read-only / not for the panel

- `GET /v1/languages` — **read-only, no write endpoints exist.** Display only;
  do not build an editor.
- `/v1/price-token` — **a scaffold stub that returns placeholder strings.** Not
  implemented. Ignore it entirely. Credit/token pricing lives in
  `/admin/billing/credit-packs`.
- `GET /v1/health` — pipeline + API status, fine for a header indicator.

## 5. Screens to build

1. **Login** — email + password, role gate, clear refusal for non-staff.
2. **Dashboard** — the billing `overview` status panel + recent activity +
   `stats` chart.
3. **Billing** — plans table (inline edit) and credit packs (CRUD). The primary
   job: paste a Dodo product link, save, see `configured` flip to true.
4. **Activity log** — the feed, filters, row detail, live updates.
5. **Users** — list, search, edit, role change (SUPERADMIN), delete.
6. **Community** — list, edit, delete.
7. **Feedback** — the inbox (§4.6). Default to unread, filter by kind, expand a
   row for the full message plus `pagePath`/`userAgent`, and move `status`. Put
   the `newCount` badge on the nav item.

## 6. How to behave

- **Do not modify the backend.** If something is missing, say so and stop.
  Do not add endpoints or change the schema.
- Money and credits are real. Confirm destructive actions (delete a user,
  delete a pack, change a role) with a dialog naming the exact target.
- Surface the API's error messages verbatim — they are written for this
  audience and say what to do next.
- Never put the API key, `DODO_WEBHOOK_SECRET`, or any secret in panel code or
  env. The panel only ever holds the base URL. Dodo secrets live on the API.
- Show, don't guess: every number on screen comes from the API. No hardcoded
  plan prices, credit counts, or tariffs.

## 7. Verify before you claim it works

Log in as a SUPERADMIN and confirm, with real requests:

1. Billing overview renders, and `webhookConfigured: false` is impossible to miss.
2. Pasting a product link into a plan flips `configured` to true, and pasting
   it into a second plan shows the `409`.
3. The activity log shows your own edits appearing, naming you as the actor and
   the plan/account as the target.
4. A reload keeps you signed in (the refresh flow works cross-origin).
5. Logging in as a plain `USER` is refused.
6. Feedback sent from the app's Home page appears in the inbox, and moving its
   status writes a `feedback.triage` row into the activity log.

State plainly which of these you actually ran.
