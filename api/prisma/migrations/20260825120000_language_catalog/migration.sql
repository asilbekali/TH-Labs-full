-- The language catalog moves into the account API's database.
--
-- It previously existed only as a Python list inside the dubbing pipeline, so
-- GET /api/languages returned 502 whenever that box was unreachable and the
-- Studio fell back to a shortened hardcoded copy. Rows here are served by
-- GET /v1/languages, which is up whenever this API is.
--
-- The table is populated by prisma/seed.ts (seedLanguages), which upserts on
-- `code` and is safe to re-run.

-- CreateTable
CREATE TABLE "public"."Language" (
    "id" SERIAL NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "native" TEXT NOT NULL,
    "flag" TEXT NOT NULL,
    "whisper" TEXT NOT NULL,
    "nllb" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Language_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Language_code_key" ON "public"."Language"("code");

-- CreateIndex
CREATE INDEX "Language_active_sortOrder_idx" ON "public"."Language"("active", "sortOrder");
