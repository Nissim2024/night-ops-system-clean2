-- AlterTable
ALTER TABLE "Version" DROP COLUMN "homeNotice",
DROP COLUMN "homeNoticeUpdatedAt";

-- AlterTable
ALTER TABLE "VersionCrAssignment" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedReason" TEXT,
ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VersionNotice" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "urgency" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VersionNotice_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VersionNotice" ADD CONSTRAINT "VersionNotice_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VersionNotice" ADD CONSTRAINT "VersionNotice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

