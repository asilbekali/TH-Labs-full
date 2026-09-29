-- Duration-based credit tariff + the free minute at registration.
--
-- 1. `freeDubUsed` is retired. The "one free dub of up to 120s" special case is
--    gone: a new account is simply given SIGNUP_BONUS_CREDITS (20 = one minute
--    at Balanced), and from then on the balance alone decides. One rule instead
--    of two overlapping ones.
--
-- 2. `credits` no longer defaults to 60. The balance is now funded by an
--    explicit SIGNUP_BONUS entry in CreditEntry written in the same transaction
--    as the account, so the cached balance and the ledger agree. A column
--    default gave every account credits that no ledger row accounted for.
--    Existing balances are untouched — only the default for NEW rows changes.
--
-- 3. Existing accounts get a backfilled SIGNUP_BONUS entry for whatever balance
--    they are already holding that the ledger does not explain, so
--    /payments/credits/reconcile stops reporting drift for every user created
--    before this migration.

ALTER TABLE "public"."User" ALTER COLUMN "credits" SET DEFAULT 0;

-- Backfill: one SIGNUP_BONUS row per user whose cached balance exceeds the sum
-- of their ledger entries. Idempotent by construction — after it runs the
-- difference is zero, so a re-run inserts nothing.
INSERT INTO "public"."CreditEntry" ("id", "userId", "delta", "balance", "reason", "note", "createdAt")
SELECT
  -- Deterministic id rather than gen_random_uuid(): it needs no extension, and
  -- the primary key itself then blocks a second backfill row per user.
  'signup_backfill_' || u."id"::text,
  u."id",
  u."credits" - COALESCE(l."net", 0),
  u."credits",
  'SIGNUP_BONUS'::"public"."CreditReason",
  'backfilled welcome bonus (pre-existing balance)',
  u."createdAt"
FROM "public"."User" u
LEFT JOIN (
  SELECT "userId", SUM("delta")::int AS "net"
  FROM "public"."CreditEntry"
  GROUP BY "userId"
) l ON l."userId" = u."id"
WHERE u."credits" - COALESCE(l."net", 0) > 0;

ALTER TABLE "public"."User" DROP COLUMN "freeDubUsed";
