-- AlterTable
ALTER TABLE "ActionItem" DROP COLUMN "team",
ADD COLUMN     "team" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Rca" DROP COLUMN "lessonsDev",
DROP COLUMN "lessonsOps",
DROP COLUMN "lessonsQa",
DROP COLUMN "lessonsReq",
DROP COLUMN "lessonsSpec";

-- DropEnum
DROP TYPE "ActionTeam";

-- CreateTable
CREATE TABLE "RcaLesson" (
    "id" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "teamId" TEXT,
    "teamName" TEXT NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "RcaLesson_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RcaLesson_rcaId_idx" ON "RcaLesson"("rcaId");

-- AddForeignKey
ALTER TABLE "RcaLesson" ADD CONSTRAINT "RcaLesson_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "Rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

