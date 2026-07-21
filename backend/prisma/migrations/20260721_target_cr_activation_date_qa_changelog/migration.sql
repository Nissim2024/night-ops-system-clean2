-- AlterTable
ALTER TABLE "CrPlan" ADD COLUMN     "activationDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VersionCrAssignment" ADD COLUMN     "alreadyInProduction" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "TargetCrReview" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "crNumber" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "gateChecklist1" BOOLEAN NOT NULL DEFAULT false,
    "gateChecklist2" BOOLEAN NOT NULL DEFAULT false,
    "gateChecklist3" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedByName" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetCrReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TargetCrDefect" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "defectId" TEXT NOT NULL,
    "description" TEXT,
    "requiresSpecialImplementation" BOOLEAN NOT NULL DEFAULT false,
    "implementationReason" TEXT,
    "importantToManagement" BOOLEAN NOT NULL DEFAULT false,
    "derivedActionId" TEXT,
    "derivedMonitoringPointId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetCrDefect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QaWorkPlanChangeLog" (
    "id" TEXT NOT NULL,
    "workPlanId" TEXT NOT NULL,
    "qaCycleTaskId" TEXT,
    "action" TEXT NOT NULL,
    "crNumber" TEXT,
    "userEmail" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QaWorkPlanChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TargetCrReview_versionId_crNumber_teamId_key" ON "TargetCrReview"("versionId", "crNumber", "teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TargetCrDefect_reviewId_defectId_key" ON "TargetCrDefect"("reviewId", "defectId");

-- AddForeignKey
ALTER TABLE "TargetCrDefect" ADD CONSTRAINT "TargetCrDefect_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "TargetCrReview"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QaWorkPlanChangeLog" ADD CONSTRAINT "QaWorkPlanChangeLog_workPlanId_fkey" FOREIGN KEY ("workPlanId") REFERENCES "QaWorkPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

