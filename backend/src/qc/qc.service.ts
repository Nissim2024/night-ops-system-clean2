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
    BG_DETECTION_DATE AS DETECTED_ON_DATE
  FROM BUG
  WHERE BG_DETECTED_IN_REL = :releaseId
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
}

const MOCK_BUG_ROWS: BugRawRow[] = [
  { DEFECT_ID: 1, ASSIGNED_TO: 'CRM Team',     DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13057 - חיוב תחזוקה בפרוקסי כ',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-14' },
  { DEFECT_ID: 2, ASSIGNED_TO: 'CRM Team',     DEFECT_STATUS: 'At Work',  DEFECT_TYPE: 'Functional',      CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-21' },
  { DEFECT_ID: 3, ASSIGNED_TO: 'Website HOT',  DEFECT_STATUS: 'Fixed_Dev',DEFECT_TYPE: 'Setup',           CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13052 - HBO ניתוח ם',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-24' },
  { DEFECT_ID: 4, ASSIGNED_TO: 'SHOB Dev Team',DEFECT_STATUS: 'Pending',  DEFECT_TYPE: 'Setup',           CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13054 - שיפור התהליך רץ פי',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-25' },
  { DEFECT_ID: 5, ASSIGNED_TO: 'HOT Design Team', DEFECT_STATUS: 'New',   DEFECT_TYPE: 'Change Requests', CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13084 - (לעמק) ONT תחיקה ב',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-28' },
  { DEFECT_ID: 6, ASSIGNED_TO: 'HOT Setup Team', DEFECT_STATUS: 'Open',   DEFECT_TYPE: 'Change Requests', CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13118 - כתובת 2 ד תיוב סוב',        TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-29' },
  { DEFECT_ID: 7, ASSIGNED_TO: 'BEZEQ',        DEFECT_STATUS: 'Canceled', DEFECT_TYPE: 'GUI',             CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13131 - ניתוח קדים ל',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-30' },
  { DEFECT_ID: 8, ASSIGNED_TO: 'ETL Team',     DEFECT_STATUS: 'Canceled', DEFECT_TYPE: 'DB Issue',        CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13048 - שולוגיאתו לק',              TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-01' },
  { DEFECT_ID: 9, ASSIGNED_TO: 'Marketing Web',DEFECT_STATUS: 'Fixed_Test', DEFECT_TYPE: 'Design',        CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13075 - CRM General Production',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-02' },
  { DEFECT_ID: 10, ASSIGNED_TO: 'NETC-DT team', DEFECT_STATUS: 'Reopen',  DEFECT_TYPE: 'Environment Issue', CATEGORY_REF: null,        CR_REFERENCE_NUMBER: '13131 - Regression',               TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-05' },
  { DEFECT_ID: 11, ASSIGNED_TO: 'Project Manager', DEFECT_STATUS: 'Reopen', DEFECT_TYPE: 'Functional',   CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13057 - חיוב תחזוקה בפרוקסי כ',   TARGET_REL: '374', DETECTED_ON_DATE: '2026-07-06' },
  { DEFECT_ID: 12, ASSIGNED_TO: 'CRM Team',    DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-17' },
  { DEFECT_ID: 13, ASSIGNED_TO: 'HOT Design Team', DEFECT_STATUS: 'At Work', DEFECT_TYPE: 'Setup',       CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13052 - HBO ניתוח ם',              TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-20' },
  { DEFECT_ID: 14, ASSIGNED_TO: 'HOT Setup Team', DEFECT_STATUS: 'Fixed_Dev', DEFECT_TYPE: 'GUI',        CATEGORY_REF: 'Production',  CR_REFERENCE_NUMBER: '13084 - (לעמק) ONT תחיקה ב',        TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-23' },
  { DEFECT_ID: 15, ASSIGNED_TO: 'CRM Team',    DEFECT_STATUS: 'Open',     DEFECT_TYPE: 'Functional',      CATEGORY_REF: 'Regression',  CR_REFERENCE_NUMBER: '13131 - Regression',               TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-26' },
  { DEFECT_ID: 16, ASSIGNED_TO: 'NETC-DT team', DEFECT_STATUS: 'At Work', DEFECT_TYPE: 'Environment Issue', CATEGORY_REF: 'Regression', CR_REFERENCE_NUMBER: '13048 - שולוגיאתו לק',           TARGET_REL: null,  DETECTED_ON_DATE: '2026-06-27' },
  { DEFECT_ID: 17, ASSIGNED_TO: 'HOT Design Team', DEFECT_STATUS: 'Fixed_Dev', DEFECT_TYPE: 'Change Requests', CATEGORY_REF: 'Regression', CR_REFERENCE_NUMBER: '13140 - שולוגיאתו',       TARGET_REL: null,  DETECTED_ON_DATE: '2026-07-01' },
  { DEFECT_ID: 18, ASSIGNED_TO: 'CRM Team',    DEFECT_STATUS: 'Closed',   DEFECT_TYPE: 'Functional',      CATEGORY_REF: null,          CR_REFERENCE_NUMBER: '13036 - נתונת דאשת הספסק ד',       TARGET_REL: '374', DETECTED_ON_DATE: '2026-06-14' },
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
