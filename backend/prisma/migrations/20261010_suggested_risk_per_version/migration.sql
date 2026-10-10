-- AI risk suggestions are decided per version (2026-10-10)
-- CreateTable
CREATE TABLE "SuggestedRiskDecision" (
    "id" TEXT NOT NULL,
    "suggestedRiskId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" "SuggestedRiskStatus" NOT NULL,
    "promotedRiskId" TEXT,
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SuggestedRiskDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SuggestedRiskDecision_suggestedRiskId_versionId_key" ON "SuggestedRiskDecision"("suggestedRiskId", "versionId");

-- AddForeignKey
ALTER TABLE "SuggestedRiskDecision" ADD CONSTRAINT "SuggestedRiskDecision_suggestedRiskId_fkey" FOREIGN KEY ("suggestedRiskId") REFERENCES "SuggestedRisk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SuggestedRiskDecision" ADD CONSTRAINT "SuggestedRiskDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: every suggestion already moved into a version keeps that decision
-- for THAT version only, and becomes open again for every other version.
INSERT INTO "SuggestedRiskDecision" ("id", "suggestedRiskId", "versionId", "status", "promotedRiskId", "createdAt")
SELECT s."id" || ':' || r."versionId", s."id", r."versionId", 'PROMOTED', r."id", s."updatedAt"
FROM "SuggestedRisk" s
JOIN "ReleaseRisk" r ON r."id" = s."promotedRiskId"
WHERE s."status" = 'PROMOTED';

UPDATE "SuggestedRisk" SET "status" = 'PENDING', "promotedRiskId" = NULL WHERE "status" = 'PROMOTED';
