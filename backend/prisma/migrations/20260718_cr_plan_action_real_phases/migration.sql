-- Replace the abstract "anchor" enum on CrPlanAction with real phase/subPhase
-- references (same convention as TaskProposal.phase/subPhaseId), so exceptional
-- actions can be auto-derived into precise TaskProposals on plan confirmation.

ALTER TABLE "CrPlanAction"
  ADD COLUMN "phase"             INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "subPhaseId"        TEXT,
  ADD COLUMN "derivedProposalId" TEXT,
  DROP COLUMN "anchor";
