-- DropTable
DROP TABLE "KpiImprovementItem";

-- CreateTable
CREATE TABLE "KpiProblemNote" (
    "id" TEXT NOT NULL,
    "releaseName" TEXT NOT NULL,
    "kpiName" TEXT NOT NULL,
    "problemCharacteristics" TEXT,
    "defectCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiProblemNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KpiImprovementTask" (
    "id" TEXT NOT NULL,
    "releaseName" TEXT NOT NULL,
    "kpiName" TEXT NOT NULL,
    "requiredImprovement" TEXT,
    "mainDevelopments" TEXT,
    "responsibility" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiImprovementTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KpiProblemNote_releaseName_kpiName_idx" ON "KpiProblemNote"("releaseName", "kpiName");

-- CreateIndex
CREATE INDEX "KpiImprovementTask_releaseName_kpiName_idx" ON "KpiImprovementTask"("releaseName", "kpiName");

-- CreateIndex
CREATE INDEX "KpiImprovementTask_status_idx" ON "KpiImprovementTask"("status");

