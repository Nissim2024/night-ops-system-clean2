-- VersionCrAssignment: QA-lead classification/prioritization fields — a "core"
-- classification independent from isStandAlone, a priority-test date for CRs
-- going live before/outside this version's scope, a free-text note, and an
-- urgent flag for home-dashboard follow-up.

ALTER TABLE "VersionCrAssignment"
  ADD COLUMN "isCore" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "priorityTestDate" TIMESTAMP(3),
  ADD COLUMN "notes" TEXT,
  ADD COLUMN "urgent" BOOLEAN NOT NULL DEFAULT false;
