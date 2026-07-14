-- CreateEnum
CREATE TYPE "RiskStatus" AS ENUM ('OPEN', 'MITIGATED', 'CLOSED');

-- CreateTable
CREATE TABLE "ReleaseRisk" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "impact" TEXT,
    "probability" TEXT,
    "owner" TEXT,
    "mitigation" TEXT,
    "status" "RiskStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReleaseRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseInsight" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "message" TEXT NOT NULL,
    "recommendation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseInsight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseHealth" (
    "versionId" TEXT NOT NULL,
    "healthScore" INTEGER NOT NULL,
    "coverageScore" INTEGER NOT NULL,
    "qualityScore" INTEGER NOT NULL,
    "riskScore" INTEGER NOT NULL,
    "forecastScore" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseHealth_pkey" PRIMARY KEY ("versionId")
);

-- CreateTable
CREATE TABLE "ReleaseForecast" (
    "versionId" TEXT NOT NULL,
    "calculatedDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "remainingTests" INTEGER NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL,
    "forecastDate" TIMESTAMP(3),
    "status" TEXT NOT NULL,

    CONSTRAINT "ReleaseForecast_pkey" PRIMARY KEY ("versionId")
);

-- AddForeignKey
ALTER TABLE "ReleaseRisk" ADD CONSTRAINT "ReleaseRisk_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseRisk" ADD CONSTRAINT "ReleaseRisk_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseInsight" ADD CONSTRAINT "ReleaseInsight_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseHealth" ADD CONSTRAINT "ReleaseHealth_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseForecast" ADD CONSTRAINT "ReleaseForecast_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
