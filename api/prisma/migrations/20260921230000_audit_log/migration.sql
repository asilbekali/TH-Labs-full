-- Append-only activity log, so ADMIN/SUPERADMIN can see who did what and when
-- from the admin panel instead of reading server logs.

CREATE TABLE "public"."AuditLog" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" INTEGER,
    "actorEmail" TEXT,
    "actorRole" "public"."Role",
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "success" BOOLEAN NOT NULL,
    "resource" TEXT,
    "summary" TEXT,
    "meta" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- The feed is always "newest first, optionally filtered", so every index
-- leads with its filter column and ends on createdAt.
CREATE INDEX "AuditLog_createdAt_idx" ON "public"."AuditLog"("createdAt");
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "public"."AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "public"."AuditLog"("action", "createdAt");
CREATE INDEX "AuditLog_success_createdAt_idx" ON "public"."AuditLog"("success", "createdAt");

-- No foreign key to User on purpose: deleting a user must not delete the
-- record of what they did. actorEmail/actorRole are copied in at write time.
