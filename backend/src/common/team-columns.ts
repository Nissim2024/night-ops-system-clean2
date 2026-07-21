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
