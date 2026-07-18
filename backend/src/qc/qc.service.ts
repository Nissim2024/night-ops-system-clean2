import { Injectable, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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

// KPI 11 — "מצב תקלות ייצור פתוחות לאורך חודשים": one row per (month, defect)
// still open as of that month-end. `area` (BG_USER_10) doubles as the
// "module" breakdown per the user's confirmation — its values aren't only
// Production/Regression, other values are actual module/component names.
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
  area: string | null;     // module/component (BG_USER_10)
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

  async getStatus(): Promise<{ enabled: boolean }> {
    const { enabled } = await getOracleConfig();
    return { enabled };
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

  async getBugDashboard(versionId: string): Promise<BugDashboardDto> {
    const { enabled } = await getOracleConfig();
    if (!enabled) return MOCK_BUG_DASHBOARD;

    const ids = await this.getQcIds(versionId);
    if (!ids) {
      this.logger.warn(`No QC release linked to version ${versionId}`);
      return computeBugDashboard([]);
    }

    let conn: any;
    try {
      conn = await oracleConnect();
      const result = await conn.execute(BUG_DASHBOARD_SQL, { releaseId: ids.relId });
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
