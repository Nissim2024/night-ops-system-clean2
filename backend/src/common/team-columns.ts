// Single source of truth for CR_LIST Excel column → internal Team name mapping.
// Previously duplicated independently in import.service.ts and
// version-cr-assignments.service.ts — the two copies drifted out of sync
// (JACADA/MAILIT/REMEDY/Telecom Team existed in one but not the other), so a
// CR with real effort logged under one of the missing columns would silently
// never get that team recorded as involved. Keep this the only copy.
export const TEAM_COLUMNS: Record<string, string[]> = {
  'CAWA Team':               ['CAWA'],
  'CRM Dev Team':            ['CRM'],
  'Cyber Security Team':     ['CYBER', 'Cyber PT', 'אבט"מ'],
  'DBA Team':                ['DBA'],
  'EAI Team':                ['EAI'],
  'ERP Team':                ['ERP'],
  'ETL Team':                ['ETL'],
  'IVR Team':                ['IVR'],
  'JACADA Team':             ['JACADA'],
  'MAILIT Team':             ['MAILIT'],
  'NC Team':                 ['NC'],
  'NETCOL Team':             ['NETCOL'],
  'OSS Team':                ['OSS'],
  'PrintBoss Team':          ['PRINTBOS'],
  'Provisioning Team':       ['PROV'],
  'PT Team':                 ['PT'],
  'QA Team':                 ['QA', 'QA BI', 'QA מוצרים'],
  'BI Team':                 ['BI'],
  'REMEDY Team':             ['REMEDY'],
  'Setup Team':              ['SETUP', 'Setup יש'],
  'TV Team':                 ['TV'],
  'Web Dev Team':            ['WEB'],
  'NETC Team':               ['WIZ'],
  'Billing Operations Team': ['תפעול בילינג'],
  'Telecom Team':            ['תקשורת'],
};

// CR_LIST "סטטוס" values that mean the CR isn't actually committed to a
// version's scope (yet, or anymore) — confirmed against the real status
// dropdown, not just the literal "מבוטל" a CR normally cancels through.
// Shared by import.service.ts and version-cr-assignments.service.ts, which
// each parse the same CR_LIST file independently — keep this the only copy
// so the two never silently diverge on which statuses count as excluded.
export const EXCLUDED_CR_STATUSES = new Set([
  'מבוטל',
  'ממתין לשיבוץ גרסה',
  'בחקירה',
  'לישיבת הערכות השקעה',
  'בהערכת השקעה',
  'הקפאה',
]);

// A CR is a "TARGET CR" (catch-all defect-handling CR, gated through
// TargetCrReview instead of a regular task-proposal form) when its label/
// title contains "target" (case-insensitive) — the only signal available,
// since CR_LIST has no dedicated type column for this. Previously duplicated
// independently in qa-workplan.service.ts and target-cr.service.ts; keep
// this the only copy so a version-wide count and a per-CR check never
// silently disagree on which CRs qualify.
export const TARGET_CR_PATTERN = /target/i;
