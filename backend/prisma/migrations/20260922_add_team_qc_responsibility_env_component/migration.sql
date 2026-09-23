-- AlterTable
-- Real QC "Responsibility" (BG_USER_03) value and Environment Component
-- value(s) this DeployCenter team maps to, for the redesigned create-defect
-- form's Responsibility/Environment Component cascades (project memory
-- project-defect-create-form-redesign-2026-09-22). Same manual-mapping
-- precedent as qcGroupName above — QC's vocabulary doesn't line up 1:1 with
-- our team names. Null/empty until an admin configures it.
ALTER TABLE "Team" ADD COLUMN "qcResponsibilityValue" TEXT;
ALTER TABLE "Team" ADD COLUMN "qcEnvironmentComponents" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
