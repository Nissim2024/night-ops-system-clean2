import { Injectable } from '@nestjs/common';

export interface TestCoverageDto {
  total: number;
  responsible: string;
  planned: number;
  passed: number;
  failed: number;
  notCompleted: number;
  blocked: number;
  notRun: number;
  subject: string;
  title: string;
  release: string;
  cycle: string;
  planId: string;
  labId: string;
}

export interface DefectDto {
  id: string;
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

// Future: implement QcTestCoverageRepository and DefectRepository
// interface QcTestCoverageRepository {
//   getTestCoverage(releaseId: string, cycleId: string): Promise<TestCoverageDto[]>;
// }
// interface DefectRepository {
//   getDefects(releaseId: string, cycleId: string): Promise<DefectDto[]>;
// }

const QC_ENABLED = process.env.QC_ENABLED === 'true';

const MOCK_COVERAGE: TestCoverageDto[] = [
  { total: 1,  responsible: 'maamona', planned: 1,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'HOT WEB',                                           release: '374', cycle: '1276', planId: '74538', labId: '74532' },
  { total: 6,  responsible: 'maamona', planned: 6,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: 'צמצום שיחות',          title: '12969 - דרישות חדשות מערכת תזכורות ב CRM',         release: '374', cycle: '1276', planId: '74543', labId: '74542' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'CRM HOTNET',                                        release: '374', cycle: '1276', planId: '74549', labId: '74548' },
  { total: 2,  responsible: 'roiv',    planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: 'שו"ש - חטיבת שירות', title: '13072 - שינוי בהתנהלות של מסך AI',                 release: '374', cycle: '1276', planId: '74531', labId: '74530' },
  { total: 3,  responsible: 'maamona', planned: 3,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'שפיות בילי',                                        release: '374', cycle: '1276', planId: '74537', labId: '74532' },
  { total: 21, responsible: 'roiv',    planned: 21, passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'Addressability',                                    release: '374', cycle: '1276', planId: '74533', labId: '74532' },
  { total: 1,  responsible: 'maamona', planned: 1,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'Web Site NEXT',                                     release: '374', cycle: '1276', planId: '74539', labId: '74532' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: 'HOT ENERGY',         title: '12821 - שירות חשמל בכתובות ללא תשתית הוט',         release: '374', cycle: '1276', planId: '74525', labId: '74524' },
  { total: 5,  responsible: 'roiv',    planned: 5,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'CRM',                                               release: '374', cycle: '1276', planId: '74534', labId: '74532' },
  { total: 8,  responsible: 'roiv',    planned: 8,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'Wizard HOTNET',                                     release: '374', cycle: '1276', planId: '74550', labId: '74548' },
  { total: 3,  responsible: 'roiv',    planned: 3,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'TOP TECH',                                          release: '374', cycle: '1276', planId: '74535', labId: '74532' },
  { total: 2,  responsible: 'maamona', planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'חשבוניות ודף מקדים',                               release: '374', cycle: '1276', planId: '74551', labId: '74548' },
  { total: 2,  responsible: 'maamona', planned: 2,  passed: 0, failed: 0, notCompleted: 0, blocked: 0, notRun: 0, subject: '',                   title: 'חשבוניות ודף מקדים',                               release: '374', cycle: '1276', planId: '74536', labId: '74532' },
];

const MOCK_DEFECTS: DefectDto[] = [
  {
    id: '7727', system: 'NC', title: 'רשומות כפולות בממשק בנקים',
    description: 'בממשק הבנקים נוצרו רשומות כפולות עבור אותו לקוח. הרשומה עלתה פעם אחת עם קוד מוסד 44860 ופעם נוספת עם קודי מוסד 40610 או 40908. דוגמה: לקוח 60617141, חשבונית משנה 3.',
    reproducible: 'Y', severity: 'Severe', priority: 'High', reporter: 'innad',
    discoveryDate: '22/02/2011', environment: 'NC-Prod', status: 'Closed',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'תקלה נסגרה לאחר טיפול.',
  },
  {
    id: '8247', system: 'NC', title: 'רישום כפול של אירוע אישור הוראת קבע ב-CRM',
    description: 'בעת קליטת אישור הוראת קבע מהבנק נרשמים מספר אירועים ב-CRM במקום אירוע אחד בלבד. בנוסף מתבצע רישום כפול בטבלת Hot_Tab_Bi_Details עבור אותו חשבון.',
    reproducible: 'Y', severity: 'Low', priority: 'Medium', reporter: 'avia',
    discoveryDate: '05/04/2011', environment: 'Crm Prod', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'בבדיקה התברר כי ממשקי EAI היו לא זמינים בזמן הבדיקה ולכן האירוע לא נרשם.',
  },
  {
    id: '7884', system: 'ISPIT', title: 'קובץ רענונים של HotNet נוצר ריק',
    description: 'תהליך יצירת קובץ הרענונים באמצעות create_refresh_file_to_ispp_isp_comp הסתיים בהצלחה אך הקובץ שנוצר היה ריק מתוכן.',
    reproducible: 'Y', severity: 'Show Stopper', priority: 'Low', reporter: 'avia',
    discoveryDate: '08/03/2011', environment: 'NC-Mig', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'מקור התקלה היה בעיית Setup בטבלאות Billing.',
  },
  {
    id: '12697', system: 'SSO', title: 'לא נשלח מייל לאחר הסרה מרשימת דיוור',
    description: 'משתמש שסימן הסרה מרשימת הדיוור בדף עדכון פרטים אישיים לא קיבל מייל אישור כנדרש. הפעולה בוצעה באמצעות סימון Check Box במסך העדכון.',
    reproducible: 'Y', severity: 'Severe', priority: 'High', reporter: 'vladimirs',
    discoveryDate: '22/05/2012', environment: 'MY HOT Test', status: 'Canceled',
    testPhase: 'Sanity Test', defectType: 'Functional', notes: 'בהמשך התברר כי המייל נשלח, אך הייתה טעות בכתובת המייל שהוזנה.',
  },
];

export interface CrItemDto {
  id: string;        // CR number, e.g. "12969"
  description: string; // CR title/description
  label: string;     // "12969 - description" — shown in the combo-box dropdown
}

// ── Mock CR list (replace with real SQL query when available) ──────────────
// TODO: replace with:
//   SELECT <cr_id_column> AS id, <cr_title_column> AS description
//   FROM <qc_cr_table>
//   WHERE <release_filter>
//   ORDER BY id
const MOCK_CR_ITEMS: CrItemDto[] = [
  { id: '12969', description: 'דרישות חדשות מערכת תזכורות ב-CRM',         label: '12969 - דרישות חדשות מערכת תזכורות ב-CRM' },
  { id: '13072', description: 'שינוי בהתנהלות של מסך AI',                  label: '13072 - שינוי בהתנהלות של מסך AI' },
  { id: '12821', description: 'שירות חשמל בכתובות ללא תשתית הוט',          label: '12821 - שירות חשמל בכתובות ללא תשתית הוט' },
  { id: '13145', description: 'שיפור ביצועי מודול ה-Addressability',        label: '13145 - שיפור ביצועי מודול ה-Addressability' },
  { id: '13201', description: 'תיקון רישום כפול בממשק בנקים',              label: '13201 - תיקון רישום כפול בממשק בנקים' },
  { id: '13312', description: 'עדכון חשבוניות ודף מקדים HOTNET',           label: '13312 - עדכון חשבוניות ודף מקדים HOTNET' },
  { id: '13387', description: 'שינויים בתהליך TOP TECH',                   label: '13387 - שינויים בתהליך TOP TECH' },
  { id: '13410', description: 'Wizard HOTNET — תיקוני ממשק',               label: '13410 - Wizard HOTNET — תיקוני ממשק' },
  { id: '13455', description: 'CRM — עדכון מסך AI בחטיבת שירות',          label: '13455 - CRM — עדכון מסך AI בחטיבת שירות' },
  { id: '13502', description: 'Web Site NEXT — עדכוני עיצוב',              label: '13502 - Web Site NEXT — עדכוני עיצוב' },
];

@Injectable()
export class QcService {
  async getTestCoverage(_versionId: string, _cycleId?: string): Promise<TestCoverageDto[]> {
    if (QC_ENABLED) {
      // TODO: call real QC system
    }
    return MOCK_COVERAGE;
  }

  async getDefects(_versionId: string, _cycleId?: string): Promise<DefectDto[]> {
    if (QC_ENABLED) {
      // TODO: call real QC system
    }
    return MOCK_DEFECTS;
  }

  async getCrItems(_releaseId?: string): Promise<CrItemDto[]> {
    if (QC_ENABLED) {
      // TODO: replace MOCK_CR_ITEMS with real DB query, e.g.:
      // const rows = await dataSource.query(
      //   `SELECT cr_id AS id, cr_title AS description FROM qc_cr WHERE release_id = $1 ORDER BY cr_id`,
      //   [_releaseId]
      // );
      // return rows.map(r => ({ ...r, label: `${r.id} - ${r.description}` }));
    }
    return MOCK_CR_ITEMS;
  }
}
