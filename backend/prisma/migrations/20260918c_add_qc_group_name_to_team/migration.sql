-- AlterTable
-- Real QC group name this DeployCenter team maps to, for the workflow
-- status-transition lookup (docs/spec-defects-module.md §4, project memory
-- project-qc-workflow-transitions-2026-09-18). Null until an admin
-- configures it.
ALTER TABLE "Team" ADD COLUMN "qcGroupName" TEXT;
