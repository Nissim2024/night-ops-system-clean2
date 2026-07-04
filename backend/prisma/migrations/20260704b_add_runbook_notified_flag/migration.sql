-- DeployCenter — add RunbookEntry.notified15MinAt.
-- Marks whether the "starts in ~15 minutes" scheduled notification has already
-- fired for a step, so the cron job never sends it twice.
-- Idempotent: safe to re-run.

ALTER TABLE "RunbookEntry" ADD COLUMN IF NOT EXISTS "notified15MinAt" TIMESTAMP(3);
