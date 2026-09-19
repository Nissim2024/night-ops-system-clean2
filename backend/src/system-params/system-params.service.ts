import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const DEFAULT_PARAMS = [
  {
    key: 'QC_RELEASES_FILE',
    value: '',
    label: 'נתיב קובץ QC Releases (Linux: /mnt/qc-releases/cr_list.xls — mount SMB/CIFS לפני הפעלה)',
    type: 'text',
  },
  {
    key: 'EXCEL_FILE_PATH',
    value: '',
    label: 'נתיב קובץ הגשת פיתוחים (legacy — השתמש ב-QC_RELEASES_FILE)',
    type: 'text',
  },
  {
    key: 'SUMMARY_OVERRUN_THRESHOLD_MINS',
    value: '30',
    label: 'סף חריגת זמן לדוח סיכום (דקות) — חריגה גדולה מזה מחייבת הסבר',
    type: 'number',
  },
  {
    key: 'WIZARD_AUTO_OPEN',
    value: 'true',
    label: 'פתח אשף הכנת תוכנית אוטומטית ביצירת גרסה מתבנית',
    type: 'boolean',
  },
  {
    key: 'USER_DEPS_CROSS_PHASE',
    value: 'false',
    label: 'אפשר יצירת תלויות per-user בין שלבים שונים (ברירת מחדל: בתוך שלב בלבד)',
    type: 'boolean',
  },
  {
    key: 'QA_EXPORT_PATH',
    value: '',
    label: 'נתיב תיקייה לשמירת קבצי ייצוא תוכנית עבודה QA (ריק = הורדה בלבד)',
    type: 'text',
  },
  {
    key: 'QA_EFFORT_THRESHOLD_DAYS',
    value: '0',
    label: 'סף מאמץ QA (ימים) לכניסת CR לתכולת הגרסה — CR נכנס אם מאמץ ה-QA שלו גדול מהערך הזה',
    type: 'number',
  },
  {
    key: 'ORACLE_ENABLED',
    value: 'false',
    label: 'QC Oracle: מופעל (true/false)',
    type: 'boolean',
  },
  {
    key: 'ORACLE_USER',
    value: '',
    label: 'QC Oracle: שם משתמש',
    type: 'text',
  },
  {
    key: 'ORACLE_PASSWORD',
    value: '',
    label: 'QC Oracle: סיסמה',
    type: 'password',
  },
  {
    key: 'ORACLE_CONNECT_STRING',
    value: '',
    label: 'QC Oracle: Connect String (host:port/service)',
    type: 'text',
  },
  {
    key: 'ANTHROPIC_API_KEY',
    value: '',
    label: 'Anthropic API Key (לניסוח AI מאוחד של תוכניות CR)',
    type: 'password',
  },
  {
    key: 'QA_SECOND_TESTER_THRESHOLD_DAYS',
    value: '12',
    label: 'סף ימי בדיקה (סבב 1) להצעת בודק שני — CR שחוצה סף זה ואין לו בודק שני יוצג כהמלצה',
    type: 'number',
  },
  {
    key: 'DEFAULT_TEST_DURATION_MINUTES',
    value: '15',
    label: 'Release Intelligence: משך ברירת מחדל לבדיקה בודדת (דקות) — לחישוב תחזית',
    type: 'number',
  },
  {
    key: 'FORECAST_ALERT_DAYS',
    value: '5',
    label: 'Release Intelligence: סף ימים לפני עלייה לאוויר להתראת "בסיכון" בתחזית',
    type: 'number',
  },
  {
    key: 'RELEASE_QUALITY_TARGET_SCORE',
    value: '93',
    label: 'Quality Hub: ציון גרסה יעד (0-100) — קובע את סטטוס "מעל/מתחת ליעד" במסך סקירה כללית',
    type: 'number',
  },
  {
    key: 'CR_LIST_SYNC_TIME',
    value: '00:15',
    label: 'שעת סינכרון לילי של קובץ CR_LIST (HH:mm)',
    type: 'text',
  },
  {
    key: 'QUALITY_KPI_SYNC_TIME',
    value: '06:00',
    label: 'Quality Hub: שעת סינכרון יומי של קובץ RELEASES_KPI_SCORES (HH:mm)',
    type: 'text',
  },
  {
    key: 'DAILY_QA_SNAPSHOT_TIME',
    value: '23:00',
    label: 'Daily QA: שעת צילום יומי לנתוני "מה השתנה מאתמול" (HH:mm)',
    type: 'text',
  },
  {
    key: 'DAILY_QA_STANDUP_CUTOFF',
    value: '12:00',
    label: 'Daily QA: שעת חתך לישיבת הבוקר — לפניה יעדי ה-CR מחושבים להיום, אחריה למחר (HH:mm)',
    type: 'text',
  },
  {
    key: 'APP_PUBLIC_URL',
    value: '',
    label: 'כתובת בסיס ציבורית של המערכת לקישורים במיילים (ריק = כתובת הדפדפן הנוכחית)',
    type: 'text',
  },
  {
    key: 'QUALITY_KPI_SCORES_FILE',
    value: '',
    label: 'Quality Hub: נתיב לקובץ RELEASES_KPI_SCORES.xlsx (ריק = אותה תיקייה כמו EXCEL_FILE_PATH)',
    type: 'text',
  },
  // QC REST write-back — separate integration channel from the existing
  // read-only Oracle connection above (direct SQL against QC's schema is
  // unsafe for writes: bypasses QC's own workflow/validation/audit-history
  // layer). Connection-only config — no credentials here: every write-back
  // call authenticates as the ACTING USER's own QC identity (qcLogin + empty
  // password), not a shared account (spec confirmed 2026-09-02). See
  // qc-rest.service.ts.
  {
    key: 'QC_REST_BASE_URL',
    value: '',
    label: 'QC REST API: Base URL (למשל http://host:8080/qcbin)',
    type: 'text',
  },
  {
    key: 'QC_REST_DOMAIN',
    value: '',
    label: 'QC REST API: Domain',
    type: 'text',
  },
  {
    key: 'QC_REST_PROJECT',
    value: '',
    label: 'QC REST API: Project',
    type: 'text',
  },
  // Bug found 2026-09-16: updateStatus() had been writing to REST field
  // "status" (BG_STATUS, ALM's native field) this whole time, but this org's
  // real business workflow — every KPI and report — runs on the custom field
  // BG_USER_04 ("Bug Status"), not BG_STATUS. Deliberately a SystemParam, not
  // a hardcoded constant like REST_FIELD: unlike 'status'/'name'/'dev-comments'
  // (verified against real QC 2026-08-29 through 09-07), this field's REST
  // name has NOT been confirmed against the real instance yet — guessing it
  // risks writing to yet another wrong field. Leave empty until confirmed via
  // the "🔍 הצג את כל שמות השדות" diagnostic (find the field whose value
  // matches the defect's real Bug Status in QC's own UI, copy its REST name
  // here). updateStatus() refuses with a clear error while this is empty,
  // rather than silently falling back to the known-wrong BG_STATUS.
  {
    key: 'QC_REST_BUG_STATUS_FIELD',
    value: '',
    label: 'QC REST: שם שדה ה-REST של BG_USER_04 (Bug Status האמיתי, לא BG_STATUS) — לגלות דרך "הצג את כל שמות השדות" בכלי הכתיבה ל-QC לפני מילוי',
    type: 'text',
  },
  // ── Defects module Tier 2 field mapping (docs/spec-defects-module.md §6,
  // 2026-09-18) — same "don't guess, discover via the lab, refuse while
  // empty" pattern as QC_REST_BUG_STATUS_FIELD above. These 6 fields were
  // confirmed with the user as the initial Tier-2 ("safe", non-workflow-
  // sensitive) allowlist; their real REST field names are NOT confirmed
  // against this instance yet — each stays empty, and the PATCH endpoint
  // that uses them refuses per-field while its mapping is unset, rather
  // than guessing (exactly the REST_FIELD/dev-comments lesson).
  {
    key: 'QC_REST_FIELD_ASSIGNED_TO',
    value: '',
    label: 'QC REST: שם שדה ה-REST של "Assigned To" — לגלות דרך "🔍 הצג את כל שמות השדות" לפני מילוי',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_PRIORITY',
    value: '',
    label: 'QC REST: שם שדה ה-REST של "Priority" — לגלות דרך "🔍 הצג את כל שמות השדות" לפני מילוי',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_SEVERITY',
    value: '',
    label: 'QC REST: שם שדה ה-REST של "Severity" — לגלות דרך "🔍 הצג את כל שמות השדות" לפני מילוי',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_ESTIMATED_FIX_TIME',
    value: '',
    label: 'QC REST: שם שדה ה-REST של "Estimated Fix Time" — לגלות דרך "🔍 הצג את כל שמות השדות" לפני מילוי',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_SUB_MODULE',
    value: '',
    label: 'QC REST: שם שדה ה-REST של "Sub Module" — לגלות דרך "🔍 הצג את כל שמות השדות" לפני מילוי',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_MAIN_MODULE',
    value: '',
    label: 'QC REST: שם שדה ה-REST של "Main Module" — לגלות דרך "🔍 הצג את כל שמות השדות" לפני מילוי',
    type: 'text',
  },
  // Kill-switch for the first real (non-lab) QC REST write path — publishing
  // an approved QA work plan's Release+Cycles to real QC and syncing their
  // dates afterward (docs/spec-qc-full-integration.md §3.5 stage 2). Off by
  // default: every step of that orchestration is unverified against
  // production QC (2026-09-18) — flipping this on is the explicit signal
  // that it's safe to reach the real "צור ב-QC"/"עדכן תאריכים ב-QC" actions,
  // independent of the always-available ADMIN-only rest-test lab.
  {
    key: 'QC_REST_RELEASE_PUBLISH_ENABLED',
    value: 'false',
    label: 'QC REST: אפשר יצירת/עדכון Release+Cycles אמיתיים ב-QC מתהליך אישור תוכנית QA (true/false) — כבוי כברירת מחדל עד אימות בייצור',
    type: 'boolean',
  },
  // Separate kill-switch from the release/cycle one above — REQ creation is
  // a materially less-verified surface (5-level folder tree, ~20-field
  // mapping, none of it tried against real QC), so it gets its own
  // independent on/off so a bad REQ assumption can be switched off without
  // touching release/cycle publishing.
  {
    key: 'QC_REST_REQ_PUBLISH_ENABLED',
    value: 'false',
    label: 'QC REST: אפשר יצירת Requirements (REQ) אמיתיים ב-QC מטאב שיבוץ בודקים (true/false) — כבוי כברירת מחדל עד אימות בייצור',
    type: 'boolean',
  },
  // Separate from the write-back connection above — a real QC Admin
  // credential, held for future QC-side administrative operations (e.g.
  // account provisioning/configuration via QC's own admin API), NOT used
  // anywhere in the defect write-back flow, which deliberately never
  // authenticates as a shared account (spec confirmed 2026-09-02). No
  // consuming code yet — storage only, until a specific admin operation is
  // built against it.
  {
    key: 'QC_ADMIN_USERNAME',
    value: '',
    label: 'QC Admin: שם משתמש (לפעולות ניהול עתידיות מול QC — לא בשימוש כיום בכתיבת תקלות)',
    type: 'text',
  },
  {
    key: 'QC_ADMIN_PASSWORD',
    value: '',
    label: 'QC Admin: סיסמה',
    type: 'password',
  },
];

@Injectable()
export class SystemParamsService {
  async seed() {
    for (const p of DEFAULT_PARAMS) {
      await prisma.systemParam.upsert({
        where: { key: p.key },
        update: {},
        create: p,
      });
    }
  }

  async findAll() {
    return prisma.systemParam.findMany({ orderBy: { key: 'asc' } });
  }

  async getValue(key: string): Promise<string> {
    const p = await prisma.systemParam.findUnique({ where: { key } });
    return p?.value ?? '';
  }

  async update(key: string, value: string, updatedBy: string) {
    const existing = await prisma.systemParam.findUnique({ where: { key } });
    if (!existing) throw new NotFoundException(`פרמטר "${key}" לא נמצא`);
    return prisma.systemParam.update({
      where: { key },
      data: { value, updatedBy },
    });
  }
}
