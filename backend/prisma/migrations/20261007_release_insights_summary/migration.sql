-- AlterTable
ALTER TABLE "ReleaseInsight" ADD COLUMN     "level" TEXT,
ADD COLUMN     "linkType" TEXT,
ADD COLUMN     "linkValue" TEXT;

-- CreateTable
CREATE TABLE "ReleaseInsightHide" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "insightKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "hiddenBy" TEXT,
    "levelAtHide" TEXT NOT NULL,
    "hiddenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseInsightHide_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseInsightHide_versionId_insightKey_key" ON "ReleaseInsightHide"("versionId", "insightKey");

-- AddForeignKey
ALTER TABLE "ReleaseInsightHide" ADD CONSTRAINT "ReleaseInsightHide_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
