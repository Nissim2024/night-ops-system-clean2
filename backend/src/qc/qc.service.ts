import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function getOracleConfig() {
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
  subject: string;
  title: string;
  release: string;
  cycle: string;
  planId: string;
  labId: string;
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
  qaTester: string;              // BG_USER_37 — the specific QA tester this TARGET defect belongs to (distinct from assignedTo/BG_RESPONSIBLE, which is a team/queue, not a person)
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

// Raw defect row for the "my reported defects" self-scoped stat — release-
// wide, filtered/aggregated by the caller (target-cr.service.ts) since the
// tester-name match is a JS-side free-text comparison, same as elsewhere.
export interface ReportedDefectDto {
  id: string;
  detectedBy: string;
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
}

export interface DefectStatusHistoryDto {
  status: string;
  changeTime: string;
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
  dailyReported: { date: string; count: number }[];
  openByType: { label: string; count: number }[];
  openByResponsibility: { label: string; count: number }[];
  openByCr: { label: string; count: number }[];
  reopenByCr: { label: string; count: number }[];
  criticalByCr: { label: string; count: number }[];
}

// ── SQL Queries ───────────────────────────────────────────────────────────────

const TEST_COVERAGE_SQL = `
  SELECT
    COUNT(*)                                                                           AS TOTAL,
    RQ.RQ_USER_05                                                                      AS RESPONSIBLE,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Passed'          THEN 1 ELSE 0 END)            AS PASSED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Failed'          THEN 1 ELSE 0 END)            AS FAILED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'No Run'          THEN 1 ELSE 0 END)            AS NOT_RUN,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Blocked'         THEN 1 ELSE 0 END)            AS BLOCKED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Not Completed'   THEN 1 ELSE 0 END)            AS NOT_COMPLETED,
    SUM(CASE WHEN TS.TS_EXEC_STATUS = 'Not Ready fr QA' THEN 1 ELSE 0 END)            AS NOT_READY,
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

const DEFECTS_SQL = `
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
  WHERE BG_USER_05 = 'Sanity Test'
    AND BG_DETECTED_IN_REL  = :releaseId
    AND BG_DETECTED_IN_RCYC = :cycleId
`;

// "יחס תקלות חדשות ביצור" — cross-release, all-history (no releaseId param,
// same pattern as OPEN_PROD_DEFECTS_HISTORY_SQL below). REL_NAME resolved via
// a self-join to RELEASES so the frontend never has to map numeric IDs itself.
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
`;

// Raw rows feeding the bug dashboard (PBIRS-equivalent) — scoped only by
// release (matches the PBIRS report's default filter state: Cycle/CR
// Number/Tester/Bug Status all "All"). Aggregation happens in JS below
// rather than in SQL, since row counts per release are small (~100-500).
// Defects for one CR within one release, for the TARGET-CR gate screen —
// team-name matching happens in JS (computeTargetDefects) since Oracle's
// BG_RESPONSIBLE free text ("CRM Team", "NETC-DT team"...) doesn't map
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
    -- BG_DEV_COMMENTS ("notes") — same HTML-entity cleanup chain as DEFECTS_SQL's
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

// Raw rows for a tester's own "defects I reported" stats — scoped only by
// release; the tester-name match against BG_DETECTED_BY happens in JS (same
// free-text-name-matching reasoning as BG_RESPONSIBLE elsewhere in this file).
const MY_REPORTED_DEFECTS_SQL = `
  SELECT
    BG_BUG_ID       AS DEFECT_ID,
    BG_DETECTED_BY  AS DETECTED_BY,
    BG_USER_04      AS DEFECT_STATUS
  FROM BUG
  WHERE BG_DETECTED_IN_REL = :releaseId
`;

const BUG_DASHBOARD_SQL = `
  SELECT
    BG_BUG_ID       AS DEFECT_ID,
    BG_RESPONSIBLE  AS ASSIGNED_TO,
    BG_USER_04      AS DEFECT_STATUS,
    BG_USER_06      AS DEFECT_TYPE,
    BG_USER_10      AS CATEGORY_REF,
    BG_USER_58      AS CR_REFERENCE_NUMBER,
    BG_TARGET_REL   AS TARGET_REL,
    BG_DETECTION_DATE AS DETECTED_ON_DATE,
    BG_SEVERITY     AS SEVERITY
  FROM BUG
  WHERE BG_DETECTED_IN_REL = :releaseId
`;

// KPI 11 — monthly snapshot of open PRODUCTION defects, adapted from the
// user-provided query. Environment filter (BG_USER_02 LIKE '%PROD%') is the
// only change from what was given — the original had no prod/QA distinction.
// Not scoped by release: this is a cross-release, all-history report (matches
// the reference Power BI page, which has no release filter, only
// Responsibility/Status/Year/FixType/Type).
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
        audit_property.AP_NEW_VALUE AS status,
        audit_log.AU_TIME           AS change_time
    FROM BUG defect
    INNER JOIN AUDIT_LOG        audit_log      ON defect.BG_BUG_ID       = audit_log.AU_ENTITY_ID
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
        MAX(fix_type)       KEEP (DENSE_RANK FIRST ORDER BY change_time) AS fix_type
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
    SELECT
        s.month_start, s.defect, s.last_status,
        a.release_id, a.severity, a.priority, a.responsibility, a.current_status,
        a.test_phase, a.detected_by, a.detected_date, a.reopen_yn, a.area, a.bug_type, a.fix_type
    FROM status_snapshot s
    JOIN bug_attributes a ON s.defect = a.defect
    WHERE s.last_status NOT IN ('Closed', 'Canceled')
),
open_without_history AS (
    SELECT
        m.month_start, b.BG_BUG_ID AS defect, b.BG_USER_04 AS last_status,
        b.BG_DETECTED_IN_REL AS release_id, b.BG_SEVERITY AS severity, b.BG_PRIORITY AS priority,
        b.BG_USER_03 AS responsibility, b.BG_USER_04 AS current_status, b.BG_USER_05 AS test_phase,
        b.BG_DETECTED_BY AS detected_by, b.BG_DETECTION_DATE AS detected_date,
        b.BG_USER_29 AS reopen_yn, b.BG_USER_10 AS area, b.BG_USER_06 AS bug_type, b.BG_USER_33 AS fix_type
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
    reopen_yn AS REOPEN_YN, area AS AREA, bug_type AS BUG_TYPE, fix_type AS FIX_TYPE
FROM open_with_history
UNION ALL
SELECT month_start, TO_CHAR(month_start, 'YYYY-MM'), defect, last_status, current_status,
    release_id, severity, priority, responsibility, test_phase, detected_by, detected_date,
    reopen_yn, area, bug_type, fix_type
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

// ── Mock data (used when ORACLE_ENABLED=false) ────────────────────────────────

const MOCK_COVERAGE: TestCoverageDto[] = [
  { total: 1,  responsible: 'maamona', planned: 1,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'HOT WEB',                                           release: '374', cycle: '1276', planId: '74538', labId: '74532' },
  { total: 6,  responsible: 'maamona', planned: 6,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: 'צמצום שיחות',           title: '12969 - דרישות חדשות מערכת תזכורות ב CRM',          release: '374', cycle: '1276', planId: '74543', labId: '74542' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'CRM HOTNET',                                        release: '374', cycle: '1276', planId: '74549', labId: '74548' },
  { total: 2,  responsible: 'roiv',    planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: 'שו"ש - חטיבת שירות',  title: '13072 - שינוי בהתנהלות של מסך AI',                  release: '374', cycle: '1276', planId: '74531', labId: '74530' },
  { total: 3,  responsible: 'maamona', planned: 3,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'שפיות בילי',                                        release: '374', cycle: '1276', planId: '74537', labId: '74532' },
  { total: 21, responsible: 'roiv',    planned: 21, passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'Addressability',                                    release: '374', cycle: '1276', planId: '74533', labId: '74532' },
  { total: 1,  responsible: 'maamona', planned: 1,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'Web Site NEXT',                                     release: '374', cycle: '1276', planId: '74539', labId: '74532' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: 'HOT ENERGY',          title: '12821 - שירות חשמל בכתובות ללא תשתית הוט',          release: '374', cycle: '1276', planId: '74525', labId: '74524' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'CRM',                                               release: '374', cycle: '1276', planId: '74534', labId: '74532' },
  { total: 8,  responsible: 'roiv',    planned: 8,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'Wizard HOTNET',                                     release: '374', cycle: '1276', planId: '74550', labId: '74548' },
  { total: 3,  responsible: 'roiv',    planned: 3,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'TOP TECH',                                          release: '374', cycle: '1276', planId: '74535', labId: '74532' },
  { total: 2,  responsible: 'maamona', planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'חשבוניות ודף מקדים',                                release: '374', cycle: '1276', planId: '74551', labId: '74548' },
  { total: 2,  responsible: 'maamona', planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, notReady: 0, subject: '',                    title: 'חשבוניות ודף מקדים',                                release: '374', cycle: '1276', planId: '74536', labId: '74532' },
];

const MOCK_DEFECTS: DefectDto[] = [
  {
    id: '7727', assignedTo: 'NC Team', system: 'NC', title: 'רשומות כפולות בממשק בנקים',
    description: 'בממשק הבנקים נוצרו רשומות כפולות עבור אותו לקוח.',
    reproducible: 'Y', severity: 'Severe', priority: 'High', reporter: 'innad',
    discoveryDate: '22/02/2011', environment: 'NC-Prod', status: 'Closed',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'תקלה נסגרה לאחר טיפול.',
  },
  {
    id: '8247', assignedTo: 'CRM Team', system: 'NC', title: 'רישום כפול של אירוע אישור הוראת קבע ב-CRM',
    description: 'בעת קליטת אישור הוראת קבע מהבנק נרשמים מספר אירועים ב-CRM.',
    reproducible: 'Y', severity: 'Low', priority: 'Medium', reporter: 'avia',
    discoveryDate: '05/04/2011', environment: 'Crm Prod', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'ממשקי EAI היו לא זמינים בזמן הבדיקה.',
  },
  {
    id: '7884', assignedTo: 'NC Team', system: 'ISPIT', title: 'קובץ רענונים של HotNet נוצר ריק',
    description: 'תהליך יצירת קובץ הרענונים הסתיים בהצלחה אך הקובץ שנוצר היה ריק.',
    reproducible: 'Y', severity: 'Show Stopper', priority: 'Low', reporter: 'avia',
    discoveryDate: '08/03/2011', environment: 'NC-Mig', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'מקור התקלה — בעיית Setup בטבלאות Billing.',
  },
  {
    id: '12697', assignedTo: 'SSO Team', system: 'SSO', title: 'לא נשלח מייל לאחר הסרה מרשימת דיוור',
    description: 'משתמש לא קיבל מייל אישור לאחר סימון הסרה מרשימת הדיוור.',
    reproducible: 'Y', severity: 'Severe', priority: 'High', reporter: 'vladimirs',
    discoveryDate: '22/05/2012', environment: 'MY HOT Test', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'המייל נשלח — הייתה טעות בכתובת.',
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
const MOCK_OPEN_PROD_DEFECTS_SOURCE: {
  id: string; severity: string; priority: string; responsibility: string;
  area: string; bugType: string; fixType: string; detectedDate: string;
  reopenYn: string; currentStatus: string; openMonths: string[];
}[] = [
  { id: '20411', severity: 'Show Stopper', priority: 'High',   responsibility: 'CRM Team',      area: 'CRM',      bugType: 'Functional', fixType: 'Code Fix', detectedDate: '2025-11-03', reopenYn: 'N', currentStatus: 'Open',     openMonths: ['2025-11', '2025-12', '2026-01', '2026-02'] },
  { id: '20487', severity: 'Severe',       priority: 'High',   responsibility: 'NETC-DT team',  area: 'NETC',     bugType: 'Setup',      fixType: 'Config',   detectedDate: '2025-12-10', reopenYn: 'Y', currentStatus: 'Reopen',   openMonths: ['2025-12', '2026-01', '2026-02'] },
  { id: '20502', severity: 'Medium',       priority: 'Medium', responsibility: 'ETL Team',      area: 'ETL',      bugType: 'DB Issue',   fixType: 'Code Fix', detectedDate: '2026-01-05', reopenYn: 'N', currentStatus: 'At Work',  openMonths: ['2026-01', '2026-02'] },
  { id: '20518', severity: 'Low',          priority: 'Low',    responsibility: 'CRM Team',      area: 'Billing',  bugType: 'GUI',        fixType: 'Code Fix', detectedDate: '2025-10-18', reopenYn: 'N', currentStatus: 'Pending',  openMonths: ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02'] },
  { id: '20530', severity: 'Severe',       priority: 'High',   responsibility: 'NC Team',       area: 'NC',       bugType: 'Functional', fixType: 'Code Fix', detectedDate: '2026-02-01', reopenYn: 'N', currentStatus: 'New',      openMonths: ['2026-02'] },
  { id: '20544', severity: 'Medium',       priority: 'Medium', responsibility: 'Web Dev Team',  area: 'Website',  bugType: 'Environment Issue', fixType: 'Config', detectedDate: '2025-11-20', reopenYn: 'N', currentStatus: 'Fixed_Dev', openMonths: ['2025-11', '2025-12', '2026-01'] },
  { id: '20559', severity: 'Show Stopper', priority: 'High',   responsibility: 'CRM Team',      area: 'CRM',      bugType: 'Change Requests', fixType: 'Code Fix', detectedDate: '2025-09-15', reopenYn: 'Y', currentStatus: 'Reopen', openMonths: ['2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02'] },
  { id: '20573', severity: 'Low',          priority: 'Low',    responsibility: 'NETC-DT team',  area: 'NETC',     bugType: 'GUI',        fixType: 'Code Fix', detectedDate: '2026-01-25', reopenYn: 'N', currentStatus: 'At Work',  openMonths: ['2026-01', '2026-02'] },
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
  total: number; coveragePct: number;
}
let realCrCoverageCache: CrCoverageDto[] | null | undefined;
function loadRealCrCoverage(): CrCoverageDto[] | null {
  if (realCrCoverageCache !== undefined) return realCrCoverageCache;
  try {
    const filePath = path.join(process.cwd(), 'src', 'qc', 'seed-data', 'test-coverage.local.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    realCrCoverageCache = JSON.parse(raw) as CrCoverageDto[];
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
}
let realCycleQgTargetsCache: CycleQgTargetDto[] | null | undefined;
function loadRealCycleQgTargets(): CycleQgTargetDto[] | null {
  if (realCycleQgTargetsCache !== undefined) return realCycleQgTargetsCache;
  try {
    const filePath = path.join(process.cwd(), 'src', 'qc', 'seed-data', 'cycle-qg-targets.local.json');
    const raw = fs.readFileSync(filePath, 'utf-8');
    realCycleQgTargetsCache = JSON.parse(raw) as CycleQgTargetDto[];
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
    detectedInCycle: '', targetRelease: '', targetCycle: '', crStatus: '', dropNumber: '',
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
    assignedTo: teams[i % teams.length],
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
  return Array.from({ length: 20 }, (_, i) => ({
    id: String(2000 + i),
    detectedBy: reporters[i % reporters.length],
    status: statuses[i % statuses.length],
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

// Raw BUG rows shape shared by both the mock data below and real Oracle rows
// from BUG_DASHBOARD_SQL — computeBugDashboard() aggregates either the same way.
interface BugRawRow {
  DEFECT_ID: string | number;
  ASSIGNED_TO: string | null;
  DEFECT_STATUS: string | null;
  DEFECT_TYPE: string | null;
  CATEGORY_REF: string | null;
  CR_REFERENCE_NUMBER: string | null;
  TARGET_REL: string | number | null;
  DETECTED_ON_DATE: string | Date | null;
  SEVERITY: string | null;
}

const MOCK_BUG_ROWS: BugRawRow[] = [
  { DEFECT_ID: 1, ASSIGNED_TO: 'CRM Team',     DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13057 - חיוב תחזוקה בפרוקסי כ',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-14', SEVERITY: 'Severe' },
  { DEFECT_ID: 2, ASSIGNED_TO: 'CRM Team',     DEFECT_STATUS: 'At Work',  DEFECT_TYPE: 'Functional',      CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-21', SEVERITY: 'Medium' },
  { DEFECT_ID: 3, ASSIGNED_TO: 'Website HOT',  DEFECT_STATUS: 'Fixed_Dev',DEFECT_TYPE: 'Setup',           CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13052 - HBO ניתוח ם',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-24', SEVERITY: 'Low' },
  { DEFECT_ID: 4, ASSIGNED_TO: 'SHOB Dev Team',DEFECT_STATUS: 'Pending',  DEFECT_TYPE: 'Setup',           CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13054 - שיפור התהליך רץ פי',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-25', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 5, ASSIGNED_TO: 'HOT Design Team', DEFECT_STATUS: 'New',   DEFECT_TYPE: 'Change Requests', CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13084 - (לעמק) ONT תחיקה ב',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-28', SEVERITY: 'Medium' },
  { DEFECT_ID: 6, ASSIGNED_TO: 'HOT Setup Team', DEFECT_STATUS: 'Open',   DEFECT_TYPE: 'Change Requests', CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13118 - כתובת 2 ד תיוב סוב',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-29', SEVERITY: 'Low' },
  { DEFECT_ID: 7, ASSIGNED_TO: 'BEZEQ',        DEFECT_STATUS: 'Canceled', DEFECT_TYPE: 'GUI',             CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13131 - ניתוח קדים ל',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-30', SEVERITY: 'Low' },
  { DEFECT_ID: 8, ASSIGNED_TO: 'ETL Team',     DEFECT_STATUS: 'Canceled', DEFECT_TYPE: 'DB Issue',        CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13048 - שולוגיאתו לק',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-01', SEVERITY: 'Medium' },
  { DEFECT_ID: 9, ASSIGNED_TO: 'Marketing Web',DEFECT_STATUS: 'Fixed_Test', DEFECT_TYPE: 'Design',        CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13075 - CRM General Production',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-02', SEVERITY: 'Low' },
  { DEFECT_ID: 10, ASSIGNED_TO: 'NETC-DT team', DEFECT_STATUS: 'Reopen',  DEFECT_TYPE: 'Environment Issue', CATEGORY_REF: null,        CR_REFERENCE_NUMBER: '13131 - Regression',               TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-05', SEVERITY: 'Severe' },
  { DEFECT_ID: 11, ASSIGNED_TO: 'Project Manager', DEFECT_STATUS: 'Reopen', DEFECT_TYPE: 'Functional',   CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13057 - חיוב תחזוקה בפרוקסי כ',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-06', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 12, ASSIGNED_TO: 'CRM Team',    DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-17', SEVERITY: 'Severe' },
  { DEFECT_ID: 13, ASSIGNED_TO: 'HOT Design Team', DEFECT_STATUS: 'At Work', DEFECT_TYPE: 'Setup',       CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13052 - HBO ניתוח ם',              TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-20', SEVERITY: 'Low' },
  { DEFECT_ID: 14, ASSIGNED_TO: 'HOT Setup Team', DEFECT_STATUS: 'Fixed_Dev', DEFECT_TYPE: 'GUI',        CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13084 - (לעמק) ONT תחיקה ב',        TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-23', SEVERITY: 'Medium' },
  { DEFECT_ID: 15, ASSIGNED_TO: 'CRM Team',    DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'Regression',  CR_REFERENCE_NUMBER: '13131 - Regression',               TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-26', SEVERITY: 'Show Stopper' },
  { DEFECT_ID: 16, ASSIGNED_TO: 'NETC-DT team', DEFECT_STATUS: 'At Work', DEFECT_TYPE: 'Environment Issue', CATEGORY_REF: 'Regression', CR_REFERENCE_NUMBER: '13048 - שולוגיאתו לק',           TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-27', SEVERITY: 'Medium' },
  { DEFECT_ID: 17, ASSIGNED_TO: 'HOT Design Team', DEFECT_STATUS: 'Fixed_Dev', DEFECT_TYPE: 'Change Requests', CATEGORY_REF: 'Regression', CR_REFERENCE_NUMBER: '13140 - שולוגיאתו',       TARGET_REL: null,  DETECTED_ON_DATE: '2026-07-01', SEVERITY: 'Low' },
  { DEFECT_ID: 18, ASSIGNED_TO: 'CRM Team',    DEFECT_STATUS: 'Closed',   DEFECT_TYPE: 'Functional',      CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-14', SEVERITY: 'Severe' },
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
  return oracledb.getConnection({
    user:          cfg.user,
    password:      cfg.password,
    connectString: cfg.connectString,
  });
}

// Bucket definitions confirmed against the team's PBIRS reports (2026-07-06):
//   Open       = status NOT IN (Closed, Canceled) — a DB-status "Rejected" row
//                still counts as open in this org's workflow until Canceled.
//   Rejected   = status = Canceled (the dashboard's "Rejected" label, NOT the
//                DB's literal "Rejected" status, which is a different, still-open state)
//   Reopen     = status = Reopen
//   Changes    = DEFECT_TYPE = 'Change Requests'
//   Production/Regression = CATEGORY_REF (BG_USER_10) = 'Production'/'Regression'
//                AND status NOT IN (New, Canceled)
//   Target     = TARGET_REL is not null; "left" = of those, status != Closed
function computeBugDashboard(rows: BugRawRow[]): BugDashboardDto {
  const isOpen = (status: string | null) => !['Closed', 'Canceled'].includes(status ?? '');
  const notNewOrCanceled = (status: string | null) => !['New', 'Canceled'].includes(status ?? '');

  const open = rows.filter(r => isOpen(r.DEFECT_STATUS));
  const rejected = rows.filter(r => r.DEFECT_STATUS === 'Canceled');
  const reopen = rows.filter(r => r.DEFECT_STATUS === 'Reopen');
  const changes = rows.filter(r => r.DEFECT_TYPE === 'Change Requests');
  const production = rows.filter(r => r.CATEGORY_REF === 'Production' && notNewOrCanceled(r.DEFECT_STATUS));
  const regression = rows.filter(r => r.CATEGORY_REF === 'Regression' && notNewOrCanceled(r.DEFECT_STATUS));
  const targeted = rows.filter(r => r.TARGET_REL !== null && r.TARGET_REL !== undefined && r.TARGET_REL !== '');
  const targetOpen = targeted.filter(r => r.DEFECT_STATUS !== 'Closed');

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

  const dailyCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.DETECTED_ON_DATE) continue;
    const d = new Date(r.DETECTED_ON_DATE);
    if (isNaN(d.getTime())) continue;
    const key = d.toISOString().slice(0, 10);
    dailyCounts.set(key, (dailyCounts.get(key) ?? 0) + 1);
  }
  const dailyReported = Array.from(dailyCounts.entries())
    .map(([date, count]) => ({ date, count }))
    .sort((a, b) => a.date.localeCompare(b.date));

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
    dailyReported,
    openByType:           groupCount(open, r => r.DEFECT_TYPE),
    openByResponsibility: groupCount(open, r => r.ASSIGNED_TO),
    openByCr:             groupCount(open, r => r.CR_REFERENCE_NUMBER),
    reopenByCr:           groupCount(reopen, r => r.CR_REFERENCE_NUMBER),
    criticalByCr:         groupCount(open.filter(r => ['Show Stopper', 'Severe'].includes(r.SEVERITY ?? '')), r => r.CR_REFERENCE_NUMBER),
  };
}

const MOCK_BUG_DASHBOARD: BugDashboardDto = computeBugDashboard(MOCK_BUG_ROWS);

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class QcService {
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

  // Release-only lookup — for queries (bug dashboard, TARGET-CR defects) that
  // filter purely on BG_DETECTED_IN_REL and never touch a test cycle. Using
  // getQcIds() for these incorrectly requires goLiveCycleId/rehearsalCycleId
  // to be resolved even though the SQL never references cycleId — a version
  // whose QcRelease is linked but hasn't had its cycle assigned yet would
  // silently fall back to all-zero/empty results despite having real data.
  private async getRelId(versionId: string): Promise<number | null> {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { qcRelease: true },
    });
    return (version as any)?.qcRelease?.relId ?? null;
  }

  async getStatus(): Promise<{ enabled: boolean }> {
    const { enabled } = await getOracleConfig();
    return { enabled };
  }

  // Real per-CR test coverage for an ad-hoc list of CR numbers — used by the
  // release-intelligence cycle-progress cards (mock/dev mode only; the live
  // path already has its own version/cycle-scoped query in getTestCoverage
  // below, which is the correct production source once Oracle is enabled).
  async getCrCoverage(crNumbers: string[]): Promise<CrCoverageDto[]> {
    const { enabled } = await getOracleConfig();
    if (enabled) return [];
    const real = loadRealCrCoverage();
    if (!real) return [];
    const wanted = new Set(crNumbers);
    return real.filter(c => wanted.has(c.crNumber));
  }

  // Real per-cycle QG coverage targets — mock/dev mode only, same rationale
  // as getCrCoverage above.
  async getCycleQgTargets(): Promise<CycleQgTargetDto[]> {
    const { enabled } = await getOracleConfig();
    if (enabled) return [];
    return loadRealCycleQgTargets() ?? [];
  }

  async getTestCoverage(versionId: string): Promise<TestCoverageDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_COVERAGE;

    const ids = await this.getQcIds(versionId);
    if (!ids) {
      this.logger.warn(`No QC release linked to version ${versionId}`);
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

  async getDefects(versionId: string): Promise<DefectDto[]> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_DEFECTS;

    const ids = await this.getQcIds(versionId);
    if (!ids) return [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(DEFECTS_SQL, { releaseId: ids.relId, cycleId: ids.cycleId });
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
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getDefects: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
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
    return all.filter(d => {
      const normAssigned = normalizeTeamName(d.assignedTo);
      return normAssigned.includes(normTeam) || normTeam.includes(normAssigned);
    });
  }

  private async fetchTargetCrDefectsFromOracle(versionId: string): Promise<TargetDefectDto[]> {
    const relId = await this.getRelId(versionId);
    if (!relId) return [];

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(TARGET_CR_DEFECTS_SQL, { releaseId: relId });
      return (result.rows ?? []).map((r: any): TargetDefectDto => ({
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
      }));
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
        id:         String(r.DEFECT_ID),
        detectedBy: r.DETECTED_BY   ?? '',
        status:     r.DEFECT_STATUS ?? '',
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getMyReportedDefects: ${err.message}`);
      throw err;
    } finally {
      if (conn) await conn.close().catch(() => {});
    }
  }

  async getBugDashboard(versionId: string): Promise<BugDashboardDto> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_BUG_DASHBOARD;

    const relId = await this.getRelId(versionId);
    if (!relId) {
      this.logger.warn(`No QC release linked to version ${versionId}`);
      return computeBugDashboard([]);
    }

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(BUG_DASHBOARD_SQL, { releaseId: relId });
      return computeBugDashboard((result.rows ?? []) as BugRawRow[]);
    } catch (err: any) {
      this.logger.error(`Oracle getBugDashboard: ${err.message}`);
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
      }));
    } catch (err: any) {
      this.logger.error(`Oracle getOpenProductionDefectsHistory: ${err.message}`);
      throw err;
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

  async getCrItems(_releaseId?: string, versionId?: string): Promise<CrItemDto[]> {
    if (versionId) {
      const rows = await prisma.versionCrAssignment.findMany({
        where: { versionId },
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
}
