-- Soft-delete tombstone for CrPlan — a team-deleted CR must never be silently
-- resurrected by the background/manual CR-list sync.

ALTER TABLE "CrPlan"
  ADD COLUMN "removedByTeam" BOOLEAN NOT NULL DEFAULT false;
