-- Last editor of plans / risks / QA plan — the "updated meanwhile" warning names them (2026-10-10)
-- AlterTable
ALTER TABLE "CrPlan" ADD COLUMN     "updatedByName" TEXT;

-- AlterTable
ALTER TABLE "QaAssignment" ADD COLUMN     "updatedByName" TEXT;

-- AlterTable
ALTER TABLE "QaWorkPlan" ADD COLUMN     "updatedByName" TEXT;

-- AlterTable
ALTER TABLE "QaCycle" ADD COLUMN     "updatedByName" TEXT;

-- AlterTable
ALTER TABLE "ReleaseRisk" ADD COLUMN     "updatedByName" TEXT;

