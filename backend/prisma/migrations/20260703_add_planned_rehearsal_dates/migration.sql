-- DeployCenter — add Version.plannedRehearsalStart/End columns.
-- Idempotent: safe to re-run.

ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "plannedRehearsalStart" TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "plannedRehearsalEnd"   TIMESTAMP(3);
