-- Yearly plans are billed once but their credits are dripped one month at a
-- time. Before this, nothing bounded the drip: the cron granted every
-- `grantDays` for as long as the period was open, so a 365-day period paid out
-- 13 allocations instead of 12. These two columns make the bound explicit.

-- How many allocations one paid period is worth (1 weekly/monthly, 12 yearly).
ALTER TABLE "Plan" ADD COLUMN "grantsPerPeriod" INTEGER NOT NULL DEFAULT 1;

-- How many of them the current period has already handed out.
ALTER TABLE "Subscription" ADD COLUMN "grantsIssued" INTEGER NOT NULL DEFAULT 0;

-- Existing rows: anything that has granted at least once has used one
-- allocation. Leaving these at 0 would hand active subscribers a free extra
-- month of credits on the next cron tick.
UPDATE "Subscription" SET "grantsIssued" = 1 WHERE "lastGrantAt" IS NOT NULL;

-- Yearly plans drip twelve times; the seed sets this too, but deployments that
-- run migrations without re-seeding still need it.
UPDATE "Plan" SET "grantsPerPeriod" = 12 WHERE "cycle" = 'YEARLY';
