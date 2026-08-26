-- AlterTable
ALTER TABLE "CrPlanAction" ADD COLUMN     "sourceDefectId" TEXT;

-- AlterTable
ALTER TABLE "TargetCrDefect" DROP COLUMN "derivedMonitoringPointId",
DROP COLUMN "implementationReason";

-- CreateTable
CREATE TABLE "RehearsalRunArchive" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "runNumber" INTEGER NOT NULL,
    "ranAt" TIMESTAMP(3),
    "tasksSnapshot" JSONB,
    "headline" TEXT,
    "morningNotes" TEXT,
    "crData" JSONB,
    "sentAt" TIMESTAMP(3),
    "sentBy" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RehearsalRunArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RehearsalRunArchive_versionId_runNumber_key" ON "RehearsalRunArchive"("versionId", "runNumber");

-- AddForeignKey
ALTER TABLE "RehearsalRunArchive" ADD CONSTRAINT "RehearsalRunArchive_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

