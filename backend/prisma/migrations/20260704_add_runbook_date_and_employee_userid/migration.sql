-- DeployCenter — add RunbookEntry.runDate + employeeUserId.
-- RunbookEntry previously stored only "HH:MM" strings for startTime/endTime with
-- no day attached, so nothing could reliably know when a step actually falls
-- (needed for scheduled notifications and "today/tomorrow" surfacing on Home).
-- employeeUserId lets notifications target the assigned employee reliably instead
-- of matching on the free-text employee name string.
-- Idempotent: safe to re-run.

ALTER TABLE "RunbookEntry" ADD COLUMN IF NOT EXISTS "runDate"        TIMESTAMP(3);
ALTER TABLE "RunbookEntry" ADD COLUMN IF NOT EXISTS "employeeUserId" TEXT;
