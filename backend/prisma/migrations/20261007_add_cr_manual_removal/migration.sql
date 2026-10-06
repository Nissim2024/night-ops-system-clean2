-- AlterTable
ALTER TABLE "VersionCrAssignment" ADD COLUMN     "manuallyRemoved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "removedReason" TEXT,
ADD COLUMN     "removedBy" TEXT,
ADD COLUMN     "removedAt" TIMESTAMP(3),
ADD COLUMN     "removedDefectCount" INTEGER;
