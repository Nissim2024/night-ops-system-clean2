-- AlterTable
ALTER TABLE "ReleaseInsight" ADD COLUMN     "createdBy" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'AUTO',
ADD COLUMN     "title" TEXT;
