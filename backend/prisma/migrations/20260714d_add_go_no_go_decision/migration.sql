-- CreateTable
CREATE TABLE "GoNoGoDecision" (
    "versionId" TEXT NOT NULL,
    "systemRecommendation" TEXT NOT NULL,
    "qaManagerStatus" TEXT,
    "qaManagerBy" TEXT,
    "qaManagerAt" TIMESTAMP(3),
    "releaseManagerStatus" TEXT,
    "releaseManagerBy" TEXT,
    "releaseManagerAt" TIMESTAMP(3),
    "managementStatus" TEXT,
    "managementBy" TEXT,
    "managementAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GoNoGoDecision_pkey" PRIMARY KEY ("versionId")
);

-- AddForeignKey
ALTER TABLE "GoNoGoDecision" ADD CONSTRAINT "GoNoGoDecision_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;
