-- Record WHO an action was done TO, not just who did it.
--
-- `resource` held a `type:id` string, which answered "which row" but not
-- "which account" — an admin panel showing "changed the role of user 42" is
-- not much better than showing nothing. It is replaced by a resolved target:
-- the type, the id, and a human label (email, tier/cycle, pack slug) copied in
-- at write time so the trail stays true after a rename or a deletion.

ALTER TABLE "public"."AuditLog" DROP COLUMN "resource";
ALTER TABLE "public"."AuditLog" ADD COLUMN "targetType" TEXT;
ALTER TABLE "public"."AuditLog" ADD COLUMN "targetId" TEXT;
ALTER TABLE "public"."AuditLog" ADD COLUMN "targetLabel" TEXT;

CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx"
  ON "public"."AuditLog"("targetType", "targetId", "createdAt");
