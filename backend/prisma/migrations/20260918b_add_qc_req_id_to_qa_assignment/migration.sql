-- AlterTable
-- Real QC `requirement` id once a CR is published as a Requirement in QC
-- (docs/spec-qc-full-integration.md §4, stage 2). Null until published.
ALTER TABLE "QaAssignment" ADD COLUMN "qcReqId" INTEGER;
