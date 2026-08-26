-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('NEW', 'ANALYZING', 'RCA_DONE', 'CLOSED');

-- CreateEnum
CREATE TYPE "RcaMethod" AS ENUM ('FIVE_WHY', 'FISHBONE', 'AI');

-- CreateEnum
CREATE TYPE "ActionTeam" AS ENUM ('REQUIREMENTS', 'SPEC', 'DEV', 'QA', 'OPS');

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'DONE', 'OVERDUE');

-- CreateTable
CREATE TABLE "IncidentGroup" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "qcDefectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "expectedVersion" TEXT,
    "actualVersion" TEXT,
    "severity" "Priority",
    "status" "IncidentStatus" NOT NULL DEFAULT 'NEW',
    "assignedToName" TEXT,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentEvidence" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rca" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "method" "RcaMethod" NOT NULL,
    "category" TEXT,
    "rootCause" TEXT,
    "lessonsReq" TEXT,
    "lessonsSpec" TEXT,
    "lessonsDev" TEXT,
    "lessonsQa" TEXT,
    "lessonsOps" TEXT,
    "aiConfidence" DOUBLE PRECISION,
    "aiRawResponse" JSONB,
    "createdByName" TEXT NOT NULL,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rca_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RcaAnswer" (
    "id" TEXT NOT NULL,
    "rcaId" TEXT NOT NULL,
    "step" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RcaAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionItem" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "team" "ActionTeam" NOT NULL,
    "ownerName" TEXT,
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "priority" "Priority" NOT NULL DEFAULT 'MEDIUM',
    "status" "ActionStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActionItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Incident_versionId_idx" ON "Incident"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "Incident_versionId_qcDefectId_key" ON "Incident"("versionId", "qcDefectId");

-- CreateIndex
CREATE UNIQUE INDEX "Rca_incidentId_key" ON "Rca"("incidentId");

-- CreateIndex
CREATE INDEX "ActionItem_incidentId_idx" ON "ActionItem"("incidentId");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "Version"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "IncidentGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentEvidence" ADD CONSTRAINT "IncidentEvidence_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rca" ADD CONSTRAINT "Rca_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RcaAnswer" ADD CONSTRAINT "RcaAnswer_rcaId_fkey" FOREIGN KEY ("rcaId") REFERENCES "Rca"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionItem" ADD CONSTRAINT "ActionItem_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

