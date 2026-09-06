-- CreateEnum
CREATE TYPE "SuggestedRiskStatus" AS ENUM ('PENDING', 'PROMOTED', 'REJECTED');

-- CreateTable
CREATE TABLE "SuggestedRisk" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceArea" TEXT NOT NULL,
    "signal" TEXT NOT NULL,
    "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "probability" TEXT,
    "impact" TEXT,
    "mitigation" TEXT,
    "status" "SuggestedRiskStatus" NOT NULL DEFAULT 'PENDING',
    "promotedRiskId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuggestedRisk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestedRisk_key_key" ON "SuggestedRisk"("key");

-- AlterTable: per-CR execution counts for the next day's "done today" delta
ALTER TABLE "DailyQaSnapshot" ADD COLUMN     "crProgress" JSONB;
