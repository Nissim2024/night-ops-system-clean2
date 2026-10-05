// Permission catalog — one tree of module → components, mirroring the
// sidebar (user ask 2026-10-05: "סדר במסך ההרשאות", grant a whole module or
// components inside it). Holding `module:<id>` grants every component of that
// module, including components added here later. Component keys keep their
// historical names (screen:*, action:*) where they existed, so stored grants
// and the backend checks that already use them keep working.

export interface CatalogItem { key: string; label: string; kind: 'screen' | 'action' }
export interface CatalogModule { id: string; key: string; label: string; icon: string; items: CatalogItem[] }

const s = (key: string, label: string): CatalogItem => ({ key, label, kind: 'screen' });
const a = (key: string, label: string): CatalogItem => ({ key, label, kind: 'action' });

export const PERMISSION_CATALOG: CatalogModule[] = [
  {
    id: 'version-management', key: 'module:version-management', label: 'ניהול גרסה', icon: '🧭',
    items: [s('vm:overview', 'סקירה כללית'), s('vm:manage', 'ניהול תכולה'), s('vm:changes', 'ניהול שינויים')],
  },
  {
    id: 'qa', key: 'module:qa', label: 'ניהול QA', icon: '👥',
    items: [
      s('qa:assignment', 'תכנון ושיבוץ'), s('qa:testers', 'בודקים'), s('qa:skills', 'מטריצת סקילים'), s('qa:leaves', 'חופשות'),
      a('action:qa_manage', 'ניהול QA (שיבוץ / מועדים / דוחות)'), a('action:qa_leave_request', 'בקשת חופשה / צפייה בסטטוס'),
    ],
  },
  {
    id: 'deployments', key: 'module:deployments', label: 'הטמעות', icon: '🌙',
    items: [
      s('screen:prep', 'הכנה'), s('screen:handoff', 'ביצוע'), s('screen:timeline', 'ציר זמן'),
      s('screen:night', 'לילה (חמ"ל)'), s('screen:summary', 'סיכום'),
      a('action:import', 'ייבוא Excel'), a('action:gonogo', 'GO / NO GO'), a('action:task_status', 'שינוי סטטוס משימה'),
      a('action:open_task_for_execution', 'פתיחת משימה לביצוע (מנהל לילה)'),
      a('action:override_version_edit', 'עריכת גרסה לאחר אישור (override)'),
      a('action:select_all_tasks', 'בחירת כל המשימות'),
      a('action:view_all_teams', 'ראש צוות: צפייה בכל הצוותים'),
    ],
  },
  {
    id: 'release-intelligence', key: 'module:release-intelligence', label: 'ניהול בדיקות', icon: '🧠',
    items: [
      s('ri:home', 'דף הבית'), s('ri:risks', 'ניהול סיכונים'), s('ri:suggested-risks', 'הצעות סיכונים (AI)'),
      s('ri:daily-qa', 'ניהול QA יומי'), s('ri:coverage-readiness', 'כיסוי ומוכנות'), s('ri:bug-dashboard', 'לוח באגים (QC)'),
      s('ri:timeline-activities', 'ציר זמן ופעילויות'), s('ri:incidents', 'תקלות ו-RCA'),
    ],
  },
  {
    id: 'quality-hub', key: 'module:quality-hub', label: 'איכות גרסה', icon: '🏆',
    items: [
      s('qh:overview', 'סקירה כללית'), s('qh:kpi-matrix', 'מטריצת KPI'), s('qh:comparison', 'השוואת גרסאות'),
      s('qh:timeline', 'ציר זמן איכות'), s('qh:kpi-config', 'הגדרות KPI'), s('qh:improvement-tracking', 'משימות שיפור'),
      s('qh:open-prod-defects', 'תקלות ייצור פתוחות'), s('qh:new-vs-target-defects', 'יחס תקלות חדשות בייצור'),
      s('qh:qc-release-history', 'עיון בגרסאות QC'),
    ],
  },
  {
    id: 'defects', key: 'module:defects', label: 'תקלות', icon: '🪲',
    items: [
      s('defects:view', 'צפייה בתקלות'),
      a('action:qc_write', 'כתיבה ל-QC: הערות וסטטוס'),
      a('action:qc_defect_create', 'פתיחת תקלה חדשה ב-QC'),
      a('action:qc_defect_edit_extended', 'עריכת שדות מורחבת בתקלה'),
      a('action:qc_attachment_upload', 'העלאת קובץ מצורף לתקלה'),
    ],
  },
  {
    id: 'admin', key: 'module:admin', label: 'ניהול מערכת', icon: '⚙️',
    items: [a('action:user_manage', 'ניהול משתמשים'), a('action:template_delete', 'מחיקת תבנית גרסה')],
  },
];

export const MODULE_KEYS = PERMISSION_CATALOG.map(m => m.key);
export const ALL_CATALOG_KEYS: string[] = PERMISSION_CATALOG.flatMap(m => [m.key, ...m.items.map(i => i.key)]);
const MODULE_OF = new Map<string, string>(PERMISSION_CATALOG.flatMap(m => m.items.map(i => [i.key, m.key] as [string, string])));

// Pre-catalog keys -> what they actually gave. They opened a module's
// SCREENS only - never its actions (an EMPLOYEE's old screen:defects must not
// turn into "may edit any field in QC").
const screensOf = (id: string) => PERMISSION_CATALOG.find(m => m.id === id)!.items.filter(i => i.kind === 'screen').map(i => i.key);
export const LEGACY_KEYS: Record<string, string[]> = {
  'screen:qa': screensOf('qa'),
  'screen:release-intelligence': screensOf('release-intelligence'),
  'screen:quality-hub': screensOf('quality-hub'),
  'screen:defects': ['defects:view'],
};

export function normalizeGrants(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of keys ?? []) {
    for (const mapped of LEGACY_KEYS[k] ?? [k]) if (ALL_CATALOG_KEYS.includes(mapped)) out.add(mapped);
  }
  return Array.from(out);
}

// Granted keys → everything they imply: a module key brings all its
// components; a component brings its module key's "partial" marker
// (`module:x` stays out, but `partial:module:x` lets the UI show the module).
export function expandGrants(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of normalizeGrants(keys)) {
    out.add(k);
    const mod = PERMISSION_CATALOG.find(m => m.key === k);
    if (mod) mod.items.forEach(i => out.add(i.key));
    const parent = MODULE_OF.get(k);
    if (parent) out.add(`partial:${parent}`);
  }
  for (const m of PERMISSION_CATALOG) if (out.has(m.key)) out.add(`partial:${m.key}`);
  return Array.from(out);
}
