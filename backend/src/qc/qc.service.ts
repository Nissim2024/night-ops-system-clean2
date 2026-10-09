import { qcMemo } from './qc-cache';
import { currentQcProject, currentQcProjectKey, isValidOracleSchema } from './qc-project-context';
import { QC_DEFECT_FIELDS } from './qc-defect-fields';
import { Injectable, Logger, BadRequestException, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { getAllowedTransitionsForUser } from './qc-workflow-transitions';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Exported for users.service.ts's syncQcUsers() — it used to read
// process.env.ORACLE_ENABLED/ORACLE_USER/etc. directly, which is NEVER set
// in production (this app configures Oracle via SystemParam, admin-editable
// at runtime, not env vars) — so syncQcUsers() silently fell back to
// HARDCODED_QC_USERS on every real run, and that fallback list has no
// `userName` field at all, meaning qcLogin could never be populated by sync
// no matter how many times an admin ran it. Found 2026-09-02 diagnosing a
// real user's persistent "no linked QC user" block after a successful sync.
export async function getOracleConfig() {
  const keys = ['ORACLE_ENABLED', 'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'];
  const rows = await prisma.systemParam.findMany({ where: { key: { in: keys } } });
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    enabled:       map['ORACLE_ENABLED'] === 'true',
    user:          map['ORACLE_USER']           || process.env.ORACLE_USER           || '',
    password:      map['ORACLE_PASSWORD']       || process.env.ORACLE_PASSWORD       || '',
    connectString: map['ORACLE_CONNECT_STRING'] || process.env.ORACLE_CONNECT_STRING || '',
  };
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

export interface TestCoverageDto {
  total: number;
  responsible: string;
  planned: number;
  passed: number;
  failed: number;
  notCompleted: number;
  blocked: number;
  notRun: number;
  notReady: number;
  notApplicable: number;
  notRelevant: number;
  subject: string;
  title: string;
  release: string;
  cycle: string;
  planId: string;
  labId: string;
}

// Canonical "executed" definition (2026-08-03 product decision, confirmed
// against ALM's own "% executed" cycle graph 2026-09-10): a script counts as
// executed once it reached ANY terminal disposition — Passed / Failed /
// Blocked / Not Completed, plus N/A and Not Relevant (deliberately marked
// out of scope for this cycle) — but NOT 'No Run' or 'Not Ready for QA'
// (genuinely not started). Every consumer of a per-CR coverage row
// (getCrCoverage's own coveragePct, getCycleProgress's cycle rollup,
// getOverview's core-cycle coveragePct/readiness axis) MUST derive
// "executed" from this one helper — three hand-rolled variants had drifted
// apart (passed+failed+blocked+notCompleted vs. passed+failed only vs. this),
// so the per-CR %, the cycle %, and the RI-Home tile disagreed with each
// other and with ALM.
export function executedScriptCount(c: {
  passed?: number; failed?: number; blocked?: number;
  notCompleted?: number; notApplicable?: number; notRelevant?: number;
}): number {
  return (c.passed ?? 0) + (c.failed ?? 0) + (c.blocked ?? 0)
    + (c.notCompleted ?? 0) + (c.notApplicable ?? 0) + (c.notRelevant ?? 0);
}

// Production-environment defect (Environment / BG_USER_02 contains "prod").
// The testing-management module leaves these out of every metric: once a
// version is live, production keeps opening defects against it until the
// next one ships, and they're no part of the go-live decision (user rule
// 2026-10-04 - environment is the only criterion).
export function isProductionEnvironment(env: string | null | undefined): boolean {
  return /prod/i.test(env ?? '');
}

export interface DefectDto {
  id: string;
  assignedTo: string;
  system: string;
  title: string;
  description: string;
  reproducible: string;
  severity: string;
  priority: string;
  reporter: string;
  discoveryDate: string;
  environment: string;
  status: string;
  testPhase: string;
  defectType: string;
  notes: string;
  // Added for KPI-filtered defect drill-down (Quality Hub) — see
  // KPI_DEFECT_FILTERS below. Not previously selected by DEFECTS_SQL.
  responsibility: string;
  crHbrNumberReference: string;
  crReferenceNumber: string;     // BG_USER_58 — real CR linkage, distinct from crHbrNumberReference above
  fixType: string;
  reason: string;
  reopenYn: string;
  // BG_TARGET_REL → RELEASES.REL_NAME. Non-empty = this defect was analysed,
  // deferred to a later release, and no longer counts as a risk to the
  // current version (spec 2026-09-07, section 1).
  targetRelease: string;
  // ── Extended fields (2026-09-14) — brings this DTO's column-picker breadth
  // in line with TargetDefectDto's (feedback: the "כל התקלות שדווחו" screen's
  // Select-Columns list had far fewer options than the TARGET-defect screen's,
  // even though both ultimately read the same BUG table). Same BG_USER_XX
  // slots as TARGET_CR_DEFECTS_SQL — see TargetDefectDto's field comments for
  // the exact column mapping of each.
  subject: string;
  qaTester: string;
  estimatedFixTime: string;
  actualFixTime: string;
  closedBy: string;
  deploymentReason: string;
  fixedUntil: string;
  vendorStatus: string;
  responseDate: string;
  supportReferenceNumber: string;
  subModule: string;
  fixedInProd: string;
  mainModule: string;
  supportStatus: string;
  vendorAssignTo: string;
  category: string;
  itemType: string;
  estimateFixTime: string;
  platform: string;
  modified: string;
  detectedInRelease: string;
  detectedInCycle: string;
  targetCycle: string;
  crStatus: string;
  dropNumber: string;
  detectedApkVersion: string;   // BG_USER_30
  detectedHotAppApk: string;    // BG_USER_41
  targetHotAppApk: string;      // BG_USER_42
  influence: string;
  secondaryPriority: string;
  releaseDefect: string;
  businessProcess: string;
  foundByAutomation: string;
  mainBusinessProcess: string;
  impact: string;
  productionReason: string;
  environmentComponent: string;
  willBeTestAtGoLive: string;
  deploymentCategory: string;
  defectResponsible: string;
  targetReleaseReason: string;
  targetType: string;
  systemComponent: string;
  forRegressionTest: string;
  escDefectResponsible: string;
  toBeTestedOnProd: string;
  deploymentDateProd: string;
  targetScopeApproved: string;
}

export interface CrItemDto {
  id: string;
  description: string;
  label: string;
}

// Defects scoped to one CR + release, for the TARGET-CR gate screen and the
// version-management overview's TARGET defect list. Field set mirrors
// TARGET_CR_DEFECTS_SQL 1:1 (see below) so every BUG column the query pulls
// has a home here — the frontend's column-picker (Select Columns dialog)
// lets the user choose which of these to actually display; `title`/`system`/
// `status` etc. are kept as the small "always useful" subset already
// consumed by existing screens (by-area treemap, defect-summary tile).
export interface TargetDefectDto {
  id: string;                    // BG_BUG_ID
  assignedTo: string;            // BG_RESPONSIBLE
  qaTester: string;              // BG_USER_37 — the specific QA tester this TARGET defect belongs to (distinct from assignedTo/BG_RESPONSIBLE = the person the fix is assigned to; the handling TEAM is responsibility/BG_USER_03 — user-confirmed 2026-10-03)
  crReferenceNumber: string;     // BG_USER_58
  system: string;                // BG_PROJECT — the "area"/system a defect belongs to, used for the version-management overview's by-area treemap
  title: string;                 // BG_SUMMARY || BG_SUBJECT
  status: string;                // BG_USER_04
  severity: string;              // BG_SEVERITY
  // ── Extended fields (all remaining columns from TARGET_CR_DEFECTS_SQL) ──
  subject: string;               // BG_SUBJECT
  summary: string;               // BG_SUMMARY
  description: string;           // BG_DESCRIPTION (HTML-stripped)
  notes: string;                 // BG_DEV_COMMENTS (HTML-entity-cleaned) — developer comments
  reproducible: string;          // BG_REPRODUCIBLE
  priority: string;              // BG_PRIORITY
  detectedBy: string;            // BG_DETECTED_BY
  detectedOnDate: string;        // BG_DETECTION_DATE
  estimatedFixTime: string;      // BG_ESTIMATED_FIX_TIME
  actualFixTime: string;         // BG_ACTUAL_FIX_TIME
  environment: string;           // BG_USER_02
  responsibility: string;        // BG_USER_03
  testPhase: string;             // BG_USER_05
  defectType: string;            // BG_USER_06
  closedBy: string;              // BG_USER_07
  deploymentReason: string;      // BG_USER_08
  fixedUntil: string;            // BG_USER_09
  crHbrNumberReference: string;  // BG_USER_10
  vendorStatus: string;          // BG_USER_11
  responseDate: string;          // BG_USER_12
  supportReferenceNumber: string;// BG_USER_13
  subModule: string;             // BG_USER_14
  fixedInProd: string;           // BG_USER_15
  mainModule: string;            // BG_USER_16
  reason: string;                // BG_USER_17
  supportStatus: string;         // BG_USER_18
  vendorAssignTo: string;        // BG_USER_19
  category: string;              // BG_USER_20
  itemType: string;              // BG_USER_22
  estimateFixTime: string;       // BG_USER_23
  platform: string;              // BG_USER_24
  modified: string;              // BG_VTS
  detectedInRelease: string;     // BG_DETECTED_IN_REL, resolved to RELEASES.REL_NAME via a join — not the raw REL_ID
  detectedInCycle: string;       // BG_DETECTED_IN_RCYC, resolved to RELEASE_CYCLES.RCYC_NAME via a join — not the raw RCYC_ID
  targetRelease: string;         // BG_TARGET_REL, resolved to RELEASES.REL_NAME — the release this defect is targeted to be tested in (BG_TARGET_REL is also the WHERE-clause filter column, matched by ID before resolution)
  targetCycle: string;           // BG_TARGET_RCYC, resolved to RELEASE_CYCLES.RCYC_NAME
  crStatus: string;              // BG_USER_27
  dropNumber: string;            // BG_USER_28
  detectedApkVersion: string;    // BG_USER_30 "Detected At APK Version"
  detectedHotAppApk: string;     // BG_USER_41 "Detected in HOT APP APK"
  targetHotAppApk: string;       // BG_USER_42 "Target HOT APP APK"
  reopenYn: string;               // BG_USER_29
  influence: string;             // BG_USER_31
  fixType: string;               // BG_USER_33
  secondaryPriority: string;     // BG_USER_39
  releaseDefect: string;         // BG_USER_43
  businessProcess: string;       // BG_USER_44
  foundByAutomation: string;     // BG_USER_45
  mainBusinessProcess: string;   // BG_USER_46
  impact: string;                // BG_USER_47
  productionReason: string;      // BG_USER_48
  environmentComponent: string;  // BG_USER_49
  willBeTestAtGoLive: string;    // BG_USER_50
  deploymentCategory: string;    // BG_USER_51
  defectResponsible: string;     // BG_USER_52
  targetReleaseReason: string;   // BG_USER_53
  targetType: string;            // BG_USER_54
  systemComponent: string;       // BG_USER_55
  forRegressionTest: string;     // BG_USER_56
  escDefectResponsible: string;  // BG_USER_57
  toBeTestedOnProd: string;      // BG_USER_59
  deploymentDateProd: string;    // BG_USER_60
  targetScopeApproved: string;   // BG_USER_61
}

// getCrDefectIndicators' three CR-plan-submission buckets — see that
// method's comment for the exact rule behind each list.
export interface CrDefectIndicatorsDto {
  fixed: TargetDefectDto[];
  open: TargetDefectDto[];
  openApproved: TargetDefectDto[];
}

// "Fixed" bucket only counts a real resolution, not a closure-for-other-
// reasons (Canceled/Rejected/Duplicate) — those wouldn't honestly represent
// "this CR's defect got fixed".
const CR_INDICATOR_FIXED_STATUSES = ['Closed', 'Fixed'];

// Go-Live/production incidents are just TargetDefectDto rows filtered to
// BG_USER_05='Production' (see GO_LIVE_INCIDENTS_SQL) instead of BG_TARGET_REL
// — same BUG table, same full real column set, so the Incidents/RCA module's
// import picker can show the same breadth of real fields TARGET's screen
// does (2026-08-09, explicit product decision after the user compared the two).
export type GoLiveIncidentDto = TargetDefectDto;

// Raw defect row for the "my reported defects" self-scoped stat — release-
// wide, filtered/aggregated by the caller (target-cr.service.ts) since the
// tester-name match is a JS-side free-text comparison, same as elsewhere.
export interface ReportedDefectDto {
  id: string;
  title: string;
  detectedBy: string;
  status: string;
  severity: string;
  assignedTo: string;
  discoveryDate: string | Date | null;
  // Real "when did this change to its current status" timestamp doesn't
  // exist on BUG — BG_VTS ("Modified") is the closest proxy: last-touched
  // time, which for a defect sitting in Fixed_Test almost always IS the
  // fix-completion timestamp (nothing else would touch it while dev is
  // working the fix). Used for the "waiting for my verification too long"
  // alert (2026-09-29 spec) — an approximation, not a real state-transition
  // audit trail.
  modified: string | Date | null;
}

// Release-wide defect rows keyed by REAL detected cycle (RELEASE_CYCLES.RCYC_NAME,
// same join/naming variants as CrCoverageDto's cycleName — see cycleNameMatches
// in release-intelligence.service.ts) — used by getCycleProgress to count
// "defects reported in the cycle" per app cycle. Filtered by DETECTED_IN_REL
// (not TARGET_REL, unlike TARGET_CR_DEFECTS_SQL) since we want defects that
// actually surfaced during this release's testing, not ones merely targeted at it.
export interface DefectByCycleDto {
  id: string;
  detectedInCycle: string;
  status: string;
}

// KPI 11 — "מצב תקלות ייצור פתוחות לאורך חודשים": one row per (month, defect)
// still open as of that month-end. `area` (BG_USER_10) is NOT a module/
// component field — confirmed directly by the user (2026-07-24): it's a
// three-way overloaded value — either the CR/task number from CR_LIST that
// this defect is linked to (when the bug relates to a specific scope task),
// or the literal string "Production" (bug reproduces in production, no
// linked task) or "Regression" (doesn't reproduce in production, no linked
// task). The Production/Regression split (used elsewhere via CATEGORY_REF)
// is correct as-is; a breakdown of THIS field is really "category or linked
// CR", not "module" — kept the field name for compatibility, but see the
// frontend label ("קטגוריה / CR מקושר", not "מודול").
export interface OpenProdDefectMonthDto {
  monthDate: string;      // ISO month-start date
  monthLabel: string;     // 'YYYY-MM'
  defectId: string;
  statusAtMonth: string;
  currentStatus: string;
  releaseId: string | null;
  severity: string | null;
  priority: string | null;
  responsibility: string | null;
  testPhase: string | null;
  detectedBy: string | null;
  detectedDate: string | null;
  reopenYn: string | null;
  area: string | null;     // category ("Production"/"Regression") or linked CR/task number (BG_USER_10) — see interface comment above
  bugType: string | null;
  fixType: string | null;
  title: string | null;
  assignedTo: string | null;
  qaTester: string | null;
  environment: string | null;
  subModule: string | null;
  mainModule: string | null;
  crReferenceNumber: string | null;
  platform: string | null;
  closedBy: string | null;
  estimatedFixTime: string | null;
  actualFixTime: string | null;
  deploymentReason: string | null;
  detectedApkVersion: string | null;
  detectedHotAppApk: string | null;
  targetHotAppApk: string | null;
}

export interface DefectStatusHistoryDto {
  status: string;
  changeTime: string;
}

export interface DefectFieldChangeDto {
  changeTime: string;
  changedBy: string;
  propertyName: string;
  oldValue: string;
  newValue: string;
}

// "יחס תקלות חדשות ביצור" — Target = defects whose TARGET_REL is that release
// (the release they were meant to be fixed by), New = defects actually
// DETECTED_IN_REL that release. Same BUG table as the rest of this file, two
// different grouping keys — confirmed against the reference Power BI page.
export interface NewVsTargetDefectDto {
  defectId: string;
  targetRelId: string | null;
  targetRelName: string | null;
  detectedRelId: string | null;
  detectedRelName: string | null;
  responsibility: string | null;
  severity: string | null;
  detectedDate: string | null;
}

export interface BugDashboardDto {
  reported: number;
  open: number;
  rejected: number;
  production: number;
  regression: number;
  changes: number;
  reopen: number;
  targetTotal: number;
  targetOpen: number;
  // Defects opened in THIS release with a non-empty BG_TARGET_REL — i.e.
  // deferred to a later release (spec 2026-09-09).
  movedToNext: number;
  dailyReported: { date: string; count: number }[];
  // Each row's own severity split — backs the segmented bars on the Bug
  // Dashboard (spec confirmed 2026-09-04).
  openByType: { label: string; count: number; bySeverity: { severity: string; count: number }[] }[];
  openByResponsibility: { label: string; count: number; bySeverity: { severity: string; count: number }[] }[];
  openByCr: { label: string; count: number; bySeverity: { severity: string; count: number }[] }[];
  // Open defects grouped into the 5 workflow-status buckets (see bugStatusBucket) —
  // drives the 4th breakdown panel on the Bug Dashboard (spec 2026-09-07).
  openByStatus: { label: string; count: number; bySeverity: { severity: string; count: number }[] }[];
  openBySeverity: { label: string; count: number }[];
  reopenByCr: { label: string; count: number }[];
  criticalByCr: { label: string; count: number }[];
  // Longest-open still-open defects (oldest DETECTED_ON_DATE first), capped —
  // added 2026-09-19 per user request for an actionable "what to triage next"
  // list rather than another aggregate chart. Same `open` row set every other
  // breakdown above is computed from, so its total is never inconsistent with
  // the "open" KPI tile.
  oldestOpen: { id: string; title: string; severity: string; status: string; discoveryDate: string; ageDays: number }[];
  // 2026-10-06 (aligned with the defects module): one row per defect for the
  // browser-side trend/backlog (detected / closed as YYYY-MM-DD; closed only
  // when the defect is closed NOW), every "stuck open" defect's age (same
  // reopen-reset rule as oldestOpen) for the aging chart, and the QC release
  // name for the "open in the defects module" link.
  timeline?: { id: string; detected: string | null; closed: string | null }[];
  closeDateFallback?: number;
  agingOpen?: { id: string; ageDays: number; ageHours: number; severity: string }[];
  /** Testing-phase fix SLA in hours per severity (TESTING_DEFECT_SLA_HOURS). */
  testingSlaHours?: Record<string, number>;
  /** The version's testing window (user, 2026-10-06): integration start → go-live day.
   *  Drives the opened-vs-closed and backlog charts; null ends = unknown. */
  testingPeriod?: { from: string | null; to: string | null; source: 'version' | 'qc-release' };
  releaseName?: string | null;
}

// ── SQL Queries ───────────────────────────────────────────────────────────────

// Same RELEASES/RELEASE_CYCLES join as QC_RELEASES_SQL (qc-releases.service.ts)
// — every cycle of one release, with its QG target thresholds.
// QG_HIGH/QG_MEDIUM/QG_LOW aren't real columns on RELEASE_CYCLES — same
// generic-custom-field pattern as REQ_HIERARCHY_SQL's CR_NUMBER. Confirmed
// against production Oracle 2026-08-03 (ORA-00904 on the old literals) and
// mapped via the user's own RELEASE_CYCLES export query: RCYC_USER_01 = QG
// High, RCYC_USER_02 = QG Medium, RCYC_USER_03 = QG Low (RCYC_USER_04 is
// Environment, unused here).
// rcyc_start_date/rcyc_end_date — standard ALM RELEASE_CYCLES columns (same
// naming convention as RELEASES.REL_START_DATE/REL_END_DATE, already
// confirmed real in qc-releases.service.ts) — added 2026-10-01 so a
// historical/relId-only release (no local QaWorkPlan to read cycle dates
// from) can still show a real planned start/end per cycle. UNVERIFIED
// against real Oracle like every other RCYC_* column here until a live run
// confirms it.
const RELEASE_CYCLES_QG_SQL = `
  SELECT
    rr.rel_name    AS RELEASE_NAME,
    rc.rcyc_name   AS CYCLE_NAME,
    rc.rcyc_user_01 AS QG_HIGH,
    rc.rcyc_user_02 AS QG_MEDIUM,
    rc.rcyc_user_03 AS QG_LOW,
    rc.rcyc_start_date AS CYCLE_START,
    rc.rcyc_end_date   AS CYCLE_END
  FROM releases rr, release_cycles rc
  WHERE rr.rel_id = rc.rcyc_parent_id
    AND rr.rel_id = :releaseId
`;

// TS_EXEC_STATUS literals confirmed against production's real distinct
// values 2026-08-03 (SELECT DISTINCT TS_EXEC_STATUS FROM TEST): Passed,
// Failed, No Run, Not Completed, Blocked, Not Ready for QA, N/A, Not
// Relevant, and null (untested/never-run rows — no bucket, only counted in
// TOTAL, so total can still exceed the sum of all named buckets).
// 'Not Ready fr QA' (missing "o") was the old literal — silently zeroed
// this bucket in every real query since it never matched.
const TEST_COVERAGE_SQL = `
  SELECT
    COUNT(*)                                                                           AS TOTAL,
    RQ.RQ_USER_05                                                                      AS RESPONSIBLE,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Passed'          THEN 1 ELSE 0 END)            AS PASSED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Failed'          THEN 1 ELSE 0 END)            AS FAILED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'No Run'          THEN 1 ELSE 0 END)            AS NOT_RUN,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Blocked'         THEN 1 ELSE 0 END)            AS BLOCKED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Not Completed'   THEN 1 ELSE 0 END)            AS NOT_COMPLETED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Not Ready for QA' THEN 1 ELSE 0 END)           AS NOT_READY,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'N/A'             THEN 1 ELSE 0 END)            AS NOT_APPLICABLE,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Not Relevant'    THEN 1 ELSE 0 END)            AS NOT_RELEVANT,
    RQ.RQ_USER_29                                                                      AS SUBJECT,
    RQ.RQ_REQ_NAME                                                                     AS TITLE,
    RQR.RQRL_RELEASE_ID                                                                AS RELEASE_ID,
    RQC.RQC_CYCLE_ID                                                                   AS CYCLE_ID,
    RQ.RQ_REQ_ID                                                                       AS PLAN_ID,
    RQ.RQ_FATHER_ID                                                                    AS LAB_ID
  FROM
    TEST TS,
    REQ_COVER RC,
    REQ RQ,
    ALL_LISTS AL,
    REQ_TYPE RT,
    REQ_RELEASES RQR,
    REQ_CYCLES RQC,
    RELEASES RR
  WHERE
    TS.TS_TEST_ID          = RC.RC_ENTITY_ID   AND
    RQ.RQ_REQ_ID           = RC.RC_REQ_ID      AND
    AL.AL_ITEM_ID          = TS.TS_SUBJECT     AND
    RC.RC_ENTITY_TYPE      = 'TEST'            AND
    RQ.RQ_TYPE_ID          = RT.TPR_TYPE_ID    AND
    RQR.RQRL_REQ_ID        = RQ.RQ_REQ_ID     AND
    RQR.RQRL_REQ_ID        = RQC.RQC_REQ_ID   AND
    RQR.RQRL_RELEASE_ID    = RR.REL_ID         AND
    RQ.RQ_USER_05 IS NOT NULL                  AND
    RR.REL_ID              = :releaseId        AND
    RQC.RQC_CYCLE_ID       = :cycleId
  GROUP BY
    RQ.RQ_REQ_NAME, RQR.RQRL_RELEASE_ID, RQC.RQC_CYCLE_ID,
    RQ.RQ_REQ_ID, RQ.RQ_FATHER_ID, RQ.RQ_USER_29, RQ.RQ_USER_05
`;

// Same TEST/REQ_COVER/REQ join as TEST_COVERAGE_SQL, across every cycle of
// the release instead of one specific cycle — but deliberately NOT grouped/
// aggregated in SQL. One row per (test × requirement-it-covers) link.
//
// REQ_COVER is many-to-many between TEST and REQ: the same physical test can
// cover multiple requirements. The old version of this query grouped by
// RQ_REQ_ID and did COUNT(*)/SUM(...) per requirement, then getCrCoverage
// summed those per-requirement rows into a per-CR total — so a test
// satisfying two requirements under the SAME CR was counted twice in the
// final total. Confirmed against real production data (2026-09-03, user's
// own audit): QC's own "Requirements Coverage" screen counts
// COUNT(DISTINCT TS_TEST_ID), not COUNT(*) — matching that raw
// COUNT(DISTINCT TS_TEST_ID) closely (441 vs the screen's 440) while a naive
// COUNT(*) came back at 452. Deduplication now happens in getCrCoverage using
// a Map<testId, status> per (CR, cycle) — a Map key naturally collapses the
// same test appearing under multiple requirements into one entry, however
// many rows it contributes here.
//
// The leaf requirement actually linked to a TEST rarely carries CR_NUMBER
// itself — that lives on an ancestor folder (see REQ_HIERARCHY_SQL) — so
// this only resolves ID/parent-ID; the CR walk happens in getCrCoverage.
const TEST_COVERAGE_BY_REQ_SQL = `
  SELECT
    RQ.RQ_REQ_ID      AS REQ_ID,
    RQ.RQ_FATHER_ID   AS FATHER_ID,
    RCYC.RCYC_NAME    AS CYCLE_NAME,
    RR.REL_NAME       AS RELEASE_NAME,
    TS.TS_TEST_ID     AS TEST_ID,
    TS.TS_EXEC_STATUS AS EXEC_STATUS,
    RQ.RQ_USER_05     AS RESPONSIBLE
  FROM
    TEST TS, REQ_COVER RC, REQ RQ, REQ_RELEASES RQR, REQ_CYCLES RQC, RELEASE_CYCLES RCYC, RELEASES RR
  WHERE
    TS.TS_TEST_ID       = RC.RC_ENTITY_ID  AND
    RQ.RQ_REQ_ID        = RC.RC_REQ_ID     AND
    RC.RC_ENTITY_TYPE   = 'TEST'           AND
    RQR.RQRL_REQ_ID     = RQ.RQ_REQ_ID     AND
    RQR.RQRL_REQ_ID     = RQC.RQC_REQ_ID   AND
    RQR.RQRL_RELEASE_ID = RR.REL_ID        AND
    RQC.RQC_CYCLE_ID    = RCYC.RCYC_ID     AND
    RR.REL_ID           = :releaseId
`;

// Cycle-wide, CR-agnostic test totals — release-scoped, grouped by cycle,
// counting DISTINCT TS_TEST_ID per status. Exists because getCrCoverage's
// per-(CR, cycle) dedup (see its `tests: Map<testId, status>` comment) only
// collapses a test appearing under multiple requirements of the SAME CR —
// two gaps still let getCycleProgress's cycle-level headline numbers (summed
// across crCoverage's per-CR rows) drift from QC's own "Requirements
// Coverage" screen for the same release+cycle (real user audit, 2026-09-14,
// ITv06-2026): a test whose requirements span requirements under TWO
// DIFFERENT CRs gets counted once per CR (inflates the sum), and a test
// whose leaf requirement's CR can't be resolved at all (resolveCr() walks
// off a broken/incomplete ancestor chain, or the CR isn't in this version's
// own VersionCrAssignment scope — e.g. "Stand Alone Items") is dropped from
// every CR bucket entirely (deflates the sum) — explaining both the +11
// (Cycle 2) and -50 (Cycle 1) directions the user found in the same audit.
// This query sidesteps both: it never walks the CR hierarchy at all, so
// nothing here depends on a test successfully resolving to one of this
// version's CRs — it's the exact same COUNT(DISTINCT TS_TEST_ID), scoped by
// release+cycle, the user proved matches QC's own screen almost exactly
// (441 vs the screen's 440, vs a naive COUNT(*) of 452).
const CYCLE_TEST_TOTALS_SQL = `
  SELECT
    RQC.RQC_CYCLE_ID AS CYCLE_ID,
    RCYC.RCYC_NAME   AS CYCLE_NAME,
    COUNT(DISTINCT TS.TS_TEST_ID)                                                                    AS TOTAL,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'Passed'           THEN TS.TS_TEST_ID END)          AS PASSED,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'Failed'           THEN TS.TS_TEST_ID END)          AS FAILED,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'No Run'           THEN TS.TS_TEST_ID END)          AS NOT_RUN,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'Blocked'          THEN TS.TS_TEST_ID END)          AS BLOCKED,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'Not Completed'    THEN TS.TS_TEST_ID END)          AS NOT_COMPLETED,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'Not Ready for QA' THEN TS.TS_TEST_ID END)          AS NOT_READY,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'N/A'              THEN TS.TS_TEST_ID END)          AS NOT_APPLICABLE,
    COUNT(DISTINCT CASE WHEN TS.TS_EXEC_STATUS = 'Not Relevant'     THEN TS.TS_TEST_ID END)          AS NOT_RELEVANT
  FROM
    TEST TS, REQ_COVER RC, REQ RQ, REQ_RELEASES RQR, REQ_CYCLES RQC, RELEASE_CYCLES RCYC, RELEASES RR
  WHERE
    TS.TS_TEST_ID       = RC.RC_ENTITY_ID  AND
    RQ.RQ_REQ_ID        = RC.RC_REQ_ID     AND
    RC.RC_ENTITY_TYPE   = 'TEST'           AND
    RQR.RQRL_REQ_ID     = RQ.RQ_REQ_ID     AND
    RQR.RQRL_REQ_ID     = RQC.RQC_REQ_ID   AND
    RQR.RQRL_RELEASE_ID = RR.REL_ID        AND
    RQC.RQC_CYCLE_ID    = RCYC.RCYC_ID     AND
    RR.REL_ID           = :releaseId
  GROUP BY RQC.RQC_CYCLE_ID, RCYC.RCYC_NAME
`;

// Full requirement parent-chain + CR link, unscoped by release — a leaf
// requirement's owning CR often lives several folder-levels up (see
// getCrCoverage), and that ancestor folder isn't guaranteed to carry its
// own REQ_RELEASES row for this release, so this can't be release-scoped
// without risking a broken chain. Only 3 narrow columns; REQ tables run in
// the tens of thousands of rows, not millions — a full scan is cheap.
// CR_NUMBER isn't a real column on REQ — the CR number lives in the generic
// custom field RQ_USER_02 (same field CR_LIST's own ALM export uses, see
// qa-workplan.service.ts's "CR - RQ_USER_02" header) — confirmed against
// production Oracle 2026-08-03 (ORA-00904 on the old literal "CR_NUMBER").
const REQ_HIERARCHY_SQL = `
  SELECT RQ_REQ_ID, RQ_FATHER_ID, RQ_USER_02 AS CR_NUMBER, RQ_REQ_NAME
  FROM REQ
`;

// Test Summary — free-text field the CR's OWN top-level requirement row
// carries (same row RQ_USER_02 = CR_NUMBER lives on, per REQ_HIERARCHY_SQL's
// own comment — not a per-leaf-test field, a once-per-CR rollup). Direct
// WHERE on RQ_USER_02 rather than the full unscoped hierarchy scan
// REQ_HIERARCHY_SQL does, since we already know the exact CR number and
// don't need to walk any father chain here.
//
// Field name confirmed correct 2026-09-23 (user checked QC directly:
// RQ_USER_26's real label is "Test Summary") — the empty-modal bug is NOT a
// wrong-field-name issue. Real suspect instead: this query is UNSCOPED by
// release, but a CR can plausibly carry more than one REQ row with the same
// RQ_USER_02 value over its lifetime (e.g. re-included/carried into a later
// release) — same "CR number isn't unique across releases" shape every other
// CR-scoped query in this file already has to account for (see
// TEST_COVERAGE_BY_REQ_SQL/CYCLE_TEST_TOTALS_SQL joining through
// REQ_RELEASES). Unscoped `WHERE RQ_USER_02 = :crNumber` with no ORDER BY
// just takes whatever row Oracle returns first — if only ONE of several
// same-CR-number rows actually has a Test Summary typed in (the one for the
// release the tester actually wrote it against), an unlucky row order
// returns an empty result even though real data exists. UNVERIFIED which
// exact row Oracle returns without a real multi-row repro, but release-
// scoping is a strict narrowing (same field, same CR, one specific
// release) with no way to make a currently-working case worse.
const CR_TEST_SUMMARY_SQL = `
  SELECT RQ_USER_26 AS TEST_SUMMARY
  FROM REQ
  WHERE RQ_USER_02 = :crNumber
`;

// Release-scoped variant (2026-09-23) — tried FIRST when a releaseId is
// available, falling back to the unscoped query above only if this finds
// nothing, so a CR that only ever had one REQ row (the common case) keeps
// working exactly as before.
const CR_TEST_SUMMARY_SQL_SCOPED = `
  SELECT RQ.RQ_USER_26 AS TEST_SUMMARY
  FROM REQ RQ, REQ_RELEASES RQR
  WHERE RQ.RQ_USER_02 = :crNumber
    AND RQR.RQRL_REQ_ID = RQ.RQ_REQ_ID
    AND RQR.RQRL_RELEASE_ID = :releaseId
`;

// Release-wide (not cycle-scoped): a defect isn't tied to one specific test
// cycle the way test coverage is, so filtering by BG_DETECTED_IN_RCYC (as
// this query used to, alongside a BG_USER_05 = 'Sanity Test' phase filter)
// silently dropped every open defect detected in an earlier cycle (Cycle 1/2/3,
// UAT, etc.) or outside the 'Sanity Test' phase — leaving this the one defects
// query in the file still requiring getQcIds()'s cycleId, and the near-empty-
// results flaw already documented at getGoLiveIncidents below. Matches
// BUG_DASHBOARD_SQL / TARGET_CR_DEFECTS_SQL / MY_REPORTED_DEFECTS_SQL, which
// all scope open-defect queries by BG_DETECTED_IN_REL alone.
//
// Shared SELECT for both the plain (release-wide) and cycle-scoped variants
// below — the rehearsal/production summary reports need "defects found in
// THIS specific test cycle", the live release-intelligence tile and Quality
// Hub need "all open defects regardless of cycle"; same columns either way.
const DEFECTS_SQL_SELECT = `
  SELECT
    BG_BUG_ID                                                                          AS DEFECT_ID,
    BG_RESPONSIBLE                                                                     AS ASSIGNED_TO,
    BG_PROJECT                                                                         AS PROJECT,
    BG_SUBJECT                                                                         AS SUBJECT,
    BG_SUMMARY                                                                         AS SUMMARY,
    REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DESCRIPTION, 4000, 1), '<[^>]*>', '')       AS DEFECT_DESCRIPTION,
    BG_REPRODUCIBLE                                                                    AS REPRODUCIBLE_Y_N,
    BG_SEVERITY                                                                        AS SEVERITY,
    BG_PRIORITY                                                                        AS PRIORITY,
    BG_DETECTED_BY                                                                     AS DETECTED_BY,
    BG_DETECTION_DATE                                                                  AS DETECTED_ON_DATE,
    BG_USER_02                                                                         AS ENVIRONMENT,
    BG_USER_04                                                                         AS DEFECT_STATUS,
    BG_USER_05                                                                         AS TEST_PHASE,
    BG_USER_06                                                                         AS DEFECT_TYPE,
    -- Added for KPI-filtered drill-down (Quality Hub) - same BG_USER_XX slots
    -- already used elsewhere in this file (TARGET_CR_DEFECTS_SQL etc.), kept
    -- consistent rather than re-derived.
    BG_USER_03                                                                         AS RESPONSIBILITY,
    BG_USER_10                                                                         AS CR_HBR_NUMBER_REFERENCE,
    -- Same BG_USER_58 already used everywhere else in this file for real
    -- defect-CR linkage (TARGET_CR_DEFECTS_SQL etc.) - CR_HBR_NUMBER_REFERENCE
    -- above is a different, separate field (a combined CR/HBR display string),
    -- not a substitute for this one (spec confirmed 2026-09-01).
    BG_USER_58                                                                         AS CR_REFERENCE_NUMBER,
    BG_USER_33                                                                         AS FIX_TYPE,
    BG_USER_17                                                                         AS REASON,
    BG_USER_29                                                                         AS REOPEN_YN,
    RT.REL_NAME                                                                        AS TARGET_RELEASE,
    -- Extended fields (2026-09-14) - same BG_USER_XX slots as
    -- TARGET_CR_DEFECTS_SQL below, added so this DTO's column-picker offers
    -- the same breadth as the TARGET-defect screen's (reported defects had
    -- far fewer Select-Columns options than TARGET even though
    -- both read the same BUG table).
    BG_ESTIMATED_FIX_TIME                                                              AS ESTIMATED_FIX_TIME,
    BG_ACTUAL_FIX_TIME                                                                 AS ACTUAL_FIX_TIME,
    BG_USER_07                                                                         AS CLOSED_BY,
    BG_USER_08                                                                         AS DEPLOYMENT_REASON,
    BG_USER_09                                                                         AS FIXED_UNTIL,
    BG_USER_11                                                                         AS VENDOR_STATUS,
    BG_USER_12                                                                         AS RESPONSE_DATE,
    BG_USER_13                                                                         AS SUPPORT_REFERENCE_NUMBER,
    BG_USER_14                                                                         AS SUB_MODULE,
    BG_USER_15                                                                         AS FIXED_IN_PROD,
    BG_USER_16                                                                         AS MAIN_MODULE,
    BG_USER_18                                                                         AS SUPPORT_STATUS,
    BG_USER_19                                                                         AS VENDOR_ASSIGN_TO,
    BG_USER_20                                                                         AS CATEGORY,
    BG_USER_22                                                                         AS ITEM_TYPE,
    BG_USER_23                                                                         AS ESTIMATE_FIX_TIME,
    BG_USER_24                                                                         AS PLATFORM,
    BG_VTS                                                                             AS MODIFIED,
    detected_rel.REL_NAME                                                              AS DETECTED_IN_RELEASE,
    detected_rcyc.RCYC_NAME                                                            AS DETECTED_IN_CYCLE,
    target_rcyc.RCYC_NAME                                                              AS TARGET_CYCLE,
    BG_USER_27                                                                         AS CR_STATUS,
    BG_USER_28                                                                         AS DROP_NUMBER,
    BG_USER_30                                                                         AS DETECTED_APK_VERSION,
    BG_USER_41                                                                         AS DETECTED_HOT_APP_APK,
    BG_USER_42                                                                         AS TARGET_HOT_APP_APK,
    BG_USER_31                                                                         AS INFLUENCE,
    BG_USER_37                                                                         AS QA_TESTER,
    BG_USER_39                                                                         AS SECONDARY_PRIORITY,
    BG_USER_43                                                                         AS RELEASE_DEFECT,
    BG_USER_44                                                                         AS BUSINESS_PROCESS,
    BG_USER_45                                                                         AS FOUND_BY_AUTOMATION,
    BG_USER_46                                                                         AS MAIN_BUSINESS_PROCESS,
    BG_USER_47                                                                         AS IMPACT,
    BG_USER_48                                                                         AS PRODUCTION_REASON,
    BG_USER_49                                                                         AS ENVIRONMENT_COMPONENT,
    BG_USER_50                                                                         AS WILL_BE_TEST_AT_GO_LIVE,
    BG_USER_51                                                                         AS DEPLOYMENT_CATEGORY,
    BG_USER_52                                                                         AS DEFECT_RESPONSIBLE,
    BG_USER_53                                                                         AS TARGET_RELEASE_REASON,
    BG_USER_54                                                                         AS TARGET_TYPE,
    BG_USER_55                                                                         AS SYSTEM_COMPONENT,
    BG_USER_56                                                                         AS FOR_REGRESSION_TEST,
    BG_USER_57                                                                         AS ESC_DEFECT_RESPONSIBLE,
    BG_USER_59                                                                         AS TO_BE_TESTED_ON_PROD,
    BG_USER_60                                                                         AS DEPLOYMENT_DATE_PROD,
    BG_USER_61                                                                         AS TARGET_SCOPE_APPROVED,
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DEV_COMMENTS, 4000, 1), '<[^>]*>', '')),
                '&gt;', '>'
              ),
              '&lt;', '<'
            ),
            '&nbsp;', ' '
          ),
          '&amp;', '&'
        ),
        '&quot;', ''
      ),
      '[ ]{2,}', ' '
    )                                                                                  AS DEFECT_COMMENTS
  FROM BUG
  LEFT JOIN RELEASES RT ON RT.REL_ID = BUG.BG_TARGET_REL
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
  LEFT JOIN RELEASE_CYCLES detected_rcyc ON detected_rcyc.RCYC_ID = BUG.BG_DETECTED_IN_RCYC
  LEFT JOIN RELEASE_CYCLES target_rcyc ON target_rcyc.RCYC_ID = BUG.BG_TARGET_RCYC
`;
const DEFECTS_SQL = `${DEFECTS_SQL_SELECT}  WHERE BG_DETECTED_IN_REL = :releaseId\n`;
// Not DEFECTS_BY_CYCLE_SQL below — that's a differently-shaped query (grouped
// breakdown across every cycle in the release, see DefectByCycleDto). This is
// the same full DefectDto row set as DEFECTS_SQL, just scoped to one cycle.
const DEFECTS_SQL_ONE_CYCLE = `${DEFECTS_SQL_SELECT}  WHERE BG_DETECTED_IN_REL = :releaseId AND BG_DETECTED_IN_RCYC = :cycleId\n`;

// Real Go-Live/production incidents — same shape as DEFECTS_SQL but a
// DIFFERENT TEST_PHASE value and scope. DEFECTS_SQL's 'Sanity Test' phase is
// vanishingly rare in real data (59 rows across ALL of history, per a live
// AllBugs export checked 2026-08-07) — genuine post-go-live production
// incidents are tagged BG_USER_05 = 'Production' instead (2,676 real rows in
// the same export). Scoped by release only (BG_DETECTED_IN_REL), not by a
// specific test cycle — a production incident isn't tied to one QC cycle the
// way a Sanity Test defect is, so this doesn't use getQcIds()'s cycleId.
// Full BUG-table column set — same breadth as TARGET_CR_DEFECTS_SQL below
// (identical column aliases, reusing mapRowToTargetDefect for both), just
// filtered to production incidents (BG_USER_05='Production' + detected-in
// this release) instead of TARGET's targeted-at-this-release filter. Product
// decision 2026-08-09: the Incidents/RCA import picker should show the same
// real field breadth as the TARGET-defects screen, not a narrow hand-picked
// subset.
const GO_LIVE_INCIDENTS_SQL = `
  SELECT
    BG_BUG_ID AS Defect_ID,
    BG_RESPONSIBLE AS Assigned_To,
    BG_PROJECT AS PROJECT,
    BG_SUBJECT AS SUBJECT,
    BG_SUMMARY AS SUMMARY,
    REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DESCRIPTION, 4000, 1), '<[^>]*>', '') AS Defect_Description,
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DEV_COMMENTS, 4000, 1), '<[^>]*>', '')),
                '&gt;', '>'
              ),
              '&lt;', '<'
            ),
            '&nbsp;', ' '
          ),
          '&amp;', '&'
        ),
        '&quot;', ''
      ),
      '[ ]{2,}', ' '
    ) AS Defect_Comments,
    BG_REPRODUCIBLE AS REPRODUCIBLE_Y_N,
    BG_SEVERITY AS Severity,
    BG_PRIORITY AS PRIORITY,
    BG_DETECTED_BY AS Detected_By,
    BG_DETECTION_DATE AS Detected_on_Date,
    BG_ESTIMATED_FIX_TIME AS Estimated_Fix_Time,
    BG_ACTUAL_FIX_TIME AS FIX_TIME,
    BG_USER_02 AS Environment,
    BG_USER_03 AS Responsibility,
    BG_USER_04 AS DEFECT_STATUS,
    BG_USER_05 AS Test_Phase,
    BG_USER_06 AS DEFECT_TYPE,
    BG_USER_07 AS Closed_By,
    BG_USER_08 AS Deployment_Reason,
    BG_USER_09 AS FIxed_Until,
    BG_USER_10 AS CR_HBR_Number_reference,
    BG_USER_11 AS Vendor_Status,
    BG_USER_12 AS Response_Date,
    BG_USER_13 AS Support_Reference_Number,
    BG_USER_14 AS Sub_Module,
    BG_USER_15 AS FIxed_in_Prod,
    BG_USER_16 AS Main_Module,
    BG_USER_17 AS Reason,
    BG_USER_18 AS Support_Status,
    BG_USER_19 AS Vendor_assign_to,
    BG_USER_20 AS Category,
    BG_USER_22 AS Item_Type,
    BG_USER_23 AS Estimate_fix_time,
    BG_USER_24 AS Platform,
    BG_VTS AS Modified,
    detected_rel.REL_NAME AS Detected_in_Release,
    detected_rcyc.RCYC_NAME AS Detected_in_Cycle,
    target_rel.REL_NAME AS Target_Release,
    target_rcyc.RCYC_NAME AS Target_Cycle,
    BG_USER_27 AS CR_Status,
    BG_USER_28 AS "Drop#",
    BG_USER_30 AS DETECTED_APK_VERSION,
    BG_USER_41 AS DETECTED_HOT_APP_APK,
    BG_USER_42 AS TARGET_HOT_APP_APK,
    BG_USER_29 AS Reopen_Y_N,
    BG_USER_31 AS Influence,
    BG_USER_33 AS Fix_Type,
    BG_USER_37 AS QA_Tester,
    BG_USER_39 AS Secondary_Priority,
    BG_USER_43 AS Release_Defect,
    BG_USER_44 AS Business_Processe,
    BG_USER_45 AS Found_By_Automation,
    BG_USER_46 AS Main_Business_Processe,
    BG_USER_47 AS Impact,
    BG_USER_48 AS Poduction_Reason,
    BG_USER_49 AS Environment_Componnent,
    BG_USER_50 AS Will_Be_Test_At_Go_Live,
    BG_USER_51 AS Deployment_Category,
    BG_USER_52 AS Defect_Responsible,
    BG_USER_53 AS Target_Release_Reason,
    BG_USER_54 AS Target_Type,
    BG_USER_55 AS System_Component,
    BG_USER_56 AS For_Regression_Test,
    BG_USER_57 AS Esc_Defect_Responsible,
    BG_USER_58 AS CR_Reference_Number,
    BG_USER_59 AS To_be_tested_on_prod,
    BG_USER_60 AS Deployment_Date_Prod,
    BG_USER_61 AS Target_Scope_Approved
  FROM BUG
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
  LEFT JOIN RELEASES target_rel ON target_rel.REL_ID = BUG.BG_TARGET_REL
  LEFT JOIN RELEASE_CYCLES detected_rcyc ON detected_rcyc.RCYC_ID = BUG.BG_DETECTED_IN_RCYC
  LEFT JOIN RELEASE_CYCLES target_rcyc ON target_rcyc.RCYC_ID = BUG.BG_TARGET_RCYC
  WHERE BG_USER_05 = 'Production'
    AND BUG.BG_DETECTED_IN_REL = :releaseId
`;

// "יחס תקלות חדשות ביצור" — cross-release, all-history (no releaseId param,
// same pattern as OPEN_PROD_DEFECTS_HISTORY_SQL below). REL_NAME resolved via
// a self-join to RELEASES so the frontend never has to map numeric IDs itself.
// The screen's own name ("...ביצור" — "...in production") implies a
// Production-only scope, but this query originally had no WHERE clause at
// all — it pulled every BUG row ever recorded (any environment, any status),
// inflating both Target and New counts far beyond what the chart is supposed
// to show. Added the same BG_USER_02 environment filter already used by
// OPEN_PROD_DEFECTS_HISTORY_SQL (found 2026-08-31: user reported the chart
// showing way too much data).
const NEW_VS_TARGET_DEFECTS_SQL = `
  SELECT
    BG.BG_BUG_ID          AS DEFECT_ID,
    BG.BG_TARGET_REL      AS TARGET_REL_ID,
    RT.REL_NAME           AS TARGET_REL_NAME,
    BG.BG_DETECTED_IN_REL AS DETECTED_REL_ID,
    RD.REL_NAME           AS DETECTED_REL_NAME,
    BG.BG_USER_03         AS RESPONSIBILITY,
    BG.BG_SEVERITY        AS SEVERITY,
    BG.BG_DETECTION_DATE  AS DETECTED_DATE
  FROM BUG BG
  LEFT JOIN RELEASES RT ON RT.REL_ID = BG.BG_TARGET_REL
  LEFT JOIN RELEASES RD ON RD.REL_ID = BG.BG_DETECTED_IN_REL
  WHERE UPPER(BG.BG_USER_02) LIKE '%PROD%'
`;

// Raw rows feeding the bug dashboard (PBIRS-equivalent) — scoped only by
// release (matches the PBIRS report's default filter state: Cycle/CR
// Number/Tester/Bug Status all "All"). Aggregation happens in JS below
// rather than in SQL, since row counts per release are small (~100-500).
// Defects for one CR within one release, for the TARGET-CR gate screen —
// team-name matching happens in JS (computeTargetDefects) since Oracle's
// BG_USER_03 / Responsibility free text ("CRM Team", "NETC-DT team"...) doesn't map
// cleanly to a SQL-side equality/LIKE against our own Team.name values.
// Scoped by release only — a TARGET CR is a catch-all for a team's release
// defects, not a single feature tied to one CR number, so BG_USER_58 (the
// defect's own CR-reference field) is deliberately NOT filtered here. Every
// TARGET CR's gate screen for a given team+release shows the same full team
// defect list, matching how the team actually works the release.
// WHERE filters on BG_TARGET_REL (the release a defect is TARGETED to be
// tested/fixed in) — NOT BG_DETECTED_IN_REL (the release it was originally
// found in). These are different BUG-table concepts; using DETECTED_IN_REL
// here was a bug (fixed 2026-07-28 against the user-supplied reference
// query) that under/over-counted a version's actual TARGET defect scope.
const TARGET_CR_DEFECTS_SQL = `
  SELECT
    BG_BUG_ID AS Defect_ID,
    BG_RESPONSIBLE AS Assigned_To,
    BG_PROJECT AS PROJECT,
    BG_SUBJECT AS SUBJECT,
    BG_SUMMARY AS SUMMARY,
    REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DESCRIPTION, 4000, 1), '<[^>]*>', '') AS Defect_Description,
    -- BG_DEV_COMMENTS ("notes") - same HTML-entity cleanup chain as DEFECTS_SQL's
    -- DEFECT_COMMENTS, since dev comments come through with the same raw
    -- &gt;/&lt;/&nbsp;/&amp;/&quot; entities and repeated-space runs that break
    -- readability (especially for Hebrew text) if left undecoded.
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DEV_COMMENTS, 4000, 1), '<[^>]*>', '')),
                '&gt;', '>'
              ),
              '&lt;', '<'
            ),
            '&nbsp;', ' '
          ),
          '&amp;', '&'
        ),
        '&quot;', ''
      ),
      '[ ]{2,}', ' '
    ) AS Defect_Comments,
    BG_REPRODUCIBLE AS REPRODUCIBLE_Y_N,
    BG_SEVERITY AS Severity,
    BG_PRIORITY AS PRIORITY,
    BG_DETECTED_BY AS Detected_By,
    BG_DETECTION_DATE AS Detected_on_Date,
    BG_ESTIMATED_FIX_TIME AS Estimated_Fix_Time,
    BG_ACTUAL_FIX_TIME AS FIX_TIME,
    BG_USER_02 AS Environment,
    BG_USER_03 AS Responsibility,
    BG_USER_04 AS DEFECT_STATUS,
    BG_USER_05 AS Test_Phase,
    BG_USER_06 AS DEFECT_TYPE,
    BG_USER_07 AS Closed_By,
    BG_USER_08 AS Deployment_Reason,
    BG_USER_09 AS FIxed_Until,
    BG_USER_10 AS CR_HBR_Number_reference,
    BG_USER_11 AS Vendor_Status,
    BG_USER_12 AS Response_Date,
    BG_USER_13 AS Support_Reference_Number,
    BG_USER_14 AS Sub_Module,
    BG_USER_15 AS FIxed_in_Prod,
    BG_USER_16 AS Main_Module,
    BG_USER_17 AS Reason,
    BG_USER_18 AS Support_Status,
    BG_USER_19 AS Vendor_assign_to,
    BG_USER_20 AS Category,
    BG_USER_22 AS Item_Type,
    BG_USER_23 AS Estimate_fix_time,
    BG_USER_24 AS Platform,
    BG_VTS AS Modified,
    detected_rel.REL_NAME AS Detected_in_Release,
    detected_rcyc.RCYC_NAME AS Detected_in_Cycle,
    target_rel.REL_NAME AS Target_Release,
    target_rcyc.RCYC_NAME AS Target_Cycle,
    BG_USER_27 AS CR_Status,
    BG_USER_28 AS "Drop#",
    BG_USER_30 AS DETECTED_APK_VERSION,
    BG_USER_41 AS DETECTED_HOT_APP_APK,
    BG_USER_42 AS TARGET_HOT_APP_APK,
    BG_USER_29 AS Reopen_Y_N,
    BG_USER_31 AS Influence,
    BG_USER_33 AS Fix_Type,
    BG_USER_37 AS QA_Tester,
    BG_USER_39 AS Secondary_Priority,
    BG_USER_43 AS Release_Defect,
    BG_USER_44 AS Business_Processe,
    BG_USER_45 AS Found_By_Automation,
    BG_USER_46 AS Main_Business_Processe,
    BG_USER_47 AS Impact,
    BG_USER_48 AS Poduction_Reason,
    BG_USER_49 AS Environment_Componnent,
    BG_USER_50 AS Will_Be_Test_At_Go_Live,
    BG_USER_51 AS Deployment_Category,
    BG_USER_52 AS Defect_Responsible,
    BG_USER_53 AS Target_Release_Reason,
    BG_USER_54 AS Target_Type,
    BG_USER_55 AS System_Component,
    BG_USER_56 AS For_Regression_Test,
    BG_USER_57 AS Esc_Defect_Responsible,
    BG_USER_58 AS CR_Reference_Number,
    BG_USER_59 AS To_be_tested_on_prod,
    BG_USER_60 AS Deployment_Date_Prod,
    BG_USER_61 AS Target_Scope_Approved
  FROM BUG
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
  LEFT JOIN RELEASES target_rel ON target_rel.REL_ID = BUG.BG_TARGET_REL
  LEFT JOIN RELEASE_CYCLES detected_rcyc ON detected_rcyc.RCYC_ID = BUG.BG_DETECTED_IN_RCYC
  LEFT JOIN RELEASE_CYCLES target_rcyc ON target_rcyc.RCYC_ID = BUG.BG_TARGET_RCYC
  WHERE BG_TARGET_REL = :releaseId
`;

// Same SELECT list as TARGET_CR_DEFECTS_SQL, but scoped by BOTH directions
// (detected in this release OR targeted at this release) plus one specific
// CR — backs the "תוקנו / פתוחות / פתוחות ומאושרות לעלייה" indicators on the
// team-lead CR-plan submission screen (spec confirmed 2026-08-29):
//   - detectedInRelease≠this AND targetRelease=this AND status closed → fixed
//     (an older defect whose fix arrived in this release for retest)
//   - targetRelease empty (never scheduled) → open
//   - detectedInRelease=this AND targetRelease set to a DIFFERENT release
//     (not empty, not this one) → open but explicitly deferred/approved to
//     ship without a fix now
// Single query covers all three since each needs to see defects from both
// the detected and target side of this release.
const CR_DEFECT_INDICATORS_SQL = `
  SELECT
    BG_BUG_ID AS Defect_ID,
    BG_RESPONSIBLE AS Assigned_To,
    BG_PROJECT AS PROJECT,
    BG_SUBJECT AS SUBJECT,
    BG_SUMMARY AS SUMMARY,
    REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DESCRIPTION, 4000, 1), '<[^>]*>', '') AS Defect_Description,
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DEV_COMMENTS, 4000, 1), '<[^>]*>', '')),
                '&gt;', '>'
              ),
              '&lt;', '<'
            ),
            '&nbsp;', ' '
          ),
          '&amp;', '&'
        ),
        '&quot;', ''
      ),
      '[ ]{2,}', ' '
    ) AS Defect_Comments,
    BG_REPRODUCIBLE AS REPRODUCIBLE_Y_N,
    BG_SEVERITY AS Severity,
    BG_PRIORITY AS PRIORITY,
    BG_DETECTED_BY AS Detected_By,
    BG_DETECTION_DATE AS Detected_on_Date,
    BG_ESTIMATED_FIX_TIME AS Estimated_Fix_Time,
    BG_ACTUAL_FIX_TIME AS FIX_TIME,
    BG_USER_02 AS Environment,
    BG_USER_03 AS Responsibility,
    BG_USER_04 AS DEFECT_STATUS,
    BG_USER_05 AS Test_Phase,
    BG_USER_06 AS DEFECT_TYPE,
    BG_USER_07 AS Closed_By,
    BG_USER_08 AS Deployment_Reason,
    BG_USER_09 AS FIxed_Until,
    BG_USER_10 AS CR_HBR_Number_reference,
    BG_USER_11 AS Vendor_Status,
    BG_USER_12 AS Response_Date,
    BG_USER_13 AS Support_Reference_Number,
    BG_USER_14 AS Sub_Module,
    BG_USER_15 AS FIxed_in_Prod,
    BG_USER_16 AS Main_Module,
    BG_USER_17 AS Reason,
    BG_USER_18 AS Support_Status,
    BG_USER_19 AS Vendor_assign_to,
    BG_USER_20 AS Category,
    BG_USER_22 AS Item_Type,
    BG_USER_23 AS Estimate_fix_time,
    BG_USER_24 AS Platform,
    BG_VTS AS Modified,
    detected_rel.REL_NAME AS Detected_in_Release,
    detected_rcyc.RCYC_NAME AS Detected_in_Cycle,
    target_rel.REL_NAME AS Target_Release,
    target_rcyc.RCYC_NAME AS Target_Cycle,
    BG_USER_27 AS CR_Status,
    BG_USER_28 AS "Drop#",
    BG_USER_30 AS DETECTED_APK_VERSION,
    BG_USER_41 AS DETECTED_HOT_APP_APK,
    BG_USER_42 AS TARGET_HOT_APP_APK,
    BG_USER_29 AS Reopen_Y_N,
    BG_USER_31 AS Influence,
    BG_USER_33 AS Fix_Type,
    BG_USER_37 AS QA_Tester,
    BG_USER_39 AS Secondary_Priority,
    BG_USER_43 AS Release_Defect,
    BG_USER_44 AS Business_Processe,
    BG_USER_45 AS Found_By_Automation,
    BG_USER_46 AS Main_Business_Processe,
    BG_USER_47 AS Impact,
    BG_USER_48 AS Poduction_Reason,
    BG_USER_49 AS Environment_Componnent,
    BG_USER_50 AS Will_Be_Test_At_Go_Live,
    BG_USER_51 AS Deployment_Category,
    BG_USER_52 AS Defect_Responsible,
    BG_USER_53 AS Target_Release_Reason,
    BG_USER_54 AS Target_Type,
    BG_USER_55 AS System_Component,
    BG_USER_56 AS For_Regression_Test,
    BG_USER_57 AS Esc_Defect_Responsible,
    BG_USER_58 AS CR_Reference_Number,
    BG_USER_59 AS To_be_tested_on_prod,
    BG_USER_60 AS Deployment_Date_Prod,
    BG_USER_61 AS Target_Scope_Approved
  FROM BUG
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
  LEFT JOIN RELEASES target_rel ON target_rel.REL_ID = BUG.BG_TARGET_REL
  LEFT JOIN RELEASE_CYCLES detected_rcyc ON detected_rcyc.RCYC_ID = BUG.BG_DETECTED_IN_RCYC
  LEFT JOIN RELEASE_CYCLES target_rcyc ON target_rcyc.RCYC_ID = BUG.BG_TARGET_RCYC
  WHERE (BG_DETECTED_IN_REL = :releaseId OR BG_TARGET_REL = :releaseId)
    AND BG_USER_10 LIKE :crNumber || ' %'
`;

// Single-defect full-record lookup — same SELECT list as TARGET_CR_DEFECTS_SQL
// (identical column aliases, reuses mapRowToTargetDefect), scoped to one
// BG_BUG_ID instead of a release. Backs the "click a defect → full detail
// screen" flow off the open-production-defects table, which otherwise only
// has the ~15-field monthly-history projection (OPEN_PROD_DEFECTS_HISTORY_SQL)
// available — that query is a multi-CTE audit-log join and isn't a sensible
// place to also select the other ~35 BUG columns.
// Full (uncut) description + comments of one defect, for the defect form —
// the driver turns the CLOBs into strings (fetchInfo), so no 4000-byte limit.
const DEFECT_FULL_TEXT_SQL = `
  SELECT BG_DESCRIPTION AS FULL_DESCRIPTION, BG_DEV_COMMENTS AS FULL_COMMENTS
  FROM BUG WHERE BG_BUG_ID = :defectId
`;
// Same cleanup the SQL applies to the cut versions (keep in step with the
// REGEXP_REPLACE chains in DEFECT_BY_ID_SQL / DEFECTS_SQL_SELECT).
export function cleanClobDescription(v: string): string {
  return v.replace(/<[^>]*>/g, '');
}
export function cleanClobComments(v: string): string {
  return v
    .replace(/<[^>]*>/g, '')
    .trim()
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '')
    .replace(/[ ]{2,}/g, ' ');
}

const DEFECT_BY_ID_SQL = `
  SELECT
    BG_BUG_ID AS Defect_ID,
    BG_RESPONSIBLE AS Assigned_To,
    BG_PROJECT AS PROJECT,
    BG_SUBJECT AS SUBJECT,
    BG_SUMMARY AS SUMMARY,
    REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DESCRIPTION, 4000, 1), '<[^>]*>', '') AS Defect_Description,
    REGEXP_REPLACE(
      REGEXP_REPLACE(
        REGEXP_REPLACE(
          REGEXP_REPLACE(
            REGEXP_REPLACE(
              REGEXP_REPLACE(
                TRIM(REGEXP_REPLACE(DBMS_LOB.SUBSTR(BUG.BG_DEV_COMMENTS, 4000, 1), '<[^>]*>', '')),
                '&gt;', '>'
              ),
              '&lt;', '<'
            ),
            '&nbsp;', ' '
          ),
          '&amp;', '&'
        ),
        '&quot;', ''
      ),
      '[ ]{2,}', ' '
    ) AS Defect_Comments,
    BG_REPRODUCIBLE AS REPRODUCIBLE_Y_N,
    BG_SEVERITY AS Severity,
    BG_PRIORITY AS PRIORITY,
    BG_DETECTED_BY AS Detected_By,
    BG_DETECTION_DATE AS Detected_on_Date,
    BG_ESTIMATED_FIX_TIME AS Estimated_Fix_Time,
    BG_ACTUAL_FIX_TIME AS FIX_TIME,
    BG_USER_02 AS Environment,
    BG_USER_03 AS Responsibility,
    BG_USER_04 AS DEFECT_STATUS,
    BG_USER_05 AS Test_Phase,
    BG_USER_06 AS DEFECT_TYPE,
    BG_USER_07 AS Closed_By,
    BG_USER_08 AS Deployment_Reason,
    BG_USER_09 AS FIxed_Until,
    BG_USER_10 AS CR_HBR_Number_reference,
    BG_USER_11 AS Vendor_Status,
    BG_USER_12 AS Response_Date,
    BG_USER_13 AS Support_Reference_Number,
    BG_USER_14 AS Sub_Module,
    BG_USER_15 AS FIxed_in_Prod,
    BG_USER_16 AS Main_Module,
    BG_USER_17 AS Reason,
    BG_USER_18 AS Support_Status,
    BG_USER_19 AS Vendor_assign_to,
    BG_USER_20 AS Category,
    BG_USER_22 AS Item_Type,
    BG_USER_23 AS Estimate_fix_time,
    BG_USER_24 AS Platform,
    BG_VTS AS Modified,
    detected_rel.REL_NAME AS Detected_in_Release,
    detected_rcyc.RCYC_NAME AS Detected_in_Cycle,
    target_rel.REL_NAME AS Target_Release,
    target_rcyc.RCYC_NAME AS Target_Cycle,
    BG_USER_27 AS CR_Status,
    BG_USER_28 AS "Drop#",
    BG_USER_30 AS DETECTED_APK_VERSION,
    BG_USER_41 AS DETECTED_HOT_APP_APK,
    BG_USER_42 AS TARGET_HOT_APP_APK,
    BG_USER_29 AS Reopen_Y_N,
    BG_USER_31 AS Influence,
    BG_USER_33 AS Fix_Type,
    BG_USER_37 AS QA_Tester,
    BG_USER_39 AS Secondary_Priority,
    BG_USER_43 AS Release_Defect,
    BG_USER_44 AS Business_Processe,
    BG_USER_45 AS Found_By_Automation,
    BG_USER_46 AS Main_Business_Processe,
    BG_USER_47 AS Impact,
    BG_USER_48 AS Poduction_Reason,
    BG_USER_49 AS Environment_Componnent,
    BG_USER_50 AS Will_Be_Test_At_Go_Live,
    BG_USER_51 AS Deployment_Category,
    BG_USER_52 AS Defect_Responsible,
    BG_USER_53 AS Target_Release_Reason,
    BG_USER_54 AS Target_Type,
    BG_USER_55 AS System_Component,
    BG_USER_56 AS For_Regression_Test,
    BG_USER_57 AS Esc_Defect_Responsible,
    BG_USER_58 AS CR_Reference_Number,
    BG_USER_59 AS To_be_tested_on_prod,
    BG_USER_60 AS Deployment_Date_Prod,
    BG_USER_61 AS Target_Scope_Approved
  FROM BUG
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
  LEFT JOIN RELEASES target_rel ON target_rel.REL_ID = BUG.BG_TARGET_REL
  LEFT JOIN RELEASE_CYCLES detected_rcyc ON detected_rcyc.RCYC_ID = BUG.BG_DETECTED_IN_RCYC
  LEFT JOIN RELEASE_CYCLES target_rcyc ON target_rcyc.RCYC_ID = BUG.BG_TARGET_RCYC
  WHERE BG_BUG_ID = :defectId
`;

// Shared row-mapper for both TARGET_CR_DEFECTS_SQL and GO_LIVE_INCIDENTS_SQL —
// identical column aliases (GO_LIVE_INCIDENTS_SQL mirrors this SELECT list
// 1:1, just with a different WHERE), so one mapper covers both real-Oracle
// fetch paths instead of duplicating this ~70-line mapping twice.
function mapRowToTargetDefect(r: any): TargetDefectDto {
  return {
    id:                String(r.DEFECT_ID),
    assignedTo:        r.ASSIGNED_TO         ?? '',
    qaTester:          r.QA_TESTER            ?? '',
    crReferenceNumber: r.CR_REFERENCE_NUMBER ?? '',
    system:            r.PROJECT             ?? '',
    title:             r.SUMMARY || r.SUBJECT || '',
    status:            r.DEFECT_STATUS       ?? '',
    severity:          r.SEVERITY             ?? '',
    subject:                r.SUBJECT                 ?? '',
    summary:                r.SUMMARY                 ?? '',
    description:            r.DEFECT_DESCRIPTION      ?? '',
    notes:                  r.DEFECT_COMMENTS         ?? '',
    reproducible:           r.REPRODUCIBLE_Y_N        ?? '',
    priority:               r.PRIORITY                ?? '',
    detectedBy:             r.DETECTED_BY             ?? '',
    detectedOnDate:         r.DETECTED_ON_DATE        ?? '',
    estimatedFixTime:       r.ESTIMATED_FIX_TIME      ?? '',
    actualFixTime:          r.FIX_TIME                ?? '',
    environment:            r.ENVIRONMENT             ?? '',
    responsibility:         r.RESPONSIBILITY          ?? '',
    testPhase:              r.TEST_PHASE              ?? '',
    defectType:             r.DEFECT_TYPE             ?? '',
    closedBy:               r.CLOSED_BY               ?? '',
    deploymentReason:       r.DEPLOYMENT_REASON       ?? '',
    fixedUntil:             r.FIXED_UNTIL             ?? '',
    crHbrNumberReference:   r.CR_HBR_NUMBER_REFERENCE ?? '',
    vendorStatus:           r.VENDOR_STATUS           ?? '',
    responseDate:           r.RESPONSE_DATE           ?? '',
    supportReferenceNumber: r.SUPPORT_REFERENCE_NUMBER ?? '',
    subModule:              r.SUB_MODULE              ?? '',
    fixedInProd:            r.FIXED_IN_PROD           ?? '',
    mainModule:             r.MAIN_MODULE             ?? '',
    reason:                 r.REASON                  ?? '',
    supportStatus:          r.SUPPORT_STATUS          ?? '',
    vendorAssignTo:         r.VENDOR_ASSIGN_TO        ?? '',
    category:               r.CATEGORY                ?? '',
    itemType:               r.ITEM_TYPE               ?? '',
    estimateFixTime:        r.ESTIMATE_FIX_TIME       ?? '',
    platform:               r.PLATFORM                ?? '',
    modified:               r.MODIFIED                ?? '',
    detectedInRelease:      r.DETECTED_IN_RELEASE     ?? '',
    detectedInCycle:        r.DETECTED_IN_CYCLE       ?? '',
    targetRelease:          r.TARGET_RELEASE          ?? '',
    targetCycle:            r.TARGET_CYCLE            ?? '',
    crStatus:               r.CR_STATUS               ?? '',
    dropNumber:             r['Drop#']                ?? '',
    detectedApkVersion:     r.DETECTED_APK_VERSION    ?? '',
    detectedHotAppApk:      r.DETECTED_HOT_APP_APK    ?? '',
    targetHotAppApk:        r.TARGET_HOT_APP_APK      ?? '',
    reopenYn:               r.REOPEN_Y_N              ?? '',
    influence:              r.INFLUENCE               ?? '',
    fixType:                r.FIX_TYPE                ?? '',
    secondaryPriority:      r.SECONDARY_PRIORITY      ?? '',
    releaseDefect:          r.RELEASE_DEFECT          ?? '',
    businessProcess:        r.BUSINESS_PROCESSE       ?? '',
    foundByAutomation:      r.FOUND_BY_AUTOMATION     ?? '',
    mainBusinessProcess:    r.MAIN_BUSINESS_PROCESSE  ?? '',
    impact:                 r.IMPACT                  ?? '',
    productionReason:       r.PODUCTION_REASON        ?? '',
    environmentComponent:   r.ENVIRONMENT_COMPONNENT  ?? '',
    willBeTestAtGoLive:     r.WILL_BE_TEST_AT_GO_LIVE ?? '',
    deploymentCategory:     r.DEPLOYMENT_CATEGORY     ?? '',
    defectResponsible:      r.DEFECT_RESPONSIBLE      ?? '',
    targetReleaseReason:    r.TARGET_RELEASE_REASON   ?? '',
    targetType:             r.TARGET_TYPE             ?? '',
    systemComponent:        r.SYSTEM_COMPONENT        ?? '',
    forRegressionTest:      r.FOR_REGRESSION_TEST     ?? '',
    escDefectResponsible:   r.ESC_DEFECT_RESPONSIBLE  ?? '',
    toBeTestedOnProd:       r.TO_BE_TESTED_ON_PROD    ?? '',
    deploymentDateProd:     r.DEPLOYMENT_DATE_PROD    ?? '',
    targetScopeApproved:    r.TARGET_SCOPE_APPROVED   ?? '',
  };
}

// Raw rows for a tester's own "defects I reported" stats — scoped only by
// release; the tester-name match against BG_DETECTED_BY happens in JS (same
// free-text-name-matching reasoning as BG_RESPONSIBLE elsewhere in this file).
const MY_REPORTED_DEFECTS_SQL = `
  SELECT
    BG_BUG_ID                AS DEFECT_ID,
    BG_SUBJECT                AS TITLE,
    BG_DETECTED_BY            AS DETECTED_BY,
    BG_USER_04                AS DEFECT_STATUS,
    BG_SEVERITY               AS SEVERITY,
    BG_RESPONSIBLE            AS ASSIGNED_TO,
    BG_DETECTION_DATE         AS DETECTED_ON_DATE,
    BG_VTS                    AS MODIFIED
  FROM BUG
  WHERE BG_DETECTED_IN_REL = :releaseId
`;

// Release-wide defects grouped by their REAL detected cycle — see DefectByCycleDto.
const DEFECTS_BY_CYCLE_SQL = `
  SELECT
    BG_BUG_ID              AS DEFECT_ID,
    BG_USER_04             AS DEFECT_STATUS,
    detected_rcyc.RCYC_NAME AS DETECTED_IN_CYCLE
  FROM BUG
  LEFT JOIN RELEASE_CYCLES detected_rcyc ON detected_rcyc.RCYC_ID = BUG.BG_DETECTED_IN_RCYC
  WHERE BG_DETECTED_IN_REL = :releaseId
    AND UPPER(NVL(BG_USER_02, ' ')) NOT LIKE '%PROD%'
`;

const BUG_DASHBOARD_SQL = `
  SELECT
    BG_BUG_ID       AS DEFECT_ID,
    BG_RESPONSIBLE  AS ASSIGNED_TO,
    BG_USER_03      AS RESPONSIBILITY_U3,
    BG_USER_04      AS DEFECT_STATUS,
    BG_USER_06      AS DEFECT_TYPE,
    BG_USER_10      AS CATEGORY_REF,
    BG_USER_58      AS CR_REFERENCE_NUMBER,
    BG_TARGET_REL   AS TARGET_REL,
    BG_DETECTION_DATE AS DETECTED_ON_DATE,
    BG_SEVERITY     AS SEVERITY,
    NVL(BG_SUMMARY, BG_SUBJECT) AS TITLE,
    BG_VTS          AS MODIFIED
  FROM BUG
  WHERE BG_DETECTED_IN_REL = :releaseId
    AND UPPER(NVL(BG_USER_02, ' ')) NOT LIKE '%PROD%'
`;

// Close dates for the bug dashboard's trend (2026-10-06, aligned with the
// defects module): the LAST change of status to Closed/Canceled, from the
// status history, for defects detected in this release. ASCII-only, pre-12c.
// Every Reopen / Closed / Canceled status change of one release's defects, in
// ONE pass over AUDIT_LOG (2026-10-07). The reopened-ids set, the latest
// reopen per defect and the close dates used to be three separate scans of
// the audit tables for the same release; they're now derived from these rows
// in code (getReleaseStatusEvents) with exactly the old filters.
// Driven from the release's defects; AU_ENTITY_ID is compared with the id as
// text so its index stays usable (ALM stores it as VARCHAR2).
const RELEASE_STATUS_EVENTS_SQL = `
  SELECT defect.BG_BUG_ID      AS DEFECT_ID,
         audit_property.AP_NEW_VALUE AS NEW_VALUE,
         audit_log.AU_TIME     AS CHANGE_TIME,
         defect.BG_USER_29     AS REOPEN_YN,
         defect.BG_USER_04     AS CURRENT_STATUS,
         defect.BG_USER_05     AS TEST_PHASE
  FROM BUG defect
  JOIN AUDIT_LOG audit_log ON audit_log.AU_ENTITY_ID = TO_CHAR(defect.BG_BUG_ID)
  JOIN AUDIT_PROPERTIES audit_property ON audit_log.AU_ACTION_ID = audit_property.AP_ACTION_ID
  WHERE defect.BG_DETECTED_IN_REL = :releaseId
    AND audit_log.AU_ENTITY_TYPE = 'BUG'
    AND audit_property.AP_PROPERTY_NAME = 'Bug Status'
    AND (audit_property.AP_NEW_VALUE = 'Reopen'
         OR TRIM(audit_property.AP_NEW_VALUE) IN ('Closed', 'Canceled', 'Cancelled'))
`;

export interface ReleaseStatusEvent {
  defectId: string; newValue: string; at: Date;
  reopenYn: string | null; currentStatus: string | null; testPhase: string | null;
}
// Same rules the three old SQL statements applied:
//  reopened ids  = REOPENED_DEFECT_IDS_SQL (AP_NEW_VALUE = 'Reopen', NVL(BG_USER_29,'Y')='Y',
//                  BG_USER_04 != 'Canceled' [NULL excluded, as in SQL], BG_USER_05 = 'System Test')
//  latest reopen = LATEST_REOPEN_TIME_SQL (MAX time of AP_NEW_VALUE = 'Reopen')
//  close date    = BUG_DASHBOARD_CLOSE_DATES_SQL (MAX time of TRIM(value) in Closed/Canceled/Cancelled)
export function deriveReleaseStatusFacts(events: ReleaseStatusEvent[]) {
  const reopenedIds = new Set<string>();
  const latestReopen = new Map<string, Date>();
  const closeTimes = new Map<string, Date>();
  for (const e of events) {
    if (isNaN(e.at.getTime())) continue;
    if (e.newValue === 'Reopen') {
      const prev = latestReopen.get(e.defectId);
      if (!prev || e.at > prev) latestReopen.set(e.defectId, e.at);
      if ((e.reopenYn ?? 'Y') === 'Y' && e.currentStatus != null && e.currentStatus !== 'Canceled' && e.testPhase === 'System Test') {
        reopenedIds.add(e.defectId);
      }
    } else if (['Closed', 'Canceled', 'Cancelled'].includes((e.newValue ?? '').trim())) {
      const prev = closeTimes.get(e.defectId);
      if (!prev || e.at > prev) closeTimes.set(e.defectId, e.at);
    }
  }
  return { reopenedIds, latestReopen, closeTimes };
}

const RELEASE_NAME_SQL = `SELECT REL_NAME FROM RELEASES WHERE REL_ID = :releaseId`;

// TARGET card — defects opened in a PREVIOUS release whose BG_TARGET_REL points
// at the current one (i.e. carried into this release to be fixed/retested).
// Deliberately the mirror image of BUG_DASHBOARD_SQL's BG_DETECTED_IN_REL scope
// (spec 2026-09-07: "כל התקלות שנפתחו בגרסאות קודמות ושהTARGET שלהם הוא הגרסה הנוכחית").
const BUG_DASHBOARD_TARGET_SQL = `
  SELECT
    BG_BUG_ID       AS DEFECT_ID,
    BG_RESPONSIBLE  AS ASSIGNED_TO,
    BG_USER_03      AS RESPONSIBILITY_U3,
    BG_USER_04      AS DEFECT_STATUS,
    BG_USER_06      AS DEFECT_TYPE,
    BG_USER_10      AS CATEGORY_REF,
    BG_USER_58      AS CR_REFERENCE_NUMBER,
    BG_TARGET_REL   AS TARGET_REL,
    BG_DETECTION_DATE AS DETECTED_ON_DATE,
    BG_SEVERITY     AS SEVERITY,
    NVL(BG_SUMMARY, BG_SUBJECT) AS TITLE
  FROM BUG
  WHERE BG_TARGET_REL = :releaseId
    AND (BG_DETECTED_IN_REL IS NULL OR BG_DETECTED_IN_REL <> :releaseId)
`;

// KPI 11 — monthly snapshot of open PRODUCTION defects, adapted from the
// user-provided query. Environment filter (BG_USER_02 LIKE '%PROD%') is the
// only change from what was given — the original had no prod/QA distinction.
// Not scoped by release: this is a cross-release, all-history report (matches
// the reference Power BI page, which has no release filter, only
// Responsibility/Status/Year/FixType/Type).
// Defaults for the admin-configurable open-prod-defects screen (table columns
// pool = OpenProdDefectMonthDto's fields; detail-screen pool = TargetDefectDto's
// full ~50 fields). Matches the table's original hardcoded 8-column layout and
// a sane detail-screen starting point, used until an admin saves a real config.
const DEFAULT_OPEN_PROD_DEFECTS_TABLE_COLUMNS = [
  'defectId', 'severity', 'responsibility', 'area', 'bugType', 'statusAtMonth', 'detectedDate', 'reopenYn',
];
const DEFAULT_OPEN_PROD_DEFECTS_DETAIL_FIELDS = [
  'id', 'title', 'status', 'severity', 'priority', 'assignedTo', 'qaTester', 'system', 'responsibility',
  'testPhase', 'detectedBy', 'detectedOnDate', 'description', 'notes', 'reproducible', 'environment',
  'fixType', 'crReferenceNumber', 'detectedInRelease', 'detectedInCycle',
  'detectedApkVersion', 'detectedHotAppApk', 'targetHotAppApk',
];

const OPEN_PROD_DEFECTS_HISTORY_SQL = `
WITH qc_defects_history AS (
    SELECT
        defect.BG_BUG_ID            AS defect,
        defect.BG_DETECTED_IN_REL   AS release_id,
        defect.BG_SEVERITY          AS severity,
        defect.BG_PRIORITY          AS priority,
        defect.BG_USER_03           AS responsibility,
        defect.BG_USER_04           AS current_status,
        defect.BG_USER_05           AS test_phase,
        defect.BG_DETECTED_BY       AS detected_by,
        defect.BG_DETECTION_DATE    AS detected_date,
        defect.BG_USER_29           AS reopen_yn,
        defect.BG_USER_10           AS area,
        defect.BG_USER_06           AS bug_type,
        defect.BG_USER_33           AS fix_type,
        -- Additional identity/ownership fields - same real BUG columns already
        -- used for the detail screen (DEFECT_BY_ID_SQL), added here so the
        -- table's admin-configurable column pool isn't limited to the ~14
        -- fields this snapshot query originally selected.
        NVL(defect.BG_SUMMARY, defect.BG_SUBJECT) AS title,
        defect.BG_RESPONSIBLE       AS assigned_to,
        defect.BG_USER_37           AS qa_tester,
        defect.BG_USER_02           AS environment,
        defect.BG_USER_14           AS sub_module,
        defect.BG_USER_16           AS main_module,
        defect.BG_USER_58           AS cr_reference_number,
        defect.BG_USER_24           AS platform,
        defect.BG_USER_07           AS closed_by,
        defect.BG_ESTIMATED_FIX_TIME AS estimated_fix_time,
        defect.BG_ACTUAL_FIX_TIME   AS actual_fix_time,
        defect.BG_USER_08           AS deployment_reason,
        defect.BG_USER_30           AS detected_apk_version,
        defect.BG_USER_41           AS detected_hot_app_apk,
        defect.BG_USER_42           AS target_hot_app_apk,
        audit_property.AP_NEW_VALUE AS status,
        audit_log.AU_TIME           AS change_time
    FROM BUG defect
    INNER JOIN AUDIT_LOG        audit_log      ON audit_log.AU_ENTITY_ID       = TO_CHAR(defect.BG_BUG_ID)
    INNER JOIN AUDIT_PROPERTIES audit_property ON audit_log.AU_ACTION_ID  = audit_property.AP_ACTION_ID
    WHERE audit_log.AU_ENTITY_TYPE        = 'BUG'
      AND audit_property.AP_PROPERTY_NAME = 'Bug Status'
      AND UPPER(defect.BG_USER_02) LIKE '%PROD%'
),
bug_attributes AS (
    SELECT
        defect,
        MAX(release_id)     KEEP (DENSE_RANK FIRST ORDER BY change_time) AS release_id,
        MAX(severity)       KEEP (DENSE_RANK FIRST ORDER BY change_time) AS severity,
        MAX(priority)       KEEP (DENSE_RANK FIRST ORDER BY change_time) AS priority,
        MAX(responsibility) KEEP (DENSE_RANK FIRST ORDER BY change_time) AS responsibility,
        MAX(current_status) KEEP (DENSE_RANK LAST  ORDER BY change_time) AS current_status,
        MAX(test_phase)     KEEP (DENSE_RANK FIRST ORDER BY change_time) AS test_phase,
        MAX(detected_by)    KEEP (DENSE_RANK FIRST ORDER BY change_time) AS detected_by,
        MAX(detected_date)  KEEP (DENSE_RANK FIRST ORDER BY change_time) AS detected_date,
        MAX(reopen_yn)      KEEP (DENSE_RANK FIRST ORDER BY change_time) AS reopen_yn,
        MAX(area)           KEEP (DENSE_RANK FIRST ORDER BY change_time) AS area,
        MAX(bug_type)       KEEP (DENSE_RANK FIRST ORDER BY change_time) AS bug_type,
        MAX(fix_type)       KEEP (DENSE_RANK FIRST ORDER BY change_time) AS fix_type,
        MAX(title)              KEEP (DENSE_RANK FIRST ORDER BY change_time) AS title,
        MAX(assigned_to)        KEEP (DENSE_RANK FIRST ORDER BY change_time) AS assigned_to,
        MAX(qa_tester)          KEEP (DENSE_RANK FIRST ORDER BY change_time) AS qa_tester,
        MAX(environment)        KEEP (DENSE_RANK FIRST ORDER BY change_time) AS environment,
        MAX(sub_module)         KEEP (DENSE_RANK FIRST ORDER BY change_time) AS sub_module,
        MAX(main_module)        KEEP (DENSE_RANK FIRST ORDER BY change_time) AS main_module,
        MAX(cr_reference_number) KEEP (DENSE_RANK FIRST ORDER BY change_time) AS cr_reference_number,
        MAX(platform)           KEEP (DENSE_RANK FIRST ORDER BY change_time) AS platform,
        MAX(closed_by)          KEEP (DENSE_RANK FIRST ORDER BY change_time) AS closed_by,
        MAX(estimated_fix_time) KEEP (DENSE_RANK FIRST ORDER BY change_time) AS estimated_fix_time,
        MAX(actual_fix_time)    KEEP (DENSE_RANK FIRST ORDER BY change_time) AS actual_fix_time,
        MAX(deployment_reason)  KEEP (DENSE_RANK FIRST ORDER BY change_time) AS deployment_reason,
        MAX(detected_apk_version) KEEP (DENSE_RANK FIRST ORDER BY change_time) AS detected_apk_version,
        MAX(detected_hot_app_apk) KEEP (DENSE_RANK FIRST ORDER BY change_time) AS detected_hot_app_apk,
        MAX(target_hot_app_apk)   KEEP (DENSE_RANK FIRST ORDER BY change_time) AS target_hot_app_apk
    FROM qc_defects_history
    GROUP BY defect
),
months AS (
    SELECT
        ADD_MONTHS(TRUNC((SELECT MIN(BG_DETECTION_DATE) FROM BUG), 'MM'), LEVEL - 1) AS month_start
    FROM dual
    CONNECT BY LEVEL <=
        MONTHS_BETWEEN(TRUNC(SYSDATE, 'MM'), TRUNC((SELECT MIN(BG_DETECTION_DATE) FROM BUG), 'MM')) + 1
),
status_snapshot AS (
    SELECT
        m.month_start,
        h.defect,
        MAX(h.status) KEEP (DENSE_RANK LAST ORDER BY h.change_time) AS last_status
    FROM months m
    JOIN qc_defects_history h ON h.change_time <= LAST_DAY(m.month_start)
    GROUP BY m.month_start, h.defect
),
open_with_history AS (
    -- For the current month, trust the live BG_USER_04 field over the audit-derived
    -- last_status: a defect whose most recent status change wasn't logged under the
    -- 'Bug Status' audit property (bulk update, migration, automation) would otherwise
    -- look stuck on a stale audited status (e.g. 'Closed') and be wrongly excluded even
    -- though it's actually open right now (found 2026-08-31: our count undercounted a
    -- live QC comparison by 44 defects). Past months keep the audit-derived status since
    -- the live field can't tell us what it was back then.
    SELECT
        s.month_start, s.defect,
        CASE WHEN s.month_start = TRUNC(SYSDATE, 'MM') THEN a.current_status ELSE s.last_status END AS last_status,
        a.release_id, a.severity, a.priority, a.responsibility, a.current_status,
        a.test_phase, a.detected_by, a.detected_date, a.reopen_yn, a.area, a.bug_type, a.fix_type,
        a.title, a.assigned_to, a.qa_tester, a.environment, a.sub_module, a.main_module,
        a.cr_reference_number, a.platform, a.closed_by, a.estimated_fix_time, a.actual_fix_time, a.deployment_reason,
        a.detected_apk_version, a.detected_hot_app_apk, a.target_hot_app_apk
    FROM status_snapshot s
    JOIN bug_attributes a ON s.defect = a.defect
    WHERE
        CASE WHEN s.month_start = TRUNC(SYSDATE, 'MM') THEN a.current_status ELSE s.last_status END
        NOT IN ('Closed', 'Canceled')
),
open_without_history AS (
    SELECT
        m.month_start, b.BG_BUG_ID AS defect, b.BG_USER_04 AS last_status,
        b.BG_DETECTED_IN_REL AS release_id, b.BG_SEVERITY AS severity, b.BG_PRIORITY AS priority,
        b.BG_USER_03 AS responsibility, b.BG_USER_04 AS current_status, b.BG_USER_05 AS test_phase,
        b.BG_DETECTED_BY AS detected_by, b.BG_DETECTION_DATE AS detected_date,
        b.BG_USER_29 AS reopen_yn, b.BG_USER_10 AS area, b.BG_USER_06 AS bug_type, b.BG_USER_33 AS fix_type,
        NVL(b.BG_SUMMARY, b.BG_SUBJECT) AS title, b.BG_RESPONSIBLE AS assigned_to, b.BG_USER_37 AS qa_tester,
        b.BG_USER_02 AS environment, b.BG_USER_14 AS sub_module, b.BG_USER_16 AS main_module,
        b.BG_USER_58 AS cr_reference_number, b.BG_USER_24 AS platform, b.BG_USER_07 AS closed_by,
        b.BG_ESTIMATED_FIX_TIME AS estimated_fix_time, b.BG_ACTUAL_FIX_TIME AS actual_fix_time,
        b.BG_USER_08 AS deployment_reason,
        b.BG_USER_30 AS detected_apk_version, b.BG_USER_41 AS detected_hot_app_apk, b.BG_USER_42 AS target_hot_app_apk
    FROM BUG b
    JOIN months m ON m.month_start >= TRUNC(b.BG_DETECTION_DATE, 'MM')
    WHERE b.BG_USER_04 NOT IN ('Closed', 'Canceled')
      AND UPPER(b.BG_USER_02) LIKE '%PROD%'
      AND NOT EXISTS (SELECT 1 FROM qc_defects_history h WHERE h.defect = b.BG_BUG_ID)
)
SELECT month_start AS MONTH_DATE, TO_CHAR(month_start, 'YYYY-MM') AS MONTH_LABEL,
    defect AS DEFECT_ID, last_status AS STATUS_AT_MONTH, current_status AS CURRENT_STATUS,
    release_id AS RELEASE_ID, severity AS SEVERITY, priority AS PRIORITY, responsibility AS RESPONSIBILITY,
    test_phase AS TEST_PHASE, detected_by AS DETECTED_BY, detected_date AS DETECTED_DATE,
    reopen_yn AS REOPEN_YN, area AS AREA, bug_type AS BUG_TYPE, fix_type AS FIX_TYPE,
    title AS TITLE, assigned_to AS ASSIGNED_TO, qa_tester AS QA_TESTER, environment AS ENVIRONMENT,
    sub_module AS SUB_MODULE, main_module AS MAIN_MODULE, cr_reference_number AS CR_REFERENCE_NUMBER,
    platform AS PLATFORM, closed_by AS CLOSED_BY, estimated_fix_time AS ESTIMATED_FIX_TIME,
    actual_fix_time AS ACTUAL_FIX_TIME, deployment_reason AS DEPLOYMENT_REASON,
    detected_apk_version AS DETECTED_APK_VERSION, detected_hot_app_apk AS DETECTED_HOT_APP_APK,
    target_hot_app_apk AS TARGET_HOT_APP_APK
FROM open_with_history
UNION ALL
SELECT month_start, TO_CHAR(month_start, 'YYYY-MM'), defect, last_status, current_status,
    release_id, severity, priority, responsibility, test_phase, detected_by, detected_date,
    reopen_yn, area, bug_type, fix_type,
    title, assigned_to, qa_tester, environment, sub_module, main_module,
    cr_reference_number, platform, closed_by, estimated_fix_time, actual_fix_time, deployment_reason,
    detected_apk_version, detected_hot_app_apk, target_hot_app_apk
FROM open_without_history
`;

const DEFECT_STATUS_HISTORY_SQL = `
  SELECT audit_property.AP_NEW_VALUE AS STATUS, audit_log.AU_TIME AS CHANGE_TIME
  FROM AUDIT_LOG audit_log
  JOIN AUDIT_PROPERTIES audit_property ON audit_log.AU_ACTION_ID = audit_property.AP_ACTION_ID
  WHERE audit_log.AU_ENTITY_TYPE = 'BUG'
    AND audit_property.AP_PROPERTY_NAME = 'Bug Status'
    AND audit_log.AU_ENTITY_ID = :defectId
  ORDER BY audit_log.AU_TIME ASC
`;

// Historical defect-fix throughput for one release's testing-phase window —
// backs the Forecast card's defect-rate check (release-intelligence's
// getHistoricalDefectFixRate). Counts distinct defects (of that release)
// with a real audit-log transition to 'Fixed Test' inside [startDate,
// endDate]. The 'Fixed Test' literal is the user's own stated status name
// (2026-09-02) but, like AU_USER/AP_OLD_VALUE on DEFECT_FIELD_HISTORY_SQL
// above, has NOT been verified against this real instance's actual distinct
// AP_NEW_VALUE spelling yet — verify against live Oracle before trusting
// this beyond a rough estimate.
const DEFECT_FIX_RATE_SQL = `
  SELECT COUNT(DISTINCT audit_log.AU_ENTITY_ID) AS FIXED_COUNT
  FROM BUG defect
  INNER JOIN AUDIT_LOG audit_log ON audit_log.AU_ENTITY_ID = TO_CHAR(defect.BG_BUG_ID)
  INNER JOIN AUDIT_PROPERTIES audit_property ON audit_log.AU_ACTION_ID = audit_property.AP_ACTION_ID
  WHERE audit_log.AU_ENTITY_TYPE = 'BUG'
    AND audit_property.AP_PROPERTY_NAME = 'Bug Status'
    AND audit_property.AP_NEW_VALUE = 'Fixed Test'
    AND defect.BG_DETECTED_IN_REL = :releaseId
    AND audit_log.AU_TIME BETWEEN :startDate AND :endDate
`;

// Same AUDIT_LOG/AUDIT_PROPERTIES tables as DEFECT_STATUS_HISTORY_SQL above,
// but without the 'Bug Status'-only filter — every field-level change for
// the defect, for the TARGET-defect detail form's change-history section.
// AU_USER (who) and AP_OLD_VALUE (old value) are the standard HP QC/ALM 11
// audit-schema column names, but — unlike every other column referenced in
// this file — NEITHER has been exercised against this real instance yet
// (the existing status-history query never needed them). Verify against
// live Oracle before trusting this beyond the mock fallback (spec confirmed
// 2026-08-30).
const DEFECT_FIELD_HISTORY_SQL = `
  SELECT
    audit_log.AU_TIME             AS CHANGE_TIME,
    audit_log.AU_USER             AS CHANGED_BY,
    audit_property.AP_PROPERTY_NAME AS PROPERTY_NAME,
    audit_property.AP_OLD_VALUE   AS OLD_VALUE,
    audit_property.AP_NEW_VALUE   AS NEW_VALUE
  FROM AUDIT_LOG audit_log
  JOIN AUDIT_PROPERTIES audit_property ON audit_log.AU_ACTION_ID = audit_property.AP_ACTION_ID
  WHERE audit_log.AU_ENTITY_TYPE = 'BUG'
    AND audit_log.AU_ENTITY_ID = :defectId
  ORDER BY audit_log.AU_TIME ASC
`;

// Distinct defects with a real audit-log transition to 'Reopen' — backs
// "Reopened Defects KPI" (see getReopenedDefectIds). Transcribed from the
// real QC "Reopen KPI" Favorite filter (2026-08-27); NVL(...,'Y')='Y' is
// intentional — it excludes only rows where reopenYn is explicitly not 'Y',
// same permissive-null treatment as the original.

// Latest real reopen timestamp per defect (2026-09-19, spec-2026-09-19-aging) —
// backs the "oldest still-open" list's age calculation: the clock restarts
// from the most recent reopen instead of running from the original detection
// date the whole time. Deliberately does NOT reuse REOPENED_DEFECT_IDS_SQL's
// extra filters (BG_USER_29/BG_USER_04/BG_USER_05) — those narrow it to match
// QC's own curated "Reopened Defects KPI" Favorite, but a real reopen that
// falls outside that KPI's filter is still a real reopen for age-reset
// purposes, so excluding it here would silently under-reset an age. UNVERIFIED
// against the real instance — same audit-log tables as DEFECT_FIELD_HISTORY_SQL
// and REOPENED_DEFECT_IDS_SQL, just grouped/maxed instead of one row per change.

// ── Mock data (used when ORACLE_ENABLED=false) ────────────────────────────────

const MOCK_COVERAGE: TestCoverageDto[] = [
  { total: 1,  responsible: 'maamona', planned: 1,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'HOT WEB',                                           release: '374', cycle: '1276', planId: '74538', labId: '74532' },
  { total: 6,  responsible: 'maamona', planned: 6,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: 'צמצום שיחות',           title: '12969 - דרישות חדשות מערכת תזכורות ב CRM',          release: '374', cycle: '1276', planId: '74543', labId: '74542' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'CRM HOTNET',                                        release: '374', cycle: '1276', planId: '74549', labId: '74548' },
  { total: 2,  responsible: 'roiv',    planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: 'שו"ש - חטיבת שירות',  title: '13072 - שינוי בהתנהלות של מסך AI',                  release: '374', cycle: '1276', planId: '74531', labId: '74530' },
  { total: 3,  responsible: 'maamona', planned: 3,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'שפיות בילי',                                        release: '374', cycle: '1276', planId: '74537', labId: '74532' },
  { total: 21, responsible: 'roiv',    planned: 21, passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'Addressability',                                    release: '374', cycle: '1276', planId: '74533', labId: '74532' },
  { total: 1,  responsible: 'maamona', planned: 1,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'Web Site NEXT',                                     release: '374', cycle: '1276', planId: '74539', labId: '74532' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: 'HOT ENERGY',          title: '12821 - שירות חשמל בכתובות ללא תשתית הוט',          release: '374', cycle: '1276', planId: '74525', labId: '74524' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'CRM',                                               release: '374', cycle: '1276', planId: '74534', labId: '74532' },
  { total: 8,  responsible: 'roiv',    planned: 8,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'Wizard HOTNET',                                     release: '374', cycle: '1276', planId: '74550', labId: '74548' },
  { total: 3,  responsible: 'roiv',    planned: 3,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'TOP TECH',                                          release: '374', cycle: '1276', planId: '74535', labId: '74532' },
  { total: 2,  responsible: 'maamona', planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'חשבוניות ודף מקדים',                                release: '374', cycle: '1276', planId: '74551', labId: '74548' },
  { total: 2,  responsible: 'maamona', planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, subject: '',                    title: 'חשבוניות ודף מקדים',                                release: '374', cycle: '1276', planId: '74536', labId: '74532' },
];

// Defaults for DefectDto's extended fields (2026-09-14 addition) — the mock
// fallback only fabricates realistic values for the original "always
// useful" subset above; the extended BG_USER_XX fields just need to satisfy
// the type, so every mock row spreads this rather than repeating 45 blank
// fields four times over.
const EMPTY_EXTENDED_DEFECT_FIELDS = {
  subject: '', qaTester: '', estimatedFixTime: '', actualFixTime: '', closedBy: '', deploymentReason: '',
  fixedUntil: '', vendorStatus: '', responseDate: '', supportReferenceNumber: '', subModule: '', fixedInProd: '',
  mainModule: '', supportStatus: '', vendorAssignTo: '', category: '', itemType: '', estimateFixTime: '',
  platform: '', modified: '', detectedInRelease: '', detectedInCycle: '', targetCycle: '', crStatus: '',
  dropNumber: '', detectedApkVersion: '', detectedHotAppApk: '', targetHotAppApk: '', influence: '', secondaryPriority: '', releaseDefect: '', businessProcess: '',
  foundByAutomation: '', mainBusinessProcess: '', impact: '', productionReason: '', environmentComponent: '',
  willBeTestAtGoLive: '', deploymentCategory: '', defectResponsible: '', targetReleaseReason: '', targetType: '',
  systemComponent: '', forRegressionTest: '', escDefectResponsible: '', toBeTestedOnProd: '', deploymentDateProd: '',
  targetScopeApproved: '',
};

const MOCK_DEFECTS: DefectDto[] = [
  {
    ...EMPTY_EXTENDED_DEFECT_FIELDS,
    id: '7727', assignedTo: 'odelyac', system: 'NC', title: 'רשומות כפולות בממשק בנקים',
    description: 'בממשק הבנקים נוצרו רשומות כפולות עבור אותו לקוח.',
    reproducible: 'Y', severity: 'Severe', priority: 'High', reporter: 'innad',
    discoveryDate: '22/02/2011', environment: 'NC-Prod', status: 'Open',
    testPhase: 'System Test', defectType: 'Design', notes: 'תקלה נסגרה לאחר טיפול.',
    responsibility: 'NC Team', crHbrNumberReference: '', crReferenceNumber: '', fixType: 'Root Cause', reason: '', reopenYn: 'N', targetRelease: '',
  },
  {
    ...EMPTY_EXTENDED_DEFECT_FIELDS,
    id: '8247', assignedTo: 'maamona', system: 'NC', title: 'רישום כפול של אירוע אישור הוראת קבע ב-CRM',
    description: 'בעת קליטת אישור הוראת קבע מהבנק נרשמים מספר אירועים ב-CRM.',
    reproducible: 'Y', severity: 'Low', priority: 'Medium', reporter: 'avia',
    discoveryDate: '05/04/2011', environment: 'Crm Prod', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'ממשקי EAI היו לא זמינים בזמן הבדיקה.',
    responsibility: 'CRM Team', crHbrNumberReference: '', crReferenceNumber: '', fixType: '', reason: 'Duplicate', reopenYn: 'N', targetRelease: '',
  },
  {
    ...EMPTY_EXTENDED_DEFECT_FIELDS,
    id: '7884', assignedTo: 'yossif', system: 'ISPIT', title: 'קובץ רענונים של HotNet נוצר ריק',
    description: 'תהליך יצירת קובץ הרענונים הסתיים בהצלחה אך הקובץ שנוצר היה ריק.',
    reproducible: 'Y', severity: 'Show Stopper', priority: 'Low', reporter: 'avia',
    discoveryDate: '08/03/2011', environment: 'NC-Mig-Prod', status: 'Open',
    testPhase: 'System Test', defectType: 'Installation', notes: 'מקור התקלה — בעיית Setup בטבלאות Billing.',
    responsibility: 'NC Team', crHbrNumberReference: '', crReferenceNumber: '', fixType: 'Instance', reason: '', reopenYn: 'N', targetRelease: 'ITv09-2026',
  },
  {
    ...EMPTY_EXTENDED_DEFECT_FIELDS,
    id: '12697', assignedTo: 'annal', system: 'SSO', title: 'לא נשלח מייל לאחר הסרה מרשימת דיוור',
    description: 'משתמש לא קיבל מייל אישור לאחר סימון הסרה מרשימת הדיוור.',
    reproducible: 'Y', severity: 'Severe', priority: 'High', reporter: 'vladimirs',
    discoveryDate: '22/05/2012', environment: 'MY HOT Test', status: 'Open',
    testPhase: 'System Test', defectType: 'Functional', notes: 'המייל נשלח — הייתה טעות בכתובת.',
    responsibility: 'SSO Team', crHbrNumberReference: '13040-reg', crReferenceNumber: '', fixType: 'Root Cause', reason: '', reopenYn: 'Y', targetRelease: 'ITv09-2026',
  },
];

const MOCK_CR_ITEMS: CrItemDto[] = [
  { id: '12969', description: 'דרישות חדשות מערכת תזכורות ב-CRM',         label: '12969 - דרישות חדשות מערכת תזכורות ב-CRM' },
  { id: '13072', description: 'שינוי בהתנהלות של מסך AI',                  label: '13072 - שינוי בהתנהלות של מסך AI' },
  { id: '12821', description: 'שירות חשמל בכתובות ללא תשתית הוט',          label: '12821 - שירות חשמל בכתובות ללא תשתית הוט' },
  { id: '13145', description: 'שיפור ביצועי מודול ה-Addressability',        label: '13145 - שיפור ביצועי מודול ה-Addressability' },
  { id: '13201', description: 'תיקון רישום כפול בממשק בנקים',               label: '13201 - תיקון רישום כפול בממשק בנקים' },
  { id: '13312', description: 'עדכון חשבוניות ודף מקדים HOTNET',            label: '13312 - עדכון חשבוניות ודף מקדים HOTNET' },
  { id: '13387', description: 'שינויים בתהליך TOP TECH',                    label: '13387 - שינויים בתהליך TOP TECH' },
  { id: '13410', description: 'Wizard HOTNET — תיקוני ממשק',                label: '13410 - Wizard HOTNET — תיקוני ממשק' },
  { id: '13455', description: 'CRM — עדכון מסך AI בחטיבת שירות',           label: '13455 - CRM — עדכון מסך AI בחטיבת שירות' },
  { id: '13502', description: 'Web Site NEXT — עדכוני עיצוב',               label: '13502 - Web Site NEXT — עדכוני עיצוב' },
];

// Compact defect definitions — expanded below into one row per (month it was
// open), matching what OPEN_PROD_DEFECTS_HISTORY_SQL would return for real
// Oracle data. `openMonths` = 'YYYY-MM' strings this defect was still open.
// Every field below (id, severity, priority, responsibility, area — the
// CR/Production/Regression-overloaded BG_USER_10 — bugType, fixType,
// detectedDate) is copied verbatim from 8 real open/reopened defects in
// backend/src/qc/seed-data/target-defects.local.json (a genuine Oracle
// export, gitignored), picked for their real detection dates falling in
// this mock's Sep 2025–Feb 2026 window — only `openMonths` (which months
// each one is simulated as still-open) is synthesized, since a single
// snapshot file has no month-by-month history to draw from. Previously
// these fields were invented outright, including a defect-ID range no real
// defect uses — fixed per explicit user request 2026-08-05.
const MOCK_OPEN_PROD_DEFECTS_SOURCE: {
  id: string; severity: string; priority: string; responsibility: string;
  area: string; bugType: string; fixType: string; detectedDate: string;
  reopenYn: string; currentStatus: string; openMonths: string[];
  title: string; assignedTo: string; qaTester: string; environment: string;
  subModule: string; mainModule: string; crReferenceNumber: string; platform: string;
  closedBy: string; estimatedFixTime: string; actualFixTime: string; deploymentReason: string;
}[] = [
  { id: '61615', severity: 'Low',    priority: 'High',   responsibility: 'ofirt',                    area: 'Production',                                          bugType: 'Change Requests', fixType: '',           detectedDate: '2025-09-18', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'],
    title: 'תיקון סיווגי תנועות',                          assignedTo: 'ofirt',          qaTester: 'Odelya Ezra',  environment: 'NC-Prod',  subModule: 'Billing',       mainModule: 'Wizard',    crReferenceNumber: '',      platform: 'Web',     closedBy: '',        estimatedFixTime: '4',  actualFixTime: '',   deploymentReason: 'Bug Fix' },
  { id: '61976', severity: 'Medium', priority: 'Medium', responsibility: 'HOT Design Team',           area: '12646 - חסימת ניתוק לפני הקפאת חיוב שלב ג',            bugType: 'Design',           fixType: '',           detectedDate: '2025-11-30', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2025-11', '2025-12', '2026-01', '2026-02'],
    title: 'חסימת ניתוק לפני הקפאת חיוב שלב ג',             assignedTo: 'Anna Leshem',     qaTester: 'Irina Klebansky', environment: 'CRM-Prod', subModule: 'Collections',  mainModule: 'CRM',       crReferenceNumber: '12646', platform: 'Web',     closedBy: '',        estimatedFixTime: '8',  actualFixTime: '',   deploymentReason: 'CR' },
  { id: '62224', severity: 'Medium', priority: 'Low',    responsibility: 'HOT Design Team',           area: '12714 - החלפת מערכת אקווריום',                        bugType: 'Change Requests', fixType: '',           detectedDate: '2025-12-29', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2025-12', '2026-01', '2026-02'],
    title: 'החלפת מערכת אקווריום',                          assignedTo: 'Yakov Chekol',    qaTester: 'Limor Pinhas', environment: 'CRM-Prod', subModule: 'Provisioning', mainModule: 'CRM',       crReferenceNumber: '12714', platform: 'Web',     closedBy: '',        estimatedFixTime: '16', actualFixTime: '',   deploymentReason: 'CR' },
  { id: '62439', severity: 'Medium', priority: 'Medium', responsibility: 'OfficeTrack (3rd party)',   area: 'Regression',                                          bugType: 'Functional',       fixType: 'Root Cause', detectedDate: '2026-01-25', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2026-01', '2026-02'],
    title: 'תקלת רגרסיה במודול OfficeTrack',                 assignedTo: 'Stanislav Abramyan', qaTester: 'roi vahab', environment: 'OT-Prod',  subModule: 'Scheduling',   mainModule: 'OfficeTrack', crReferenceNumber: '',    platform: 'Mobile',  closedBy: '',        estimatedFixTime: '6',  actualFixTime: '',   deploymentReason: 'Bug Fix' },
  { id: '62506', severity: 'Medium', priority: 'High',   responsibility: 'DWH Team;ETL Team',         area: '12736 - HBO   ממשקים ואתר HOT',                       bugType: 'Functional',       fixType: '',           detectedDate: '2026-02-05', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2026-02'],
    title: 'ממשקים HBO ואתר HOT לא מסונכרנים',               assignedTo: 'Joseph Abdallah', qaTester: 'Evana Raed',  environment: 'DWH-Prod', subModule: 'Interfaces',   mainModule: 'DWH',       crReferenceNumber: '12736', platform: 'Web',     closedBy: '',        estimatedFixTime: '12', actualFixTime: '',   deploymentReason: 'CR' },
  { id: '62537', severity: 'Medium', priority: 'High',   responsibility: 'Dalia (3rd party)',         area: 'Production',                                          bugType: 'Change Requests', fixType: 'Design',     detectedDate: '2026-02-10', reopenYn: 'Y', currentStatus: 'Reopen', openMonths: ['2026-02'],
    title: 'תקלה חוזרת בממשק Dalia',                        assignedTo: 'Maamon Alwan',    qaTester: 'Anna Leshem',  environment: 'NC-Prod',  subModule: 'Billing',      mainModule: 'Dalia',     crReferenceNumber: '',      platform: 'Web',     closedBy: '',        estimatedFixTime: '4',  actualFixTime: '',   deploymentReason: 'Bug Fix' },
  { id: '62595', severity: 'Severe', priority: 'High',   responsibility: 'HOT Design Team',           area: 'Production',                                          bugType: 'Functional',       fixType: '',           detectedDate: '2026-02-22', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2026-02'],
    title: 'קריסת מסך בעת פתיחת הזמנה',                     assignedTo: 'Irina Klebansky', qaTester: 'Limor Pinhas', environment: 'CRM-Prod', subModule: 'Orders',       mainModule: 'CRM',       crReferenceNumber: '',      platform: 'Web',     closedBy: '',        estimatedFixTime: '2',  actualFixTime: '',   deploymentReason: 'Bug Fix' },
  { id: '62867', severity: 'Medium', priority: 'High',   responsibility: 'OSS Team',                  area: 'Production',                                          bugType: 'Functional',       fixType: 'Root Cause', detectedDate: '2026-02-25', reopenYn: 'N', currentStatus: 'Open',   openMonths: ['2026-02'],
    title: 'תקלת ביצועים במערכת OSS',                       assignedTo: 'roi vahab',       qaTester: 'Stanislav Abramyan', environment: 'OSS-Prod', subModule: 'Network',   mainModule: 'OSS',       crReferenceNumber: '',      platform: 'Web',     closedBy: '',        estimatedFixTime: '10', actualFixTime: '',   deploymentReason: 'Bug Fix' },
];

function buildMockOpenProdDefectsHistory(): OpenProdDefectMonthDto[] {
  const rows: OpenProdDefectMonthDto[] = [];
  for (const d of MOCK_OPEN_PROD_DEFECTS_SOURCE) {
    for (const monthLabel of d.openMonths) {
      const isLastMonth = monthLabel === d.openMonths[d.openMonths.length - 1];
      rows.push({
        monthDate: `${monthLabel}-01`,
        monthLabel,
        defectId: d.id,
        statusAtMonth: isLastMonth ? d.currentStatus : 'At Work',
        currentStatus: d.currentStatus,
        releaseId: 'ITv06-2026',
        severity: d.severity,
        priority: d.priority,
        responsibility: d.responsibility,
        testPhase: 'Sanity Test',
        detectedBy: 'qa-team',
        detectedDate: d.detectedDate,
        reopenYn: d.reopenYn,
        area: d.area,
        bugType: d.bugType,
        fixType: d.fixType,
        title: d.title,
        assignedTo: d.assignedTo,
        qaTester: d.qaTester,
        environment: d.environment,
        subModule: d.subModule,
        mainModule: d.mainModule,
        crReferenceNumber: d.crReferenceNumber,
        platform: d.platform,
        closedBy: d.closedBy,
        estimatedFixTime: d.estimatedFixTime,
        actualFixTime: d.actualFixTime,
        deploymentReason: d.deploymentReason,
        detectedApkVersion: null, detectedHotAppApk: null, targetHotAppApk: null,
      });
    }
  }
  return rows;
}

const MOCK_OPEN_PROD_DEFECTS_HISTORY: OpenProdDefectMonthDto[] = buildMockOpenProdDefectsHistory();

// Compact per-release quota (Target) + per-team defect counts (New), expanded
// below into one row per synthetic defect — mirrors what NEW_VS_TARGET_DEFECTS_SQL
// returns for real Oracle data (one BUG row with a TARGET_REL and a
// DETECTED_IN_REL, which may differ when a defect slips past its target release).
const MOCK_NEW_VS_TARGET_SOURCE: {
  release: string; target: number;
  byTeam: { team: string; newCount: number; severities: string[] }[];
}[] = [
  { release: 'ITv01-2025', target: 5,  byTeam: [{ team: 'NETC-DT team', newCount: 27, severities: ['Severe', 'Severe', 'Medium', 'Show Stopper', 'Low'] }] },
  { release: 'ITv02-2025', target: 16, byTeam: [{ team: 'NETC-DT team', newCount: 10, severities: ['Medium', 'Low', 'Severe'] }] },
  { release: 'ITv03-2025', target: 16, byTeam: [{ team: 'NETC-DT team', newCount: 11, severities: ['Low', 'Medium'] }] },
  { release: 'ITv04-2025', target: 10, byTeam: [{ team: 'NETC-DT team', newCount: 18, severities: ['Severe', 'Show Stopper', 'Medium'] }] },
  { release: 'ITv05-2025', target: 10, byTeam: [{ team: 'NETC-DT team', newCount: 14, severities: ['Medium', 'Low'] }] },
  { release: 'ITv06-2025', target: 31, byTeam: [{ team: 'NETC-DT team', newCount: 12, severities: ['Low', 'Medium'] }] },
  { release: 'ITv07-2025', target: 31, byTeam: [{ team: 'NETC-DT team', newCount: 10, severities: ['Medium'] }] },
  { release: 'ITv08-2025', target: 14, byTeam: [{ team: 'NETC-DT team', newCount: 22, severities: ['Severe', 'Medium', 'Low'] }] },
];

// Strips common team-suffix words so Oracle's free-text BG_RESPONSIBLE
// ("CRM Team", "NETC-DT team", "צוות CRM") can be fuzzily matched against our
// own Team.name values without requiring an exact mapping table.
function normalizeTeamName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\bteam\b/gi, '')
    .replace(/צוות/g, '')
    .replace(/[-_\s]+/g, '')
    .trim();
}

// Real anonymized-in-place QC export (985 rows), gitignored — see
// backend/src/qc/seed-data/. Not present on every machine/CI, so this falls
// back to the synthetic generator below when missing. Loaded once and
// cached; the file never changes at runtime.
let realTargetDefectsCache: TargetDefectDto[] | null | undefined;
// DEV ONLY (2026-10-07): real defects exported from production QC ("AllBugs"
// Excel = the defects SQL's own columns), converted by
// scripts/import-real-defects-seed.js into the git-ignored seed folder. When
// present and Oracle is disabled, the mock defects module / search / lists /
// defect form use these instead of synthetic defects. Never used with Oracle.
// Dev seed files of the request's QC project (2026-10-09): another project's
// files live in seed-data/projects/<key>/ — the default project keeps the
// top-level ones.
function devSeedPath(file: string): string {
  const key = currentQcProjectKey();
  return key
    ? path.join(process.cwd(), 'src', 'qc', 'seed-data', 'projects', key, file)
    : path.join(process.cwd(), 'src', 'qc', 'seed-data', file);
}

const realAllBugsFiles = new Map<string, { mtime: number; rows: any[] | null; byId: Map<string, any> | null }>();
function loadRealAllBugsEntry(): { mtime: number; rows: any[] | null; byId: Map<string, any> | null } {
  const filePath = devSeedPath('allbugs.local.json');
  let mtime = 0;
  try { mtime = fs.statSync(filePath).mtimeMs; } catch { mtime = 0; }
  // re-read when the file is regenerated (no server restart needed)
  const hit = realAllBugsFiles.get(filePath);
  if (hit && hit.mtime === mtime) return hit;
  let rows: any[] | null = null;
  try {
    const parsed = mtime ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : null;
    rows = Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch { rows = null; }
  const entry = { mtime, rows, byId: null as Map<string, any> | null };
  realAllBugsFiles.set(filePath, entry);
  return entry;
}
function loadRealAllBugs(): any[] | null {
  return loadRealAllBugsEntry().rows;
}
function realAllBugById(id: string): any | null {
  const e = loadRealAllBugsEntry();
  if (!e.rows) return null;
  if (!e.byId) e.byId = new Map(e.rows.map(r => [String(r.DEFECT_ID), r]));
  return e.byId.get(String(id)) ?? null;
}
// DEV ONLY: value lists for the form's dropdowns while there's no QC — the
// distinct values each list field really has across the real export.
export function devPicklistsFromRealSeed(listKeys: string[]): Record<string, { values: string[]; lastSyncAt: Date }> {
  const out: Record<string, { values: string[]; lastSyncAt: Date }> = {};
  // 1. the real QC Project Lists (production dump, seed-data/qc-lists.local.json)
  try {
    const lists = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'qc', 'seed-data', 'qc-lists.local.json'), 'utf-8'));
    for (const k of listKeys) {
      const id = QC_DEFECT_FIELDS[k]?.listId;
      const vals: string[] = id && lists[id] ? Array.from(new Set<string>(lists[id].values.map((v: string) => String(v).trim()).filter(Boolean))) : [];
      if (vals.length) out[k] = { values: vals, lastSyncAt: new Date() };
    }
  } catch { /* no lists snapshot */ }
  // 2. otherwise the distinct values the real defects export holds
  const rows = loadRealAllBugs();
  if (!rows) return out;
  const sets: Record<string, Set<string>> = Object.fromEntries(listKeys.filter(k => !out[k]).map(k => [k, new Set<string>()]));
  for (const r of rows) {
    const d: any = mapRowToTargetDefect(r);
    for (const k of Object.keys(sets)) { const v = String(d[k] ?? '').trim(); if (v) sets[k].add(v); }
  }
  for (const [k, s] of Object.entries(sets)) if (s.size > 0) out[k] = { values: [...s].sort((a, b) => a.localeCompare(b)), lastSyncAt: new Date() };
  return out;
}

// ── Paired defect fields (user, 2026-10-08) ────────────────────────────────
// Release + cycle are pairs (Detected in Release/Cycle, Target Release/Cycle):
// the form offers only the chosen release's own cycles. Every QC release
// since 2022 with its cycles, newest first; releases a DeployCenter version is
// running right now are flagged `inFlight` (shown on top). Names, never ids,
// are what the user sees; the ids go to QC.
export interface ReleaseCycleOption { id: string; name: string; startDate: string | null; inFlight: boolean; cycles: { id: string; name: string; startDate: string | null }[] }

const RELEASE_CYCLE_OPTIONS_SQL = `
  SELECT RR.REL_ID, RR.REL_NAME, TO_CHAR(RR.REL_START_DATE, 'YYYY-MM-DD') AS REL_START,
         RC.RCYC_ID, RC.RCYC_NAME, TO_CHAR(RC.RCYC_START_DATE, 'YYYY-MM-DD') AS RCYC_START
  FROM RELEASES RR
  LEFT JOIN RELEASE_CYCLES RC ON RC.RCYC_PARENT_ID = RR.REL_ID
  WHERE RR.REL_START_DATE > TO_DATE('2022-01-01', 'YYYY-MM-DD')
  ORDER BY RR.REL_START_DATE DESC, RC.RCYC_START_DATE, RC.RCYC_ID
`;

const byStartThenId = (a: { startDate: string | null; id: string }, b: { startDate: string | null; id: string }) =>
  String(a.startDate ?? '').localeCompare(String(b.startDate ?? '')) || Number(a.id) - Number(b.id);

export async function getReleaseCycleOptions(): Promise<ReleaseCycleOption[]> {
  const { enabled } = await getOracleConfig();
  let releases: Omit<ReleaseCycleOption, 'inFlight'>[] = [];
  if (enabled) {
    releases = await qcMemo('release-cycle-options', async () => {
      const conn = await oracleConnect();
      try {
        const res = await conn.execute(RELEASE_CYCLE_OPTIONS_SQL);
        const byId = new Map<string, Omit<ReleaseCycleOption, 'inFlight'>>();
        for (const r of (res.rows ?? []) as any[]) {
          const id = String(r.REL_ID);
          if (!byId.has(id)) byId.set(id, { id, name: String(r.REL_NAME ?? '').trim(), startDate: r.REL_START ?? null, cycles: [] });
          if (r.RCYC_ID != null) byId.get(id)!.cycles.push({ id: String(r.RCYC_ID), name: String(r.RCYC_NAME ?? '').trim(), startDate: r.RCYC_START ?? null });
        }
        return [...byId.values()];
      } finally {
        await conn.close().catch(() => {});
      }
    }, 10 * 60_000);
  } else {
    // dev: the real RELEASES/CYCLES exports (scripts/import-real-defects-seed.js)
    try {
      releases = JSON.parse(fs.readFileSync(devSeedPath('release-cycles.local.json'), 'utf-8'));
    } catch {
      const rows = await prisma.qcRelease.findMany({ orderBy: { relStartDate: 'desc' } });
      releases = rows.map(r => ({
        id: String(r.relId), name: r.relName, startDate: r.relStartDate?.toISOString().slice(0, 10) ?? null,
        cycles: [
          r.rehearsalCycleId ? { id: String(r.rehearsalCycleId), name: 'Dress Rehearsal', startDate: r.rehearsalDate?.toISOString().slice(0, 10) ?? null } : null,
          r.goLiveCycleId ? { id: String(r.goLiveCycleId), name: 'Go Live', startDate: r.goLiveDate?.toISOString().slice(0, 10) ?? null } : null,
        ].filter(Boolean) as ReleaseCycleOption['cycles'],
      }));
    }
  }
  // by QC id, or by name (the version is named after its QC release)
  const running = await prisma.version.findMany({
    where: { isQcHistorical: false, status: { notIn: ['DRAFT', 'COMPLETED', 'ROLLED_BACK'] } },
    select: { name: true, qcRelease: { select: { relId: true, relName: true } } },
  });
  const ids = new Set(running.map(v => v.qcRelease ? String(v.qcRelease.relId) : '').filter(Boolean));
  const names = new Set(running.flatMap(v => [v.name, v.qcRelease?.relName ?? '']).map(n => n.trim().toLowerCase()).filter(Boolean));
  return releases.map(r => ({ ...r, cycles: [...r.cycles].sort(byStartThenId), inFlight: ids.has(r.id) || names.has(r.name.trim().toLowerCase()) }));
}

// Team (Responsibility) + Environment Component are a pair too: a team's
// components are its "QC Environment Components" (AdminPanel), else its
// systems (apps — what the deployments module uses); a team with neither
// gets the full list. `all` = every team's components + values already used.
export async function getTeamEnvironmentComponents(): Promise<{ teams: { name: string; responsibility: string | null; components: string[] }[]; all: string[] }> {
  const teams = await prisma.team.findMany({ where: { active: true }, select: { name: true, qcResponsibilityValue: true, qcEnvironmentComponents: true, apps: true } });
  const out = teams.map(t => ({
    name: t.name,
    responsibility: t.qcResponsibilityValue?.trim() || null,
    components: (t.qcEnvironmentComponents.length > 0 ? t.qcEnvironmentComponents : t.apps).map(s => s.trim()).filter(Boolean),
  }));
  const all = new Set<string>(out.flatMap(t => t.components));
  const { enabled } = await getOracleConfig();
  if (enabled) {
    const used = await qcMemo('environment-component-values', async () => {
      const conn = await oracleConnect();
      try {
        const res = await conn.execute(`SELECT DISTINCT BG_USER_49 AS V FROM BUG WHERE BG_USER_49 IS NOT NULL`);
        return ((res.rows ?? []) as any[]).map(r => String(r.V ?? '').trim()).filter(Boolean);
      } finally {
        await conn.close().catch(() => {});
      }
    }, 10 * 60_000).catch(() => [] as string[]);
    for (const v of used) all.add(v);
  } else {
    for (const r of loadRealAllBugs() ?? []) { const v = String(r.ENVIRONMENT_COMPONNENT ?? '').trim(); if (v) all.add(v); }
  }
  return { teams: out, all: [...all].sort((a, b) => a.localeCompare(b)) };
}

// ── QC edit locks (user, 2026-10-09) ───────────────────────────────────────
// A user standing on a defect in the QC client locks it; any other write is
// refused until they leave it. QC keeps those locks in the project schema's
// LOCKS table — read here (cheap, no REST login) so the form can say "open
// for editing by X" before the user starts. The column names are the
// standard ALM ones (LK_OBJECT_TYPE / LK_OBJECT_KEY / LK_USER / LK_TIME) but
// NOT yet confirmed on this instance: the row is read generically, and any
// Oracle error = "unavailable" (the save-time REST check still applies).
// probeLocksTable (admin lab) shows the real table to confirm it.
export interface DefectLock { locked: boolean; by?: string; byName?: string; since?: string; source: 'oracle' | 'dev' | 'unavailable'; error?: string }

const DEFECT_LOCK_SQL = `SELECT * FROM LOCKS WHERE LK_OBJECT_TYPE IN ('BUG', 'DEFECT') AND TO_CHAR(LK_OBJECT_KEY) = :defectId`;

function lockFromRow(row: Record<string, any>): { by?: string; since?: string } {
  const cols = Object.keys(row);
  const userCol = cols.find(c => /USER/i.test(c));
  const timeCol = cols.find(c => /TIME|DATE/i.test(c));
  const t = timeCol ? row[timeCol] : null;
  return {
    by: userCol && row[userCol] != null ? String(row[userCol]).trim() : undefined,
    since: t instanceof Date ? t.toISOString() : t != null ? String(t) : undefined,
  };
}

async function withPersonName(lock: DefectLock): Promise<DefectLock> {
  if (!lock.by) return lock;
  const person = ((await getQcPersonDirectory().catch(() => null)) ?? []).find(p => p.login.toLowerCase() === lock.by!.toLowerCase());
  return { ...lock, byName: person?.fullName ?? lock.by };
}

export async function getDefectLock(defectId: string): Promise<DefectLock> {
  const { enabled } = await getOracleConfig();
  if (!enabled) {
    // dev: seed-data/locks.local.json = { "<defectId>": { "user": "<login>", "since": "<iso>" } }
    try {
      const all = JSON.parse(fs.readFileSync(devSeedPath('locks.local.json'), 'utf-8'));
      const l = all[defectId];
      return withPersonName(l ? { locked: true, by: l.user, since: l.since, source: 'dev' } : { locked: false, source: 'dev' });
    } catch {
      return { locked: false, source: 'dev' };
    }
  }
  let conn: any;
  try {
    conn = await oracleConnect();
    const res = await conn.execute(DEFECT_LOCK_SQL, { defectId: String(defectId) });
    const row = (res.rows ?? [])[0];
    return withPersonName(row ? { locked: true, ...lockFromRow(row), source: 'oracle' } : { locked: false, source: 'oracle' });
  } catch (err: any) {
    return { locked: false, source: 'unavailable', error: err.message };
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

// QC projects admin: can this request's project schema be read? (2026-10-09)
export async function testQcProjectOracle(): Promise<{ ok: boolean; message: string }> {
  let conn: any;
  try {
    conn = await oracleConnect();
    const r = ((await conn.execute(`SELECT COUNT(*) AS N, MAX(BG_BUG_ID) AS MX FROM BUG`)).rows ?? [])[0] as any;
    const schema = ((await conn.execute(`SELECT SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS S FROM DUAL`)).rows ?? [])[0] as any;
    return { ok: true, message: `Oracle: סכמה ${schema?.S ?? '?'} — ${r?.N ?? 0} תקלות (מספר אחרון ${r?.MX ?? '—'})` };
  } catch (err: any) {
    return { ok: false, message: `Oracle: ${err.message}` };
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

// admin lab: the real LOCKS table (columns + a sample) and this defect's row
export async function probeLocksTable(defectId?: string): Promise<{ columns?: string[]; sample?: any[]; forDefect?: any[]; error?: string; forDefectError?: string }> {
  const { enabled } = await getOracleConfig();
  if (!enabled) return { error: 'Oracle לא מוגדר בסביבה הזו' };
  let conn: any;
  try {
    conn = await oracleConnect();
    const res = await conn.execute(`SELECT * FROM LOCKS WHERE ROWNUM <= 20`);
    const sample = (res.rows ?? []) as any[];
    const columns = (res.metaData ?? []).map((m: any) => m.name);
    let forDefect: any[] | undefined;
    let forDefectError: string | undefined;
    if (defectId) {
      try { forDefect = ((await conn.execute(DEFECT_LOCK_SQL, { defectId: String(defectId) })).rows ?? []) as any[]; }
      catch (e: any) { forDefectError = e.message; }
    }
    return { columns, sample, forDefect, forDefectError };
  } catch (err: any) {
    return { error: err.message };
  } finally {
    if (conn) await conn.close().catch(() => {});
  }
}

// mock-mode rows for the defects module's dashboard / page / filtered list
function mockAllDefectsRows(): AllDefectsRawRow[] {
  const real = loadRealAllBugs();
  if (!real) return MOCK_ALL_DEFECTS_ROWS;
  return real.map(r => ({
    DEFECT_ID: r.DEFECT_ID, DEFECT_STATUS: r.DEFECT_STATUS ?? null, SEVERITY: r.SEVERITY ?? null,
    MAIN_MODULE: r.MAIN_MODULE ?? null, RESPONSIBILITY: r.RESPONSIBILITY ?? null, ASSIGNED_TO: r.ASSIGNED_TO ?? null,
    REOPEN_YN: r.REOPEN_Y_N ?? null, DETECTED_IN_RELEASE: r.DETECTED_IN_RELEASE ?? null,
    DETECTED_ON_DATE: r.DETECTED_ON_DATE ?? null, ENVIRONMENT_COMPONENT: r.ENVIRONMENT_COMPONNENT ?? null,
    TITLE: r.SUMMARY || r.SUBJECT || null,
  }));
}

function loadRealTargetDefects(): TargetDefectDto[] | null {
  if (realTargetDefectsCache !== undefined) return realTargetDefectsCache;
  try {
    // Resolved from process.cwd() (backend/), not __dirname — this file
    // lives under src/ and is never copied into dist/ by the Nest build
    // (no nest-cli.json asset-copy config), so __dirname would look in the
    // wrong place once running from compiled output.
    const filePath = path.join(process.cwd(), 'src', 'qc', 'seed-data', 'target-defects.local.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    realTargetDefectsCache = JSON.parse(raw) as TargetDefectDto[];
  } catch {
    realTargetDefectsCache = null;
  }
  return realTargetDefectsCache;
}

// Real per-CR test-execution coverage (QC_REQUIRMENTS_COVERAGE export),
// aggregated by CR number — see backend/src/qc/seed-data/. Same
// gitignored-real-data pattern as loadRealTargetDefects. coveragePct here is
// "% of planned tests actually executed" (Passed+Failed+Blocked+NotCompleted
// over the total, i.e. everything except NotRun/NotReady) — execution rate,
// not pass rate.
export interface CrCoverageDto {
  crNumber: string; crTitle: string; releaseName: string; cycleName: string;
  passed: number; failed: number; notRun: number; blocked: number; notCompleted: number; notReady: number;
  notApplicable: number; notRelevant: number;
  total: number; coveragePct: number;
  // RQ_USER_05 ("Responsible") per requirement under this CR/cycle — the
  // real QC-native owner, distinct from our own QaAssignment (who WE
  // scheduled to test it). Added 2026-10-01 for historical/relId-only
  // releases, which have no QaAssignment row at all; joined with " + " when
  // a CR/cycle bucket spans requirements with more than one distinct
  // responsible. '' when every requirement's RQ_USER_05 was empty.
  responsible: string;
}

// Cycle-wide, CR-agnostic totals — see CYCLE_TEST_TOTALS_SQL's own comment
// for why this exists alongside CrCoverageDto (per-CR dedup isn't the same
// as per-cycle dedup).
export interface CycleTestTotalsDto {
  cycleName: string;
  passed: number; failed: number; notRun: number; blocked: number; notCompleted: number; notReady: number;
  notApplicable: number; notRelevant: number;
  total: number;
}
let realCrCoverageCache: CrCoverageDto[] | null | undefined;
function loadRealCrCoverage(): CrCoverageDto[] | null {
  if (realCrCoverageCache !== undefined) return realCrCoverageCache;
  try {
    const filePath = path.join(process.cwd(), 'src', 'qc', 'seed-data', 'test-coverage.local.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    // Normalize: the seed file predates `responsible` and the N/A / Not
    // Relevant counts — default them so sums don't turn into NaN (which
    // serializes as null and crashed Coverage & Readiness's toFixed).
    const parsed = JSON.parse(raw) as Partial<CrCoverageDto>[];
    realCrCoverageCache = parsed.map(r => ({ responsible: '', notApplicable: 0, notRelevant: 0, ...r } as CrCoverageDto));
  } catch {
    realCrCoverageCache = null;
  }
  return realCrCoverageCache;
}

// Real per-cycle Quality Gate coverage targets (RELEASE_CYCLES.QG_HIGH/
// QG_MEDIUM/QG_LOW), keyed by (releaseName, cycleName) — see
// backend/src/qc/seed-data/. Same gitignored-real-data pattern as the two
// loaders above. Genuinely varies per real cycle (26 distinct combos seen),
// not a flat 100% everywhere.
export interface CycleQgTargetDto {
  releaseName: string; cycleName: string; qgHigh: number; qgMedium: number; qgLow: number;
  // Real cycle planned dates (RCYC_START_DATE/END_DATE) — added 2026-10-01
  // for historical/relId-only releases, which have no local QaWorkPlan to
  // read cycle dates from. null in mock mode (no seed data carries these yet).
  cycleStart: Date | null; cycleEnd: Date | null;
}
let realCycleQgTargetsCache: CycleQgTargetDto[] | null | undefined;
function loadRealCycleQgTargets(): CycleQgTargetDto[] | null {
  if (realCycleQgTargetsCache !== undefined) return realCycleQgTargetsCache;
  try {
    const filePath = path.join(process.cwd(), 'src', 'qc', 'seed-data', 'cycle-qg-targets.local.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    // Normalize: the seed file predates cycleStart/cycleEnd, so old rows
    // simply don't have them — default to null rather than leaving undefined.
    const parsed = JSON.parse(raw) as Partial<CycleQgTargetDto>[];
    realCycleQgTargetsCache = parsed.map(r => ({ cycleStart: null, cycleEnd: null, ...r } as CycleQgTargetDto));
  } catch {
    realCycleQgTargetsCache = null;
  }
  return realCycleQgTargetsCache;
}

function buildMockTargetDefects(crNumber: string, releaseName?: string): TargetDefectDto[] {
  const real = loadRealTargetDefects();
  if (real) {
    // Strict match only — showing defects targeted at a DIFFERENT real
    // release than the one actually selected is exactly the bug this is
    // fixing, so no substring/fuzzy fallback here. A version with no real
    // historical match (e.g. a synthetic dev/test version name that was
    // never a real QC release) correctly gets an empty list rather than a
    // misleading mix of unrelated releases.
    return releaseName ? real.filter(d => d.targetRelease === releaseName) : [];
  }
  const teams = ['CRM Team', 'EAI Team', 'OSS Team', 'QA Team'];
  const testers = ['Cohen, Dana', 'Levi, Yossi', 'Peretz, Nissim', ''];
  const systems = ['BSA', 'HOT Energy', 'Billing', 'VC', 'ממשקים'];
  const titles = [
    'שדרוג בקליק', 'Billing', 'WIZ', 'תיקון תצוגה בממשק', 'עדכון פרמטר',
  ];
  // Extended fields (everything beyond the small "always useful" subset
  // above) default to '' in mock mode — dev/Oracle-disabled fallback only
  // needs to be type-correct, not data-accurate; the column-picker simply
  // shows blanks for these until a real Oracle connection is enabled.
  const blankExtendedFields = {
    subject: '', summary: '', description: '', notes: '', reproducible: '', priority: '',
    detectedBy: '', detectedOnDate: '', estimatedFixTime: '', actualFixTime: '',
    environment: '', responsibility: '', testPhase: '', defectType: '', closedBy: '',
    deploymentReason: '', fixedUntil: '', crHbrNumberReference: '', vendorStatus: '',
    responseDate: '', supportReferenceNumber: '', subModule: '', fixedInProd: '',
    mainModule: '', reason: '', supportStatus: '', vendorAssignTo: '', category: '',
    itemType: '', estimateFixTime: '', platform: '', modified: '', detectedInRelease: '',
    detectedInCycle: '', targetRelease: '', targetCycle: '', crStatus: '', dropNumber: '', detectedApkVersion: '', detectedHotAppApk: '', targetHotAppApk: '',
    reopenYn: '', influence: '', fixType: '', secondaryPriority: '', releaseDefect: '',
    businessProcess: '', foundByAutomation: '', mainBusinessProcess: '', impact: '',
    productionReason: '', environmentComponent: '', willBeTestAtGoLive: '',
    deploymentCategory: '', defectResponsible: '', targetReleaseReason: '', targetType: '',
    systemComponent: '', forRegressionTest: '', escDefectResponsible: '', toBeTestedOnProd: '',
    deploymentDateProd: '', targetScopeApproved: '',
  };
  // A couple of rows get realistic multi-line Hebrew description/notes text
  // (dev mode only) so the field-detail form's large text areas have
  // something real to render, not just blanks.
  const sampleDescriptions = [
    'הלקוח מדווח כי לאחר עדכון הגרסה, מסך הצפייה בחשבונית אינו מציג את פירוט השירותים כנדרש.\nהתקלה חוזרת על עצמה גם בסביבת בדיקה וגם בסביבת production.\n\nשלבים לשחזור:\n1. כניסה לאזור אישי\n2. מעבר למסך "חשבוניות"\n3. פתיחת חשבונית אחרונה',
    '',
  ];
  const sampleNotes = [
    'נבדק ע"י צוות הפיתוח — הבעיה נובעת מ-timeout בקריאה ל-API של Billing.\nנדרש תיקון בצד השרת + עדכון ה-timeout ל-30 שניות.',
    '',
  ];
  return Array.from({ length: 6 }, (_, i) => ({
    id: String(1000 + i),
    // Assigned To = a person's QC login; the team lives in responsibility.
    assignedTo: ['yossif', 'annal', 'idany', 'hsupport', 'shaul', 'evanar'][i % 6],
    qaTester: testers[i % testers.length],
    crReferenceNumber: `${crNumber} - TARGET`,
    system: systems[i % systems.length],
    title: titles[i % titles.length],
    status: i % 3 === 0 ? 'Closed' : 'Open',
    severity: i % 4 === 0 ? 'Severe' : 'Medium',
    ...blankExtendedFields,
    description: sampleDescriptions[i % sampleDescriptions.length],
    notes: sampleNotes[i % sampleNotes.length],
  }));
}

function buildMockReportedDefects(): ReportedDefectDto[] {
  const reporters = ['Cohen, Dana', 'Levi, Yossi', 'Peretz, Nissim', 'Mizrahi, Tal'];
  const statuses = ['Open', 'Fixed_Dev', 'Fixed_Test', 'Closed', 'Reopen'];
  const severities = ['Show Stopper', 'Severe', 'Medium', 'Low'];
  const titles = ['תקלה בטעינת מסך', 'שגיאת ולידציה בטופס', 'קריסה בשמירה', 'תצוגה שגויה בדוח', 'בעיית הרשאות'];
  const now = Date.now();
  // A spread of "modified" ages (0 to ~4.5 days back) so the stale-
  // verification alert has something real to flag in dev/mock mode — a
  // Fixed_Test row aged past its severity's threshold should show up.
  return Array.from({ length: 20 }, (_, i) => ({
    id: String(2000 + i),
    title: titles[i % titles.length],
    detectedBy: reporters[i % reporters.length],
    status: statuses[i % statuses.length],
    severity: severities[i % severities.length],
    assignedTo: reporters[(i + 1) % reporters.length],
    discoveryDate: new Date(now - i * 12 * 3600000).toISOString(),
    modified: new Date(now - i * 6 * 3600000).toISOString(),
  }));
}

function buildMockNewVsTargetDefects(): NewVsTargetDefectDto[] {
  const rows: NewVsTargetDefectDto[] = [];
  let seq = 30000;
  for (const r of MOCK_NEW_VS_TARGET_SOURCE) {
    // Target quota — defects whose TARGET_REL is this release (fix commitment).
    // Left undetected (detectedRelName: null) so these rows count only toward
    // Target, not New — a real BUG row would have its own separate detected-in
    // release, often not this one at all.
    for (let i = 0; i < r.target; i++) {
      rows.push({
        defectId: String(seq++),
        targetRelId: r.release, targetRelName: r.release,
        detectedRelId: null, detectedRelName: null,
        responsibility: r.byTeam[0]?.team ?? null,
        severity: 'Medium',
        detectedDate: null,
      });
    }
    // New defects actually detected in this release, per team — no target
    // commitment tracked in this mock (targetRelName: null), so they count
    // only toward New, not Target.
    for (const t of r.byTeam) {
      for (let i = 0; i < t.newCount; i++) {
        rows.push({
          defectId: String(seq++),
          targetRelId: null, targetRelName: null,
          detectedRelId: r.release, detectedRelName: r.release,
          responsibility: t.team,
          severity: t.severities[i % t.severities.length],
          detectedDate: null,
        });
      }
    }
  }
  return rows;
}

const MOCK_NEW_VS_TARGET_DEFECTS: NewVsTargetDefectDto[] = buildMockNewVsTargetDefects();

const MOCK_DEFECT_STATUS_HISTORY: Record<string, DefectStatusHistoryDto[]> = {
  '20411': [
    { status: 'New', changeTime: '2025-11-03T09:00:00' },
    { status: 'At Work', changeTime: '2025-11-05T10:00:00' },
    { status: 'Open', changeTime: '2025-12-01T14:00:00' },
  ],
  '20487': [
    { status: 'New', changeTime: '2025-12-10T09:00:00' },
    { status: 'Fixed_Dev', changeTime: '2025-12-20T11:00:00' },
    { status: 'Fixed_Test', changeTime: '2026-01-05T09:00:00' },
    { status: 'Reopen', changeTime: '2026-01-15T13:00:00' },
  ],
  '20559': [
    { status: 'New', changeTime: '2025-09-15T09:00:00' },
    { status: 'At Work', changeTime: '2025-09-20T09:00:00' },
    { status: 'Fixed_Dev', changeTime: '2025-10-10T09:00:00' },
    { status: 'Closed', changeTime: '2025-10-25T09:00:00' },
    { status: 'Reopen', changeTime: '2025-11-02T09:00:00' },
  ],
};

// Illustrative only (same honest-mock convention as MOCK_DEFECT_STATUS_HISTORY
// above) — real per-field audit data isn't in any local seed file, so this is
// synthesized just to exercise the change-history UI end to end in this
// sandbox. Keyed by a real TARGET-defect ID from the local mock TARGET data
// (62034, ITv01-2026) so it's reachable from the actual detail screen.
const MOCK_DEFECT_FIELD_HISTORY: Record<string, DefectFieldChangeDto[]> = {
  '62034': [
    { changeTime: '2025-12-07T09:12:00', changedBy: 'bat-7', propertyName: 'Bug Status', oldValue: 'New', newValue: 'Open' },
    { changeTime: '2025-12-22T14:05:00', changedBy: 'limork', propertyName: 'Assigned To', oldValue: 'hsupport', newValue: 'limork' },
    { changeTime: '2026-01-21T11:40:00', changedBy: 'roiv', propertyName: 'Bug Status', oldValue: 'Open', newValue: 'Fixed_Dev' },
    { changeTime: '2026-01-21T11:40:00', changedBy: 'roiv', propertyName: 'Severity', oldValue: 'Medium', newValue: 'Severe' },
    { changeTime: '2026-01-21T11:40:00', changedBy: 'roiv', propertyName: 'Summary', oldValue: 'שגיאה בטעינת מסך לקוח', newValue: 'שגיאה בטעינת מסך לקוח - Wizard 360' },
    { changeTime: '2026-02-04T15:41:00', changedBy: 'roiv', propertyName: 'Bug Status', oldValue: 'Fixed_Dev', newValue: 'Closed' },
  ],
};

// Raw BUG rows shape shared by both the mock data below and real Oracle rows
// from BUG_DASHBOARD_SQL — computeBugDashboard() aggregates either the same way.
interface BugRawRow {
  DEFECT_ID: string | number;
  ASSIGNED_TO: string | null;
  RESPONSIBILITY_U3: string | null;   // BG_USER_03 — "Open By Responsibility" groups by this (spec 2026-09-07)
  DEFECT_STATUS: string | null;
  DEFECT_TYPE: string | null;
  CATEGORY_REF: string | null;
  CR_REFERENCE_NUMBER: string | null;
  TARGET_REL: string | number | null;
  DETECTED_ON_DATE: string | Date | null;
  SEVERITY: string | null;
  TITLE?: string | null;   // NVL(BG_SUMMARY, BG_SUBJECT) — absent from mock rows, defaults to '' (see bugRawRowToDefectDto)
  MODIFIED?: string | Date | null;   // BG_VTS — close-date fallback for the trend
}

// BG_USER_10 (CATEGORY_REF) is overloaded in real QC: it holds either
// 'Production'/'Regression' OR a linked CR/HBR number. The mock rows below now
// carry realistic CR/HBR values in it too (not just null / the category flags)
// so "Open By CR Name" — which groups by BG_USER_10 per the 2026-09-07 spec —
// has something to show in dev. RESPONSIBILITY_U3 (BG_USER_03) is the
// department/group field, distinct from BG_RESPONSIBLE (ASSIGNED_TO).
const MOCK_BUG_ROWS: BugRawRow[] = [
  { DEFECT_ID: 1, ASSIGNED_TO: 'yossif',     RESPONSIBILITY_U3: 'CRM Team',   DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'HBR-13057',   CR_REFERENCE_NUMBER: '13057 - חיוב תחזוקה בפרוקסי כ',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-14', SEVERITY: 'Severe' },
  { DEFECT_ID: 2, ASSIGNED_TO: 'annal',     RESPONSIBILITY_U3: 'CRM Team',   DEFECT_STATUS: 'At Work',  DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'HBR-13036',   CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-21', SEVERITY: 'Medium' },
  { DEFECT_ID: 3, ASSIGNED_TO: 'idany',  RESPONSIBILITY_U3: 'Website HOT',  DEFECT_STATUS: 'Fixed_Dev',DEFECT_TYPE: 'Setup',           CATEGORY_REF: 'HBR-13052',   CR_REFERENCE_NUMBER: '13052 - HBO ניתוח ם',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-24', SEVERITY: 'Low' },
  { DEFECT_ID: 4, ASSIGNED_TO: 'shaul',RESPONSIBILITY_U3: 'SHOB Dev Team',   DEFECT_STATUS: 'Pending',  DEFECT_TYPE: 'Setup',           CATEGORY_REF: 'HBR-13054',   CR_REFERENCE_NUMBER: '13054 - שיפור התהליך רץ פי',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-25', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 5, ASSIGNED_TO: 'evanar', RESPONSIBILITY_U3: 'HOT Design Team',  DEFECT_STATUS: 'Rejected', DEFECT_TYPE: 'Change Requests', CATEGORY_REF: 'HBR-13084',   CR_REFERENCE_NUMBER: '13084 - (לעמק) ONT תחיקה ב',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-28', SEVERITY: 'Medium' },
  { DEFECT_ID: 6, ASSIGNED_TO: 'hsupport', RESPONSIBILITY_U3: 'HOT Setup Team', DEFECT_STATUS: 'Open',   DEFECT_TYPE: 'Change Requests', CATEGORY_REF: 'HBR-13118',   CR_REFERENCE_NUMBER: '13118 - כתובת 2 ד תיוב סוב',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-29', SEVERITY: 'Low' },
  { DEFECT_ID: 7, ASSIGNED_TO: 'odelyac',        RESPONSIBILITY_U3: 'BEZEQ',     DEFECT_STATUS: 'Canceled', DEFECT_TYPE: 'GUI',             CATEGORY_REF: 'HBR-13131',   CR_REFERENCE_NUMBER: '13131 - ניתוח קדים ל',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-30', SEVERITY: 'Low' },
  { DEFECT_ID: 8, ASSIGNED_TO: 'maamona',     RESPONSIBILITY_U3: 'ETL Team',   DEFECT_STATUS: 'Canceled', DEFECT_TYPE: 'DB Issue',        CATEGORY_REF: 'HBR-13048',   CR_REFERENCE_NUMBER: '13048 - שולוגיאתו לק',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-01', SEVERITY: 'Medium' },
  { DEFECT_ID: 9, ASSIGNED_TO: 'yossif',RESPONSIBILITY_U3: 'Marketing Web',   DEFECT_STATUS: 'Fixed_Test', DEFECT_TYPE: 'Design',        CATEGORY_REF: 'HBR-13075',   CR_REFERENCE_NUMBER: '13075 - CRM General Production',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-02', SEVERITY: 'Low' },
  { DEFECT_ID: 10, ASSIGNED_TO: 'annal', RESPONSIBILITY_U3: 'NETC-DT team', DEFECT_STATUS: 'Reopen',  DEFECT_TYPE: 'Environment Issue', CATEGORY_REF: 'HBR-13131',  CR_REFERENCE_NUMBER: '13131 - Regression',               TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-05', SEVERITY: 'Severe' },
  { DEFECT_ID: 11, ASSIGNED_TO: 'idany', RESPONSIBILITY_U3: 'Project Manager', DEFECT_STATUS: 'Reopen', DEFECT_TYPE: 'Functional',   CATEGORY_REF: 'HBR-13057',   CR_REFERENCE_NUMBER: '13057 - חיוב תחזוקה בפרוקסי כ',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-06', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 12, ASSIGNED_TO: 'shaul',    RESPONSIBILITY_U3: 'CRM Team',   DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-17', SEVERITY: 'Severe' },
  { DEFECT_ID: 13, ASSIGNED_TO: 'evanar', RESPONSIBILITY_U3: 'HOT Design Team', DEFECT_STATUS: 'At Work', DEFECT_TYPE: 'Setup',       CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13052 - HBO ניתוח ם',              TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-20', SEVERITY: 'Low' },
  { DEFECT_ID: 14, ASSIGNED_TO: 'hsupport', RESPONSIBILITY_U3: 'HOT Setup Team', DEFECT_STATUS: 'Fixed_Dev', DEFECT_TYPE: 'GUI',        CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13084 - (לעמק) ONT תחיקה ב',        TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-23', SEVERITY: 'Medium' },
  { DEFECT_ID: 15, ASSIGNED_TO: 'odelyac',    RESPONSIBILITY_U3: 'CRM Team',  DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'Regression',  CR_REFERENCE_NUMBER: '13131 - Regression',               TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-26', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 16, ASSIGNED_TO: 'maamona', RESPONSIBILITY_U3: 'NETC-DT team', DEFECT_STATUS: 'At Work', DEFECT_TYPE: 'Environment Issue', CATEGORY_REF: 'Regression', CR_REFERENCE_NUMBER: '13048 - שולוגיאתו לק',           TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-27', SEVERITY: 'Medium' },
  { DEFECT_ID: 17, ASSIGNED_TO: 'yossif', RESPONSIBILITY_U3: 'HOT Design Team', DEFECT_STATUS: 'Fixed_Dev', DEFECT_TYPE: 'Change Requests', CATEGORY_REF: 'Regression', CR_REFERENCE_NUMBER: '13140 - שולוגיאתו',       TARGET_REL: null,  DETECTED_ON_DATE: '2026-07-01', SEVERITY: 'Low' },
  { DEFECT_ID: 18, ASSIGNED_TO: 'annal',    RESPONSIBILITY_U3: 'CRM Team',   DEFECT_STATUS: 'Closed',   DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'HBR-13036',   CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-14', SEVERITY: 'Severe' },
];

// TARGET card mock — defects "detected in an earlier release, targeted at this
// one". Kept small; real Oracle mode uses BUG_DASHBOARD_TARGET_SQL.
const MOCK_BUG_TARGET_ROWS: BugRawRow[] = [
  { DEFECT_ID: 101, ASSIGNED_TO: 'idany',   RESPONSIBILITY_U3: 'CRM Team',  DEFECT_STATUS: 'Open',      DEFECT_TYPE: 'Functional', CATEGORY_REF: 'HBR-12980', CR_REFERENCE_NUMBER: '12980 - תיקון גרסה קודמת', TARGET_REL: 'CURRENT', DETECTED_ON_DATE: '2026-04-11', SEVERITY: 'Severe' },
  { DEFECT_ID: 102, ASSIGNED_TO: 'shaul',    RESPONSIBILITY_U3: 'NC Team', DEFECT_STATUS: 'Fixed_Test',DEFECT_TYPE: 'Setup',      CATEGORY_REF: 'HBR-12981', CR_REFERENCE_NUMBER: '12981 - העברת חוב', TARGET_REL: 'CURRENT', DETECTED_ON_DATE: '2026-04-22', SEVERITY: 'Medium' },
  { DEFECT_ID: 103, ASSIGNED_TO: 'evanar',   RESPONSIBILITY_U3: 'EAI Team', DEFECT_STATUS: 'At Work',   DEFECT_TYPE: 'DB Issue',   CATEGORY_REF: 'HBR-12982', CR_REFERENCE_NUMBER: '12982 - ממשק בנקים', TARGET_REL: 'CURRENT', DETECTED_ON_DATE: '2026-05-03', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 104, ASSIGNED_TO: 'hsupport',   RESPONSIBILITY_U3: 'CRM Team',  DEFECT_STATUS: 'Closed',    DEFECT_TYPE: 'Functional', CATEGORY_REF: 'HBR-12983', CR_REFERENCE_NUMBER: '12983 - דוח חיובים', TARGET_REL: 'CURRENT', DETECTED_ON_DATE: '2026-05-19', SEVERITY: 'Low' },
];

// ── Helper ────────────────────────────────────────────────────────────────────

async function oracleConnect(): Promise<any> {
  const cfg = await getOracleConfig();

  // Thick Mode must already be initialized by main.ts (ORACLE_LIB_DIR).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const oracledb = require('oracledb');
  if (oracledb.thin === true) {
    throw new Error(
      'Oracle is in Thin Mode — Oracle 11g is not supported in Thin Mode (NJS-138).\n' +
      'Set ORACLE_LIB_DIR to the Oracle Client library directory and restart.'
    );
  }
  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  // Pooled (2026-10-07): every query used to open a brand-new Oracle session
  // (network + login) and close it — ~20 of them per home-page load. The pool
  // keeps a few sessions open and hands them out; conn.close() returns the
  // session to the pool. Re-created when the connection settings change; if
  // the pool can't be created, fall back to a direct connection as before.
  const key = `${cfg.user}|${cfg.connectString}|${cfg.password}`;
  if (!oraclePool || oraclePoolKey !== key) {
    const old = oraclePool;
    oraclePoolKey = key;
    oraclePool = oracledb.createPool({
      user: cfg.user, password: cfg.password, connectString: cfg.connectString,
      poolMin: 1, poolMax: 8, poolIncrement: 1, poolTimeout: 300, queueTimeout: 120000, stmtCacheSize: 40,
    });
    oraclePool!.catch(() => { oraclePool = null; oraclePoolKey = ''; });
    if (old) old.then((p: any) => p.close(30)).catch(() => {});
  }
  let conn: any;
  try {
    const pool = await oraclePool!;
    conn = await pool.getConnection();
  } catch (err: any) {
    console.warn(`[oracle] pool unavailable (${err?.message}) — direct connection`);
    conn = await oracledb.getConnection({ user: cfg.user, password: cfg.password, connectString: cfg.connectString });
  }
  // The request's QC project (2026-10-09): every query here uses unqualified
  // table names, so pointing the session at the project's schema is all it
  // takes. Pooled sessions keep their schema — once any project switched,
  // every checkout sets it explicitly (null = back to the user's own schema).
  const project = await currentQcProject().catch(() => null);
  const schema = project?.oracleSchema?.trim() || null;
  if (schema || oracleSchemaSwitched) {
    const target = schema ?? cfg.user;
    if (!isValidOracleSchema(target)) {
      await conn.close().catch(() => {});
      throw new Error(`Invalid Oracle schema name for QC project ${project?.key}: ${target}`);
    }
    if (schema) oracleSchemaSwitched = true;
    try {
      await conn.execute(`ALTER SESSION SET CURRENT_SCHEMA = ${target}`);
    } catch (err) {
      await conn.close().catch(() => {});
      throw err;
    }
  }
  return conn;
}
let oraclePool: Promise<any> | null = null;
let oraclePoolKey = '';
let oracleSchemaSwitched = false;

// Bucket definitions confirmed against the team's PBIRS reports (2026-07-06):
//   Open       = status NOT IN (Closed, Canceled) — a DB-status "Rejected" row
//                still counts as open in this org's workflow until Canceled.
//   Rejected   = status = Canceled (the dashboard's "Rejected" label, NOT the
//                DB's literal "Rejected" status, which is a different, still-open state)
//   Reopen     = a real audit-log transition to 'Reopen' at some point, NOT
//                "current status = Reopen" (a bug that reopened and was since
//                re-fixed still counts — this is a history question, not a
//                snapshot) — see reopenedIds (getReopenedDefectIds, same
//                query "Reopened Defects KPI" already uses: real QC "Reopen
//                KPI" Favorite filter, provided 2026-08-27). That query also
//                excludes defects explicitly flagged BG_USER_29='N' (reopen
//                Y/N), same as here (user-confirmed 2026-09-04) — NVL(...,'Y')
//                treats a blank flag as countable, only an explicit 'N' drops it.
//   Changes    = DEFECT_TYPE = 'Change Requests'
//   Production/Regression = CATEGORY_REF (BG_USER_10) = 'Production'/'Regression'
//                AND status NOT IN (New, Canceled)
//   Target     = a defect detected in an EARLIER release, targeted at this one
//                (BUG_DASHBOARD_TARGET_SQL / MOCK_BUG_TARGET_ROWS) — "left" = of
//                those, status not Closed/Canceled (spec 2026-09-07)

// Raw BG_USER_04 status → one of the 5 workflow buckets the Bug Dashboard's
// "פתוחות לפי סטטוס" panel shows (spec 2026-09-07). Covers the English ALM
// status codes seen in this instance plus their common Hebrew equivalents;
// anything unrecognised is returned verbatim so it stays visible rather than
// being silently folded away. NOTE: the exact real BG_USER_04 value set is
// org-specific — adjust the arrays here if a real status lands in the wrong bucket.
const BUG_STATUS_BUCKETS: { label: string; match: string[] }[] = [
  { label: 'פתוח',                   match: ['open', 'new', 'reopen', 'reopened', 'פתוח', 'חדש', 'נפתח מחדש'] },
  { label: 'בעבודה',                 match: ['at work', 'in progress', 'assigned', 'working', 'בעבודה', 'בטיפול'] },
  { label: 'ממתין להטמעה בסביבה',    match: ['fixed_dev', 'fixed dev', 'ready for deployment', 'pending deployment', 'pending deploy', 'ממתין להטמעה', 'ממתין להטמעה בסביבה', 'תוקן בפיתוח'] },
  { label: 'ממתין לבדיקות',          match: ['fixed_test', 'fixed test', 'ready for test', 'pending', 'ready for retest', 'ממתין לבדיקות', 'ממתין לבדיקה', 'תוקן בבדיקות'] },
  { label: 'נדחה',                   match: ['rejected', 'declined', 'נדחה'] },
];
export function bugStatusBucket(status: string | null | undefined): string {
  const s = (status ?? '').trim().toLowerCase();
  if (!s) return 'ללא סטטוס';
  const hit = BUG_STATUS_BUCKETS.find(b => b.match.includes(s));
  return hit ? hit.label : (status as string);
}

// Thin BugRawRow → DefectDto projection for the Bug Dashboard drill-down
// lists. Only the columns BUG_DASHBOARD_SQL/BUG_DASHBOARD_TARGET_SQL select
// are populated; the rest default to '' (the drill-down table only shows
// id/title/severity/status/owner/date, and a row click re-fetches the full
// detail by id anyway).
// "YYYY-MM-DD" of a detection date, LOCAL day. One function for the Bug
// Dashboard's daily chart and its day drill-down (user report 2026-10-05:
// clicking a point listed nothing) - the chart keyed by toISOString() (UTC:
// an Israeli-midnight Oracle DATE fell on the previous day) while the drill
// sliced String(Date) ("Mon Oct 05 ...") and could never match. Strings that
// already start with a date (mock rows) are taken as-is.
export function localIsoDay(v: string | Date | null | undefined): string {
  if (!v) return '';
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  const d = v instanceof Date ? v : new Date(v);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function bugRawRowToDefectDto(r: BugRawRow): DefectDto {
  const cr = r.CR_REFERENCE_NUMBER ?? '';
  // TITLE (BG_SUMMARY/BG_SUBJECT) is the real per-defect title. CR_REFERENCE_NUMBER
  // (BG_USER_58) is shared across every defect linked to the same CR, so it was
  // producing identical, non-title-looking values across a whole drill-down table
  // when used as the title fallback — bug found in production 2026-09-10.
  const title = (r.TITLE ?? '').trim();
  return {
    ...EMPTY_EXTENDED_DEFECT_FIELDS,
    id: String(r.DEFECT_ID),
    assignedTo: r.ASSIGNED_TO ?? '',
    system: '',
    title: title || cr || `תקלה ${r.DEFECT_ID}`,
    description: '',
    reproducible: '',
    severity: r.SEVERITY ?? '',
    priority: '',
    reporter: '',
    discoveryDate: localIsoDay(r.DETECTED_ON_DATE),
    environment: '',
    status: r.DEFECT_STATUS ?? '',
    testPhase: '',
    defectType: r.DEFECT_TYPE ?? '',
    notes: '',
    responsibility: r.RESPONSIBILITY_U3 ?? '',
    crHbrNumberReference: r.CATEGORY_REF ?? '',
    crReferenceNumber: cr,
    fixType: '',
    reason: '',
    reopenYn: '',
    targetRelease: r.TARGET_REL != null && String(r.TARGET_REL).trim() !== '' ? String(r.TARGET_REL) : '',
  };
}

// ── All Defects (general defects module, 2026-09-22) ────────────────────────
// System-wide, ALL-status dashboard — no version/release scope at all, unlike
// every other defect view in this file (all of which are release-scoped via
// BG_DETECTED_IN_REL = :releaseId). Deliberately a narrow, CLOB-free SELECT
// (unlike DEFECTS_SQL_SELECT's 60+ columns incl. description/comments via
// DBMS_LOB.SUBSTR) since this can return every defect in the whole QC
// instance's history — fetching full descriptions for every row here would be
// wasteful for a dashboard that only needs breakdown counts. UNVERIFIED
// against real data volume: if this instance's BUG table is large enough that
// an unbounded scan is slow in practice, the fix is a WHERE BG_DETECTION_DATE
// >= :sinceDate bound here — not attempted yet since real row counts aren't
// known.
export interface DefectBreakdownRow { label: string; count: number; }
export interface AllDefectsDashboardDto {
  total: number;
  open: number;
  closed: number;
  criticalOpen: number;
  reopenCount: number;
  byStatus: DefectBreakdownRow[];
  bySeverity: DefectBreakdownRow[];
  byMainModule: DefectBreakdownRow[];
  byResponsibility: DefectBreakdownRow[];
  byDetectedRelease: DefectBreakdownRow[];
  byEnvironmentComponent: DefectBreakdownRow[];
  monthlyTrend: { month: string; count: number }[];
}

interface AllDefectsRawRow {
  DEFECT_ID: string | number;
  DEFECT_STATUS: string | null;
  SEVERITY: string | null;
  MAIN_MODULE: string | null;
  RESPONSIBILITY: string | null;
  ASSIGNED_TO: string | null;
  REOPEN_YN: string | null;
  DETECTED_IN_RELEASE: string | null;
  DETECTED_ON_DATE: string | Date | null;
  ENVIRONMENT_COMPONENT: string | null;
  TITLE?: string | null;
}

const ALL_DEFECTS_DASHBOARD_COLUMNS = `
    BG_BUG_ID                AS DEFECT_ID,
    BG_USER_04                AS DEFECT_STATUS,
    BG_SEVERITY                AS SEVERITY,
    BG_USER_16                AS MAIN_MODULE,
    BG_USER_03                AS RESPONSIBILITY,
    BG_RESPONSIBLE                AS ASSIGNED_TO,
    BG_USER_29                AS REOPEN_YN,
    detected_rel.REL_NAME        AS DETECTED_IN_RELEASE,
    BG_DETECTION_DATE            AS DETECTED_ON_DATE,
    BG_USER_49                AS ENVIRONMENT_COMPONENT,
    NVL(BG_SUMMARY, BG_SUBJECT)      AS TITLE`;

const ALL_DEFECTS_DASHBOARD_SQL = `
  SELECT${ALL_DEFECTS_DASHBOARD_COLUMNS}
  FROM BUG
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
`;

// Drill-down list behind one breakdown-panel bar (e.g. "Severity = Show
// Stopper") — same lightweight column set as the dashboard query (no CLOBs),
// plus TITLE, filtered to one dimension and capped at 300 rows via ROWNUM —
// NOT `FETCH FIRST n ROWS ONLY`: that is Oracle 12c+ syntax, and the real QC
// instance rejected it with ORA-00933 at exactly that clause (production
// logs, 2026-10-04). ROWNUM works on every version, and with no ORDER BY in
// these queries the rows returned are the same.
// The column each filterField maps to must stay a fixed allowlist below —
// never interpolate the field name itself from caller input.
const ALL_DEFECTS_FILTER_COLUMNS: Record<string, string> = {
  status: 'BG_USER_04',
  severity: 'BG_SEVERITY',
  mainModule: 'BG_USER_16',
  responsibility: 'BG_USER_03',
  detectedInRelease: 'detected_rel.REL_NAME',
  environmentComponent: 'BG_USER_49',
};
// TRIM() on both sides (2026-09-23, fixes-batch item B) — a real production
// report ("במודול התקלות אני לא מצליח לעשות דריל בשום אובייקט") showed the
// breakdown panel counting real defects under a status like "Open" but the
// same value clicked back into this filter returning zero rows. The
// breakdown itself groups by the raw column value with no normalization
// (computeAllDefectsDashboard's groupCount), so if the real BG_USER_04/etc.
// value carries incidental trailing whitespace (common in hand-maintained
// ALM picklist data), the label a user sees and clicks is byte-identical to
// what gets sent back here — an exact `=` still can't be ruled out as the
// culprit without real Oracle access to confirm, but TRIM() on both sides is
// a safe hardening that costs nothing if this wasn't the actual cause and
// fixes it outright if it was.
// Built on DEFECTS_SQL_SELECT (2026-09-23, follow-up to the item-B fix above)
// — NOT the lightweight ALL_DEFECTS_DASHBOARD_COLUMNS — so this drill-down
// returns the exact same full DefectDto column breadth as every other
// drill-down table in the app (DefectDrilldownModal's 70+ columns, real
// column picker), instead of a separate, poorer 8-column reimplementation.
// User feedback verbatim: "למה לא להשתמש במשהו טוב?" (why not use something
// that's already good?) — DEFECTS_SQL_SELECT's raw column names
// (BG_USER_04, BG_SEVERITY, detected_rel.REL_NAME, ...) are identical to the
// lightweight query's, since both read the same BUG table — only the SELECT
// list (and therefore what the caller gets back) differs.
function buildAllDefectsFilteredSql(filterField: string, extraWhere = ''): string {
  const column = ALL_DEFECTS_FILTER_COLUMNS[filterField];
  if (!column) throw new BadRequestException(`שדה סינון לא מוכר: ${filterField}`);
  const scopeClause = extraWhere ? ` AND ${extraWhere}` : '';
  return `${DEFECTS_SQL_SELECT}  WHERE TRIM(${column}) = TRIM(:value)${scopeClause}\n  AND ROWNUM <= 300\n`;
}

// KPI-tile drill-down (2026-09-23, fixes-batch item B — "הכרטיסיות עצמן
// אינן מאפשרות לחיצה בכלל") — the 5 headline tiles (Total/Open/Closed/
// Critical Open/Reopened) aren't a single field=value match like the
// breakdown-panel bars above; each is the exact same compound predicate
// computeAllDefectsDashboard already uses to compute the tile's own number,
// mirrored here as SQL (real Oracle) and as a JS predicate (mock) so the
// drill-down list is always consistent with the count the user clicked.
const ALL_DEFECTS_KPI_WHERE: Record<string, string> = {
  total: '1=1',
  open: `TRIM(BG_USER_04) NOT IN ('Closed', 'Canceled')`,
  closed: `TRIM(BG_USER_04) IN ('Closed', 'Canceled')`,
  criticalOpen: `TRIM(BG_USER_04) NOT IN ('Closed', 'Canceled') AND TRIM(BG_SEVERITY) = 'Show Stopper'`,
  reopen: `(UPPER(TRIM(BG_USER_29)) = 'Y' OR TRIM(BG_USER_04) = 'Reopen')`,
};
const ALL_DEFECTS_KPI_PREDICATE: Record<string, (r: AllDefectsRawRow) => boolean> = {
  total: () => true,
  open: r => !['Closed', 'Canceled'].includes((r.DEFECT_STATUS ?? '').trim()),
  closed: r => ['Closed', 'Canceled'].includes((r.DEFECT_STATUS ?? '').trim()),
  criticalOpen: r => !['Closed', 'Canceled'].includes((r.DEFECT_STATUS ?? '').trim()) && (r.SEVERITY ?? '').trim() === 'Show Stopper',
  reopen: r => (r.REOPEN_YN ?? '').trim().toUpperCase() === 'Y' || (r.DEFECT_STATUS ?? '').trim() === 'Reopen',
};
// Also rebuilt on DEFECTS_SQL_SELECT — same reasoning as
// buildAllDefectsFilteredSql above.
function buildAllDefectsKpiSql(kpiKey: string, extraWhere = ''): string {
  const where = ALL_DEFECTS_KPI_WHERE[kpiKey];
  if (!where) throw new BadRequestException(`KPI לא מוכר: ${kpiKey}`);
  const scopeClause = extraWhere ? ` AND ${extraWhere}` : '';
  return `${DEFECTS_SQL_SELECT}  WHERE (${where})${scopeClause}\n  AND ROWNUM <= 300\n`;
}

// Dedicated mock fixture (not reusing MOCK_BUG_ROWS, which lacks MAIN_MODULE
// and spans only ~2 weeks) — spans several months and releases so the
// monthly trend chart and by-release breakdown have something real to show.
// ASSIGNED_TO here is a per-person QC login (matches User.qcLogin), not a team
// name — confirmed with the user 2026-09-25 (access-control spec) despite an
// older BG_RESPONSIBLE comment elsewhere in this file describing a different,
// team/queue-shaped usage of that same raw column in other queries.
const MOCK_ALL_DEFECTS_ROWS: AllDefectsRawRow[] = [
  { DEFECT_ID: 1,  DEFECT_STATUS: 'Closed',    SEVERITY: 'Medium',       MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'CRM Team',  ASSIGNED_TO: 'dlevi',   REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv02-2026', DETECTED_ON_DATE: '2026-03-11', ENVIRONMENT_COMPONENT: 'WEB' },
  { DEFECT_ID: 2,  DEFECT_STATUS: 'Closed',    SEVERITY: 'Low',          MAIN_MODULE: 'Billing',  RESPONSIBILITY: 'NETC-DT team', ASSIGNED_TO: 'ncohen',  REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv02-2026', DETECTED_ON_DATE: '2026-03-19', ENVIRONMENT_COMPONENT: 'DB' },
  { DEFECT_ID: 3,  DEFECT_STATUS: 'Canceled',  SEVERITY: 'Low',          MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'OSS Team', ASSIGNED_TO: 'ymizrahi',REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv03-2026', DETECTED_ON_DATE: '2026-04-08', ENVIRONMENT_COMPONENT: 'WEB' },
  { DEFECT_ID: 4,  DEFECT_STATUS: 'Closed',    SEVERITY: 'Severe',       MAIN_MODULE: 'Provisioning', RESPONSIBILITY: 'CRM Team', ASSIGNED_TO: 'dlevi',   REOPEN_YN: 'Y', DETECTED_IN_RELEASE: 'ITv03-2026', DETECTED_ON_DATE: '2026-04-22', ENVIRONMENT_COMPONENT: 'API' },
  { DEFECT_ID: 5,  DEFECT_STATUS: 'Fixed_Test',SEVERITY: 'Show Stopper', MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'CRM Team',  ASSIGNED_TO: 'raviv',   REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv04-2026', DETECTED_ON_DATE: '2026-05-14', ENVIRONMENT_COMPONENT: 'APP' },
  { DEFECT_ID: 6,  DEFECT_STATUS: 'Open',      SEVERITY: 'Medium',       MAIN_MODULE: 'IVR',      RESPONSIBILITY: 'NETC-DT team', ASSIGNED_TO: 'ncohen',  REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv04-2026', DETECTED_ON_DATE: '2026-05-27', ENVIRONMENT_COMPONENT: 'IVR-PLATFORM' },
  { DEFECT_ID: 7,  DEFECT_STATUS: 'Reopen',    SEVERITY: 'Severe',       MAIN_MODULE: 'Billing',  RESPONSIBILITY: 'OSS Team', ASSIGNED_TO: 'ymizrahi',REOPEN_YN: 'Y', DETECTED_IN_RELEASE: 'ITv05-2026', DETECTED_ON_DATE: '2026-06-09', ENVIRONMENT_COMPONENT: 'DB' },
  { DEFECT_ID: 8,  DEFECT_STATUS: 'At Work',   SEVERITY: 'Low',          MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'CRM Team',  ASSIGNED_TO: 'raviv',   REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv05-2026', DETECTED_ON_DATE: '2026-06-18', ENVIRONMENT_COMPONENT: 'WEB' },
  { DEFECT_ID: 9,  DEFECT_STATUS: 'Fixed_Dev', SEVERITY: 'Medium',       MAIN_MODULE: 'Provisioning', RESPONSIBILITY: 'HOT Design Team', ASSIGNED_TO: 'mgabay',  REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv06-2026', DETECTED_ON_DATE: '2026-07-02', ENVIRONMENT_COMPONENT: 'API' },
  { DEFECT_ID: 10, DEFECT_STATUS: 'Open',      SEVERITY: 'Show Stopper', MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'CRM Team',  ASSIGNED_TO: 'dlevi',   REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv06-2026', DETECTED_ON_DATE: '2026-07-15', ENVIRONMENT_COMPONENT: 'APP' },
  { DEFECT_ID: 11, DEFECT_STATUS: 'Open',      SEVERITY: 'Severe',       MAIN_MODULE: 'IVR',      RESPONSIBILITY: 'NETC-DT team', ASSIGNED_TO: 'ncohen',  REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv06-2026', DETECTED_ON_DATE: '2026-08-05', ENVIRONMENT_COMPONENT: 'IVR-PLATFORM' },
  { DEFECT_ID: 12, DEFECT_STATUS: 'Pending',   SEVERITY: 'Medium',       MAIN_MODULE: 'Billing',  RESPONSIBILITY: 'OSS Team', ASSIGNED_TO: 'ymizrahi',REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv06-2026', DETECTED_ON_DATE: '2026-08-21', ENVIRONMENT_COMPONENT: 'DB' },
  { DEFECT_ID: 13, DEFECT_STATUS: 'Open',      SEVERITY: 'Low',          MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'CRM Team',  ASSIGNED_TO: 'raviv',   REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv07-2026', DETECTED_ON_DATE: '2026-09-02', ENVIRONMENT_COMPONENT: 'WEB' },
  { DEFECT_ID: 14, DEFECT_STATUS: 'Reopen',    SEVERITY: 'Show Stopper', MAIN_MODULE: 'Provisioning', RESPONSIBILITY: 'CRM Team', ASSIGNED_TO: 'dlevi',   REOPEN_YN: 'Y', DETECTED_IN_RELEASE: 'ITv07-2026', DETECTED_ON_DATE: '2026-09-10', ENVIRONMENT_COMPONENT: 'API' },
  { DEFECT_ID: 15, DEFECT_STATUS: 'New',       SEVERITY: 'Medium',       MAIN_MODULE: 'CRM',      RESPONSIBILITY: 'OSS Team', ASSIGNED_TO: 'ymizrahi',REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv08-2026', DETECTED_ON_DATE: '2026-09-18', ENVIRONMENT_COMPONENT: 'APP' },
  { DEFECT_ID: 16, DEFECT_STATUS: 'Open',      SEVERITY: 'Severe',       MAIN_MODULE: 'IVR',      RESPONSIBILITY: 'NETC-DT team', ASSIGNED_TO: 'ncohen',  REOPEN_YN: 'N', DETECTED_IN_RELEASE: 'ITv08-2026', DETECTED_ON_DATE: '2026-09-20', ENVIRONMENT_COMPONENT: 'IVR-PLATFORM' },
];

// Mock-mode mapper for getAllDefectsFiltered (2026-09-23 follow-up) — maps
// the lightweight MOCK_ALL_DEFECTS_ROWS fixture into a full DefectDto shape
// (matching what the real Oracle path returns via runDefectsQuery) so the
// frontend's rich DefectDrilldownModal always gets the right TYPE, even
// though this dev-only mock fixture doesn't carry every one of DefectDto's
// 70 fields — everything beyond the 8 fields the fixture actually has comes
// back empty in mock mode only; real Oracle populates all of them for real.
function allDefectsRawRowToDefectDto(r: AllDefectsRawRow): DefectDto {
  return {
    id: String(r.DEFECT_ID),
    title: r.TITLE || `תקלה #${r.DEFECT_ID}`,
    status: r.DEFECT_STATUS ?? '',
    severity: r.SEVERITY ?? '',
    mainModule: r.MAIN_MODULE ?? '',
    responsibility: r.RESPONSIBILITY ?? '',
    detectedInRelease: r.DETECTED_IN_RELEASE ?? '',
    discoveryDate: r.DETECTED_ON_DATE ? new Date(r.DETECTED_ON_DATE).toLocaleDateString('he-IL') : '',
    reopenYn: r.REOPEN_YN ?? '',
    assignedTo: r.ASSIGNED_TO ?? '', system: '', description: '', reproducible: '', priority: '', reporter: '',
    environment: '', testPhase: '', defectType: '', notes: '', crHbrNumberReference: '',
    crReferenceNumber: '', fixType: '', reason: '', targetRelease: '', subject: '', qaTester: '',
    estimatedFixTime: '', actualFixTime: '', closedBy: '', deploymentReason: '', fixedUntil: '',
    vendorStatus: '', responseDate: '', supportReferenceNumber: '', subModule: '', fixedInProd: '',
    supportStatus: '', vendorAssignTo: '', category: '', itemType: '', estimateFixTime: '',
    platform: '', modified: '', detectedInCycle: '', targetCycle: '', crStatus: '', dropNumber: '', detectedApkVersion: '', detectedHotAppApk: '', targetHotAppApk: '',
    influence: '', secondaryPriority: '', releaseDefect: '', businessProcess: '', foundByAutomation: '',
    mainBusinessProcess: '', impact: '', productionReason: '', environmentComponent: r.ENVIRONMENT_COMPONENT ?? '',
    willBeTestAtGoLive: '', deploymentCategory: '', defectResponsible: '', targetReleaseReason: '',
    targetType: '', systemComponent: '', forRegressionTest: '', escDefectResponsible: '',
    toBeTestedOnProd: '', deploymentDateProd: '', targetScopeApproved: '',
  };
}

// Access-control spec 2026-09-25 — the general Defects module previously
// applied no scoping at all (every authenticated user saw every defect).
// TEAM_LEAD (isLead=true) sees their team's Responsibility (BG_USER_03);
// EMPLOYEE sees only defects assigned to them personally (BG_RESPONSIBLE,
// matched against User.qcLogin); everyone else is unrestricted.
export type DefectScope =
  | { kind: 'all' }
  | { kind: 'team'; values: string[] }
  | { kind: 'personal'; qcLogin: string | null };

// Exported for reuse by release-intelligence.service.ts's version-scoped Home
// widget (2026-09-26) — same scope resolution, applied there in JS against an
// already-fetched, version-filtered DefectDto[] instead of a SQL WHERE clause.
export async function resolveDefectScope(user: { sub: string; role: string }): Promise<DefectScope> {
  if (['ADMIN', 'RELEASE_MANAGER', 'CR_MANAGER', 'VIEWER'].includes(user.role)) return { kind: 'all' };
  if (user.role === 'TEAM_LEAD') {
    const leaderships = await prisma.teamMember.findMany({
      where: { userId: user.sub, isLead: true },
      include: { team: { select: { qcResponsibilityValue: true } } },
    });
    const values = leaderships
      .map(l => l.team.qcResponsibilityValue)
      .filter((v): v is string => !!v);
    // No team has a configured Responsibility value yet — an admin-config gap,
    // not a security boundary to enforce strictly until it's set (same "not
    // mapped yet" convention as qcResponsibilityValue elsewhere in this app).
    if (values.length === 0) return { kind: 'all' };
    return { kind: 'team', values };
  }
  // EMPLOYEE (and any other/future role) — personal scope only.
  const me = await prisma.user.findUnique({ where: { id: user.sub }, select: { qcLogin: true } });
  return { kind: 'personal', qcLogin: me?.qcLogin ?? null };
}

// SQL predicate + binds for the given scope — '' sql means unrestricted.
// Shared by both raw-row shapes (ALL_DEFECTS_DASHBOARD_COLUMNS and the full
// DEFECTS_SQL_SELECT) since both read the same BUG table / column names.
function buildDefectScopeSql(scope: DefectScope): { sql: string; binds: Record<string, any> } {
  if (scope.kind === 'all') return { sql: '', binds: {} };
  if (scope.kind === 'team') {
    const binds: Record<string, any> = {};
    // BG_USER_03 can hold several teams joined by ';' on one defect (e.g.
    // "CRM Team;TopTech Dev Team") — an exact IN match silently dropped every
    // defect where the team lead's team was combined with another (found
    // 2026-09-29 while fixing the same bug in the Responsibility filter
    // dropdowns). Wrapping both sides in ';' delimiters and matching as a
    // substring finds the team whether it's alone or combined.
    const conditions = scope.values.map((v, i) => {
      binds[`resp${i}`] = v;
      return `(';' || TRIM(BG_USER_03) || ';') LIKE ('%;' || :resp${i} || ';%')`;
    });
    return { sql: `(${conditions.join(' OR ')})`, binds };
  }
  // personal — no linked qcLogin means see nothing, not everything (the exact
  // bug this scoping fixes is "unlinked user sees all defects").
  if (!scope.qcLogin) return { sql: '1=0', binds: {} };
  return { sql: 'TRIM(BG_RESPONSIBLE) = TRIM(:qcLogin)', binds: { qcLogin: scope.qcLogin } };
}

function filterMockRowsByScope(rows: AllDefectsRawRow[], scope: DefectScope): AllDefectsRawRow[] {
  if (scope.kind === 'all') return rows;
  if (scope.kind === 'team') {
    const set = new Set(scope.values.map(v => v.trim()));
    return rows.filter(r => (r.RESPONSIBILITY ?? '').split(';').some(t => set.has(t.trim())));
  }
  if (!scope.qcLogin) return [];
  const login = scope.qcLogin.trim().toLowerCase();
  return rows.filter(r => (r.ASSIGNED_TO ?? '').trim().toLowerCase() === login);
}

// Defects module filters (user ask 2026-10-05): detection year(s) and
// detected-in release(s). Empty = no restriction.
export interface DefectsHubFilter { years?: number[]; releases?: string[] }
function rowYear(r: AllDefectsRawRow): number | null {
  if (!r.DETECTED_ON_DATE) return null;
  const d = new Date(r.DETECTED_ON_DATE as any);
  return isNaN(d.getTime()) ? null : d.getFullYear();
}
function matchesHubFilter(r: AllDefectsRawRow, f: DefectsHubFilter): boolean {
  if (f.years?.length && !f.years.includes(rowYear(r) ?? -1)) return false;
  if (f.releases?.length && !f.releases.includes(String(r.DETECTED_IN_RELEASE ?? '').trim())) return false;
  return true;
}
const MOCK_FILTER_KEY: Record<string, keyof AllDefectsRawRow> = {
  status: 'DEFECT_STATUS', severity: 'SEVERITY', mainModule: 'MAIN_MODULE',
  responsibility: 'RESPONSIBILITY', detectedInRelease: 'DETECTED_IN_RELEASE', environmentComponent: 'ENVIRONMENT_COMPONENT',
};

function computeAllDefectsDashboard(rows: AllDefectsRawRow[]): AllDefectsDashboardDto {
  const isOpen = (r: AllDefectsRawRow) => !['Closed', 'Canceled'].includes(r.DEFECT_STATUS ?? '');
  const open = rows.filter(isOpen);
  const closed = rows.filter(r => !isOpen(r));
  const criticalOpen = open.filter(r => r.SEVERITY === 'Show Stopper').length;
  const reopenCount = rows.filter(r =>
    (r.REOPEN_YN ?? '').trim().toUpperCase() === 'Y' || r.DEFECT_STATUS === 'Reopen',
  ).length;

  const groupCount = (keyFn: (r: AllDefectsRawRow) => string | null): DefectBreakdownRow[] => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const key = keyFn(r) || 'ללא סיווג';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Same as groupCount, but for RESPONSIBILITY (BG_USER_03), which can hold
  // several teams joined by ';' on one row — each real team gets counted
  // instead of every raw combination becoming its own bar.
  const groupCountByTeam = (keyFn: (r: AllDefectsRawRow) => string | null): DefectBreakdownRow[] => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const raw = keyFn(r);
      const teams = raw ? raw.split(';').map(s => s.trim()).filter(Boolean) : [];
      const keys = teams.length > 0 ? teams : ['ללא סיווג'];
      for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };

  const monthCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.DETECTED_ON_DATE) continue;
    const d = new Date(r.DETECTED_ON_DATE);
    if (isNaN(d.getTime())) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    monthCounts.set(key, (monthCounts.get(key) ?? 0) + 1);
  }
  const monthlyTrend = Array.from(monthCounts.entries())
    .map(([month, count]) => ({ month, count }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return {
    total: rows.length,
    open: open.length,
    closed: closed.length,
    criticalOpen,
    reopenCount,
    byStatus: groupCount(r => r.DEFECT_STATUS),
    bySeverity: groupCount(r => r.SEVERITY),
    byMainModule: groupCount(r => r.MAIN_MODULE),
    byResponsibility: groupCountByTeam(r => r.RESPONSIBILITY),
    byDetectedRelease: groupCount(r => r.DETECTED_IN_RELEASE),
    byEnvironmentComponent: groupCount(r => r.ENVIRONMENT_COMPONENT),
    monthlyTrend,
  };
}

// ── Defects analytics dataset (investigation dashboard, 2026-10-06) ─────────
// One compact row per defect for the "🐞 תקלות" module's investigation
// dashboard: the browser does every grouping / filter / chart itself (instant
// "הצג לפי" switching, per-user pinned charts, heat map) and drills down by
// sending back the exact matching ids (POST /qc/defects-by-ids), so a list
// can never disagree with the number that was clicked. Field mapping
// confirmed by the user 2026-10-06: מערכת = BG_USER_49, מודול = Sub Module
// (BG_USER_14), team = BG_USER_03, owner = BG_RESPONSIBLE. "נושא" dropped.
// Pre-12c Oracle + ASCII-only SQL text (see QC notes): no FETCH FIRST.
const DEFECTS_ANALYTICS_SQL = `
  SELECT
    BG_BUG_ID            AS DEFECT_ID,
    BG_USER_04           AS DEFECT_STATUS,
    BG_SEVERITY          AS SEVERITY,
    BG_USER_03           AS RESPONSIBILITY,
    BG_USER_49           AS SYSTEM_NAME,
    BG_USER_14           AS SUB_MODULE,
    BG_USER_02           AS ENVIRONMENT,
    BG_RESPONSIBLE       AS ASSIGNED_TO,
    BG_DETECTED_BY       AS DETECTED_BY,
    detected_rel.REL_NAME AS DETECTED_IN_RELEASE,
    BG_DETECTION_DATE    AS DETECTED_ON_DATE,
    BG_VTS               AS MODIFIED
  FROM BUG
  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL
`;

// Close date = the LAST time the status became Closed/Canceled, from the
// status history (user, 2026-10-06: "תאריך הסגירה קיים בהיסטוריה"). Same
// AUDIT_LOG/AUDIT_PROPERTIES + 'Bug Status' property as
// DEFECT_STATUS_HISTORY_SQL. Both spellings of Canceled are accepted.
const DEFECTS_CLOSE_DATES_SQL = `
  SELECT audit_log.AU_ENTITY_ID AS DEFECT_ID, MAX(audit_log.AU_TIME) AS CLOSED_AT
  FROM AUDIT_LOG audit_log
  JOIN AUDIT_PROPERTIES audit_property ON audit_log.AU_ACTION_ID = audit_property.AP_ACTION_ID
  WHERE audit_log.AU_ENTITY_TYPE = 'BUG'
    AND audit_property.AP_PROPERTY_NAME = 'Bug Status'
    AND TRIM(audit_property.AP_NEW_VALUE) IN ('Closed', 'Canceled', 'Cancelled')
  GROUP BY audit_log.AU_ENTITY_ID
`;

interface AnalyticsRawRow {
  DEFECT_ID: string | number;
  DEFECT_STATUS: string | null;
  SEVERITY: string | null;
  RESPONSIBILITY: string | null;
  SYSTEM_NAME: string | null;
  SUB_MODULE: string | null;
  ENVIRONMENT: string | null;       // BG_USER_02 — "prod" in it = production defect (isProductionEnvironment)
  ASSIGNED_TO: string | null;
  DETECTED_BY: string | null;
  DETECTED_IN_RELEASE: string | null;
  DETECTED_ON_DATE: string | Date | null;
  MODIFIED: string | Date | null;
  CLOSED_AT?: string | Date | null;
}

const ANALYTICS_CLOSED_STATUSES = ['closed', 'canceled', 'cancelled'];
const isClosedStatus = (s: string | null) => ANALYTICS_CLOSED_STATUSES.includes((s ?? '').trim().toLowerCase());

// Columnar + dictionary-encoded: every text value is an index into `dict`,
// every date a day number (days since 1970-01-01, UTC). -1 / null = empty.
export interface DefectsAnalyticsDto {
  generatedAt: string;
  mock: boolean;
  closeDate: { fromHistory: number; fallback: number };   // closed defects whose close date came from history vs BG_VTS fallback
  dict: { status: string[]; severity: string[]; team: string[]; system: string[]; module: string[]; release: string[]; person: string[]; env: string[] };
  id: number[];
  env: number[];          // index into dict.env (BG_USER_02)
  status: number[];
  severity: number[];
  teams: number[][];      // BG_USER_03 may hold several teams joined by ';'
  system: number[];
  module: number[];
  release: number[];
  owner: number[];        // index into dict.person
  creator: number[];      // index into dict.person
  detected: (number | null)[];
  closed: (number | null)[];
  updated: (number | null)[];
}

const toDayNum = (v: string | Date | null | undefined): number | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  const t = d.getTime();
  return isNaN(t) ? null : Math.floor(t / 86400000);
};

function encodeDefectsAnalytics(rows: AnalyticsRawRow[], personName: (login: string) => string, mock: boolean): DefectsAnalyticsDto {
  const dicts: Record<keyof DefectsAnalyticsDto['dict'], Map<string, number>> = {
    status: new Map(), severity: new Map(), team: new Map(), system: new Map(), module: new Map(), release: new Map(), person: new Map(), env: new Map(),
  };
  const enc = (k: keyof DefectsAnalyticsDto['dict'], raw: string | null | undefined): number => {
    const v = (raw ?? '').trim();
    if (!v) return -1;
    const m = dicts[k];
    let i = m.get(v);
    if (i === undefined) { i = m.size; m.set(v, i); }
    return i;
  };
  const out: DefectsAnalyticsDto = {
    generatedAt: new Date().toISOString(), mock, closeDate: { fromHistory: 0, fallback: 0 },
    dict: { status: [], severity: [], team: [], system: [], module: [], release: [], person: [], env: [] },
    id: [], env: [], status: [], severity: [], teams: [], system: [], module: [], release: [], owner: [], creator: [], detected: [], closed: [], updated: [],
  };
  for (const r of rows) {
    out.id.push(Number(r.DEFECT_ID));
    out.status.push(enc('status', r.DEFECT_STATUS));
    out.severity.push(enc('severity', r.SEVERITY));
    out.teams.push((r.RESPONSIBILITY ?? '').split(';').map(s => s.trim()).filter(Boolean).map(t => enc('team', t)));
    out.system.push(enc('system', r.SYSTEM_NAME));
    out.module.push(enc('module', r.SUB_MODULE));
    out.env.push(enc('env', r.ENVIRONMENT));
    out.release.push(enc('release', r.DETECTED_IN_RELEASE));
    out.owner.push(enc('person', r.ASSIGNED_TO ? personName(r.ASSIGNED_TO.trim()) : null));
    out.creator.push(enc('person', r.DETECTED_BY ? personName(r.DETECTED_BY.trim()) : null));
    const detected = toDayNum(r.DETECTED_ON_DATE);
    const updated = toDayNum(r.MODIFIED);
    out.detected.push(detected);
    out.updated.push(updated);
    // A close date only for defects that are closed NOW (a reopened one is open).
    let closed: number | null = null;
    if (isClosedStatus(r.DEFECT_STATUS)) {
      closed = toDayNum(r.CLOSED_AT ?? null);
      if (closed != null) out.closeDate.fromHistory++;
      else { closed = updated; out.closeDate.fallback++; }   // no history row → last-modified as best proxy
    }
    out.closed.push(closed);
  }
  for (const k of Object.keys(dicts) as (keyof DefectsAnalyticsDto['dict'])[]) {
    out.dict[k] = Array.from(dicts[k].keys());
  }
  return out;
}

// Dev-mode fixture: ~600 deterministic defects over 21 months, so trend,
// aging, heat map and top-10 have something meaningful to show.
function buildMockAnalyticsRows(): AnalyticsRawRow[] {
  const real = loadRealAllBugs();
  if (real) {
    return real.map(r => ({
      DEFECT_ID: r.DEFECT_ID, DEFECT_STATUS: r.DEFECT_STATUS ?? null, SEVERITY: r.SEVERITY ?? null,
      RESPONSIBILITY: r.RESPONSIBILITY ?? null, SYSTEM_NAME: r.ENVIRONMENT_COMPONNENT ?? null, SUB_MODULE: r.SUB_MODULE ?? null,
      ENVIRONMENT: r.ENVIRONMENT ?? null, ASSIGNED_TO: r.ASSIGNED_TO ?? null, DETECTED_BY: r.DETECTED_BY ?? null,
      DETECTED_IN_RELEASE: r.DETECTED_IN_RELEASE ?? null, DETECTED_ON_DATE: r.DETECTED_ON_DATE ?? null,
      MODIFIED: r.MODIFIED ?? null, CLOSED_AT: null,
    }));
  }
  let seed = 20261006;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = <T,>(arr: T[], weights?: number[]): T => {
    if (!weights) return arr[Math.floor(rnd() * arr.length)];
    const total = weights.reduce((s, w) => s + w, 0);
    let x = rnd() * total;
    for (let i = 0; i < arr.length; i++) { x -= weights[i]; if (x <= 0) return arr[i]; }
    return arr[arr.length - 1];
  };
  const systems = ['CRM', 'Billing', 'Provisioning', 'IVR', 'WEB-HOT', 'OSB', 'BI', 'ERP', 'CONNECT', 'REMEDY', 'NIFI', 'MEDIATION'];
  const modules = ['Customer 360', 'Orders', 'Invoices', 'Payments', 'Activation', 'Self Care', 'Reports', 'Interfaces', 'Login', 'Catalog', 'Tickets', 'Usage'];
  const teams = ['CRM Team', 'OSS Team', 'NETC-DT team', 'HOT Design Team', 'BI Team', 'Web Dev Team', 'IVR Team', 'DBA Team'];
  const people = ['dlevi', 'ncohen', 'ymizrahi', 'raviv', 'mgabay', 'aamar', 'tbenami', 'skatz', 'olevi', 'rpeled'];
  const openStatuses = ['New', 'Open', 'At Work', 'Fixed_Dev', 'Fixed_Test', 'Reopen', 'Pending'];
  const rows: AnalyticsRawRow[] = [];
  const start = Date.UTC(2025, 0, 1);
  const today = Date.now();
  const span = today - start;
  for (let i = 0; i < 600; i++) {
    const detected = start + Math.floor(Math.pow(rnd(), 0.8) * span);
    const ageDays = (today - detected) / 86400000;
    const closedProb = Math.min(0.92, ageDays / 120);
    const closed = rnd() < closedProb;
    const closeAt = closed ? Math.min(today - 86400000, detected + (2 + rnd() * Math.min(90, ageDays)) * 86400000) : null;
    const status = closed ? pick(['Closed', 'Canceled'], [9, 1]) : pick(openStatuses, [2, 5, 4, 2, 2, 1, 1]);
    const lastTouch = closed ? closeAt! : today - rnd() * Math.min(ageDays, 120) * 86400000;
    const relIdx = Math.min(9, Math.floor((detected - start) / span * 10));
    rows.push({
      DEFECT_ID: 61000 + i,
      DEFECT_STATUS: status,
      SEVERITY: pick(['Show Stopper', 'Severe', 'Medium', 'Low'], [1, 4, 9, 6]),
      RESPONSIBILITY: rnd() < 0.08 ? `${pick(teams)};${pick(teams)}` : pick(teams),
      SYSTEM_NAME: pick(systems, [14, 10, 8, 5, 6, 4, 3, 3, 2, 2, 1, 1]),
      SUB_MODULE: rnd() < 0.05 ? null : pick(modules),
      ENVIRONMENT: rnd() < 0.04 ? null : pick(['Integration', 'QA', 'Test', 'UAT', 'Production', 'PROD-Like'], [5, 6, 4, 2, 3, 1]),
      ASSIGNED_TO: pick(people),
      DETECTED_BY: pick(people),
      DETECTED_IN_RELEASE: `ITv${String((relIdx % 10) + 1).padStart(2, '0')}-${relIdx < 5 ? 2025 : 2026}`,
      DETECTED_ON_DATE: new Date(detected).toISOString(),
      MODIFIED: new Date(lastTouch).toISOString(),
      CLOSED_AT: closed && rnd() < 0.95 ? new Date(closeAt!).toISOString() : null,   // ~5% exercise the fallback
    });
  }
  return rows;
}

// per QC project (key '' = the default project) — 2026-10-09
const analyticsCaches = new Map<string, { at: number; rows: AnalyticsRawRow[]; mock: boolean }>();
const analyticsLoadings = new Map<string, Promise<{ rows: AnalyticsRawRow[]; mock: boolean }>>();
const ANALYTICS_CACHE_MS = 10 * 60 * 1000;

// SLA — not defined yet (user, 2026-10-06: "להכין משהו שיתמוך בזה בעתיד").
// Target days per severity + where the clock stops; stays off until an admin
// enables it. Stored in SystemParam DEFECT_SLA_CONFIG as JSON.
export interface DefectSlaConfig {
  enabled: boolean;
  stopAt: 'closed';                                 // clock stops when the defect is closed (history close date)
  targetDays: Record<string, number | null>;        // severity -> days; null = no SLA for that severity
}
const DEFAULT_SLA_CONFIG: DefectSlaConfig = {
  enabled: false, stopAt: 'closed',
  targetDays: { 'Show Stopper': null, 'Severe': null, 'Medium': null, 'Low': null },
};

// Fix SLA for defects found during a version's testing phases (user,
// 2026-10-06) — much stricter than production: Show Stopper within 24h,
// Severe 2 days, Medium 3, Low 4 — or a decision not to handle it, which
// cancels it. The clock runs from detection (or the latest reopen) and stops
// at Fixed / Closed / Canceled or once deferred to another release (TARGET) —
// exactly the "still stuck" set below. Calendar hours.
export const TESTING_DEFECT_SLA_HOURS: Record<string, number> = {
  'Show Stopper': 24, 'Severe': 48, 'Medium': 72, 'Low': 96,
};

function computeBugDashboard(
  rows: BugRawRow[], reopenedIds: Set<string>, targetRows: BugRawRow[] = [], reopenTimes: Map<string, Date> = new Map(),
  closeTimes: Map<string, Date> = new Map(),
): BugDashboardDto {
  // BG_TARGET_REL set = it's been decided this defect won't be handled in the
  // current version at all (deferred to a later release) — used both to
  // exclude it from "open" below and, status-agnostically, for "עוברות
  // לגרסה הבאה" (spec 2026-09-09).
  const hasTarget = (r: BugRawRow) => r.TARGET_REL != null && String(r.TARGET_REL).trim() !== '';

  // "Open" — unchanged, still just Closed/Canceled excluded. This is the
  // definition behind the "תקלות פתוחות" KPI and all 4 breakdown panels, and
  // release-intelligence.service.ts's own bug-dashboard drill-down mirrors it
  // exactly — changing it here alone would make the drilldown list disagree
  // with the KPI it was clicked from.
  const isOpen = (r: BugRawRow) => !['Closed', 'Canceled'].includes(r.DEFECT_STATUS ?? '');
  const notNewOrCanceled = (status: string | null) => !['New', 'Canceled'].includes(status ?? '');

  // Narrower "still stuck, needs attention now" predicate — 2026-09-19,
  // user-confirmed, scoped ONLY to the "oldest still-open" aging list below
  // (not the general "open" definition, which stays as-is per the user's
  // follow-up: "הכוונה הייתה לספור תקלות ותיקות לפי ההגדרה הזו"). On top of
  // Closed/Canceled: Fixed_Dev ("טופלה, ממתינה להעברה לבדיקות") and Fixed_Test
  // ("הוטמעה בסביבה, טרם נבדקה") are dev-side-done, not "stuck" work anymore;
  // a defect with BG_TARGET_REL set was explicitly deferred out of this
  // version, so it's not something to chase down in it either.
  const isStuckOpen = (r: BugRawRow) => {
    const status = (r.DEFECT_STATUS ?? '').trim().toLowerCase();
    if (['closed', 'canceled', 'fixed_dev', 'fixed_test'].includes(status)) return false;
    if (hasTarget(r)) return false;
    return true;
  };

  const open = rows.filter(isOpen);
  const rejected = rows.filter(r => r.DEFECT_STATUS === 'Canceled');
  const reopen = rows.filter(r => reopenedIds.has(String(r.DEFECT_ID)));
  const changes = rows.filter(r => r.DEFECT_TYPE === 'Change Requests');
  const production = rows.filter(r => r.CATEGORY_REF === 'Production' && notNewOrCanceled(r.DEFECT_STATUS));
  const regression = rows.filter(r => r.CATEGORY_REF === 'Regression' && notNewOrCanceled(r.DEFECT_STATUS));
  // TARGET = defects from earlier releases carried into this one (targetRows);
  // "left" = of those, still not resolved. Kept as the original Closed/
  // Canceled-only definition — these rows are already the "targeted at this
  // version" set, so the "has a target" exclusion above doesn't apply the
  // same way here; not part of what was asked to change.
  const targeted = targetRows;
  const targetOpen = targeted.filter(r => !['Closed', 'Canceled'].includes(r.DEFECT_STATUS ?? ''));
  // "עוברות לגרסה הבאה" — the mirror of TARGET: defects opened in THIS release
  // (rows are already BG_DETECTED_IN_REL-scoped) whose BG_TARGET_REL is set,
  // i.e. deferred to a later release (spec 2026-09-09). Status-agnostic.
  const movedToNext = rows.filter(hasTarget);

  const groupCount = (items: BugRawRow[], keyFn: (r: BugRawRow) => string | null) => {
    const counts = new Map<string, number>();
    for (const item of items) {
      const key = keyFn(item) || 'ללא סיווג';
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count);
  };

  // Same grouping as groupCount, but each bucket also carries its own
  // severity split — backs the Bug Dashboard's segmented bars (each bar
  // colored by how many Show Stopper/Severe/Medium/Low make up that
  // category), not just a flat per-category total (spec confirmed 2026-09-04).
  const groupCountBySeverity = (items: BugRawRow[], keyFn: (r: BugRawRow) => string | null) => {
    const buckets = new Map<string, Map<string, number>>();
    for (const item of items) {
      const key = keyFn(item) || 'ללא סיווג';
      const severity = item.SEVERITY || 'ללא סיווג';
      const sevCounts = buckets.get(key) ?? new Map<string, number>();
      sevCounts.set(severity, (sevCounts.get(severity) ?? 0) + 1);
      buckets.set(key, sevCounts);
    }
    return Array.from(buckets.entries())
      .map(([label, sevCounts]) => ({
        label,
        count: Array.from(sevCounts.values()).reduce((s, c) => s + c, 0),
        bySeverity: Array.from(sevCounts.entries()).map(([severity, count]) => ({ severity, count })),
      }))
      .sort((a, b) => b.count - a.count);
  };

  // Same as groupCountBySeverity, but for RESPONSIBILITY_U3 (BG_USER_03),
  // which can hold several teams joined by ';' on one row — each real team
  // is counted instead of every raw combination becoming its own bar.
  const groupCountBySeverityByTeam = (items: BugRawRow[], keyFn: (r: BugRawRow) => string | null) => {
    const buckets = new Map<string, Map<string, number>>();
    for (const item of items) {
      const raw = keyFn(item);
      const teams = raw ? raw.split(';').map(s => s.trim()).filter(Boolean) : [];
      const keys = teams.length > 0 ? teams : ['ללא סיווג'];
      const severity = item.SEVERITY || 'ללא סיווג';
      for (const key of keys) {
        const sevCounts = buckets.get(key) ?? new Map<string, number>();
        sevCounts.set(severity, (sevCounts.get(severity) ?? 0) + 1);
        buckets.set(key, sevCounts);
      }
    }
    return Array.from(buckets.entries())
      .map(([label, sevCounts]) => ({
        label,
        count: Array.from(sevCounts.values()).reduce((s, c) => s + c, 0),
        bySeverity: Array.from(sevCounts.entries()).map(([severity, count]) => ({ severity, count })),
      }))
      .sort((a, b) => b.count - a.count);
  };

  const dailyCounts = new Map<string, number>();
  for (const r of rows) {
    const key = localIsoDay(r.DETECTED_ON_DATE);
    if (!key) continue;
    dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }
  const dailyReported = Array.from(dailyCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();

  // trend/backlog rows — closed date from history, else last-modified
  let closeDateFallback = 0;
  const timeline = rows.map(r => {
    const id = String(r.DEFECT_ID);
    let closed: string | null = null;
    if (['closed', 'canceled', 'cancelled'].includes((r.DEFECT_STATUS ?? '').trim().toLowerCase())) {
      const fromHistory = closeTimes.get(id);
      if (fromHistory) closed = localIsoDay(fromHistory);
      else { closed = localIsoDay(r.MODIFIED ?? null) || localIsoDay(r.DETECTED_ON_DATE) || null; closeDateFallback++; }
    }
    return { id, detected: localIsoDay(r.DETECTED_ON_DATE), closed };
  });

  const stuckMs = (r: BugRawRow) => {
    const detected = new Date(r.DETECTED_ON_DATE!);
    const reopenedAt = reopenTimes.get(String(r.DEFECT_ID));
    const openSince = reopenedAt && reopenedAt.getTime() > detected.getTime() ? reopenedAt : detected;
    return Math.max(0, now - openSince.getTime());
  };
  const ageOfStuck = (r: BugRawRow) => Math.floor(stuckMs(r) / MS_PER_DAY);
  const agingOpen = rows
    .filter(isStuckOpen)
    .filter(r => !!r.DETECTED_ON_DATE && !isNaN(new Date(r.DETECTED_ON_DATE).getTime()))
    .map(r => ({
      id: String(r.DEFECT_ID), ageDays: ageOfStuck(r),
      ageHours: Math.floor(stuckMs(r) / 3600000), severity: r.SEVERITY || 'ללא סיווג',
    }));

  const oldestOpen = rows
    .filter(isStuckOpen)
    .filter(r => !!r.DETECTED_ON_DATE && !isNaN(new Date(r.DETECTED_ON_DATE).getTime()))
    .map(r => {
      const detected = new Date(r.DETECTED_ON_DATE!);
      // Age resets from the LATEST real reopen (user-confirmed 2026-09-19):
      // if this defect was ever reopened, "how long has it been open" means
      // "since that reopen", not since its original detection date. Guard
      // against a reopen timestamp somehow predating detection (bad data) —
      // never let the "restart" push the age further back than the original.
      const reopenedAt = reopenTimes.get(String(r.DEFECT_ID));
      const openSince = reopenedAt && reopenedAt.getTime() > detected.getTime() ? reopenedAt : detected;
      const dto = bugRawRowToDefectDto(r);
      return {
        id: dto.id,
        title: dto.title,
        severity: r.SEVERITY || 'ללא סיווג',
        status: r.DEFECT_STATUS ?? '',
        discoveryDate: dto.discoveryDate,
        ageDays: Math.max(0, Math.floor((now - openSince.getTime()) / MS_PER_DAY)),
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays)
    .slice(0, 8);

  return {
    reported:   rows.length,
    open:       open.length,
    rejected:   rejected.length,
    production: production.length,
    regression: regression.length,
    changes:    changes.length,
    reopen:     reopen.length,
    targetTotal: targeted.length,
    targetOpen:  targetOpen.length,
    movedToNext: movedToNext.length,
    dailyReported,
    openByType:           groupCountBySeverity(open, r => r.DEFECT_TYPE),
    // BG_USER_03 (RESPONSIBILITY_U3), NOT BG_RESPONSIBLE — spec 2026-09-07
    openByResponsibility: groupCountBySeverityByTeam(open, r => r.RESPONSIBILITY_U3),
    // BG_USER_10 (CATEGORY_REF), NOT BG_USER_58 — spec 2026-09-07
    openByCr:             groupCountBySeverity(open, r => r.CATEGORY_REF),
    openByStatus:         groupCountBySeverity(open, r => bugStatusBucket(r.DEFECT_STATUS)),
    openBySeverity:       groupCount(open, r => r.SEVERITY),
    reopenByCr:           groupCount(reopen, r => r.CR_REFERENCE_NUMBER),
    // "קריטי" = Show Stopper only (user-confirmed 2026-09-09)
    criticalByCr:         groupCount(open.filter(r => (r.SEVERITY ?? '') === 'Show Stopper'), r => r.CR_REFERENCE_NUMBER),
    oldestOpen,
    timeline,
    closeDateFallback,
    agingOpen,
    testingSlaHours: TESTING_DEFECT_SLA_HOURS,
  };
}

// No separate mock audit-log dataset exists for MOCK_BUG_ROWS, so the mock
// reopen set falls back to "current status = Reopen" as a stand-in — a
// documented approximation for demo/dev only; real Oracle mode uses the real
// audit-log query via getReopenedDefectIds.
const MOCK_REOPENED_BUG_IDS = new Set(MOCK_BUG_ROWS.filter(r => r.DEFECT_STATUS === 'Reopen').map(r => String(r.DEFECT_ID)));
// Same "no separate mock audit-log dataset" approximation as MOCK_REOPENED_BUG_IDS
// above, for the reopen TIMESTAMP this time — 5 days after detection is an
// arbitrary but plausible stand-in, purely so dev mode has something non-empty
// to exercise the age-reset logic with; real Oracle mode uses LATEST_REOPEN_TIME_SQL.
const MOCK_REOPEN_TIMES = new Map<string, Date>(
  MOCK_BUG_ROWS.filter(r => r.DEFECT_STATUS === 'Reopen' && r.DETECTED_ON_DATE).map(r => {
    const detected = new Date(r.DETECTED_ON_DATE!);
    return [String(r.DEFECT_ID), new Date(detected.getTime() + 5 * 24 * 60 * 60 * 1000)];
  }),
);
const MOCK_BUG_DASHBOARD: BugDashboardDto = computeBugDashboard(MOCK_BUG_ROWS, MOCK_REOPENED_BUG_IDS, MOCK_BUG_TARGET_ROWS, MOCK_REOPEN_TIMES);

// Defect person-fields hold raw QC login strings (e.g. "hsupport"), not
// "First Last" names. QC's USERS.USER_NAME is synced into User.qcLogin by
// syncQcUsers(); this maps those logins → User.fullName (case-insensitive) so
// every defect surface can show a real name/avatar, falling back to the raw
// login when no User has that qcLogin synced. Extracted from
// target-cr.service.ts's private copy and rolled out to the defect table +
// detail screen + drilldowns (spec confirmed 2026-09-06). Returns fresh
// shallow-cloned rows — never mutates the input (MOCK_DEFECTS etc. are shared
// module constants).
const DEFECT_PERSON_FIELDS = [
  'assignedTo', 'qaTester', 'detectedBy', 'closedBy', 'reporter',
  'defectResponsible', 'escDefectResponsible', 'vendorAssignTo',
];
const PERSON_FIELD_SET = new Set(DEFECT_PERSON_FIELDS);
// Full QC user directory (login → full name) for people who have no
// DeployCenter account — developers, generic users, former employees (user
// report 2026-10-03: defect tables showed raw logins like "avia"). Same Site
// Admin USERS table syncQcUsers() reads, but unfiltered (any project, active
// or not, with or without email). Cached in memory: 12h after a successful
// load, 10min after a failure. Empty when Oracle is disabled (dev).
const QC_USER_DIRECTORY_SQL = `
  SELECT USER_NAME, FULL_NAME
  FROM QCSITEADMIN11_DB.USERS
  WHERE USER_NAME IS NOT NULL AND FULL_NAME IS NOT NULL
`;
let qcDirectoryCache: { map: Map<string, string>; expiresAt: number } | null = null;
let qcDirectoryLoading: Promise<Map<string, string>> | null = null;
export async function getQcUserDirectory(): Promise<Map<string, string>> {
  if (qcDirectoryCache && qcDirectoryCache.expiresAt > Date.now()) return qcDirectoryCache.map;
  if (qcDirectoryLoading) return qcDirectoryLoading;
  qcDirectoryLoading = (async () => {
    const map = new Map<string, string>();
    let ok = false;
    const { enabled } = await getOracleConfig().catch(() => ({ enabled: false }));
    if (enabled) {
      let conn: any;
      try {
        conn = await oracleConnect();
        const result = await conn.execute(QC_USER_DIRECTORY_SQL);
        for (const r of (result.rows ?? []) as any[]) {
          const login = String(r.USER_NAME ?? '').trim().toLowerCase();
          const name = String(r.FULL_NAME ?? '').trim();
          if (login && name) map.set(login, name);
        }
        ok = true;
      } catch (err: any) {
        // Fall back to logins as-is; retry soon rather than in 12h. Logged:
        // a silent failure here is indistinguishable from "no names" in prod.
        new Logger('QcUserDirectory').warn(`QC user directory load failed - person fields stay as logins: ${err?.message ?? err}`);
      } finally {
        if (conn) await conn.close().catch(() => {});
      }
    }
    qcDirectoryCache = { map, expiresAt: Date.now() + (ok ? 12 * 3600_000 : 10 * 60_000) };
    qcDirectoryLoading = null;
    return map;
  })();
  return qcDirectoryLoading;
}

// Everyone a QC person field can hold, as { login, fullName } - the QC
// directory plus DeployCenter users with a linked qcLogin (their own name
// wins). Feeds the defect form's people picker and the write-back guard that
// turns a name back into a login (QcRestService.toQcLogin).
export async function getQcPersonDirectory(): Promise<{ login: string; fullName: string }[]> {
  const [users, directory] = await Promise.all([
    prisma.user.findMany({ where: { qcLogin: { not: null } }, select: { qcLogin: true, fullName: true } }),
    getQcUserDirectory(),
  ]);
  const byLogin = new Map<string, { login: string; fullName: string }>();
  for (const [login, fullName] of directory) byLogin.set(login, { login, fullName });
  for (const u of users) {
    const login = (u.qcLogin ?? '').trim();
    if (login) byLogin.set(login.toLowerCase(), { login, fullName: (u.fullName || '').trim() || login });
  }
  return Array.from(byLogin.values()).sort((a, b) => a.fullName.localeCompare(b.fullName));
}

// login -> full name for a set of logins: a DeployCenter account's own name
// wins, the QC directory fills the rest.
async function personNameMap(logins: Set<string>): Promise<Record<string, string>> {
  const [users, directory] = await Promise.all([
    prisma.user.findMany({
      where: { qcLogin: { in: Array.from(logins), mode: 'insensitive' } },
      select: { qcLogin: true, fullName: true },
    }),
    getQcUserDirectory(),
  ]);
  const map: Record<string, string> = {};
  for (const login of logins) {
    const name = directory.get(login);
    if (name) map[login] = name;
  }
  for (const u of users) if (u.qcLogin && u.fullName) map[u.qcLogin.toLowerCase()] = u.fullName;
  return map;
}

// Whole-response variant for PersonNamesInterceptor: walks arrays and plain
// objects at any depth and swaps every DEFECT_PERSON_FIELDS value that is a
// known login. Anything else (Dates, Buffers, streams) passes through as-is;
// input is never mutated.
const isPlainObject = (v: any) => v !== null && typeof v === 'object' && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
// Change history (2026-10-06): who made the change, and the old/new values of
// person fields (Assigned To, Tester, ...), come out of AUDIT_LOG as logins —
// the generic key-based resolver can't see them (the key is "oldValue").
const HISTORY_PERSON_PROPERTY = /assigned|tester|detected by|closed by|responsible|reporter|owner/i;
export async function withHistoryPersonNames(rows: DefectFieldChangeDto[]): Promise<DefectFieldChangeDto[]> {
  const logins = new Set<string>();
  for (const r of rows) {
    if (r.changedBy?.trim()) logins.add(r.changedBy.trim().toLowerCase());
    if (HISTORY_PERSON_PROPERTY.test(r.propertyName)) {
      for (const v of [r.oldValue, r.newValue]) if (v?.trim()) logins.add(v.trim().toLowerCase());
    }
  }
  if (logins.size === 0) return rows;
  const map = await personNameMap(logins);
  const name = (v: string) => (v ? map[v.trim().toLowerCase()] ?? v : v);
  return rows.map(r => ({
    ...r,
    changedBy: name(r.changedBy),
    ...(HISTORY_PERSON_PROPERTY.test(r.propertyName) ? { oldValue: name(r.oldValue), newValue: name(r.newValue) } : {}),
  }));
}

export async function resolvePersonNamesDeep<T>(data: T): Promise<T> {
  const logins = new Set<string>();
  const collect = (v: any) => {
    if (Array.isArray(v)) { for (const x of v) collect(x); return; }
    if (!isPlainObject(v)) return;
    for (const [k, x] of Object.entries(v)) {
      if (PERSON_FIELD_SET.has(k) && typeof x === 'string' && x.trim()) logins.add(x.trim().toLowerCase());
      else if (x && typeof x === 'object') collect(x);
    }
  };
  collect(data);
  if (logins.size === 0) return data;
  const map = await personNameMap(logins);
  if (Object.keys(map).length === 0) return data;
  const swap = (v: any): any => {
    if (Array.isArray(v)) return v.map(swap);
    if (!isPlainObject(v)) return v;
    const out: any = {};
    for (const [k, x] of Object.entries(v)) {
      out[k] = PERSON_FIELD_SET.has(k) && typeof x === 'string'
        ? (map[x.trim().toLowerCase()] ?? x)
        : (x && typeof x === 'object' ? swap(x) : x);
    }
    return out;
  };
  return swap(data);
}

export async function resolveDefectPersonNames<T extends Record<string, any>>(rows: T[]): Promise<T[]> {
  if (rows.length === 0) return rows;
  const logins = new Set<string>();
  for (const r of rows) {
    for (const f of DEFECT_PERSON_FIELDS) {
      const v = String(r?.[f] ?? '').trim();
      if (v) logins.add(v.toLowerCase());
    }
  }
  if (logins.size === 0) return rows;
  const map = await personNameMap(logins);
  if (Object.keys(map).length === 0) return rows;
  return rows.map(r => {
    const clone: any = { ...r };
    for (const f of DEFECT_PERSON_FIELDS) {
      const v = String(clone[f] ?? '').trim();
      if (v && map[v.toLowerCase()]) clone[f] = map[v.toLowerCase()];
    }
    return clone as T;
  });
}

// Defect detail-form layouts (see QcService.getDefectFormLayouts). Key keeps
// the OPEN_PROD_DEFECTS_ prefix so AdminPanel's generic Params tab hides it.
const DEFECT_FORM_LAYOUTS_KEY = 'OPEN_PROD_DEFECTS_FORM_LAYOUTS';
export interface DefectFormLayout { panels: { name: string; fields: string[]; wide?: string[] }[]; }
export interface DefectFormLayouts {
  default: DefectFormLayout | null;
  roles: Record<string, DefectFormLayout>;
  teams: Record<string, DefectFormLayout>;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class QcService implements OnApplicationBootstrap {
  onApplicationBootstrap() { this.warmUpAnalytics(); }

  private readonly logger = new Logger(QcService.name);

  private async getQcIds(versionId: string): Promise<{ relId: number; cycleId: number } | null> {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { qcRelease: true },
    });
    const rel = (version as any)?.qcRelease;
    if (!rel) return null;
    const cycleId = rel.goLiveCycleId ?? rel.rehearsalCycleId;
    if (!cycleId) return null;
    return { relId: rel.relId, cycleId };
  }

  // Same relId+cycleId resolution as getQcIds, but lets the caller state
  // which real Oracle cycle it actually wants (a rehearsal report needs the
  // Dress Rehearsal cycle's own defects/coverage, a production report needs
  // Go Live's — getQcIds's hardcoded "always prefer Go Live" made both reports
  // show identical, Go-Live-only data). Falls back to whichever cycle IS
  // resolved when the preferred one isn't linked yet — same reasoning as
  // getRelId's own comment: silently going empty when real data exists under
  // the other cycle is worse than a graceful fallback.
  private async getQcIdsForCycle(
    versionId: string,
    cyclePreference?: 'REHEARSAL' | 'GO_LIVE',
  ): Promise<{ relId: number; cycleId: number | null }> {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { qcRelease: true },
    });
    const rel = (version as any)?.qcRelease;
    if (!rel) return { relId: 0, cycleId: null };
    const cycleId = cyclePreference === 'REHEARSAL'
      ? (rel.rehearsalCycleId ?? rel.goLiveCycleId ?? null)
      : cyclePreference === 'GO_LIVE'
      ? (rel.goLiveCycleId ?? rel.rehearsalCycleId ?? null)
      : null; // no preference stated — release-wide, no cycle filter
    return { relId: rel.relId, cycleId };
  }

  // Release-only lookup — for queries (bug dashboard, TARGET-CR defects) that
  // filter purely on BG_DETECTED_IN_REL and never touch a test cycle. Using
  // getQcIds() for these incorrectly requires goLiveCycleId/rehearsalCycleId
  // to be resolved even though the SQL never references cycleId — a version
  // whose QcRelease is linked but hasn't had its cycle assigned yet would
  // silently fall back to all-zero/empty results despite having real data.
  // Historical QC release with no local Version: its synced start → go-live dates.
  private async qcReleaseTestingPeriod(relId: number): Promise<BugDashboardDto['testingPeriod'] | undefined> {
    const rel = await prisma.qcRelease.findUnique({ where: { relId }, select: { relStartDate: true, goLiveDate: true, relEndDate: true } });
    const to = rel?.goLiveDate ?? rel?.relEndDate ?? null;
    if (!rel?.relStartDate && !to) return undefined;
    return { from: rel?.relStartDate ? localIsoDay(rel.relStartDate) : null, to: to ? localIsoDay(to) : null, source: 'qc-release' };
  }

  private async getRelId(versionId: string): Promise<number | null> {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { qcRelease: true },
    });
    return (version as any)?.qcRelease?.relId ?? null;
  }

  // Mock-mode only: seed files are keyed by release *name*, not relId — the
  // relId-direct methods below use this to scope the seed to one release
  // (live Oracle scopes by releaseId in SQL instead).
  private async mockReleaseName(relId: number): Promise<string | null> {
    const rel = await prisma.qcRelease.findUnique({ where: { relId }, select: { relName: true } });
    return rel?.relName ?? null;
  }

  async getStatus(): Promise<{ enabled: boolean }> {
    const { enabled } = await getOracleConfig();
    return { enabled };
  }

  // Real per-CR test coverage — used by the release-intelligence cycle-
  // progress cards. Mock mode filters the seed dataset by crNumber directly.
  // Live mode has to work harder: the requirement actually linked to a TEST
  // rarely carries CR_NUMBER itself — it sits on an ancestor folder several
  // levels up the RQ_FATHER_ID chain — so this fetches per-requirement
  // coverage counts and the full parent/CR map separately, then resolves +
  // aggregates in application code. Confirmed against a real REQ/Coverage
  // export (2026-07-30): checking only the leaf or its immediate parent
  // resolves under half of real coverage rows to a CR; walking the full
  // chain is what actually finds it.
  async getCrCoverage(crNumbers: string[], versionId?: string): Promise<CrCoverageDto[]> {
    return qcMemo(`crCoverage|${versionId ?? ''}|${[...crNumbers].sort().join(',')}`, () => this.getCrCoverageUncached(crNumbers, versionId));
  }

  private async getCrCoverageUncached(crNumbers: string[], versionId?: string): Promise<CrCoverageDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) {
      const real = loadRealCrCoverage();
      if (!real) return [];
      const wanted = new Set(crNumbers);
      return real.filter(c => wanted.has(c.crNumber));
    }
    if (!versionId) return [];

    const relId = await this.getRelId(versionId);
    if (!relId) return [];
    return this.getCrCoverageByRelId(crNumbers, relId);
  }

  // relId-direct variant (2026-10-01, same pattern as getDefectsByRelId) —
  // for a historical release with no local Version to resolve a relId from.
  // getCrCoverage above is now a thin wrapper around this for the normal
  // (local-Version) path.
  async getCrCoverageByRelId(crNumbers: string[], relId: number): Promise<CrCoverageDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) {
      const real = loadRealCrCoverage();
      if (!real) return [];
      // Empty crNumbers = every CR in the release, same as the live path below.
      const relName = await this.mockReleaseName(relId);
      const wanted = crNumbers.length > 0 ? new Set(crNumbers) : null;
      return real.filter(c => c.releaseName === relName && (!wanted || wanted.has(c.crNumber)));
    }

    let conn: any;
    try {
      conn = await oracleConnect();
      const [covResult, hierResult] = await Promise.all([
        conn.execute(TEST_COVERAGE_BY_REQ_SQL, { releaseId: relId }),
        conn.execute(REQ_HIERARCHY_SQL),
      ]);

      const hierarchy = new Map<string, { fatherId: string | null; crNumber: string | null; reqName: string }>();
      for (const r of (hierResult.rows ?? []) as any[]) {
        hierarchy.set(String(r.RQ_REQ_ID), {
          fatherId: r.RQ_FATHER_ID != null ? String(r.RQ_FATHER_ID) : null,
          crNumber: r.CR_NUMBER ?? null,
          reqName:  r.RQ_REQ_NAME ?? '',
        });
      }

      // Nearest ancestor (or the leaf itself) carrying a CR_NUMBER — a
      // visited-set caps a corrupt/cyclical father chain in the data.
      const resolveCr = (reqId: string): { crNumber: string; reqName: string } | null => {
        let cur = reqId;
        const seen = new Set<string>();
        while (!seen.has(cur)) {
          seen.add(cur);
          const node = hierarchy.get(cur);
          if (!node) return null;
          if (node.crNumber) return { crNumber: node.crNumber, reqName: node.reqName };
          if (!node.fatherId) return null;
          cur = node.fatherId;
        }
        return null;
      };

      const wanted = crNumbers.length > 0 ? new Set(crNumbers) : null;
      type Bucket = {
        crNumber: string; crTitle: string; releaseName: string; cycleName: string;
        tests: Map<string, string>; // testId -> exec status; a Map key dedupes
        // a test that satisfies multiple requirements under the same CR into
        // one entry, however many raw rows it contributed above.
        responsible: Set<string>;
      };
      const byKey = new Map<string, Bucket>();

      for (const r of (covResult.rows ?? []) as any[]) {
        const resolved = resolveCr(String(r.REQ_ID));
        if (!resolved || (wanted && !wanted.has(resolved.crNumber))) continue;

        const cycleName = r.CYCLE_NAME ?? '';
        const key = `${resolved.crNumber}::${cycleName}`;
        let existing = byKey.get(key);
        if (!existing) {
          existing = {
            crNumber: resolved.crNumber,
            crTitle: resolved.reqName.replace(new RegExp(`^${resolved.crNumber.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*-\\s*`), ''),
            releaseName: r.RELEASE_NAME ?? '', cycleName, tests: new Map(), responsible: new Set(),
          };
          byKey.set(key, existing);
        }
        existing.tests.set(String(r.TEST_ID), r.EXEC_STATUS ?? '');
        if (r.RESPONSIBLE) existing.responsible.add(String(r.RESPONSIBLE));
      }

      // N/A and Not Relevant count toward "executed" (2026-08-03 product
      // decision) — a test the team deliberately marked out-of-scope for
      // this cycle shouldn't drag coverage % down like a genuine not-run gap.
      return Array.from(byKey.values()).map(v => {
        const counts = {
          passed: 0, failed: 0, notRun: 0, blocked: 0, notCompleted: 0, notReady: 0,
          notApplicable: 0, notRelevant: 0,
        };
        for (const status of v.tests.values()) {
          switch (status) {
            case 'Passed':           counts.passed++; break;
            case 'Failed':           counts.failed++; break;
            case 'No Run':           counts.notRun++; break;
            case 'Blocked':          counts.blocked++; break;
            case 'Not Completed':    counts.notCompleted++; break;
            case 'Not Ready for QA': counts.notReady++; break;
            case 'N/A':              counts.notApplicable++; break;
            case 'Not Relevant':     counts.notRelevant++; break;
          }
        }
        const total = v.tests.size;
        const executed = executedScriptCount(counts);
        return {
          crNumber: v.crNumber, crTitle: v.crTitle, releaseName: v.releaseName, cycleName: v.cycleName,
          ...counts, total, coveragePct: total > 0 ? Math.round((executed / total) * 10000) / 100 : 0,
          responsible: Array.from(v.responsible).join(' + '),
        };
      });
    } catch (err: any) {
      this.logger.error(`Oracle getCrCoverageByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Cycle-wide, CR-agnostic test totals for a release — see
  // CYCLE_TEST_TOTALS_SQL's comment for why getCycleProgress needs this
  // alongside getCrCoverage's per-CR rows (feedback 2026-09-14, ITv06-2026
  // audit against QC's own Requirements Coverage screen). No mock-mode seed
  // exists for this yet — returns [] when Oracle is disabled, same as an
  // unlinked/never-synced release; getCycleProgress falls back to its old
  // per-CR sum in that case, unchanged from before this method existed.
  async getCycleTestTotals(versionId: string): Promise<CycleTestTotalsDto[]> {
    return qcMemo(`cycleTotals|${versionId}`, () => this.getCycleTestTotalsUncached(versionId));
  }

  private async getCycleTestTotalsUncached(versionId: string): Promise<CycleTestTotalsDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return [];

    const relId = await this.getRelId(versionId);
    if (!relId) return [];
    return this.getCycleTestTotalsByRelId(relId);
  }

  // relId-direct variant (2026-10-01) — see getCycleQgTargetsByRelId's
  // comment, same reasoning. getCycleTestTotals above is now a thin wrapper.
  async getCycleTestTotalsByRelId(relId: number): Promise<CycleTestTotalsDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(CYCLE_TEST_TOTALS_SQL, { releaseId: relId });
      return (result.rows ?? []).map((r: any): CycleTestTotalsDto => ({
        cycleName:     r.CYCLE_NAME ?? '',
        total:         Number(r.TOTAL),
        passed:        Number(r.PASSED),
        failed:        Number(r.FAILED),
        notRun:        Number(r.NOT_RUN),
        blocked:       Number(r.BLOCKED),
        notCompleted:  Number(r.NOT_COMPLETED),
        notReady:      Number(r.NOT_READY),
        notApplicable: Number(r.NOT_APPLICABLE),
        notRelevant:   Number(r.NOT_RELEVANT),
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getCycleTestTotalsByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Real per-cycle QG coverage targets. Mock mode returns the full seed
  // array (release-name filtering happens in the caller, same as
  // getCrCoverage). Live mode queries RELEASE_CYCLES.QG_HIGH/QG_MEDIUM/
  // QG_LOW directly, scoped to this version's release — this was
  // previously a stub returning [] for Oracle-enabled environments, which
  // silently emptied the Cycle Progress screen's QG Summary/target-marker
  // in production (caught live on ITv06-2026, 2026-07-30).
  async getCycleQgTargets(versionId: string): Promise<CycleQgTargetDto[]> {
    return qcMemo(`cycleQg|${versionId}`, () => this.getCycleQgTargetsUncached(versionId));
  }

  private async getCycleQgTargetsUncached(versionId: string): Promise<CycleQgTargetDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return loadRealCycleQgTargets() ?? [];

    const relId = await this.getRelId(versionId);
    if (!relId) return [];
    return this.getCycleQgTargetsByRelId(relId);
  }

  // relId-direct variant (2026-10-01, same pattern as getDefectsByRelId/
  // getBugDashboardByRelId) — for a historical release with no local Version
  // to resolve a relId from in the first place. getCycleQgTargets above is
  // now a thin wrapper around this.
  async getCycleQgTargetsByRelId(relId: number): Promise<CycleQgTargetDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) {
      const relName = await this.mockReleaseName(relId);
      return (loadRealCycleQgTargets() ?? []).filter(t => t.releaseName === relName);
    }

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(RELEASE_CYCLES_QG_SQL, { releaseId: relId });
      return (result.rows ?? []).map((r: any): CycleQgTargetDto => ({
        releaseName: r.RELEASE_NAME ?? '',
        cycleName:   r.CYCLE_NAME   ?? '',
        qgHigh:      Number(r.QG_HIGH   ?? 0),
        qgMedium:    Number(r.QG_MEDIUM ?? 0),
        qgLow:       Number(r.QG_LOW    ?? 0),
        cycleStart:  r.CYCLE_START ?? null,
        cycleEnd:    r.CYCLE_END   ?? null,
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getCycleQgTargetsByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // cyclePreference: the night/rehearsal summary report passes this so
  // coverage reflects the cycle that report is actually about (Dress
  // Rehearsal vs Go Live) instead of always defaulting to Go Live regardless
  // of which report asked. Every other caller omits it — unchanged behavior.
  async getTestCoverage(versionId: string, cyclePreference?: 'REHEARSAL' | 'GO_LIVE'): Promise<TestCoverageDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_COVERAGE;

    const ids = cyclePreference
      ? await this.getQcIdsForCycle(versionId, cyclePreference)
      : await this.getQcIds(versionId);
    if (!ids?.relId || ids.cycleId == null) {
      this.logger.warn(`No QC release/cycle linked to version ${versionId}`);
      return [];
    }

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(TEST_COVERAGE_SQL, { releaseId: ids.relId, cycleId: ids.cycleId });
      return (result.rows ?? []).map((r: any): TestCoverageDto => ({
        total:        Number(r.TOTAL),
        responsible:  r.RESPONSIBLE  ?? '',
        planned:      Number(r.TOTAL),
        passed:       Number(r.PASSED),
        failed:       Number(r.FAILED),
        notRun:       Number(r.NOT_RUN),
        blocked:      Number(r.BLOCKED),
        notCompleted: Number(r.NOT_COMPLETED),
        notReady:     Number(r.NOT_READY),
        notApplicable: Number(r.NOT_APPLICABLE),
        notRelevant:  Number(r.NOT_RELEVANT),
        subject:      r.SUBJECT   ?? '',
        title:        r.TITLE     ?? '',
        release:      String(r.RELEASE_ID),
        cycle:        String(r.CYCLE_ID),
        planId:       String(r.PLAN_ID),
        labId:        String(r.LAB_ID),
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getTestCoverage: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // cyclePreference is only passed by the night/rehearsal summary report —
  // every other caller (release-intelligence's live "open defects" tile,
  // Quality Hub) omits it and keeps getting the release-wide, all-cycles
  // list, unchanged from today's behavior.
  // shared for a minute across the parallel requests of one page (see qc-cache.ts)
  async getDefects(versionId: string, cyclePreference?: 'REHEARSAL' | 'GO_LIVE'): Promise<DefectDto[]> {
    return qcMemo(`defects|${versionId}|${cyclePreference ?? ''}`, () => this.getDefectsUncached(versionId, cyclePreference));
  }

  private async getDefectsUncached(versionId: string, cyclePreference?: 'REHEARSAL' | 'GO_LIVE'): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_DEFECTS;

    if (!cyclePreference) {
      const relId = await this.getRelId(versionId);
      if (!relId) return [];
      return this.runDefectsQuery(DEFECTS_SQL, { releaseId: relId });
    }

    const { relId, cycleId } = await this.getQcIdsForCycle(versionId, cyclePreference);
    if (!relId) return [];
    if (cycleId == null) return this.runDefectsQuery(DEFECTS_SQL, { releaseId: relId });
    return this.runDefectsQuery(DEFECTS_SQL_ONE_CYCLE, { releaseId: relId, cycleId });
  }

  // Full DefectDto rows (DEFECTS_SQL_SELECT columns) for a set of defect ids,
  // any release. Chunked under Oracle's 1000-item IN limit. Empty when Oracle
  // is disabled (dev mock) - callers keep what they already had.
  async getDefectsByIds(ids: string[]): Promise<DefectDto[]> {
    const nums = Array.from(new Set(ids.map(i => Number(i)).filter(n => Number.isFinite(n))));
    if (nums.length === 0) return [];
    const { enabled } = await getOracleConfig();
    if (!enabled) return [];
    const out: DefectDto[] = [];
    for (let i = 0; i < nums.length; i += 500) {
      const chunk = nums.slice(i, i + 500);
      const binds: Record<string, number> = {};
      chunk.forEach((n, j) => { binds[`id${j}`] = n; });
      const sql = `${DEFECTS_SQL_SELECT}  WHERE BG_BUG_ID IN (${chunk.map((_, j) => `:id${j}`).join(', ')})
`;
      out.push(...await this.runDefectsQuery(sql, binds));
    }
    return out;
  }

  private async runDefectsQuery(sql: string, params: Record<string, any>): Promise<DefectDto[]> {
    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(sql, params);
      return (result.rows ?? []).map((r: any): DefectDto => ({
        id:            String(r.DEFECT_ID),
        assignedTo:    r.ASSIGNED_TO     ?? '',
        system:        r.PROJECT         ?? '',
        title:         r.SUMMARY         ?? '',
        description:   r.DEFECT_DESCRIPTION ?? '',
        reproducible:  r.REPRODUCIBLE_Y_N ?? '',
        severity:      r.SEVERITY        ?? '',
        priority:      r.PRIORITY        ?? '',
        reporter:      r.DETECTED_BY     ?? '',
        discoveryDate: r.DETECTED_ON_DATE
          ? new Date(r.DETECTED_ON_DATE).toLocaleDateString('he-IL')
          : '',
        environment:   r.ENVIRONMENT     ?? '',
        status:        r.DEFECT_STATUS   ?? '',
        testPhase:     r.TEST_PHASE      ?? '',
        defectType:    r.DEFECT_TYPE     ?? '',
        notes:         r.DEFECT_COMMENTS ?? '',
        responsibility:        r.RESPONSIBILITY           ?? '',
        crHbrNumberReference:  r.CR_HBR_NUMBER_REFERENCE  ?? '',
        crReferenceNumber:     r.CR_REFERENCE_NUMBER      ?? '',
        fixType:               r.FIX_TYPE                 ?? '',
        reason:                r.REASON                   ?? '',
        reopenYn:              r.REOPEN_YN                ?? '',
        targetRelease:         r.TARGET_RELEASE           ?? '',
        subject:               r.SUBJECT                  ?? '',
        qaTester:              r.QA_TESTER                ?? '',
        estimatedFixTime:      r.ESTIMATED_FIX_TIME       ?? '',
        actualFixTime:         r.ACTUAL_FIX_TIME          ?? '',
        closedBy:              r.CLOSED_BY                ?? '',
        deploymentReason:      r.DEPLOYMENT_REASON        ?? '',
        fixedUntil:            r.FIXED_UNTIL              ?? '',
        vendorStatus:          r.VENDOR_STATUS            ?? '',
        responseDate:          r.RESPONSE_DATE            ?? '',
        supportReferenceNumber: r.SUPPORT_REFERENCE_NUMBER ?? '',
        subModule:             r.SUB_MODULE               ?? '',
        fixedInProd:           r.FIXED_IN_PROD            ?? '',
        mainModule:            r.MAIN_MODULE              ?? '',
        supportStatus:         r.SUPPORT_STATUS           ?? '',
        vendorAssignTo:        r.VENDOR_ASSIGN_TO         ?? '',
        category:              r.CATEGORY                 ?? '',
        itemType:              r.ITEM_TYPE                ?? '',
        estimateFixTime:       r.ESTIMATE_FIX_TIME        ?? '',
        platform:              r.PLATFORM                 ?? '',
        modified:              r.MODIFIED                 ?? '',
        detectedInRelease:     r.DETECTED_IN_RELEASE      ?? '',
        detectedInCycle:       r.DETECTED_IN_CYCLE        ?? '',
        targetCycle:           r.TARGET_CYCLE             ?? '',
        crStatus:              r.CR_STATUS                ?? '',
        dropNumber:            r.DROP_NUMBER              ?? '',
        detectedApkVersion:    r.DETECTED_APK_VERSION     ?? '',
        detectedHotAppApk:     r.DETECTED_HOT_APP_APK     ?? '',
        targetHotAppApk:       r.TARGET_HOT_APP_APK       ?? '',
        influence:             r.INFLUENCE                ?? '',
        secondaryPriority:     r.SECONDARY_PRIORITY       ?? '',
        releaseDefect:         r.RELEASE_DEFECT           ?? '',
        businessProcess:       r.BUSINESS_PROCESS         ?? '',
        foundByAutomation:     r.FOUND_BY_AUTOMATION      ?? '',
        mainBusinessProcess:   r.MAIN_BUSINESS_PROCESS    ?? '',
        impact:                r.IMPACT                   ?? '',
        productionReason:      r.PRODUCTION_REASON        ?? '',
        environmentComponent:  r.ENVIRONMENT_COMPONENT    ?? '',
        willBeTestAtGoLive:    r.WILL_BE_TEST_AT_GO_LIVE  ?? '',
        deploymentCategory:    r.DEPLOYMENT_CATEGORY      ?? '',
        defectResponsible:     r.DEFECT_RESPONSIBLE       ?? '',
        targetReleaseReason:   r.TARGET_RELEASE_REASON    ?? '',
        targetType:            r.TARGET_TYPE              ?? '',
        systemComponent:       r.SYSTEM_COMPONENT         ?? '',
        forRegressionTest:     r.FOR_REGRESSION_TEST      ?? '',
        escDefectResponsible:  r.ESC_DEFECT_RESPONSIBLE   ?? '',
        toBeTestedOnProd:      r.TO_BE_TESTED_ON_PROD     ?? '',
        deploymentDateProd:    r.DEPLOYMENT_DATE_PROD     ?? '',
        targetScopeApproved:   r.TARGET_SCOPE_APPROVED    ?? '',
      }));
    } catch (err: any) {
      // ORA-00933 reported against this query in real production (2026-09-28)
      // couldn't be pinpointed from err.message alone — node-oracledb attaches
      // the parser's exact character position as err.offset, not embedded in
      // the message text, and this only logged .message. Log offset + a
      // window of the actual SQL text around it (not the full ~9KB query) so
      // the next syntax error is diagnosable from one log line instead of a
      // guessing match against the source.
      const offset = typeof err?.offset === 'number' ? err.offset : null;
      const snippet = offset != null ? sql.slice(Math.max(0, offset - 60), offset + 60) : null;
      this.logger.error(
        `Oracle runDefectsQuery: ${err.message}` +
        (offset != null ? ` | offset=${offset} errorNum=${err.errorNum ?? '?'}` : '') +
        (snippet != null ? ` | sqlAroundOffset=${JSON.stringify(snippet)}` : ''),
      );
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // ── KPI-filtered defect drill-down (Quality Hub "צפה בתקלות") ──────────────
  // Each predicate below was transcribed directly from the real QC "Favorite"
  // filter definitions for that KPI (provided 2026-08-27) — not derived or
  // guessed. "Detected in Release" is every filter's own release-scoping
  // condition; that's already handled by getDefects(versionId) itself, so it's
  // deliberately not repeated here. Two KPIs (Average Time Resolved Defect,
  // Defect Resolution Time) are time-average metrics with no meaningful
  // per-defect list — intentionally absent from this map; see
  // KPI_WITHOUT_DEFECT_LIST. "Reopened Defects KPI" also isn't here — its real
  // QC definition needs an audit-log event, not a static field, and is handled
  // separately in getDefectsForKpi.
  private static readonly ESCAPED_EXCLUDED_TYPES = [
    'Design', 'Change Requests', 'Environment issue', 'Information', 'Installation',
    'Setup', 'DB Issue', 'Configuration', 'Implementaion',
  ];

  private get kpiDefectFilters(): Record<string, (d: DefectDto) => boolean> {
    const isProd = (env: string) => env.toLowerCase().includes('prod');
    return {
      'Design Defects': d =>
        d.status !== 'Canceled' && d.defectType === 'Design' &&
        !isProd(d.environment) && d.testPhase === 'System Test',
      'Defects Quantity': d =>
        !['Canceled', 'New'].includes(d.status) &&
        !['ANDROID_DEV', 'NATC-support'].includes(d.responsibility) &&
        d.testPhase === 'System Test',
      'installation Defects KPI': d =>
        d.status !== 'Canceled' && ['Configuration', 'Installation', 'Setup'].includes(d.defectType) &&
        !isProd(d.environment) && d.testPhase === 'System Test',
      // Missing a severity restriction until 2026-08-29: cross-checked against
      // the real AllBugs export across 35 releases and the imported KPI score's
      // severity breakdown was, without exception, exactly the release's
      // Show-Stopper-severity count with severe/medium/low at zero — this KPI
      // is specifically about Show-Stopper defects, not every severity.
      'Critical Defects KPI': d =>
        d.status !== 'Canceled' && !isProd(d.environment) && d.testPhase === 'System Test' &&
        d.severity === 'Show Stopper',
      'Rejected Defects KPI': d =>
        d.status === 'Canceled' && !isProd(d.environment) &&
        ['Duplicate', 'Not A Problem'].includes(d.reason) && d.responsibility !== 'ANDROID_DEV' &&
        d.testPhase === 'System Test',
      'Regression': d =>
        d.status !== 'Canceled' && d.crHbrNumberReference.toLowerCase().includes('reg') &&
        d.responsibility !== 'ANDROID_DEV' && d.testPhase === 'System Test',
      'Implementation': d =>
        d.status !== 'Canceled' && d.defectType === 'Implementaion' && d.testPhase === 'Sanity Test',
      'Number of Escaped Defects KPI': d =>
        d.status !== 'Canceled' &&
        !QcService.ESCAPED_EXCLUDED_TYPES.includes(d.defectType) &&
        isProd(d.environment) &&
        d.fixType === 'Root Cause' &&
        !['Duplicate', 'Environment Issue', 'Not in scope'].includes(d.reason),
      'Production Impact KPI': d =>
        d.status !== 'Canceled' && isProd(d.environment) &&
        !['Instance', 'Single Row DB Fix'].includes(d.fixType),
    };
  }

  readonly KPI_WITHOUT_DEFECT_LIST = new Set(['Average Time Resolved Defect KPI', 'Defect Resolution Time KPI']);

  // Distinct defect IDs with a real audit-log transition to 'Reopen' status —
  // matches the exact real QC query for "Reopened Defects KPI" (provided
  // 2026-08-27). A static reopenYn flag alone isn't what QC's own definition
  // checks, so this can't reuse the plain field-filter map above.
  async getReopenedDefectIds(relId: number): Promise<Set<string>> {
    return qcMemo(`reopened|${relId}`, () => this.getReopenedDefectIdsUncached(relId));
  }

  private async getReopenedDefectIdsUncached(relId: number): Promise<Set<string>> {
    const { enabled } = await getOracleConfig();
    if (!enabled) {
      return new Set(MOCK_DEFECTS.filter(d => d.reopenYn === 'Y').map(d => d.id));
    }
    return deriveReleaseStatusFacts(await this.getReleaseStatusEvents(relId)).reopenedIds;
  }

  // One AUDIT_LOG pass per release, shared (qcMemo) by the reopened set, the
  // latest-reopen times and the bug dashboard's close dates.
  async getReleaseStatusEvents(relId: number): Promise<ReleaseStatusEvent[]> {
    return qcMemo(`statusEvents|${relId}`, async () => {
      let conn: any;
      try {
        conn = await oracleConnect();
        const result = await conn.execute(RELEASE_STATUS_EVENTS_SQL, { releaseId: relId });
        return ((result.rows ?? []) as any[]).map(r => ({
          defectId: String(r.DEFECT_ID), newValue: r.NEW_VALUE ?? '', at: new Date(r.CHANGE_TIME),
          reopenYn: r.REOPEN_YN ?? null, currentStatus: r.CURRENT_STATUS ?? null, testPhase: r.TEST_PHASE ?? null,
        }));
      } catch (err: any) {
        this.logger.error(`Oracle getReleaseStatusEvents: ${err.message}`);
        throw err;
      } finally {
        if (conn) await conn.close().catch(() => {});
      }
    });
  }

  // Latest real reopen timestamp per defect (2026-09-19) — backs the
  // "oldest still-open" list's age-reset-on-reopen rule. See
  // LATEST_REOPEN_TIME_SQL's own comment for why this doesn't reuse
  // REOPENED_DEFECT_IDS_SQL's narrower KPI-matching filters.
  private async getLatestReopenTimes(relId: number): Promise<Map<string, Date>> {
    return qcMemo(`reopenTimes|${relId}`, () => this.getLatestReopenTimesUncached(relId));
  }

  private async getLatestReopenTimesUncached(relId: number): Promise<Map<string, Date>> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_REOPEN_TIMES;
    return deriveReleaseStatusFacts(await this.getReleaseStatusEvents(relId)).latestReopen;
  }

  // Public wrapper — getReopenedDefectIds/getRelId are both private (used
  // internally by getBugDashboard), but release-intelligence.service.ts's
  // drill-down dispatcher needs the same real audit-log reopen set to filter
  // its own DefectDto list, so it never disagrees with the Bug Dashboard's
  // own Reopen KPI number.
  async getReopenedDefectIdsForVersion(versionId: string): Promise<Set<string>> {
    const relId = await this.getRelId(versionId);
    if (!relId) return new Set();
    return this.getReopenedDefectIds(relId);
  }

  async getDefectsForKpi(versionId: string, kpiName: string): Promise<DefectDto[]> {
    if (this.KPI_WITHOUT_DEFECT_LIST.has(kpiName)) return [];

    const defects = await this.getDefects(versionId);

    if (kpiName === 'Reopened Defects KPI') {
      const relId = await this.getRelId(versionId);
      const reopenedIds = relId ? await this.getReopenedDefectIds(relId) : new Set<string>();
      return defects.filter(d => reopenedIds.has(d.id));
    }

    const filter = this.kpiDefectFilters[kpiName];
    // Unknown KPI name (not yet mapped) — fail open with the unfiltered list
    // rather than silently hiding real data behind a filter that doesn't exist.
    return filter ? defects.filter(filter) : defects;
  }

  // Direct-by-relId defect list (2026-09-18, historical QC releases browse) —
  // deliberately a separate method rather than reusing getDefects(versionId)
  // internals, to avoid any risk of regressing the just-fixed Version-based
  // drill-down: a historical release browsed this way usually has NO local
  // Version row at all (that's the whole point — QC-only releases that
  // predate this tool), so there's nothing to resolve a versionId from.
  // Every real defect query in this file only ever keys on relId under the
  // hood anyway (see getRelId) — this just skips the Version indirection.
  // cycleName (2026-10-01, historical cycle-level defect navigation):
  // optional post-filter to just the defects detected in one specific real
  // QC cycle — reuses getDefectsByCycleByRelId's id→cycle map rather than a
  // second SQL query, same join DEFECTS_BY_CYCLE_SQL already does.
  async getDefectsByRelId(relId: number, cycleName?: string): Promise<DefectDto[]> {
    return qcMemo(`defectsByRel|${relId}|${cycleName ?? ''}`, () => this.getDefectsByRelIdUncached(relId, cycleName));
  }

  private async getDefectsByRelIdUncached(relId: number, cycleName?: string): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    const defects = enabled ? await this.runDefectsQuery(DEFECTS_SQL, { releaseId: relId }) : MOCK_DEFECTS;
    if (!cycleName) return defects;
    const byCycle = await this.getDefectsByCycleByRelId(relId).catch((): DefectByCycleDto[] => []);
    const idsInCycle = new Set(byCycle.filter(d => d.detectedInCycle === cycleName).map(d => d.id));
    return defects.filter(d => idsInCycle.has(d.id));
  }

  // relId-direct sibling of getDefectsForKpi (2026-09-23, fixes-batch item I
  // — Quality Hub's live-defects cards/drilldown were hard-blocked for any
  // release with no local Version row, e.g. every release older than this
  // app itself). Mirrors getDefectsForKpi's logic exactly (same
  // kpiDefectFilters map, same Reopened-KPI special case) but starts from
  // getDefectsByRelId(relId) instead of getDefects(versionId), and resolves
  // "reopened" straight from the given relId instead of round-tripping
  // through getRelId(versionId) — there is no versionId to round-trip
  // through in this path.
  async getDefectsForKpiByRelId(relId: number, kpiName: string): Promise<DefectDto[]> {
    if (this.KPI_WITHOUT_DEFECT_LIST.has(kpiName)) return [];

    const defects = await this.getDefectsByRelId(relId);

    if (kpiName === 'Reopened Defects KPI') {
      const reopenedIds = await this.getReopenedDefectIds(relId);
      return defects.filter(d => reopenedIds.has(d.id));
    }

    const filter = this.kpiDefectFilters[kpiName];
    return filter ? defects.filter(filter) : defects;
  }

  // Real Go-Live/production incidents for a release — used by the Incidents/
  // RCA module's QC import. Deliberately NOT getDefects() — this needs every
  // Production-phase incident regardless of which test cycle picked it up,
  // where getDefects (even cycle-scoped) is answering a different question
  // ("what did THIS cycle find"), not "what happened in production."
  // Release-scoped only (getRelId, not getQcIds) — a production incident
  // isn't tied to one specific test cycle.
  //
  // Dev/Oracle-disabled path mirrors getTargetCrDefects' real-seed-first
  // pattern exactly (2026-08-09 — product decision to show the same real
  // field breadth as the TARGET-defects screen instead of a hand-picked
  // 8-row mock): the real BUG-table export already covers Production-phase
  // rows (testPhase), just filtered by detectedInRelease here instead of
  // targetRelease. A version with no real historical match correctly gets
  // an empty list, same reasoning as buildMockTargetDefects.
  async getGoLiveIncidents(versionId: string): Promise<GoLiveIncidentDto[]> {
    const { enabled } = await getOracleConfig();
    if (enabled) {
      const relId = await this.getRelId(versionId);
      if (!relId) return [];
      let conn: any;
      try {
        conn = await oracleConnect();
        const result = await conn.execute(GO_LIVE_INCIDENTS_SQL, { releaseId: relId });
        return (result.rows ?? []).map(mapRowToTargetDefect);
      } catch (err: any) {
        this.logger.error(`Oracle getGoLiveIncidents: ${err.message}`);
        throw err;
      } finally {
        if (conn) await conn.close().catch(() => {});
      }
    }

    const real = loadRealTargetDefects();
    if (real) {
      const version = await prisma.version.findUnique({ where: { id: versionId }, include: { qcRelease: true } });
      const releaseName = (version as any)?.qcRelease?.relName ?? version?.name ?? '';
      return releaseName ? real.filter(d => d.testPhase === 'Production' && d.detectedInRelease === releaseName) : [];
    }
    return [];
  }

  // Full ~50-field BUG record for one defect, regardless of release/version —
  // backs the open-production-defects table's "click a row" detail screen.
  // Not release-scoped (unlike getTargetCrDefects/getGoLiveIncidents) since a
  // defect clicked from that table can belong to any historical release.
  async getDefectFullDetail(defectId: string): Promise<TargetDefectDto | null> {
    const defect = await this.getDefectFullDetailRaw(defectId);
    if (!defect) return null;
    const [resolved] = await resolveDefectPersonNames([defect]);
    return resolved;
  }

  private async getDefectFullDetailRaw(defectId: string): Promise<TargetDefectDto | null> {
    const { enabled } = await getOracleConfig();
    if (enabled) {
      let conn: any;
      try {
        conn = await oracleConnect();
        const result = await conn.execute(DEFECT_BY_ID_SQL, { defectId });
        const rows = (result.rows ?? []).map(mapRowToTargetDefect);
        const row = rows[0] ?? null;
        if (row) {
          // The form shows ONE defect, so read description + comments in full.
          // DEFECT_BY_ID_SQL (like every list query) takes DBMS_LOB.SUBSTR(...,
          // 4000) of these CLOBs — a 4000-BYTE limit in SQL, i.e. ~2000 Hebrew
          // characters — which cut long comment threads (user report
          // 2026-10-07). Fetched as a string by the driver, no length limit,
          // then cleaned exactly like the SQL does.
          try {
            const full = await conn.execute(DEFECT_FULL_TEXT_SQL, { defectId }, {
              fetchInfo: { FULL_DESCRIPTION: { type: require('oracledb').STRING }, FULL_COMMENTS: { type: require('oracledb').STRING } },
            });
            const f = (full.rows ?? [])[0] as any;
            if (f) {
              if (f.FULL_DESCRIPTION != null) row.description = cleanClobDescription(String(f.FULL_DESCRIPTION));
              if (f.FULL_COMMENTS != null) row.notes = cleanClobComments(String(f.FULL_COMMENTS));
            }
          } catch (err: any) {
            this.logger.warn(`Oracle full CLOB text for defect ${defectId} failed, keeping the 4000-byte cut: ${err.message}`);
          }
        }
        return row;
      } catch (err: any) {
        this.logger.error(`Oracle getDefectFullDetail: ${err.message}`);
        throw err;
      } finally {
        if (conn) await conn.close().catch(() => {});
      }
    }

    const realBug = realAllBugById(defectId);
    if (realBug) return mapRowToTargetDefect(realBug);
    const real = loadRealTargetDefects();
    const fromSeed = real?.find(d => d.id === defectId);
    if (fromSeed) return fromSeed;

    // Dev/mock fallback: the drill-down tables (getDefects → MOCK_DEFECTS) and
    // the real-seed target-defects file use disjoint id spaces, so a row
    // clicked in any mock drill-down would otherwise 404 here ("לא נמצא מידע
    // מלא עבור תקלה זו"). Map the matching MOCK_DEFECTS entry onto a blank
    // TargetDefectDto so every mock defect is openable in dev.
    const mock = MOCK_DEFECTS.find(d => d.id === defectId);
    if (mock) {
      // MOCK_DEFECTS carries dd/mm/yyyy; the real Oracle column is ISO and the
      // frontend date formatter expects that — convert so the date isn't dropped.
      const dmy = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(mock.discoveryDate ?? '');
      const detectedOnDate = dmy ? `${dmy[3]}-${dmy[2]}-${dmy[1]}` : (mock.discoveryDate ?? '');
      return {
        ...mapRowToTargetDefect({}),
        id: mock.id,
        assignedTo: mock.assignedTo,
        system: mock.system,
        title: mock.title,
        subject: mock.title,
        summary: mock.title,
        description: mock.description,
        notes: mock.notes,
        reproducible: mock.reproducible,
        severity: mock.severity,
        priority: mock.priority,
        detectedBy: mock.reporter,
        detectedOnDate,
        environment: mock.environment,
        status: mock.status,
        testPhase: mock.testPhase,
        defectType: mock.defectType,
        responsibility: mock.responsibility,
        crHbrNumberReference: mock.crHbrNumberReference,
        crReferenceNumber: mock.crReferenceNumber,
        fixType: mock.fixType,
        reason: mock.reason,
        reopenYn: mock.reopenYn,
        targetRelease: mock.targetRelease,
      };
    }

    // Also cover rows that only exist in the Bug Dashboard mock set
    // (MOCK_BUG_ROWS / MOCK_BUG_TARGET_ROWS) — those drive the bug-dashboard
    // drill-downs and use their own id space too.
    const bugRow = [...MOCK_BUG_ROWS, ...MOCK_BUG_TARGET_ROWS].find(r => String(r.DEFECT_ID) === defectId);
    if (bugRow) {
      const d = bugRawRowToDefectDto(bugRow);
      return {
        ...mapRowToTargetDefect({}),
        id: d.id,
        assignedTo: d.assignedTo,
        title: d.title,
        subject: d.title,
        summary: d.title,
        severity: d.severity,
        status: d.status,
        defectType: d.defectType,
        detectedOnDate: d.discoveryDate,
        responsibility: d.responsibility,
        crHbrNumberReference: d.crHbrNumberReference,
        crReferenceNumber: d.crReferenceNumber,
      };
    }
    return null;
  }

  // All of a team's defects for the release (not scoped to one CR number —
  // see TARGET_CR_DEFECTS_SQL), optionally narrowed to one team (fuzzy name
  // match — see normalizeTeamName). Used by the TARGET-CR gate screen.
  // crNumber is kept only to label mock rows in dev/Oracle-disabled mode.
  async getTargetCrDefects(versionId: string, crNumber: string, teamName?: string): Promise<TargetDefectDto[]> {
    const { enabled } = await getOracleConfig();
    let all: TargetDefectDto[];
    if (enabled) {
      all = await this.fetchTargetCrDefectsFromOracle(versionId);
    } else {
      // Mock mode must still scope by release — the real seed dataset (see
      // loadRealTargetDefects) spans real historical releases (2022-2025),
      // so without this filter every dev/test version would show a random
      // mix of OTHER releases' defects (caught live 2026-07-28: the
      // "Target Release" column showed everything except the actually
      // selected version). Falls back to '' (no match, so an empty result)
      // when the version has no linked QcRelease.
      const version = await prisma.version.findUnique({ where: { id: versionId }, include: { qcRelease: true } });
      const releaseName = (version as any)?.qcRelease?.relName ?? version?.name ?? '';
      all = buildMockTargetDefects(crNumber, releaseName);
    }
    if (!teamName) return all;
    const normTeam = normalizeTeamName(teamName);
    // Team ownership lives in BG_USER_03/responsibility, matching the
    // convention every other dashboard in this file uses for team-level
    // grouping — assignedTo/BG_RESPONSIBLE is a person's name, not a team,
    // confirmed against real QC data 2026-08-23 (CRM Dev Team's TARGET
    // defects were invisible because this filter checked the wrong field).
    return all.filter(d => {
      const normResponsibility = normalizeTeamName(d.responsibility);
      return normResponsibility.includes(normTeam) || normTeam.includes(normResponsibility);
    });
  }

  // "תוקנו / פתוחות / פתוחות ומאושרות לעלייה" — CR-plan submission indicators
  // (spec confirmed 2026-08-29). See CR_DEFECT_INDICATORS_SQL's comment for
  // the exact bucket rules. A defect targeted at this release but not yet
  // closed fits none of the three requested buckets and is intentionally
  // omitted — this screen isn't meant to be a complete defect-status report.
  //
  // teamName: omit for the release-manager-facing unified plan (counts every
  // team's defects on the CR together); pass the submitting team's name from
  // a team lead's own CR-plan screen so each team only sees its own defects —
  // same optional fuzzy-match-by-responsibility convention as getTargetCrDefects
  // (spec confirmed 2026-08-29).
  async getCrDefectIndicators(versionId: string, crNumber: string, teamName?: string): Promise<CrDefectIndicatorsDto> {
    const version = await prisma.version.findUnique({ where: { id: versionId }, include: { qcRelease: true } });
    const releaseName = (version as any)?.qcRelease?.relName ?? version?.name ?? '';

    const { enabled } = await getOracleConfig();
    let all: TargetDefectDto[];
    if (enabled) {
      const relId = (version as any)?.qcRelease?.relId ?? null;
      if (!relId) return { fixed: [], open: [], openApproved: [] };
      let conn: any;
      try {
        conn = await oracleConnect();
        const result = await conn.execute(CR_DEFECT_INDICATORS_SQL, { releaseId: relId, crNumber });
        all = (result.rows ?? []).map(mapRowToTargetDefect);
      } catch (err: any) {
        this.logger.error(`Oracle getCrDefectIndicators: ${err.message}`);
        throw err;
      } finally {
        if (conn) await conn.close().catch(() => {});
      }
    } else {
      const real = loadRealTargetDefects();
      all = (real ?? []).filter(d =>
        d.crHbrNumberReference.startsWith(`${crNumber} `) &&
        (d.detectedInRelease === releaseName || d.targetRelease === releaseName),
      );
    }

    if (teamName) {
      const normTeam = normalizeTeamName(teamName);
      all = all.filter(d => {
        const normResponsibility = normalizeTeamName(d.responsibility);
        return normResponsibility.includes(normTeam) || normTeam.includes(normResponsibility);
      });
    }

    const fixed: TargetDefectDto[] = [];
    const open: TargetDefectDto[] = [];
    const openApproved: TargetDefectDto[] = [];
    for (const d of all) {
      const target = (d.targetRelease || '').trim();
      if (!target) {
        open.push(d);
      } else if (target === releaseName && d.detectedInRelease !== releaseName && CR_INDICATOR_FIXED_STATUSES.includes(d.status)) {
        fixed.push(d);
      } else if (target !== releaseName && d.detectedInRelease === releaseName) {
        openApproved.push(d);
      }
    }
    return { fixed, open, openApproved };
  }

  private async fetchTargetCrDefectsFromOracle(versionId: string): Promise<TargetDefectDto[]> {
    const relId = await this.getRelId(versionId);
    if (!relId) return [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(TARGET_CR_DEFECTS_SQL, { releaseId: relId });
      return (result.rows ?? []).map(mapRowToTargetDefect);
    } catch (err: any) {
      this.logger.error(`Oracle getTargetCrDefects: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Release-wide raw defect rows (id/detectedBy/status) for a tester's own
  // "defects I reported" self-scoped stat — see target-cr.service.ts's
  // getMyDefectStats, which does the tester-name filtering and counting.
  async getMyReportedDefects(versionId: string): Promise<ReportedDefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return buildMockReportedDefects();

    const relId = await this.getRelId(versionId);
    if (!relId) return [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(MY_REPORTED_DEFECTS_SQL, { releaseId: relId });
      return (result.rows ?? []).map((r: any): ReportedDefectDto => ({
        id:             String(r.DEFECT_ID),
        title:          r.TITLE             ?? '',
        detectedBy:     r.DETECTED_BY       ?? '',
        status:         r.DEFECT_STATUS     ?? '',
        severity:       r.SEVERITY          ?? '',
        assignedTo:     r.ASSIGNED_TO       ?? '',
        discoveryDate:  r.DETECTED_ON_DATE  ?? null,
        modified:       r.MODIFIED          ?? null,
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getMyReportedDefects: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Mock/offline mode reuses the same gitignored real-data seed as
  // getTargetCrDefects (loadRealTargetDefects) — it already carries
  // detectedInRelease/detectedInCycle for every row, just filtered here by
  // the release that DETECTED the defect rather than the one it TARGETS.
  async getDefectsByCycle(versionId: string): Promise<DefectByCycleDto[]> {
    return qcMemo(`defectsByCycle|${versionId}`, () => this.getDefectsByCycleUncached(versionId));
  }

  private async getDefectsByCycleUncached(versionId: string): Promise<DefectByCycleDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) {
      const version = await prisma.version.findUnique({ where: { id: versionId }, include: { qcRelease: true } });
      const releaseName = (version as any)?.qcRelease?.relName ?? version?.name ?? '';
      const real = loadRealTargetDefects();
      if (!real || !releaseName) return [];
      return real
        .filter(d => d.detectedInRelease === releaseName && !isProductionEnvironment(d.environment))
        .map(d => ({ id: d.id, detectedInCycle: d.detectedInCycle, status: d.status }));
    }

    const relId = await this.getRelId(versionId);
    if (!relId) return [];
    return this.getDefectsByCycleByRelId(relId);
  }

  // relId-direct variant (2026-10-01) — for a historical release with no
  // local Version to resolve a relId from. No mock-mode fallback: the
  // offline seed here is keyed by release NAME (loadRealTargetDefects),
  // which getDefectsByCycle above already resolves from the local Version —
  // there's no local Version in this path to get a name from, and no relId
  // key on that seed file to look up instead.
  async getDefectsByCycleByRelId(relId: number): Promise<DefectByCycleDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(DEFECTS_BY_CYCLE_SQL, { releaseId: relId });
      return (result.rows ?? []).map((r: any): DefectByCycleDto => ({
        id: String(r.DEFECT_ID),
        detectedInCycle: r.DETECTED_IN_CYCLE ?? '',
        status: r.DEFECT_STATUS ?? '',
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getDefectsByCycleByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // System-wide, all-status dashboard for the general Defects module
  // (2026-09-22) — see computeAllDefectsDashboard's own comment for the
  // scoping/performance caveat (unbounded query, unverified at real volume).
  async getAllDefectsDashboard(user: { sub: string; role: string }, filter: DefectsHubFilter = {}): Promise<AllDefectsDashboardDto & { options: { years: number[]; releases: string[] } }> {
    return qcMemo(`allDash|${user.sub}|${user.role}|${JSON.stringify(filter)}`, () => this.getAllDefectsDashboardUncached(user, filter));
  }

  private async getAllDefectsDashboardUncached(user: { sub: string; role: string }, filter: DefectsHubFilter = {}): Promise<AllDefectsDashboardDto & { options: { years: number[]; releases: string[] } }> {
    const rows = await this.getAllDefectsRawRows(user);
    const years = new Set<number>(), releases = new Set<string>();
    for (const r of rows) {
      const y = rowYear(r);
      if (y) years.add(y);
      if (r.DETECTED_IN_RELEASE) releases.add(String(r.DETECTED_IN_RELEASE).trim());
    }
    return {
      ...computeAllDefectsDashboard(rows.filter(r => matchesHubFilter(r, filter))),
      options: { years: Array.from(years).sort((a, b) => b - a), releases: Array.from(releases).sort((a, b) => b.localeCompare(a)) },
    };
  }

  // Defects module list (2026-10-05): server-side paging, newest first
  // (BG_BUG_ID desc), the same year / release filters as the dashboard, and a
  // search (defect id, or text in the title). Replaces the old 300-row cap
  // with no ORDER BY, which returned an arbitrary slice - a defect that
  // certainly exists in QC "wasn't there". Pre-12c Oracle: ROWNUM paging.
  async getAllDefectsPage(user: { sub: string; role: string }, q: {
    field?: string; value?: string; kpi?: string; search?: string; page?: number; pageSize?: number;
  } & DefectsHubFilter): Promise<{ rows: DefectDto[]; total: number; page: number; pageSize: number }> {
    return qcMemo(`allPage|${user.sub}|${user.role}|${JSON.stringify(q)}`, () => this.getAllDefectsPageUncached(user, q));
  }

  private async getAllDefectsPageUncached(user: { sub: string; role: string }, q: {
    field?: string; value?: string; kpi?: string; search?: string; page?: number; pageSize?: number;
  } & DefectsHubFilter): Promise<{ rows: DefectDto[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Math.floor(Number(q.page) || 1));
    const pageSize = Math.min(500, Math.max(10, Math.floor(Number(q.pageSize) || 100)));
    if (q.field && q.field !== '__kpi__' && !ALL_DEFECTS_FILTER_COLUMNS[q.field]) throw new BadRequestException(`שדה סינון לא מוכר: ${q.field}`);
    const kpi = q.field === '__kpi__' ? q.value : q.kpi;
    if (kpi && !ALL_DEFECTS_KPI_WHERE[kpi]) throw new BadRequestException(`KPI לא מוכר: ${kpi}`);
    const search = (q.search ?? '').trim();
    const scope = await resolveDefectScope(user);
    const { enabled } = await getOracleConfig();

    if (!enabled) {
      let rows = filterMockRowsByScope(mockAllDefectsRows(), scope).filter(r => matchesHubFilter(r, q));
      if (kpi) rows = rows.filter(ALL_DEFECTS_KPI_PREDICATE[kpi]);
      if (q.field && q.field !== '__kpi__') {
        const key = MOCK_FILTER_KEY[q.field];
        rows = rows.filter(r => String((r as any)[key] ?? '').trim() === String(q.value ?? '').trim());
      }
      if (search) rows = rows.filter(r => /^\d+$/.test(search) ? String(r.DEFECT_ID) === search : String(r.TITLE ?? '').toLowerCase().includes(search.toLowerCase()));
      rows = [...rows].sort((a, b) => Number(b.DEFECT_ID) - Number(a.DEFECT_ID));
      return { rows: rows.slice((page - 1) * pageSize, page * pageSize).map(allDefectsRawRowToDefectDto), total: rows.length, page, pageSize };
    }

    const conds: string[] = [];
    const binds: Record<string, any> = {};
    if (q.field && q.field !== '__kpi__') { conds.push(`TRIM(${ALL_DEFECTS_FILTER_COLUMNS[q.field]}) = TRIM(:fv)`); binds.fv = q.value ?? ''; }
    if (kpi) conds.push(`(${ALL_DEFECTS_KPI_WHERE[kpi]})`);
    (q.years ?? []).forEach((y, i) => { binds[`y${i}`] = y; });
    if ((q.years ?? []).length) conds.push(`EXTRACT(YEAR FROM BG_DETECTION_DATE) IN (${q.years!.map((_, i) => `:y${i}`).join(', ')})`);
    (q.releases ?? []).forEach((r, i) => { binds[`r${i}`] = r; });
    if ((q.releases ?? []).length) conds.push(`TRIM(detected_rel.REL_NAME) IN (${q.releases!.map((_, i) => `TRIM(:r${i})`).join(', ')})`);
    if (search) {
      if (/^\d+$/.test(search)) { conds.push('BG_BUG_ID = :sid'); binds.sid = Number(search); }
      else { conds.push('UPPER(NVL(BG_SUMMARY, BG_SUBJECT)) LIKE :sq'); binds.sq = `%${search.toUpperCase()}%`; }
    }
    const { sql: scopeSql, binds: scopeBinds } = buildDefectScopeSql(scope);
    if (scopeSql) conds.push(scopeSql);
    Object.assign(binds, scopeBinds);
    const where = conds.length ? `  WHERE ${conds.join('\n    AND ')}\n` : '';

    let conn: any;
    try {
      conn = await oracleConnect();
      const countRes = await conn.execute(
        `SELECT COUNT(*) AS CNT FROM BUG\n  LEFT JOIN RELEASES detected_rel ON detected_rel.REL_ID = BUG.BG_DETECTED_IN_REL\n${where}`, binds);
      const total = Number((countRes.rows ?? [])[0]?.CNT ?? 0);
      const lo = (page - 1) * pageSize, hi = page * pageSize;
      const pageSql = `SELECT * FROM (SELECT q.*, ROWNUM AS RN__ FROM (\n${DEFECTS_SQL_SELECT}${where}  ORDER BY BG_BUG_ID DESC\n) q WHERE ROWNUM <= :hi__) WHERE RN__ > :lo__\n`;
      const rows = await this.runDefectsQuery(pageSql, { ...binds, hi__: hi, lo__: lo });
      return { rows, total, page, pageSize };
    } catch (err: any) {
      this.logger.error(`Oracle getAllDefectsPage: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // The user's whole scope of defect rows (dashboard columns), any release.
  private async getAllDefectsRawRows(user: { sub: string; role: string }): Promise<AllDefectsRawRow[]> {
    const scope = await resolveDefectScope(user);
    const { enabled } = await getOracleConfig();
    if (!enabled) return filterMockRowsByScope(mockAllDefectsRows(), scope);

    let conn: any;
    try {
      conn = await oracleConnect();
      const { sql: scopeSql, binds } = buildDefectScopeSql(scope);
      const sql = scopeSql ? `${ALL_DEFECTS_DASHBOARD_SQL}\n  WHERE ${scopeSql}` : ALL_DEFECTS_DASHBOARD_SQL;
      const result = await conn.execute(sql, binds);
      return (result.rows ?? []) as AllDefectsRawRow[];
    } catch (err: any) {
      this.logger.error(`Oracle getAllDefectsRawRows: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Drill-down behind one breakdown-panel bar OR one KPI tile on the general
  // Defects module — returns the FULL DefectDto shape (2026-09-23, follow-up
  // to the item-B fix: user pointed out every other drill-down table in the
  // app already has real column-picker breadth via DefectDrilldownModal, and
  // asked "why not use something that's already good?" instead of this
  // screen's own separate 8-column implementation). filterField is validated
  // against a fixed allowlist (ALL_DEFECTS_FILTER_COLUMNS) before touching
  // SQL — never interpolated from caller input directly. filterField ===
  // '__kpi__' is the compound-predicate path for the 5 headline tiles — see
  // ALL_DEFECTS_KPI_WHERE/_PREDICATE above.
  async getAllDefectsFiltered(filterField: string, value: string, user: { sub: string; role: string }): Promise<DefectDto[]> {
    return qcMemo(`allFiltered|${user.sub}|${user.role}|${filterField}|${value}`, () => this.getAllDefectsFilteredUncached(filterField, value, user));
  }

  private async getAllDefectsFilteredUncached(filterField: string, value: string, user: { sub: string; role: string }): Promise<DefectDto[]> {
    const scope = await resolveDefectScope(user);
    const { enabled } = await getOracleConfig();
    if (filterField === '__kpi__') {
      const predicate = ALL_DEFECTS_KPI_PREDICATE[value];
      if (!predicate) throw new BadRequestException(`KPI לא מוכר: ${value}`);
      if (!enabled) return filterMockRowsByScope(mockAllDefectsRows(), scope).filter(predicate).map(allDefectsRawRowToDefectDto);
      const { sql: scopeSql, binds: scopeBinds } = buildDefectScopeSql(scope);
      return this.runDefectsQuery(buildAllDefectsKpiSql(value, scopeSql), scopeBinds);
    }

    if (!enabled) {
      const keyOf: Record<string, keyof AllDefectsRawRow> = {
        status: 'DEFECT_STATUS', severity: 'SEVERITY', mainModule: 'MAIN_MODULE',
        responsibility: 'RESPONSIBILITY', detectedInRelease: 'DETECTED_IN_RELEASE',
        environmentComponent: 'ENVIRONMENT_COMPONENT',
      };
      const key = keyOf[filterField];
      if (!key) throw new BadRequestException(`שדה סינון לא מוכר: ${filterField}`);
      return filterMockRowsByScope(mockAllDefectsRows(), scope)
        .filter(r => String(r[key] ?? '').trim() === value.trim())
        .map(allDefectsRawRowToDefectDto);
    }

    const { sql: scopeSql, binds: scopeBinds } = buildDefectScopeSql(scope);
    return this.runDefectsQuery(buildAllDefectsFilteredSql(filterField, scopeSql), { value, ...scopeBinds });
  }

  // ── Defects analytics (investigation dashboard, 2026-10-06) ────────────────
  // Defects-module rows: every defect in QC + close dates from AUDIT_LOG, the
  // heaviest read in the system. Served stale-while-revalidate (2026-10-07):
  // once loaded, an expired cache is returned immediately and ONE background
  // refresh replaces it — nobody waits on the full scan except the very first
  // load after a restart (and the warm-up below takes that one too). "force"
  // (the refresh button) waits for fresh rows, still shared by all callers.
  private async loadAnalyticsRows(force = false): Promise<{ rows: AnalyticsRawRow[]; mock: boolean }> {
    const analyticsCache = analyticsCaches.get(currentQcProjectKey() ?? '');
    const fresh = analyticsCache && Date.now() - analyticsCache.at < ANALYTICS_CACHE_MS;
    if (!force && fresh) return analyticsCache!;
    if (!force && analyticsCache) {
      this.refreshAnalyticsRows().catch(err => this.logger.warn(`defects analytics background refresh failed: ${err.message}`));
      return analyticsCache;
    }
    return this.refreshAnalyticsRows();
  }

  private refreshAnalyticsRows(): Promise<{ rows: AnalyticsRawRow[]; mock: boolean }> {
    const k = currentQcProjectKey() ?? '';
    let loading = analyticsLoadings.get(k);
    if (!loading) {
      loading = this.loadAnalyticsRowsFromDb().finally(() => { analyticsLoadings.delete(k); });
      analyticsLoadings.set(k, loading);
    }
    return loading;
  }

  // Fill the defects-module cache shortly after startup so the first user
  // doesn't wait on the full scan (only when Oracle is enabled).
  warmUpAnalytics(): void {
    setTimeout(() => {
      getOracleConfig().then(({ enabled }) => {
        if (enabled) this.refreshAnalyticsRows().catch(err => this.logger.warn(`defects analytics warm-up failed: ${err.message}`));
      }).catch(() => {});
    }, 20_000);
  }

  private async loadAnalyticsRowsFromDb(): Promise<{ rows: AnalyticsRawRow[]; mock: boolean }> {
    const { enabled } = await getOracleConfig();
    if (!enabled) {
      const c = { at: Date.now(), rows: buildMockAnalyticsRows(), mock: true };
      analyticsCaches.set(currentQcProjectKey() ?? '', c);
      return c;
    }
    // the two scans run in parallel on two pooled sessions
    const run = async (sql: string) => {
      const conn = await oracleConnect();
      try { return (await conn.execute(sql, {})).rows ?? []; } finally { await conn.close().catch(() => {}); }
    };
    try {
      const [rowsRes, closeRes] = await Promise.allSettled([run(DEFECTS_ANALYTICS_SQL), run(DEFECTS_CLOSE_DATES_SQL)]);
      if (rowsRes.status === 'rejected') throw rowsRes.reason;
      const rows = rowsRes.value as AnalyticsRawRow[];
      // Close dates are best-effort: if the audit query fails the dashboard
      // still loads, closed defects just fall back to last-modified.
      if (closeRes.status === 'fulfilled') {
        const closeById = new Map<string, any>((closeRes.value as any[]).map((r: any) => [String(r.DEFECT_ID), r.CLOSED_AT]));
        for (const r of rows) r.CLOSED_AT = closeById.get(String(r.DEFECT_ID)) ?? null;
      } else {
        this.logger.warn(`Oracle defects close-dates (AUDIT_LOG) failed, using BG_VTS fallback: ${closeRes.reason?.message}`);
      }
      const c = { at: Date.now(), rows, mock: false };
      analyticsCaches.set(currentQcProjectKey() ?? '', c);
      return c;
    } catch (err: any) {
      this.logger.error(`Oracle getDefectsAnalytics: ${err.message}`);
      throw err;
    }
  }

  // Same role scoping as the rest of the defects module (resolveDefectScope):
  // TEAM_LEAD → their teams' Responsibility, EMPLOYEE → assigned to them.
  private scopeAnalyticsRows(rows: AnalyticsRawRow[], scope: DefectScope): AnalyticsRawRow[] {
    if (scope.kind === 'all') return rows;
    if (scope.kind === 'team') {
      const set = new Set(scope.values.map(v => v.trim()));
      return rows.filter(r => (r.RESPONSIBILITY ?? '').split(';').some(t => set.has(t.trim())));
    }
    if (!scope.qcLogin) return [];
    const login = scope.qcLogin.trim().toLowerCase();
    return rows.filter(r => (r.ASSIGNED_TO ?? '').trim().toLowerCase() === login);
  }

  async getDefectsAnalytics(user: { sub: string; role: string }, force = false): Promise<DefectsAnalyticsDto> {
    const [{ rows, mock }, scope] = await Promise.all([this.loadAnalyticsRows(force), resolveDefectScope(user)]);
    const scoped = this.scopeAnalyticsRows(rows, scope);
    // QC logins → full names (same rule as PersonNamesInterceptor: show the
    // person, write the login). Unknown logins stay as-is.
    const users = await prisma.user.findMany({ where: { qcLogin: { not: null } }, select: { qcLogin: true, fullName: true } });
    const nameByLogin = new Map(users.map(u => [String(u.qcLogin).trim().toLowerCase(), u.fullName]));
    return encodeDefectsAnalytics(scoped, login => nameByLogin.get(login.toLowerCase()) ?? login, mock);
  }

  // Full rows for a drill-down page. Ids outside the caller's scope are
  // dropped (the ids come from the browser, so never trust them blindly).
  async getDefectsByIdsScoped(user: { sub: string; role: string }, ids: string[]): Promise<DefectDto[]> {
    const want = Array.from(new Set((ids ?? []).map(String))).slice(0, 500);
    if (want.length === 0) return [];
    const [{ rows, mock }, scope] = await Promise.all([this.loadAnalyticsRows(), resolveDefectScope(user)]);
    const allowed = new Set(this.scopeAnalyticsRows(rows, scope).map(r => String(r.DEFECT_ID)));
    const permitted = want.filter(id => allowed.has(id));
    if (permitted.length === 0) return [];
    let out: DefectDto[];
    if (mock) {
      const byId = new Map(rows.map(r => [String(r.DEFECT_ID), r]));
      out = permitted.map(id => byId.get(id)!).filter(Boolean).map(r => ({
        ...allDefectsRawRowToDefectDto({
          DEFECT_ID: r.DEFECT_ID, DEFECT_STATUS: r.DEFECT_STATUS, SEVERITY: r.SEVERITY, MAIN_MODULE: realAllBugById(String(r.DEFECT_ID))?.MAIN_MODULE ?? null,
          RESPONSIBILITY: r.RESPONSIBILITY, ASSIGNED_TO: r.ASSIGNED_TO, REOPEN_YN: null,
          DETECTED_IN_RELEASE: r.DETECTED_IN_RELEASE, DETECTED_ON_DATE: r.DETECTED_ON_DATE, ENVIRONMENT_COMPONENT: r.SYSTEM_NAME,
          TITLE: realAllBugById(String(r.DEFECT_ID))?.SUMMARY || realAllBugById(String(r.DEFECT_ID))?.SUBJECT || `תקלה לדוגמה #${r.DEFECT_ID} — ${r.SYSTEM_NAME ?? ''}`,
        }),
        subModule: r.SUB_MODULE ?? '', reporter: r.DETECTED_BY ?? '',
        environment: r.ENVIRONMENT ?? '',
        modified: r.MODIFIED ? new Date(r.MODIFIED as any).toLocaleDateString('he-IL') : '',
      }));
    } else {
      out = await this.getDefectsByIds(permitted);
    }
    // Keep the caller's order (e.g. "oldest first").
    const pos = new Map(permitted.map((id, i) => [id, i]));
    return out.sort((a, b) => (pos.get(a.id) ?? 0) - (pos.get(b.id) ?? 0));
  }

  async getDefectSlaConfig(): Promise<DefectSlaConfig> {
    const row = await prisma.systemParam.findUnique({ where: { key: 'DEFECT_SLA_CONFIG' } });
    if (!row?.value) return DEFAULT_SLA_CONFIG;
    try { return { ...DEFAULT_SLA_CONFIG, ...JSON.parse(row.value) }; } catch { return DEFAULT_SLA_CONFIG; }
  }

  async setDefectSlaConfig(cfg: Partial<DefectSlaConfig>): Promise<DefectSlaConfig> {
    const targetDays: Record<string, number | null> = {};
    for (const [sev, d] of Object.entries(cfg.targetDays ?? {})) {
      const n = d == null || (d as any) === '' ? null : Number(d);
      targetDays[sev] = n != null && Number.isFinite(n) && n > 0 ? Math.round(n) : null;
    }
    const next: DefectSlaConfig = { enabled: !!cfg.enabled, stopAt: 'closed', targetDays: { ...DEFAULT_SLA_CONFIG.targetDays, ...targetDays } };
    await prisma.systemParam.upsert({
      where: { key: 'DEFECT_SLA_CONFIG' },
      update: { value: JSON.stringify(next) },
      create: { key: 'DEFECT_SLA_CONFIG', value: JSON.stringify(next), label: 'SLA לתקלות — יעד בימים לפי חומרה (מודול תקלות)' } as any,
    });
    return next;
  }

  async getUserPreference(userId: string, key: string): Promise<any> {
    const row = await prisma.userPreference.findUnique({ where: { userId_key: { userId, key } } });
    return row?.value ?? null;
  }

  async setUserPreference(userId: string, key: string, value: any): Promise<any> {
    const json = JSON.stringify(value ?? null);
    if (json.length > 50000) throw new BadRequestException('ההגדרה גדולה מדי');
    const row = await prisma.userPreference.upsert({
      where: { userId_key: { userId, key } },
      update: { value: value ?? null },
      create: { userId, key, value: value ?? null },
    });
    return row.value;
  }

  async getBugDashboard(versionId: string): Promise<BugDashboardDto> {
    return qcMemo(`bugDash|${versionId}`, () => this.getBugDashboardUncached(versionId));
  }

  private async getBugDashboardUncached(versionId: string): Promise<BugDashboardDto> {
    const { enabled } = await getOracleConfig();
    const period = await this.versionTestingPeriod(versionId);
    if (!enabled) return { ...MOCK_BUG_DASHBOARD, ...(period ? { testingPeriod: period } : {}) };

    const relId = await this.getRelId(versionId);
    if (!relId) {
      this.logger.warn(`No QC release linked to version ${versionId}`);
      return { ...computeBugDashboard([], new Set()), ...(period ? { testingPeriod: period } : {}) };
    }
    const res = await this.getBugDashboardByRelId(relId);
    // the version's own dates win; the QC release's dates are only the fallback
    return period ? { ...res, testingPeriod: period } : res;
  }

  // Testing window = integration start (else QA start) → go-live (plannedStart),
  // both owned by version management. null when the version has neither.
  private async versionTestingPeriod(versionId: string): Promise<BugDashboardDto['testingPeriod'] | null> {
    const v = await prisma.version.findUnique({
      where: { id: versionId }, select: { integrationStart: true, qaStart: true, plannedStart: true },
    });
    const from = v?.integrationStart ?? v?.qaStart ?? null;
    const to = v?.plannedStart ?? null;
    if (!from && !to) return null;
    return { from: from ? localIsoDay(from) : null, to: to ? localIsoDay(to) : null, source: 'version' };
  }

  // relId-direct variant (2026-09-20) — same pattern as getDefectsByRelId:
  // bypasses Version/getRelId entirely so a QC-only historical release (no
  // local Version row at all) can get a real Bug Dashboard. BUG_DASHBOARD_SQL
  // was already relId-driven under the hood; getBugDashboard just resolved
  // versionId→relId first. Callers that DO have a versionId should keep using
  // getBugDashboard (it still returns MOCK_BUG_DASHBOARD when Oracle is
  // disabled, which this method deliberately does NOT — a relId came from a
  // real synced QcRelease row, so falling back to the versionId-flavored mock
  // here would be misleading rather than helpful).
  async getBugDashboardByRelId(relId: number): Promise<BugDashboardDto> {
    return qcMemo(`bugDashRel|${relId}`, () => this.getBugDashboardByRelIdUncached(relId));
  }

  private async getBugDashboardByRelIdUncached(relId: number): Promise<BugDashboardDto> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return computeBugDashboard([], new Set());

    let conn: any;
    try {
      conn = await oracleConnect();
      const [result, targetResult, reopenedIds, reopenTimes] = await Promise.all([
        conn.execute(BUG_DASHBOARD_SQL, { releaseId: relId }),
        conn.execute(BUG_DASHBOARD_TARGET_SQL, { releaseId: relId }),
        this.getReopenedDefectIds(relId),
        this.getLatestReopenTimes(relId),
      ]);
      // Best-effort extras: the dashboard still loads if either fails.
      // close dates come from the same single status-history pass (already shared)
      let closeTimes = new Map<string, Date>();
      try {
        closeTimes = deriveReleaseStatusFacts(await this.getReleaseStatusEvents(relId)).closeTimes;
      } catch (err: any) { this.logger.warn(`Oracle bug-dashboard close dates failed, using BG_VTS: ${err.message}`); }
      let releaseName: string | null = null;
      try {
        const rn = await conn.execute(RELEASE_NAME_SQL, { releaseId: relId });
        releaseName = ((rn.rows ?? [])[0] as any)?.REL_NAME ?? null;
      } catch { /* name is only for the deep link */ }
      return {
        ...computeBugDashboard(
          (result.rows ?? []) as BugRawRow[],
          reopenedIds,
          (targetResult.rows ?? []) as BugRawRow[],
          reopenTimes,
          closeTimes,
        ),
        releaseName,
        testingPeriod: await this.qcReleaseTestingPeriod(relId),
      };
    } catch (err: any) {
      this.logger.error(`Oracle getBugDashboardByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // The Bug Dashboard's own row set (BUG_DASHBOARD_SQL / MOCK_BUG_ROWS) as
  // DefectDto[], so drill-downs that key on BUG_DASHBOARD-specific fields
  // (BG_USER_03 responsibility, BG_USER_10 category, status buckets,
  // Production/Regression) resolve against the exact rows the KPI numbers were
  // computed from — never the wider DEFECTS_SQL set, which uses different
  // columns for some of these and (in dev) a disjoint mock dataset.
  async getBugDashboardDefects(versionId: string): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_BUG_ROWS.map(bugRawRowToDefectDto);
    const relId = await this.getRelId(versionId);
    if (!relId) return [];
    return this.getBugDashboardDefectsByRelId(relId);
  }

  // relId-direct (historical QC release with no local Version, 2026-10-05).
  async getBugDashboardDefectsByRelId(relId: number): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return [];
    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(BUG_DASHBOARD_SQL, { releaseId: relId });
      return ((result.rows ?? []) as BugRawRow[]).map(bugRawRowToDefectDto);
    } catch (err: any) {
      this.logger.error(`Oracle getBugDashboardDefectsByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }


  // Row list behind the Bug Dashboard's TARGET card — same scope as
  // BUG_DASHBOARD_TARGET_SQL (detected earlier, targeted here). Returned as
  // DefectDto[] so DefectDrilldownModal renders it like every other bucket.
  async getBugDashboardTargetDefects(versionId: string): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_BUG_TARGET_ROWS.map(bugRawRowToDefectDto);
    const relId = await this.getRelId(versionId);
    if (!relId) return [];
    return this.getBugDashboardTargetDefectsByRelId(relId);
  }

  async getBugDashboardTargetDefectsByRelId(relId: number): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return [];
    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(BUG_DASHBOARD_TARGET_SQL, { releaseId: relId });
      return ((result.rows ?? []) as BugRawRow[]).map(bugRawRowToDefectDto);
    } catch (err: any) {
      this.logger.error(`Oracle getBugDashboardTargetDefectsByRelId: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }


  // "יחס תקלות חדשות ביצור" — cross-release, all-history (no versionId scoping,
  // same rationale as getOpenProductionDefectsHistory below).
  async getNewVsTargetDefects(): Promise<NewVsTargetDefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_NEW_VS_TARGET_DEFECTS;

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(NEW_VS_TARGET_DEFECTS_SQL);
      return (result.rows ?? []).map((r: any): NewVsTargetDefectDto => ({
        defectId:        String(r.DEFECT_ID),
        targetRelId:     r.TARGET_REL_ID   != null ? String(r.TARGET_REL_ID) : null,
        targetRelName:   r.TARGET_REL_NAME ?? null,
        detectedRelId:   r.DETECTED_REL_ID != null ? String(r.DETECTED_REL_ID) : null,
        detectedRelName: r.DETECTED_REL_NAME ?? null,
        responsibility:  r.RESPONSIBILITY ?? null,
        severity:        r.SEVERITY ?? null,
        detectedDate:    r.DETECTED_DATE ? new Date(r.DETECTED_DATE).toISOString().slice(0, 10) : null,
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getNewVsTargetDefects: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // KPI 11 — cross-release, all-history report (no versionId scoping, matches
  // the reference Power BI page which filters by Responsibility/Status/Year/
  // FixType/Type only, never by a single release).
  async getOpenProductionDefectsHistory(): Promise<OpenProdDefectMonthDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_OPEN_PROD_DEFECTS_HISTORY;

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(OPEN_PROD_DEFECTS_HISTORY_SQL);
      return (result.rows ?? []).map((r: any): OpenProdDefectMonthDto => ({
        monthDate:      r.MONTH_DATE ? new Date(r.MONTH_DATE).toISOString().slice(0, 10) : '',
        monthLabel:     r.MONTH_LABEL ?? '',
        defectId:       String(r.DEFECT_ID),
        statusAtMonth:  r.STATUS_AT_MONTH ?? '',
        currentStatus:  r.CURRENT_STATUS ?? '',
        releaseId:      r.RELEASE_ID != null ? String(r.RELEASE_ID) : null,
        severity:       r.SEVERITY ?? null,
        priority:       r.PRIORITY ?? null,
        responsibility: r.RESPONSIBILITY ?? null,
        testPhase:      r.TEST_PHASE ?? null,
        detectedBy:     r.DETECTED_BY ?? null,
        detectedDate:   r.DETECTED_DATE ? new Date(r.DETECTED_DATE).toISOString().slice(0, 10) : null,
        reopenYn:       r.REOPEN_YN ?? null,
        area:           r.AREA ?? null,
        bugType:        r.BUG_TYPE ?? null,
        fixType:        r.FIX_TYPE ?? null,
        title:              r.TITLE ?? null,
        assignedTo:         r.ASSIGNED_TO ?? null,
        qaTester:           r.QA_TESTER ?? null,
        environment:        r.ENVIRONMENT ?? null,
        subModule:          r.SUB_MODULE ?? null,
        mainModule:         r.MAIN_MODULE ?? null,
        crReferenceNumber:  r.CR_REFERENCE_NUMBER ?? null,
        platform:           r.PLATFORM ?? null,
        closedBy:           r.CLOSED_BY ?? null,
        estimatedFixTime:   r.ESTIMATED_FIX_TIME ?? null,
        actualFixTime:      r.ACTUAL_FIX_TIME ?? null,
        deploymentReason:   r.DEPLOYMENT_REASON ?? null,
        detectedApkVersion: r.DETECTED_APK_VERSION ?? null,
        detectedHotAppApk:  r.DETECTED_HOT_APP_APK ?? null,
        targetHotAppApk:    r.TARGET_HOT_APP_APK ?? null,
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getOpenProductionDefectsHistory: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // No mock fallback (returns null when Oracle is disabled) — inventing a
  // fake historical fix-rate would be worse than just not showing that half
  // of the Forecast card (spec confirmed 2026-09-02, "אם אפשר" — this is a
  // best-effort metric, not a guaranteed one).
  async getDefectFixRate(versionId: string, startDate: Date, endDate: Date): Promise<number | null> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return null;
    const relId = await this.getRelId(versionId);
    if (!relId) return null;

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(DEFECT_FIX_RATE_SQL, { releaseId: relId, startDate, endDate });
      const row = (result.rows ?? [])[0] as any;
      return row ? Number(row.FIXED_COUNT ?? 0) : 0;
    } catch (err: any) {
      this.logger.error(`Oracle getDefectFixRate: ${err.message}`);
      return null;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  async getDefectStatusHistory(defectId: string): Promise<DefectStatusHistoryDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_DEFECT_STATUS_HISTORY[defectId] ?? [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(DEFECT_STATUS_HISTORY_SQL, { defectId });
      return (result.rows ?? []).map((r: any): DefectStatusHistoryDto => ({
        status:     r.STATUS ?? '',
        changeTime: r.CHANGE_TIME ? new Date(r.CHANGE_TIME).toISOString() : '',
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getDefectStatusHistory: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Backs the TARGET-defect detail form's change-history section. AU_USER/
  // AP_OLD_VALUE are unverified against this real instance — see the note on
  // DEFECT_FIELD_HISTORY_SQL above.
  async getDefectFieldHistory(defectId: string): Promise<DefectFieldChangeDto[]> {
    return withHistoryPersonNames(await this.getDefectFieldHistoryRaw(defectId));
  }

  private async getDefectFieldHistoryRaw(defectId: string): Promise<DefectFieldChangeDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_DEFECT_FIELD_HISTORY[defectId] ?? [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(DEFECT_FIELD_HISTORY_SQL, { defectId });
      return (result.rows ?? []).map((r: any): DefectFieldChangeDto => ({
        changeTime:   r.CHANGE_TIME ? new Date(r.CHANGE_TIME).toISOString() : '',
        changedBy:    r.CHANGED_BY ?? '',
        propertyName: r.PROPERTY_NAME ?? '',
        oldValue:     r.OLD_VALUE ?? '',
        newValue:     r.NEW_VALUE ?? '',
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getDefectFieldHistory: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  // Backs the UAT cycle's "הצג סיכום בדיקות" button (spec 2026-09-17) — RQ_USER_26
  // ("Test Summary") on the CR's own requirement row. Returns null (not '')
  // when there's nothing to show, so the frontend can tell "no summary
  // written yet" apart from "query returned an empty string".
  // `versionId` added 2026-09-23 — optional, but tried FIRST when given (see
  // CR_TEST_SUMMARY_SQL_SCOPED's own comment for why release-scoping is the
  // leading suspect for the empty-modal bug once the field name itself was
  // confirmed correct). Falls back to the unscoped query so a CR with only
  // one REQ row ever (the common case) is unaffected.
  async getCrTestSummary(crNumber: string, versionId?: string): Promise<string | null> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return null;

    let conn: any;
    try {
      conn = await oracleConnect();
      const releaseId = versionId ? await this.getRelId(versionId) : null;
      if (releaseId) {
        const scoped = await conn.execute(CR_TEST_SUMMARY_SQL_SCOPED, { crNumber, releaseId });
        const scopedRows = scoped.rows ?? [];
        // A real match for THIS release was found — trust it even if its
        // summary is empty (not yet written for this release), rather than
        // falling through to a DIFFERENT release's possibly-stale text.
        // Only fall back when no row links this CR to this release at all.
        if (scopedRows.length > 0) {
          const summary = (scopedRows[0] as any)?.TEST_SUMMARY;
          return summary ? String(summary) : null;
        }
      }
      const result = await conn.execute(CR_TEST_SUMMARY_SQL, { crNumber });
      const row = (result.rows ?? [])[0] as any;
      const summary = row?.TEST_SUMMARY;
      return summary ? String(summary) : null;
    } catch (err: any) {
      this.logger.error(`Oracle getCrTestSummary: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  async getCrItems(_releaseId?: string, versionId?: string): Promise<CrItemDto[]> {
    if (versionId) {
      const rows = await prisma.versionCrAssignment.findMany({
        where: { versionId, manuallyRemoved: false },
        select: { crNumber: true, crLabel: true },
        orderBy: { crNumber: 'asc' },
      });
      // Deduplicate by crNumber (same CR can belong to multiple teams)
      const seen = new Set<string>();
      const items: CrItemDto[] = [];
      for (const row of rows) {
        if (seen.has(row.crNumber)) continue;
        seen.add(row.crNumber);
        const label = row.crLabel ?? row.crNumber;
        items.push({ id: row.crNumber, description: label, label });
      }
      return items;
    }
    return MOCK_CR_ITEMS;
  }

  // ── Open-production-defects screen config — admin-managed column/field
  // selection + order for the table and its per-defect detail screen. Stored
  // as SystemParam JSON (same mechanism as LDAP/Email settings), not a new
  // table — this is a single global config object, not a list of records.
  // ── Defect view/update form layout (user ask 2026-10-04) ────────────────
  // Admin-designed panels (name + ordered fields) for the defect detail
  // screen, per scope: one default, plus optional per-role and per-team
  // overrides. A user gets team → role → default (user's chosen precedence);
  // none set → null, and the screen falls back to its built-in panels.
  async getDefectFormLayouts(): Promise<DefectFormLayouts> {
    const row = await prisma.systemParam.findUnique({ where: { key: DEFECT_FORM_LAYOUTS_KEY } });
    if (!row) return { default: null, roles: {}, teams: {} };
    try {
      const parsed = JSON.parse(row.value);
      return { default: parsed.default ?? null, roles: parsed.roles ?? {}, teams: parsed.teams ?? {} };
    } catch {
      return { default: null, roles: {}, teams: {} };
    }
  }

  async setDefectFormLayouts(body: DefectFormLayouts) {
    const clean = (l: any): DefectFormLayout | null => {
      if (!l || !Array.isArray(l.panels)) return null;
      const panels = l.panels
        .filter((p: any) => p && typeof p.name === 'string' && Array.isArray(p.fields))
        .map((p: any) => {
          const fields: string[] = Array.from(new Set((p.fields as any[]).filter(f => typeof f === 'string' && /^[A-Za-z0-9_]{1,60}$/.test(f))));
          // full-row fields: only ones actually in this panel
          const wide = Array.isArray(p.wide) ? fields.filter(f => p.wide.includes(f)) : [];
          return { name: p.name.trim().slice(0, 60) || 'חלונית', fields, ...(wide.length ? { wide } : {}) };
        });
      return { panels };
    };
    const cleanMap = (m: any) => Object.fromEntries(
      Object.entries(m ?? {}).map(([k, v]) => [k, clean(v)]).filter(([, v]) => v !== null),
    );
    const value: DefectFormLayouts = { default: clean(body?.default), roles: cleanMap(body?.roles), teams: cleanMap(body?.teams) };
    await prisma.systemParam.upsert({
      where: { key: DEFECT_FORM_LAYOUTS_KEY },
      create: { key: DEFECT_FORM_LAYOUTS_KEY, label: 'תבניות טופס תצוגת תקלה', value: JSON.stringify(value) },
      update: { value: JSON.stringify(value) },
    });
    return value;
  }

  async resolveDefectFormLayout(user: { sub: string; role: string }) {
    const [all, memberships] = await Promise.all([
      this.getDefectFormLayouts(),
      prisma.teamMember.findMany({ where: { userId: user.sub }, select: { teamId: true, team: { select: { name: true } } } }),
    ]);
    for (const m of memberships) {
      if (all.teams[m.teamId]) return { layout: all.teams[m.teamId], scope: 'team' as const, scopeName: m.team.name };
    }
    if (all.roles[user.role]) return { layout: all.roles[user.role], scope: 'role' as const, scopeName: user.role };
    if (all.default) return { layout: all.default, scope: 'default' as const, scopeName: null };
    return { layout: null, scope: 'builtin' as const, scopeName: null };
  }

  async getOpenProdDefectsConfig(): Promise<{ tableColumns: string[]; detailFields: string[] }> {
    const [tableRow, detailRow] = await Promise.all([
      prisma.systemParam.findUnique({ where: { key: 'OPEN_PROD_DEFECTS_TABLE_COLUMNS' } }),
      prisma.systemParam.findUnique({ where: { key: 'OPEN_PROD_DEFECTS_DETAIL_FIELDS' } }),
    ]);
    return {
      tableColumns: tableRow ? JSON.parse(tableRow.value) : DEFAULT_OPEN_PROD_DEFECTS_TABLE_COLUMNS,
      detailFields: detailRow ? JSON.parse(detailRow.value) : DEFAULT_OPEN_PROD_DEFECTS_DETAIL_FIELDS,
    };
  }

  async setOpenProdDefectsConfig(patch: { tableColumns?: string[]; detailFields?: string[] }) {
    if (patch.tableColumns) {
      await prisma.systemParam.upsert({
        where: { key: 'OPEN_PROD_DEFECTS_TABLE_COLUMNS' },
        create: { key: 'OPEN_PROD_DEFECTS_TABLE_COLUMNS', label: 'עמודות טבלת תקלות ייצור פתוחות', value: JSON.stringify(patch.tableColumns) },
        update: { value: JSON.stringify(patch.tableColumns) },
      });
    }
    if (patch.detailFields) {
      await prisma.systemParam.upsert({
        where: { key: 'OPEN_PROD_DEFECTS_DETAIL_FIELDS' },
        create: { key: 'OPEN_PROD_DEFECTS_DETAIL_FIELDS', label: 'שדות מסך פרטי תקלת ייצור', value: JSON.stringify(patch.detailFields) },
        update: { value: JSON.stringify(patch.detailFields) },
      });
    }
    return this.getOpenProdDefectsConfig();
  }

  // Real workflow-aware status transitions (docs/spec-defects-module.md §4,
  // 2026-09-18) — replaces guessing at a hardcoded status list. Resolves the
  // acting user's DeployCenter team(s) to their configured QC group name(s)
  // (Team.qcGroupName, admin-set — see project memory
  // project-qc-workflow-transitions-2026-09-18 for why this is a static
  // mapping and not a live QC lookup), then looks up the real transition
  // rules transcribed from QC's own admin UI. `hasMapping: false` tells the
  // caller none of the user's teams have a QC group configured yet, so it
  // should fall back to the old free-text status field instead of showing
  // an empty/wrong dropdown.
  async getAllowedStatusTransitions(userId: string, currentStatus: string, role = ''): Promise<{ hasMapping: boolean; allowed: string[] }> {
    const memberships = await prisma.teamMember.findMany({ where: { userId }, include: { team: { select: { qcGroupName: true } } } });
    const qcGroupNames = Array.from(new Set(memberships.map(m => m.team.qcGroupName).filter((g): g is string => !!g)));
    // ADMIN / RELEASE_MANAGER: everything incl. Pending; CR_MANAGER: developers' rules
    return getAllowedTransitionsForUser(role, qcGroupNames, currentStatus);
  }
}
