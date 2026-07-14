-- CreateTable
CREATE TABLE "KpiDefinition" (
    "id" TEXT NOT NULL,
    "kpiOrder" INTEGER NOT NULL,
    "kpiName" TEXT NOT NULL,
    "kpiType" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "measuredEntity" TEXT NOT NULL,
    "purpose" TEXT,
    "description" TEXT,
    "dataSource" TEXT,
    "measurementPeriod" TEXT,
    "trend" TEXT,
    "comments" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KpiDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseKpiScore" (
    "id" TEXT NOT NULL,
    "releaseName" TEXT NOT NULL,
    "kpiName" TEXT NOT NULL,
    "target" DOUBLE PRECISION NOT NULL,
    "grade" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL,
    "relativeScore" DOUBLE PRECISION,
    "calcScore" DOUBLE PRECISION,
    "allCount" DOUBLE PRECISION,
    "showStopper" DOUBLE PRECISION,
    "severe" DOUBLE PRECISION,
    "medium" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseKpiScore_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KpiDefinition_kpiName_key" ON "KpiDefinition"("kpiName");

-- CreateIndex
CREATE INDEX "ReleaseKpiScore_releaseName_idx" ON "ReleaseKpiScore"("releaseName");

-- CreateIndex
CREATE INDEX "ReleaseKpiScore_kpiName_idx" ON "ReleaseKpiScore"("kpiName");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseKpiScore_releaseName_kpiName_key" ON "ReleaseKpiScore"("releaseName", "kpiName");
