-- Daily QA Management redesign (schema shipped in code without a migration —
-- dev was brought up via `prisma db push`; this back-fills the migration so
-- `prisma migrate deploy` builds the same tables in test/prod).

-- CreateEnum
CREATE TYPE "BlockerType" AS ENUM ('ENVIRONMENT', 'DATA', 'DEVELOPMENT', 'INTEGRATION', 'INFRASTRUCTURE', 'PERMISSIONS', 'THIRD_PARTY', 'BUSINESS_REQUIREMENT', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "BlockerStatus" AS ENUM ('OPEN', 'RESOLVED');

-- CreateEnum
CREATE TYPE "DailyActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'WAITING', 'DONE', 'CANCELED');

-- CreateTable
CREATE TABLE "DailyBlocker" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "BlockerType" NOT NULL,
    "crNumber" TEXT,
    "ownerName" TEXT,
    "status" "BlockerStatus" NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyBlocker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyActionItem" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ownerName" TEXT,
    "dueAt" TIMESTAMP(3),
    "status" "DailyActionStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DailyActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyQaSnapshot" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL,
    "testProgressPct" INTEGER NOT NULL,
    "passed" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "blocked" INTEGER NOT NULL,
    "openDefects" INTEGER NOT NULL,
    "criticalDefects" INTEGER NOT NULL,
    "openBlockers" INTEGER NOT NULL,
    "crsAtRisk" INTEGER NOT NULL,
    "testersNoProgress" INTEGER NOT NULL,
    "crRisk" JSONB NOT NULL,
    "testerProgress" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyQaSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyBlocker_versionId_idx" ON "DailyBlocker"("versionId");

-- CreateIndex
CREATE INDEX "DailyActionItem_versionId_idx" ON "DailyActionItem"("versionId");

-- CreateIndex
CREATE INDEX "DailyQaSnapshot_versionId_idx" ON "DailyQaSnapshot"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "DailyQaSnapshot_versionId_snapshotDate_key" ON "DailyQaSnapshot"("versionId", "snapshotDate");

-- AddForeignKey
ALTER TABLE "DailyBlocker" ADD CONSTRAINT "DailyBlocker_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyBlocker" ADD CONSTRAINT "DailyBlocker_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyActionItem" ADD CONSTRAINT "DailyActionItem_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyActionItem" ADD CONSTRAINT "DailyActionItem_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyQaSnapshot" ADD CONSTRAINT "DailyQaSnapshot_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
