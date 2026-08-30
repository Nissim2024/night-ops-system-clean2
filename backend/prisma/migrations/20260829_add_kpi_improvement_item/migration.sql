-- CreateTable
CREATE TABLE "KpiImprovementItem" (
    "id" TEXT NOT NULL,
    "releaseName" TEXT NOT NULL,
    "kpiName" TEXT NOT NULL,
    "responsibility" TEXT,
    "requiredImprovement" TEXT,
    "problemCharacteristics" TEXT,
    "mainDevelopments" TEXT,
    "defectCount" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiImprovementItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KpiImprovementItem_releaseName_kpiName_idx" ON "KpiImprovementItem"("releaseName", "kpiName");

-- CreateIndex
CREATE INDEX "KpiImprovementItem_status_idx" ON "KpiImprovementItem"("status");

