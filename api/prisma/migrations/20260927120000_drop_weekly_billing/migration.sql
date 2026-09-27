-- Weekly billing is retired. The two weekly rows (PRO and STUDIO) were never
-- sellable — neither ever had a Dodo product id — and the pricing page stopped
-- offering the cycle, so the catalog is now FREE + PRO/STUDIO × monthly/yearly.

-- Any subscription still pointing at a weekly plan would block the delete
-- below; there are none, and the FK would raise rather than cascade if that
-- ever changed.
DELETE FROM "Plan" WHERE "cycle" = 'WEEKLY';

-- Postgres cannot drop a value from an enum in place, so the type is rebuilt.
ALTER TYPE "BillingCycle" RENAME TO "BillingCycle_old";
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'YEARLY');
ALTER TABLE "Plan"
  ALTER COLUMN "cycle" TYPE "BillingCycle" USING ("cycle"::text::"BillingCycle");
DROP TYPE "BillingCycle_old";
