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

// ── Helper ────────────────────────────────────────────────────────────────────

async function oracleConnect(): Promise<any> {
  const cfg = await getOracleConfig();
  const oracledb = await import('oracledb');
  oracledb.default.outFormat = oracledb.default.OUT_FORMAT_OBJECT;
  return oracledb.default.getConnection({
    user:          cfg.user,
    password:      cfg.password,
    connectString: cfg.connectString,
  });
}

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

  async getCrItems(_releaseId?: string): Promise<CrItemDto[]> {
    return MOCK_CR_ITEMS;
  }
}
