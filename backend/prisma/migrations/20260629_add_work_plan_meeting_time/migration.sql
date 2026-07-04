-- DeployCenter 2.7.1 — Comprehensive schema catch-up migration
-- Adds ALL columns that exist in schema.prisma but were absent from 0_init.
-- Every statement uses IF NOT EXISTS / DO $$ so it is safe to re-run.

-- ── Version table ─────────────────────────────────────────────────────────────
-- These 7 columns were added to schema.prisma after the initial migration.

ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "workPlanMeetingTime"  TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "integrationStart"      TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "integrationEnd"        TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "qaStart"               TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "qaEnd"                 TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "submissionDeadline"    TIMESTAMP(3);
ALTER TABLE "Version" ADD COLUMN IF NOT EXISTS "approvalDeadline"      TIMESTAMP(3);

-- ── VersionCrAssignment table ─────────────────────────────────────────────────
-- estimateDays, teamEstimateDays, hasActual added after 0_init.
-- syncStatus is handled separately in 20260620_add_cr_sync_status.

ALTER TABLE "VersionCrAssignment" ADD COLUMN IF NOT EXISTS "estimateDays"     DOUBLE PRECISION;
ALTER TABLE "VersionCrAssignment" ADD COLUMN IF NOT EXISTS "teamEstimateDays" DOUBLE PRECISION;
ALTER TABLE "VersionCrAssignment" ADD COLUMN IF NOT EXISTS "hasActual"        BOOLEAN;

-- ── QaAssignment table ────────────────────────────────────────────────────────
-- secondaryTesterId and secondarySkillLevel added after 0_init.

ALTER TABLE "QaAssignment" ADD COLUMN IF NOT EXISTS "secondaryTesterId"   TEXT;
ALTER TABLE "QaAssignment" ADD COLUMN IF NOT EXISTS "secondarySkillLevel" INTEGER DEFAULT 3;

-- Foreign key: QaAssignment.secondaryTesterId → User.id
-- Only add if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'QaAssignment_secondaryTesterId_fkey'
      AND table_name = 'QaAssignment'
  ) THEN
    ALTER TABLE "QaAssignment"
      ADD CONSTRAINT "QaAssignment_secondaryTesterId_fkey"
      FOREIGN KEY ("secondaryTesterId")
      REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
