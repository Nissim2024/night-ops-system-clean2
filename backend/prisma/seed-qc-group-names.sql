-- Team.qcGroupName seed — real QC workflow-transition group mapping
-- (docs/spec-defects-module.md §4; project memory
-- project-qc-workflow-transitions-2026-09-18). Decided with the user
-- 2026-09-18 by going through all 31 dev-DB teams one by one.
--
-- Run this against the PRODUCTION database once this release is actually
-- installed there — keyed by team NAME (not id, since ids differ between
-- databases). Idempotent: safe to re-run, only touches teams by exact name
-- match. Does NOT create teams that don't exist in the target DB; if a
-- production team name doesn't match one of these exactly, it's silently
-- skipped (verify row counts after running against prod, since prod's
-- team list may differ from what's in dev today).

UPDATE "Team" SET "qcGroupName" = 'Developer_New' WHERE name IN (
  'BI Team', 'CAWA Team', 'CRM Dev Team', 'DBA Team', 'Design Team',
  'Digital Team', 'EAI Team', 'ERP Team', 'ETL Team', 'IVR Team',
  'NC Team', 'NETCOL Team', 'NETC Team', 'Nifi Team', 'OSS Team',
  'PrintBoss Team', 'Provisioning Team', 'QV Team', 'SHOB Team',
  'TV Team', 'Web Dev Team'
);

UPDATE "Team" SET "qcGroupName" = 'HotSupport' WHERE name IN (
  'NOC Operators', 'Operations Team', 'Setup Team'
);

UPDATE "Team" SET "qcGroupName" = 'QATesters_New' WHERE name IN (
  'Cyber Security Team', 'PT Team', 'QA-CRM ????', 'QA-DBA ????',
  'QA-EAI ????', 'QA Team'
);

-- "Management" deliberately left unmapped (user's explicit choice,
-- 2026-09-18) — not a defects-workflow team.
