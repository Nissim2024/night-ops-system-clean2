-- CrPlanAction: estimated duration + dependency on a real framework Task (instead of
-- free text only). CrPlanMonitoringPoint: team/employee assignment + auto-derivation
-- tracking, mirroring CrPlanAction.

ALTER TABLE "CrPlanAction"
  ADD COLUMN "estimatedMins"      INTEGER,
  ADD COLUMN "dependsOnTaskId"    TEXT,
  ADD COLUMN "dependencyRelation" TEXT DEFAULT 'AFTER';

ALTER TABLE "CrPlanMonitoringPoint"
  ADD COLUMN "assignedTeamId"    TEXT,
  ADD COLUMN "assignedUserName"  TEXT,
  ADD COLUMN "derivedProposalId" TEXT;
