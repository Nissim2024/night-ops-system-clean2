-- A manual risk may name the CR it is about (CR card, 2026-10-10)
ALTER TABLE "ReleaseRisk" ADD COLUMN "crNumber" TEXT;
CREATE INDEX "ReleaseRisk_versionId_crNumber_idx" ON "ReleaseRisk"("versionId", "crNumber");
