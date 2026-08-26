// Guided (facts-first) investigation — decision-tree data for RcaMethod.GUIDED.
// Product spec from the user 2026-08-09: most investigations fail because
// users jump straight to "root cause" while still in fact-finding. The fix
// is structural, not a form field — stage 2 (facts) is collected and locked
// BEFORE stage 3 (this tree) becomes available, and stage 3 itself only
// offers fixed answer options (no free-text "what's the root cause?" box)
// so the system infers the failure category/root cause from the path taken,
// instead of asking for it directly.
//
// This is a STARTER tree, not an exhaustive RCA knowledge base — it fully
// implements the user's own worked example (version → interface change →
// Endpoint → wrong URL → no deployment control) end-to-end, plus sibling
// coverage for every change type they listed (code/config/endpoint/
// permissions/DB) and every starting point (after release/infra/config/
// unknown), so no path dead-ends. Extend it by adding nodes/leaves here —
// the engine (incidents.service.ts) and UI (RcaWizardModal.tsx) are both
// fully data-driven off this file, no per-branch UI code.
//
// category/rootCauseReason on each leaf are picked from the SAME real
// Root Cause Category taxonomy already used by the manual/AI RCA methods
// (see root-cause-taxonomy.ts) — deliberately one taxonomy for all RCA
// methods, not a parallel one, so "BI over time" (root-cause distribution
// across incidents) stays meaningful regardless of which method produced
// each RCA.

export interface GuidedTreeOption {
  value: string;
  label: string;
  next?: string; // node id — absent means `value` resolves directly to a leaf with the same id as `${nodeId}:${value}`
}

export interface GuidedTreeNode {
  id: string;
  question: string;
  options: GuidedTreeOption[];
}

export interface GuidedTreeLeaf {
  id: string;
  directCause: string;
  rootCause: string;
  category: string;
  rootCauseReason: string;
  correctiveAction: string;
  preventiveAction: string;
}

// Which node stage 3 opens on, based on the stage-2 answer to "מתי התחילה
// התקלה?" — reuses that answer instead of re-asking "התגלתה גרסה חדשה?"
// the way the raw spec's example does.
export const GUIDED_TREE_START: Record<string, string> = {
  AFTER_RELEASE: 'changed_interface',
  AFTER_INFRA_CHANGE: 'infra_type',
  AFTER_CONFIG_CHANGE: 'config_type',
  UNKNOWN: 'unknown_start',
};

export const GUIDED_TREE_NODES: Record<string, GuidedTreeNode> = {
  changed_interface: {
    id: 'changed_interface',
    question: 'האם בוצע שינוי בממשק (API/Endpoint) כחלק מהגרסה?',
    options: [
      { value: 'YES', label: 'כן', next: 'change_type' },
      { value: 'NO', label: 'לא', next: 'changed_code' },
    ],
  },
  changed_code: {
    id: 'changed_code',
    question: 'האם בוצע שינוי בקוד היישום (שאינו ממשק/API) כחלק מהגרסה?',
    options: [
      { value: 'YES', label: 'כן', next: 'code_check' },
      { value: 'NO', label: 'לא', next: 'release_no_change' },
    ],
  },
  release_no_change: {
    id: 'release_no_change',
    question: 'לא זוהה שינוי ספציפי בממשק/בקוד — האם התקלה קשורה לתהליך ההטמעה עצמו (למשל סדר הרצה או תלות בין רכיבים)?',
    options: [
      { value: 'YES', label: 'כן' },
      { value: 'NO', label: 'לא' },
    ],
  },
  change_type: {
    id: 'change_type',
    question: 'איזה סוג שינוי בוצע?',
    options: [
      { value: 'CODE', label: 'קוד', next: 'code_check' },
      { value: 'CONFIG', label: 'קונפיגורציה', next: 'config_check' },
      { value: 'ENDPOINT', label: 'Endpoint', next: 'endpoint_check' },
      { value: 'PERMISSIONS', label: 'הרשאות', next: 'perm_check' },
      { value: 'DB', label: 'DB', next: 'db_check' },
    ],
  },
  endpoint_check: {
    id: 'endpoint_check',
    question: 'מה נמצא בבדיקה?',
    options: [
      { value: 'WRONG_URL', label: 'URL שגוי', next: 'endpoint_wrong_url' },
      { value: 'UNREACHABLE', label: 'URL לא נגיש' },
      { value: 'FIREWALL', label: 'Firewall' },
      { value: 'TIMEOUT', label: 'Timeout' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  endpoint_wrong_url: {
    id: 'endpoint_wrong_url',
    question: 'כיצד ה-URL השגוי הגיע לייצור?',
    options: [
      { value: 'MANUAL_ERROR', label: 'טעות ידנית' },
      { value: 'WRONG_CONFIG_FILE', label: 'קובץ Config שגוי' },
      { value: 'DEPLOYMENT', label: 'Deployment' },
      { value: 'NO_CONTROL', label: 'ללא בקרה' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  config_check: {
    id: 'config_check',
    question: 'מה נמצא בבדיקה?',
    options: [
      { value: 'WRONG_VALUE', label: 'ערך שגוי' },
      { value: 'MISSING_VALUE', label: 'חסר ערך' },
      { value: 'WRONG_PERMISSIONS', label: 'הרשאות שגויות' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  code_check: {
    id: 'code_check',
    question: 'מה נמצא בבדיקה?',
    options: [
      { value: 'LOGIC_BUG', label: 'Bug בלוגיקה' },
      { value: 'UNHANDLED_EXCEPTION', label: 'Exception לא מטופל' },
      { value: 'REGRESSION', label: 'Regression' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  perm_check: {
    id: 'perm_check',
    question: 'מה נמצא בבדיקה?',
    options: [
      { value: 'MISSING_PERMISSION', label: 'הרשאה חסרה' },
      { value: 'EXCESSIVE_PERMISSION', label: 'הרשאה עודפת' },
      { value: 'WRONG_GROUP', label: 'קבוצת הרשאה שגויה' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  db_check: {
    id: 'db_check',
    question: 'מה נמצא בבדיקה?',
    options: [
      { value: 'MIGRATION_FAILED', label: 'Migration נכשל' },
      { value: 'LOCK', label: 'נעילה (Lock)' },
      { value: 'MISSING_DATA', label: 'נתונים חסרים' },
      { value: 'MISSING_INDEX', label: 'אינדקס חסר' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  infra_type: {
    id: 'infra_type',
    question: 'איזה סוג שינוי תשתיתי בוצע?',
    options: [
      { value: 'SERVER', label: 'שרת' },
      { value: 'NETWORK', label: 'רשת' },
      { value: 'DATABASE', label: 'מסד נתונים', next: 'db_check' },
      { value: 'INFRA_PERMISSIONS', label: 'הרשאות תשתית', next: 'perm_check' },
      { value: 'OTHER', label: 'אחר' },
    ],
  },
  config_type: {
    id: 'config_type',
    question: 'היכן בוצע שינוי הקונפיגורציה?',
    options: [
      { value: 'APP_CONFIG_FILE', label: 'קובץ הגדרות אפליקטיבי', next: 'config_check' },
      { value: 'ENV_VARS', label: 'משתני סביבה' },
      { value: 'PERMISSIONS', label: 'הרשאות', next: 'perm_check' },
      { value: 'OTHER', label: 'אחר', next: 'config_check' },
    ],
  },
  unknown_start: {
    id: 'unknown_start',
    question: 'האם ידוע על שינוי כלשהו שבוצע סמוך לתחילת התקלה?',
    options: [
      { value: 'INTERFACE', label: 'כן — בממשק', next: 'change_type' },
      { value: 'CODE', label: 'כן — בקוד', next: 'code_check' },
      { value: 'INFRA', label: 'כן — בתשתית', next: 'infra_type' },
      { value: 'NONE', label: 'לא ידוע כלל' },
    ],
  },
};

// Leaves are keyed `${nodeId}:${optionValue}` — looked up once an option
// without a `next` is chosen (see resolveGuidedStep in incidents.service.ts).
export const GUIDED_TREE_LEAVES: Record<string, GuidedTreeLeaf> = {
  'endpoint_check:UNREACHABLE': {
    id: 'endpoint_check:UNREACHABLE',
    directCause: 'כתובת ה-Endpoint נכונה אך אינה נגישה מסביבת הייצור',
    rootCause: 'חוסר בבדיקת קישוריות (connectivity) בין הסביבות כחלק מתהליך ההטמעה',
    category: 'Environment', rootCauseReason: 'Missing Environment Setup Step',
    correctiveAction: 'פתיחת הנגישות/Route הנדרש לסביבת הייצור',
    preventiveAction: 'הוספת בדיקת קישוריות אוטומטית (health check) כחלק מה-Deployment',
  },
  'endpoint_check:FIREWALL': {
    id: 'endpoint_check:FIREWALL',
    directCause: 'חסימת Firewall מנעה תקשורת לממשק היעד',
    rootCause: 'כללי Firewall לא עודכנו כחלק מתהליך ההטמעה של השינוי',
    category: 'Process', rootCauseReason: 'Missing Approval Step',
    correctiveAction: 'פתיחת הכלל הנדרש ב-Firewall',
    preventiveAction: 'הוספת עדכון כללי Firewall כשלב מחייב ב-Deployment Checklist',
  },
  'endpoint_check:TIMEOUT': {
    id: 'endpoint_check:TIMEOUT',
    directCause: 'הקריאה לממשק חרגה מזמן התגובה המותר (Timeout)',
    rootCause: 'לא בוצע מבחן עומסים/ביצועים לממשק לפני ההטמעה לייצור',
    category: 'QA', rootCauseReason: 'Lack of End-to-End Testing',
    correctiveAction: 'הגדלת ה-Timeout או שיפור זמן התגובה של הממשק',
    preventiveAction: 'הוספת מבחן ביצועים לממשק כחלק מתהליך הבדיקות לפני עלייה לייצור',
  },
  'endpoint_check:OTHER': {
    id: 'endpoint_check:OTHER',
    directCause: 'נמצאה תקלה בממשק שאינה נכנסת לאחת הקטגוריות המוכרות',
    rootCause: 'יש להשלים תיעוד ידני של הסיבה המדויקת',
    category: 'Integration', rootCauseReason: 'Timing/Sequence Issue',
    correctiveAction: 'טיפול נקודתי בהתאם לממצא שהתגלה',
    preventiveAction: 'הרחבת עץ ההחקירה כך שיכסה את המקרה החדש שהתגלה',
  },
  'endpoint_wrong_url:MANUAL_ERROR': {
    id: 'endpoint_wrong_url:MANUAL_ERROR',
    directCause: 'כתובת Endpoint שגויה הוזנה ידנית בתהליך ההטמעה',
    rootCause: 'הסתמכות על הזנה ידנית של פרמטרים קריטיים ללא בקרה כפולה (4-eyes)',
    category: 'Deployment', rootCauseReason: 'Deployment Without Checklist',
    correctiveAction: 'תיקון כתובת ה-Endpoint לערך הנכון',
    preventiveAction: 'מעבר להזרקת קונפיגורציה אוטומטית לפי סביבה, ללא הזנה ידנית',
  },
  'endpoint_wrong_url:WRONG_CONFIG_FILE': {
    id: 'endpoint_wrong_url:WRONG_CONFIG_FILE',
    directCause: 'קובץ הקונפיגורציה שהוטמע הכיל את כתובת ה-Endpoint של סביבת בדיקה',
    rootCause: 'חוסר הפרדה ברורה בין קבצי קונפיגורציה של סביבות שונות',
    category: 'Configuration', rootCauseReason: 'Wrong Environment Configuration',
    correctiveAction: 'עדכון קובץ הקונפיגורציה בסביבת הייצור',
    preventiveAction: 'אימות אוטומטי של קובץ הקונפיגורציה מול הסביבה בזמן ה-Deployment',
  },
  'endpoint_wrong_url:DEPLOYMENT': {
    id: 'endpoint_wrong_url:DEPLOYMENT',
    directCause: 'תהליך ה-Deployment החיל את קונפיגורציית ה-TEST במקום PROD',
    rootCause: 'כלי/תהליך ה-Deployment אינו אוכף באופן חד-משמעי את הפרדת הסביבות',
    category: 'Deployment', rootCauseReason: 'Incorrect Production Configuration',
    correctiveAction: 'הרצה חוזרת של ה-Deployment עם קונפיגורציית הייצור הנכונה',
    preventiveAction: 'הוספת ולידציה אוטומטית בכלי ה-Deployment שמונעת שיוך קונפיגורציה שגויה לסביבה',
  },
  // Exact match to the user's own worked example (spec stages 3-6).
  'endpoint_wrong_url:NO_CONTROL': {
    id: 'endpoint_wrong_url:NO_CONTROL',
    directCause: 'Endpoint בסביבת PROD הפנה לסביבת TEST',
    rootCause: 'חוסר בתהליך בקרת הטמעה ואימות קונפיגורציה לאחר העלאת גרסה',
    category: 'Deployment', rootCauseReason: 'Deployment Without Checklist',
    correctiveAction: 'עדכון כתובת ה-Endpoint',
    preventiveAction: 'הוספת Deployment Checklist ובדיקות Smoke אוטומטיות לאחר הטמעה',
  },
  'endpoint_wrong_url:OTHER': {
    id: 'endpoint_wrong_url:OTHER',
    directCause: 'כתובת Endpoint שגויה זוהתה בסביבת הייצור מסיבה שלא זוהתה באחת הקטגוריות הידועות',
    rootCause: 'יש לתעד את הסיבה הספציפית באופן ידני להשלמת החקירה',
    category: 'Deployment', rootCauseReason: 'Missing Post-Deployment Testing',
    correctiveAction: 'עדכון כתובת ה-Endpoint לערך הנכון',
    preventiveAction: 'הרחבת ה-Checklist הקיים כך שיכסה את המקרה שהתגלה',
  },
  'config_check:WRONG_VALUE': {
    id: 'config_check:WRONG_VALUE',
    directCause: 'פרמטר קונפיגורציה הוגדר בערך שגוי בסביבת הייצור',
    rootCause: 'חוסר בבקרת קונפיגורציה (Config Validation) לאחר הטמעה',
    category: 'Configuration', rootCauseReason: 'Incorrect Parameter Value',
    correctiveAction: 'עדכון הפרמטר לערך הנכון',
    preventiveAction: 'הוספת ולידציה אוטומטית לערכי קונפיגורציה קריטיים לאחר כל עלייה',
  },
  'config_check:MISSING_VALUE': {
    id: 'config_check:MISSING_VALUE',
    directCause: 'פרמטר קונפיגורציה נדרש לא הוגדר כלל בסביבת הייצור',
    rootCause: 'רשימת פרמטרי הקונפיגורציה הנדרשים אינה מתוחזקת/נבדקת באופן שיטתי',
    category: 'Configuration', rootCauseReason: 'Missing Configuration Validation',
    correctiveAction: 'הוספת הפרמטר החסר עם הערך הנכון',
    preventiveAction: 'הוספת בדיקת שלמות קונפיגורציה (config completeness check) לתהליך ההטמעה',
  },
  'config_check:WRONG_PERMISSIONS': {
    id: 'config_check:WRONG_PERMISSIONS',
    directCause: 'הרשאה שגויה הוגדרה כחלק משינוי הקונפיגורציה',
    rootCause: 'שינויי הרשאות אינם עוברים תהליך אישור/בקרה נפרד',
    category: 'Process', rootCauseReason: 'Missing Approval Step',
    correctiveAction: 'תיקון ההרשאה לערך הנכון',
    preventiveAction: 'הוספת שלב אישור ייעודי לכל שינוי הרשאות בקונפיגורציה',
  },
  'config_check:OTHER': {
    id: 'config_check:OTHER',
    directCause: 'נמצא ממצא בקונפיגורציה שאינו נכנס לקטגוריה מוכרת',
    rootCause: 'יש להשלים תיעוד ידני',
    category: 'Configuration', rootCauseReason: 'Missing Configuration Validation',
    correctiveAction: 'טיפול נקודתי בהתאם לממצא',
    preventiveAction: 'הרחבת עץ ההחקירה',
  },
  'code_check:LOGIC_BUG': {
    id: 'code_check:LOGIC_BUG',
    directCause: 'נמצא באג בלוגיקה העסקית שהוטמעה בגרסה',
    rootCause: 'מקרה הקצה שגרם לתקלה לא כוסה בבדיקות היחידה/אינטגרציה',
    category: 'Development', rootCauseReason: 'Missing Edge Cases',
    correctiveAction: 'תיקון הבאג בקוד ופריסה מתוקנת',
    preventiveAction: 'הוספת בדיקת יחידה שמכסה את מקרה הקצה שהתגלה',
  },
  'code_check:UNHANDLED_EXCEPTION': {
    id: 'code_check:UNHANDLED_EXCEPTION',
    directCause: 'התרחש Exception שלא טופל בקוד וגרם לכשל',
    rootCause: 'חוסר בטיפול בשגיאות (error handling) עבור תרחיש זה',
    category: 'Development', rootCauseReason: 'Missing or Unclear Logs',
    correctiveAction: 'הוספת טיפול בחריגה והחזרת תגובה תקינה למשתמש',
    preventiveAction: 'הוספת בדיקות Exception-handling כחלק מסקירת הקוד (Code Review)',
  },
  'code_check:REGRESSION': {
    id: 'code_check:REGRESSION',
    directCause: 'השינוי החדש גרם לרגרסיה בפונקציונליות קיימת',
    rootCause: 'לא בוצעה בדיקת רגרסיה מספקת לפני העלייה לייצור',
    category: 'QA', rootCauseReason: 'Coverage Gap',
    correctiveAction: 'תיקון הרגרסיה שהתגלתה',
    preventiveAction: 'הרחבת מערך בדיקות הרגרסיה האוטומטיות כך שיכסה את התרחיש',
  },
  'code_check:OTHER': {
    id: 'code_check:OTHER',
    directCause: 'נמצאה תקלה בקוד שאינה נכנסת לקטגוריה מוכרת',
    rootCause: 'יש להשלים תיעוד ידני',
    category: 'Development', rootCauseReason: 'Missing Unit Tests',
    correctiveAction: 'טיפול נקודתי בהתאם לממצא',
    preventiveAction: 'הרחבת עץ ההחקירה',
  },
  'perm_check:MISSING_PERMISSION': {
    id: 'perm_check:MISSING_PERMISSION',
    directCause: 'למשתמש/לשירות חסרה הרשאה נדרשת לביצוע הפעולה',
    rootCause: 'רשימת ההרשאות הנדרשות לא עודכנה כחלק מתהליך ההטמעה',
    category: 'Deployment', rootCauseReason: 'Missing Post-Deployment Testing',
    correctiveAction: 'הוספת ההרשאה החסרה',
    preventiveAction: 'הוספת בדיקת הרשאות (Smoke Test) לאחר כל הטמעה',
  },
  'perm_check:EXCESSIVE_PERMISSION': {
    id: 'perm_check:EXCESSIVE_PERMISSION',
    directCause: 'ניתנה הרשאה רחבה מדי שגרמה להתנהגות לא צפויה',
    rootCause: 'חוסר בעקרון ההרשאה המינימלית (Least Privilege) בתהליך ההטמעה',
    category: 'Process', rootCauseReason: 'No Defined Process',
    correctiveAction: 'צמצום ההרשאה לרמה הנדרשת בלבד',
    preventiveAction: 'קביעת תהליך סקירת הרשאות לפני כל הטמעה',
  },
  'perm_check:WRONG_GROUP': {
    id: 'perm_check:WRONG_GROUP',
    directCause: 'המשתמש/השירות שויך לקבוצת הרשאה שגויה',
    rootCause: 'תהליך שיוך ההרשאות לא אומת מול הדרישה המקורית',
    category: 'Requirements', rootCauseReason: 'Uncommunicated Requirement Change',
    correctiveAction: 'שיוך מחדש לקבוצת ההרשאה הנכונה',
    preventiveAction: 'הוספת אימות מול הדרישה המקורית כחלק מתהליך ההרשאות',
  },
  'perm_check:OTHER': {
    id: 'perm_check:OTHER',
    directCause: 'נמצא ממצא הרשאות שאינו נכנס לקטגוריה מוכרת',
    rootCause: 'יש להשלים תיעוד ידני',
    category: 'Process', rootCauseReason: 'No Defined Process',
    correctiveAction: 'טיפול נקודתי בהתאם לממצא',
    preventiveAction: 'הרחבת עץ ההחקירה',
  },
  'db_check:MIGRATION_FAILED': {
    id: 'db_check:MIGRATION_FAILED',
    directCause: 'סקריפט ה-Migration נכשל או רץ באופן חלקי בסביבת הייצור',
    rootCause: 'לא בוצעה הרצת Migration מבוקרת עם Rollback מוגדר',
    category: 'Deployment', rootCauseReason: 'Deployment Without Checklist',
    correctiveAction: 'השלמת/תיקון ה-Migration בסביבת הייצור',
    preventiveAction: 'הוספת תהליך Migration מבוקר עם בדיקת תקינות ו-Rollback אוטומטי',
  },
  'db_check:LOCK': {
    id: 'db_check:LOCK',
    directCause: 'נעילת טבלה/שורה במסד הנתונים חסמה את הפעולה',
    rootCause: 'לא בוצע ניתוח נעילות (locking) לפני ביצוע השינוי בסביבת הייצור',
    category: 'Environment', rootCauseReason: 'Resource Limitation',
    correctiveAction: 'שחרור הנעילה והרצה חוזרת של הפעולה',
    preventiveAction: 'הוספת ניתוח נעילות מקדים כחלק מתכנון שינויי DB',
  },
  'db_check:MISSING_DATA': {
    id: 'db_check:MISSING_DATA',
    directCause: 'נתונים נדרשים חסרים במסד הנתונים בסביבת הייצור',
    rootCause: 'תהליך הסבת/טעינת הנתונים לא כיסה את כל התרחישים הנדרשים',
    category: 'Development', rootCauseReason: 'Missing Edge Cases',
    correctiveAction: 'השלמת הנתונים החסרים',
    preventiveAction: 'הוספת בדיקת שלמות נתונים (data completeness check) לאחר כל הסבה',
  },
  'db_check:MISSING_INDEX': {
    id: 'db_check:MISSING_INDEX',
    directCause: 'אינדקס נדרש חסר גרם לביצועים ירודים/כשל',
    rootCause: 'לא בוצעה בדיקת ביצועים על נפח נתונים ריאלי לפני ההטמעה',
    category: 'QA', rootCauseReason: 'Lack of End-to-End Testing',
    correctiveAction: 'הוספת האינדקס החסר',
    preventiveAction: 'הוספת בדיקת ביצועים על נפח נתונים ריאלי כחלק מהבדיקות לפני עלייה',
  },
  'db_check:OTHER': {
    id: 'db_check:OTHER',
    directCause: 'נמצא ממצא DB שאינו נכנס לקטגוריה מוכרת',
    rootCause: 'יש להשלים תיעוד ידני',
    category: 'Development', rootCauseReason: 'Missing Edge Cases',
    correctiveAction: 'טיפול נקודתי בהתאם לממצא',
    preventiveAction: 'הרחבת עץ ההחקירה',
  },
  'release_no_change:YES': {
    id: 'release_no_change:YES',
    directCause: 'התקלה נגרמה מסדר הרצה/תלות שגויה בין רכיבי ההטמעה',
    rootCause: 'חוסר בתיאום/תזמון בין הצוותים המעורבים בהטמעת הגרסה',
    category: 'Management', rootCauseReason: 'Poor Communication Between Teams',
    correctiveAction: 'תיקון סדר ההרצה/סנכרון הרכיבים הנדרשים',
    preventiveAction: 'תיעוד ואכיפת סדר הטמעה מחייב (Runbook) עבור גרסאות עתידיות',
  },
  'release_no_change:NO': {
    id: 'release_no_change:NO',
    directCause: 'לא זוהה שינוי ספציפי שגרם לתקלה במסגרת עץ ההחקירה הנוכחי',
    rootCause: 'יש להמשיך חקירה ידנית מעבר למסגרת המובנית',
    category: 'Process', rootCauseReason: 'No Defined Process',
    correctiveAction: 'טיפול נקודתי בהתאם לממצאים נוספים שיתגלו',
    preventiveAction: 'הרחבת עץ ההחקירה כך שיכסה תרחיש זה',
  },
  'infra_type:SERVER': {
    id: 'infra_type:SERVER',
    directCause: 'שינוי בתצורת השרת (משאבים/גרסת רכיב) גרם לתקלה',
    rootCause: 'שינויי תשתית לא עברו בדיקת עומסים/תאימות לפני ההטמעה',
    category: 'Environment', rootCauseReason: 'Version Mismatch Between Environments',
    correctiveAction: 'החזרת תצורת השרת לערך התקין או תיקון התאמה',
    preventiveAction: 'הוספת בדיקת תאימות/עומסים לכל שינוי תשתית לפני הטמעה בייצור',
  },
  'infra_type:NETWORK': {
    id: 'infra_type:NETWORK',
    directCause: 'שינוי ברשת (Routing/DNS/Load Balancer) גרם לתקלה בתקשורת',
    rootCause: 'שינויי רשת לא תואמו/נבדקו מול הצוותים המושפעים',
    category: 'Environment', rootCauseReason: 'Environment Drift',
    correctiveAction: 'תיקון הגדרת הרשת לערך התקין',
    preventiveAction: 'הוספת תהליך תיאום ובדיקה מחייב לכל שינוי רשת',
  },
  'infra_type:OTHER': {
    id: 'infra_type:OTHER',
    directCause: 'נמצא ממצא תשתיתי שאינו נכנס לקטגוריה מוכרת',
    rootCause: 'יש להשלים תיעוד ידני',
    category: 'Environment', rootCauseReason: 'Environment Drift',
    correctiveAction: 'טיפול נקודתי בהתאם לממצא',
    preventiveAction: 'הרחבת עץ ההחקירה',
  },
  'config_type:ENV_VARS': {
    id: 'config_type:ENV_VARS',
    directCause: 'משתנה סביבה (Environment Variable) הוגדר בערך שגוי',
    rootCause: 'משתני סביבה קריטיים אינם מנוהלים/נבדקים באופן מרכזי',
    category: 'Configuration', rootCauseReason: 'Wrong Environment Configuration',
    correctiveAction: 'עדכון משתנה הסביבה לערך הנכון',
    preventiveAction: 'ניהול משתני סביבה במקום מרכזי עם בדיקת תקינות אוטומטית',
  },
  'unknown_start:NONE': {
    id: 'unknown_start:NONE',
    directCause: 'לא זוהה שינוי או אירוע מקושר לתחילת התקלה',
    rootCause: 'יש להמשיך חקירה באמצעות ניתוח לוגים/מעקב שלא נכלל בעץ ההחקירה הנוכחי',
    category: 'Process', rootCauseReason: 'No Defined Process',
    correctiveAction: 'המשך חקירה ידנית לאיתור הגורם',
    preventiveAction: 'שיפור יכולות המעקב/Observability לאיתור מהיר יותר של גורמים דומים בעתיד',
  },
};

export interface GuidedTreePathEntry { nodeId: string; question: string; answerValue: string; answerLabel: string }

// Deterministic — the tree path itself IS the 5-Why chain, no AI call
// needed. Matches the spec's "המערכת בונה אוטומטית... לא שואלת 'מה שורש
// התקלה'" — every step becomes "למה קרה X? כי נבחר Y", finishing with the
// leaf's root cause as the final "why".
export function buildAutoFiveWhy(path: GuidedTreePathEntry[], leaf: GuidedTreeLeaf): { step: number; question: string; answer: string }[] {
  const rows = path.map((p, i) => ({
    step: i + 1,
    question: `למה? (${p.question})`,
    answer: `נבחר: ${p.answerLabel}`,
  }));
  rows.push({ step: rows.length + 1, question: 'מה הגורם השורשי הסופי?', answer: leaf.rootCause });
  return rows;
}
