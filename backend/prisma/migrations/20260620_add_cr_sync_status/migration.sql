-- Add syncStatus field to VersionCrAssignment
-- Tracks whether a CR was newly added ('NEW'), removed from Excel ('REMOVED'), or active ('ACTIVE')
ALTER TABLE "VersionCrAssignment" ADD COLUMN IF NOT EXISTS "syncStatus" TEXT NOT NULL DEFAULT 'ACTIVE';
