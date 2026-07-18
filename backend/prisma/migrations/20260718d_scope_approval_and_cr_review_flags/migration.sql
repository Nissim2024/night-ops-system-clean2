-- Stage 1 version-opening / scope-approval workflow:
-- Version gets an explicit scope-approval signature (mirrors approvedBy/approvedAt).
-- VersionCrAssignment gets a per-row "reviewed" flag for the opening validation
-- step, and "needsAttention" for scope changes detected after scope approval.

ALTER TABLE "Version"
  ADD COLUMN "scopeApprovedBy" TEXT,
  ADD COLUMN "scopeApprovedAt" TIMESTAMP(3);

ALTER TABLE "VersionCrAssignment"
  ADD COLUMN "reviewed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "needsAttention" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Version"
  ADD CONSTRAINT "Version_scopeApprovedBy_fkey"
  FOREIGN KEY ("scopeApprovedBy") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
