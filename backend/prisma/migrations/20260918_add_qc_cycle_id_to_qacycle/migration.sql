-- AlterTable
-- Real QC RELEASE_CYCLES.RCYC_CYCLE_ID once this cycle is written to QC via
-- REST (docs/spec-qc-full-integration.md §3.4, stage 1). This column was
-- added to schema.prisma in commit 36160c1a but no migration was ever
-- generated for it — it already exists on the dev DB (applied via a stray
-- `db push`) but is missing everywhere else (confirmed absent on the test
-- DB, 2026-09-18). This migration backfills the missing migration file.
ALTER TABLE "QaCycle" ADD COLUMN "qcCycleId" INTEGER;
