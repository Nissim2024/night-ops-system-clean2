-- DeployCenter — add BlockSeverity enum + Task.blockedSeverity column.
-- Idempotent: safe to re-run.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'BlockSeverity') THEN
    CREATE TYPE "BlockSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
  END IF;
END $$;

ALTER TABLE "Task" ADD COLUMN IF NOT EXISTS "blockedSeverity" "BlockSeverity";
