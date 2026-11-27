-- The real-time wallet counts time, not tokens: packs sell 10/30/60 minutes
-- outright and a session takes the seconds it was granted. Renames only; no
-- data is converted (no account held a real-time balance when this was made).

-- AlterTable
ALTER TABLE "public"."User" RENAME COLUMN "realtimeCredits" TO "realtimeSeconds";

-- AlterTable
ALTER TABLE "public"."RealtimeSession" RENAME COLUMN "chargedCredits" TO "chargedSeconds";
