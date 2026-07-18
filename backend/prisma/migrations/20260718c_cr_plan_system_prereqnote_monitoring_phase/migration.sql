-- CrPlan: free-text note alongside prerequisite chips.
-- CrPlanAction: which system/app the action applies to; drop before/after —
-- a dependency on an existing task is always "must complete first".
-- CrPlanMonitoringPoint: explicit phase (monitoring can happen in any phase,
-- not just morning-after).

ALTER TABLE "CrPlan"
  ADD COLUMN "prerequisitesNote" TEXT;

ALTER TABLE "CrPlanAction"
  ADD COLUMN "system" TEXT,
  DROP COLUMN "dependencyRelation";

ALTER TABLE "CrPlanMonitoringPoint"
  ADD COLUMN "phase" INTEGER NOT NULL DEFAULT 4;
