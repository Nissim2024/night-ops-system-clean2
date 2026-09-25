-- AlterTable
ALTER TABLE "VersionCrAssignment" ADD COLUMN     "sourceStatus" TEXT;

-- CreateTable
-- Persisted change log written by VersionCrAssignmentsService.syncApply() —
-- one row per detected diff each time the CR_LIST sync runs. See the
-- CrChangeEvent model comment in schema.prisma.
CREATE TABLE "CrChangeEvent" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "crLabel" TEXT,
    "teamId" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "oldValue" TEXT,
    "newValue" TEXT,
    "reason" TEXT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceSyncedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CrChangeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrChangeEvent_versionId_detectedAt_idx" ON "CrChangeEvent"("versionId", "detectedAt");

-- CreateIndex
CREATE INDEX "CrChangeEvent_versionId_crNumber_idx" ON "CrChangeEvent"("versionId", "crNumber");

-- AddForeignKey
ALTER TABLE "CrChangeEvent" ADD CONSTRAINT "CrChangeEvent_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrChangeEvent" ADD CONSTRAINT "CrChangeEvent_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
