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
    // Confirmed 2026-09-20 — user-explicit: "due to a historical mistake we
    // used the wrong [native] status field; continue with the field that's
    // actually been maintained for years" (BG_USER_04). Same "user-NN" REST
    // naming convention already confirmed for Sub/Main Module the same day.
    key: 'QC_REST_BUG_STATUS_FIELD',
    value: 'user-04',
    label: 'QC REST: שם שדה ה-REST של BG_USER_04 (Bug Status האמיתי, לא BG_STATUS) — מאומת 2026-09-20 (user-04)',
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
    // Confirmed 2026-09-20 from a real "list-all-fields" REST dump on live
    // defect #47000 — "owner" is the only one of the 6 NOT a verbatim or
    // already-known-mapping match (the others are exact string matches or
    // rely on our already-trusted BG_USER_14/16 mapping); it's a plausible
    // real ALM/QC convention (Assigned To ↔ owner) but this specific dump
    // only shows one defect where owner and detected-by happen to be the
    // same person, so it doesn't disambiguate on its own. Kept non-empty
    // because it's the best evidence we have, but flag it for a quick
    // double-check against a defect where Assigned To and Detected By
    // visibly differ before trusting a real write through it.
    key: 'QC_REST_FIELD_ASSIGNED_TO',
    value: 'owner',
    label: 'QC REST: שם שדה ה-REST של "Assigned To" — "owner" מאומת חלקית (2026-09-20), לוודא מול תקלה שבה Assigned To שונה מ-Detected By',
    type: 'text',
  },
  {
    // Confirmed 2026-09-20 — verbatim field name in a real REST field dump.
    key: 'QC_REST_FIELD_PRIORITY',
    value: 'priority',
    label: 'QC REST: שם שדה ה-REST של "Priority" — מאומת 2026-09-20 מדאמפ שדות אמיתי',
    type: 'text',
  },
  {
    // Confirmed 2026-09-20 — verbatim field name in a real REST field dump.
    key: 'QC_REST_FIELD_SEVERITY',
    value: 'severity',
    label: 'QC REST: שם שדה ה-REST של "Severity" — מאומת 2026-09-20 מדאמפ שדות אמיתי',
    type: 'text',
  },
  {
    // Confirmed 2026-09-20 — verbatim field name in a real REST field dump.
    key: 'QC_REST_FIELD_ESTIMATED_FIX_TIME',
    value: 'estimated-fix-time',
    label: 'QC REST: שם שדה ה-REST של "Estimated Fix Time" — מאומת 2026-09-20 מדאמפ שדות אמיתי',
    type: 'text',
  },
  {
    // Confirmed 2026-09-20 — the real dump exposes generic fields as
    // "user-NN"; BG_USER_14 = Sub Module was already a trusted mapping used
    // throughout this codebase (mapRowToTargetDefect etc.), so "user-14" is
    // that same column's real REST name.
    key: 'QC_REST_FIELD_SUB_MODULE',
    value: 'user-14',
    label: 'QC REST: שם שדה ה-REST של "Sub Module" — מאומת 2026-09-20 (user-14 = BG_USER_14)',
    type: 'text',
  },
  {
    // Same reasoning as Sub Module — BG_USER_16 = Main Module already trusted.
    key: 'QC_REST_FIELD_MAIN_MODULE',
    value: 'user-16',
    label: 'QC REST: שם שדה ה-REST של "Main Module" — מאומת 2026-09-20 (user-16 = BG_USER_16)',
    type: 'text',
  },
  // Reference-type creation fields (2026-09-20) — Target Release / Detected
  // Cycle for the create-defect form's "default to the version/cycle we're
  // on now" behavior. UNCONFIRMED for the defect/BUG entity: `target-rel` is
  // confirmed for Requirement entities (buildRequirementPayload), but classic
  // QC's REST field names aren't guaranteed uniform across entity types —
  // left empty rather than assumed, per the same discipline as every other
  // QC_REST_FIELD_* param. A likely value to try once real QC access exists:
  // "target-rel".
  {
    // Confirmed 2026-09-23 from a real entity-fields dump (BG_TARGET_REL) —
    // also confirmed identical ("target-rel"/RQ_TARGET_REL) on the
    // Requirement entity in the same dump.
    key: 'QC_REST_FIELD_TARGET_RELEASE',
    value: 'target-rel',
    label: 'QC REST: שם שדה ה-REST (סוג הפניה) של "Target Release" בתקלה — מאומת 2026-09-23 (target-rel = BG_TARGET_REL)',
    type: 'text',
  },
  {
    // Confirmed 2026-09-23 from a real entity-fields dump (BG_DETECTED_IN_RCYC).
    key: 'QC_REST_FIELD_DETECTED_CYCLE',
    value: 'detected-in-rcyc',
    label: 'QC REST: שם שדה ה-REST (סוג הפניה) של "Detected in Cycle" בתקלה — מאומת 2026-09-23 (detected-in-rcyc = BG_DETECTED_IN_RCYC)',
    type: 'text',
  },
  // "Detected in Release" (BG_DETECTED_IN_REL) — a NEW defect's own release,
  // distinct from QC_REST_FIELD_TARGET_RELEASE above (BG_TARGET_REL, for
  // deferring an EXISTING defect forward). Same reference-type field shape.
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "detected-in-rel" guess exactly.
    key: 'QC_REST_FIELD_DETECTED_RELEASE',
    value: 'detected-in-rel',
    label: 'QC REST: שם שדה ה-REST (סוג הפניה) של "Detected in Release" בתקלה — מאומת 2026-09-23 (detected-in-rel = BG_DETECTED_IN_REL)',
    type: 'text',
  },
  // Plain (non-reference) creation fields for the redesigned create-defect
  // form (2026-09-22, project-defect-create-form-redesign-2026-09-22
  // memory) — all unconfirmed, same "user-NN" pattern already confirmed for
  // Sub Module/Main Module is a reasonable guess for these too, but none has
  // been seen in a real REST dump yet.
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "user-03" guess exactly.
    key: 'QC_REST_FIELD_RESPONSIBILITY',
    value: 'user-03',
    label: 'QC REST: שם שדה ה-REST של "Responsibility" בתקלה — מאומת 2026-09-23 (user-03 = BG_USER_03)',
    type: 'text',
  },
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "user-06" guess exactly.
    key: 'QC_REST_FIELD_BUG_TYPE',
    value: 'user-06',
    label: 'QC REST: שם שדה ה-REST של "Bug Type" בתקלה — מאומת 2026-09-23 (user-06 = BG_USER_06)',
    type: 'text',
  },
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "user-05" guess exactly.
    key: 'QC_REST_FIELD_TEST_PHASE',
    value: 'user-05',
    label: 'QC REST: שם שדה ה-REST של "Test Phase" בתקלה — מאומת 2026-09-23 (user-05 = BG_USER_05)',
    type: 'text',
  },
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "user-02" guess exactly.
    key: 'QC_REST_FIELD_ENVIRONMENT',
    value: 'user-02',
    label: 'QC REST: שם שדה ה-REST של "Environment" בתקלה — מאומת 2026-09-23 (user-02 = BG_USER_02)',
    type: 'text',
  },
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "user-49" guess exactly (QC's own label has a typo: "Componnent").
    key: 'QC_REST_FIELD_ENVIRONMENT_COMPONENT',
    value: 'user-49',
    label: 'QC REST: שם שדה ה-REST של "Environment Component" בתקלה — מאומת 2026-09-23 (user-49 = BG_USER_49)',
    type: 'text',
  },
  {
    // Confirmed 2026-09-23 from a real entity-fields dump — matches the
    // "user-10" guess exactly. NOTE: a separate, different field "CR
    // Reference Number" also exists at user-58 (BG_USER_58) — do not confuse
    // the two; this app's create-defect form intentionally uses "CR/HBR
    // Number reference" (user-10), matching its exact real label.
    key: 'QC_REST_FIELD_CR_HBR_REFERENCE',
    value: 'user-10',
    label: 'QC REST: שם שדה ה-REST של "CR / HBR Number reference" בתקלה — מאומת 2026-09-23 (user-10 = BG_USER_10, שונה מ-user-58 "CR Reference Number")',
    type: 'text',
  },
  // 4 more Tier2-editable fields (2026-09-23, fixes-batch A.5 — user
  // explicitly asked these to become editable in the detail screen, having
  // first suggested locking them as "historical facts"). All 4 real REST
  // names were already confirmed in the same 2026-09-23 field dump used
  // above, just not yet wired into the editable allowlist.
  {
    key: 'QC_REST_FIELD_CLOSED_BY',
    value: 'user-07',
    label: 'QC REST: שם שדה ה-REST של "Closed By" בתקלה — מאומת 2026-09-23 (user-07 = BG_USER_07)',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_CLOSING_DATE',
    value: 'closing-date',
    label: 'QC REST: שם שדה ה-REST של "Closing Date" בתקלה — מאומת 2026-09-23 (closing-date = BG_CLOSING_DATE)',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_DETECTED_BY',
    value: 'detected-by',
    label: 'QC REST: שם שדה ה-REST של "Detected By" בתקלה — מאומת 2026-09-23 (detected-by = BG_DETECTED_BY)',
    type: 'text',
  },
  {
    key: 'QC_REST_FIELD_DETECTED_ON_DATE',
    value: 'creation-time',
    label: 'QC REST: שם שדה ה-REST של "Detected on Date" בתקלה — מאומת 2026-09-23 (creation-time = BG_DETECTION_DATE)',
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
  // Test Plan / Test Lab kill-switches (2026-09-23, admin-screen QC
  // infrastructure prep — user request: "prepare in the admin screen
  // everything needed to use QC across all its modules"). No feature screens
  // exist yet for either module — these flags exist so a future writer knows
  // where to check before reaching real QC, same discipline as Release/REQ
  // above. The generic collectionUrlFor/probeEntityFields/buildFieldsPayload
  // primitives in qc-rest.service.ts already work against ANY entity-type
  // segment (tests/test-folders/design-steps for Test Plan; test-sets/
  // test-set-folders/test-instances/runs for Test Lab) with zero new code —
  // confirmed via the "בדיקת כתיבה ל-QC" tab's free-text entity-fields
  // prober — so what's missing today is real field-name discovery + an
  // actual write flow, not REST plumbing.
  {
    key: 'QC_REST_TESTPLAN_PUBLISH_ENABLED',
    value: 'false',
    label: 'QC REST: אפשר כתיבה אמיתית ל-Test Plan (תסריטי בדיקה/צעדים) ב-QC (true/false) — אין עדיין מסך תכונה; כבוי כברירת מחדל',
    type: 'boolean',
  },
  {
    key: 'QC_REST_TESTLAB_PUBLISH_ENABLED',
    value: 'false',
    label: 'QC REST: אפשר כתיבה אמיתית ל-Test Lab (Test Sets/Instances/Runs) ב-QC (true/false) — אין עדיין מסך תכונה; כבוי כברירת מחדל',
    type: 'boolean',
  },
  // Site Administration is architecturally separate from every other QC_REST_*
  // flow here: it's not domain/project-scoped (rest/site-admin/... vs
  // rest/domains/.../projects/...) and per-user qcLogin empty-password auth
  // doesn't apply — it needs a real site-admin-privileged account, which is
  // exactly what QC_ADMIN_USERNAME/PASSWORD below were already reserved for.
  // Off by default — no consuming write flow exists yet, only the read-only
  // probe in the "בדיקת כתיבה ל-QC" tab.
  {
    key: 'QC_SITE_ADMIN_ENABLED',
    value: 'false',
    label: 'QC REST: אפשר גישה ל-Site Administration API (דומיינים/פרויקטים/משתמשים ברמת האתר) — דורש QC Admin Username/Password למטה',
    type: 'boolean',
  },
  // Separate from the write-back connection above — a real QC Admin
  // credential, held for future QC-side administrative operations (e.g.
  // account provisioning/configuration via QC's own admin API), NOT used
  // anywhere in the defect write-back flow, which deliberately never
  // authenticates as a shared account (spec confirmed 2026-09-02). Now also
  // used by the read-only Site Administration probe above once
  // QC_SITE_ADMIN_ENABLED is turned on (2026-09-23).
  {
    key: 'QC_ADMIN_USERNAME',
    value: '',
    label: 'QC Admin: שם משתמש (ל-Site Administration ולפעולות ניהול עתידיות מול QC — לא בשימוש בכתיבת תקלות)',
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
