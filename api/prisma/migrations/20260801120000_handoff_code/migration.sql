-- CreateTable
CREATE TABLE "public"."HandoffCode" (
    "id" SERIAL NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandoffCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HandoffCode_codeHash_key" ON "public"."HandoffCode"("codeHash");

-- CreateIndex
CREATE INDEX "HandoffCode_expiresAt_idx" ON "public"."HandoffCode"("expiresAt");

-- CreateIndex
CREATE INDEX "HandoffCode_userId_idx" ON "public"."HandoffCode"("userId");

-- AddForeignKey
ALTER TABLE "public"."HandoffCode" ADD CONSTRAINT "HandoffCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
