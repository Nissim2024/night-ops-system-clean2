-- Structured CR team-plan submission form (exception-first spec, 2026-07-17)

ALTER TABLE "CrPlan"
  ADD COLUMN "gateAnswered"      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "changeTypes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "prerequisites"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "nightTestNeeded"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextDayTestNeeded" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nextDayTestNotes"  TEXT,
  ADD COLUMN "rollbackType"      TEXT;

ALTER TABLE "CrDependency"
  ADD COLUMN "note" TEXT;

CREATE TABLE "CrPlanAction" (
  "id"             TEXT NOT NULL,
  "crPlanId"       TEXT NOT NULL,
  "actionType"     TEXT NOT NULL,
  "description"    TEXT NOT NULL,
  "anchor"         TEXT NOT NULL DEFAULT 'RELEASE_NIGHT',
  "dependencyNote" TEXT,
  "ownerName"      TEXT,
  "orderIndex"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrPlanAction_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CrPlanMonitoringPoint" (
  "id"         TEXT NOT NULL,
  "crPlanId"   TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "name"       TEXT NOT NULL,
  "note"       TEXT,
  "orderIndex" INTEGER NOT NULL DEFAULT 0,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "CrPlanMonitoringPoint_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "CrPlanAction"
  ADD CONSTRAINT "CrPlanAction_crPlanId_fkey"
  FOREIGN KEY ("crPlanId") REFERENCES "CrPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CrPlanMonitoringPoint"
  ADD CONSTRAINT "CrPlanMonitoringPoint_crPlanId_fkey"
  FOREIGN KEY ("crPlanId") REFERENCES "CrPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
