-- DeployCenter — add Task.rehearsalPlannedStart/End columns.
-- Separates rehearsal scheduling from production (real-night) plannedStart/plannedEnd,
-- so reschedule() for a rehearsal no longer overwrites the production schedule.
-- Idempotent: safe to re-run.

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "rehearsalPlannedStart" TIMESTAMP(3);
ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "rehearsalPlannedEnd"   TIMESTAMP(3);
