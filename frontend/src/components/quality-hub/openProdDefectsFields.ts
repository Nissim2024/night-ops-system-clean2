// Field pools for the open-production-defects screen's admin-configurable
// table columns and detail-screen fields. Two separate pools because they
// come from two different backend queries with different field breadth —
// see OpenProdDefectsView.tsx and qc.service.ts's DEFECT_BY_ID_SQL.

export interface FieldDef { key: string; label: string; }

// Matches OpenProdDefectMonthDto (backend qc.service.ts) — the ~15 fields
// already returned by the monthly-history query. monthDate/monthLabel are
// the grouping key (the screen's own month selector), not row fields, so
// they're excluded from the choosable pool.
export const TABLE_COLUMN_FIELDS: FieldDef[] = [
  { key: 'defectId',      label: 'Defect ID' },
  { key: 'title',         label: 'Title' },
  { key: 'severity',      label: 'Severity' },
  { key: 'priority',      label: 'Priority' },
  { key: 'responsibility',label: 'Responsibility' },
  { key: 'assignedTo',    label: 'Assigned To' },
  { key: 'qaTester',      label: 'Tester' },
  { key: 'area',          label: 'CR' },
  { key: 'crReferenceNumber', label: 'CR Reference Number' },
  { key: 'bugType',       label: 'Bug Type' },
  { key: 'fixType',       label: 'Fix Type' },
  { key: 'statusAtMonth', label: 'Status (Selected Month)' },
  { key: 'currentStatus', label: 'Current Status' },
  { key: 'testPhase',     label: 'Test Phase' },
  { key: 'detectedBy',    label: 'Detected By' },
  { key: 'detectedDate',  label: 'Detected on Date' },
  { key: 'closedBy',      label: 'Closed By' },
  { key: 'reopenYn',      label: 'Reopen Y/N' },
  { key: 'releaseId',     label: 'Release ID' },
  { key: 'environment',   label: 'Environment' },
  { key: 'subModule',     label: 'Sub Module' },
  { key: 'mainModule',    label: 'Main Module' },
  { key: 'platform',      label: 'Platform' },
  { key: 'estimatedFixTime', label: 'Estimated Fix Time' },
  { key: 'actualFixTime',   label: 'Fix Time' },
  { key: 'deploymentReason', label: 'Deployment Reason' },
  { key: 'detectedApkVersion', label: 'Detected At APK Version' },
  { key: 'detectedHotAppApk', label: 'Detected in HOT APP APK' },
  { key: 'targetHotAppApk', label: 'Target HOT APP APK' },
];

// Matches TargetDefectDto (backend qc.service.ts) — the full real BUG-table
// field set, same shape already used by the TARGET-CR and Incidents/RCA
// screens (mapRowToTargetDefect).
export const DETAIL_FIELDS: FieldDef[] = [
  { key: 'id',                      label: 'Defect ID' },
  { key: 'title',                   label: 'Title' },
  { key: 'subject',                 label: 'Subject' },
  { key: 'summary',                 label: 'Summary' },
  { key: 'description',             label: 'Description' },
  { key: 'notes',                   label: 'Comments' },
  { key: 'status',                  label: 'Bug Status' },
  { key: 'severity',                label: 'Severity' },
  { key: 'priority',                label: 'Priority' },
  { key: 'secondaryPriority',       label: 'Secondary Priority' },
  { key: 'reproducible',            label: 'Reproducible Y/N' },
  { key: 'assignedTo',              label: 'Assigned To' },
  { key: 'qaTester',                label: 'Tester' },
  { key: 'detectedBy',              label: 'Detected By' },
  { key: 'detectedOnDate',          label: 'Detected on Date' },
  { key: 'closedBy',                label: 'Closed By' },
  { key: 'system',                  label: 'Project' },
  { key: 'environment',             label: 'Environment' },
  { key: 'environmentComponent',    label: 'Environment Component' },
  { key: 'responsibility',          label: 'Responsibility' },
  { key: 'defectResponsible',       label: 'Defect Responsible' },
  { key: 'escDefectResponsible',    label: 'Esc Defect Responsible' },
  { key: 'testPhase',               label: 'Test Phase' },
  { key: 'defectType',              label: 'Bug Type' },
  { key: 'fixType',                 label: 'Fix Type' },
  { key: 'estimatedFixTime',        label: 'Estimated Fix Time' },
  { key: 'actualFixTime',           label: 'Fix Time' },
  { key: 'estimateFixTime',         label: 'Estimate Fix Time' },
  { key: 'fixedUntil',              label: 'Fixed Until' },
  { key: 'fixedInProd',             label: 'Fixed in Prod' },
  { key: 'deploymentReason',        label: 'Deployment Reason' },
  { key: 'deploymentCategory',      label: 'Deployment Category' },
  { key: 'deploymentDateProd',      label: 'Deployment Date (Prod)' },
  { key: 'crHbrNumberReference',    label: 'CR/HBR Number reference' },
  { key: 'crReferenceNumber',       label: 'CR Reference Number' },
  { key: 'crStatus',                label: 'CR Status' },
  { key: 'vendorStatus',            label: 'Vendor Status' },
  { key: 'vendorAssignTo',          label: 'Assign To (Vendor)' },
  { key: 'responseDate',            label: 'Response Date' },
  { key: 'supportReferenceNumber',  label: 'Support Reference Number' },
  { key: 'supportStatus',           label: 'Support Status' },
  { key: 'subModule',               label: 'Sub Module' },
  { key: 'mainModule',              label: 'Main Module' },
  { key: 'systemComponent',         label: 'System Component' },
  { key: 'reason',                  label: 'Reason' },
  { key: 'category',                label: 'Category' },
  { key: 'itemType',                label: 'Item Type' },
  { key: 'platform',                label: 'Platform' },
  { key: 'modified',                label: 'Modified' },
  { key: 'detectedInRelease',       label: 'Detected in Release' },
  { key: 'detectedInCycle',         label: 'Detected in Cycle' },
  { key: 'targetRelease',           label: 'Target Release' },
  { key: 'targetCycle',             label: 'Target Cycle' },
  { key: 'targetType',              label: 'Target Type' },
  { key: 'targetReleaseReason',     label: 'Target Release Reason' },
  { key: 'targetScopeApproved',     label: 'Target Scope Approved' },
  { key: 'dropNumber',              label: 'Drop#' },
  { key: 'detectedApkVersion',      label: 'Detected At APK Version' },
  { key: 'detectedHotAppApk',       label: 'Detected in HOT APP APK' },
  { key: 'targetHotAppApk',         label: 'Target HOT APP APK' },
  { key: 'reopenYn',                label: 'Reopen Y/N' },
  { key: 'influence',               label: 'Influence' },
  { key: 'impact',                  label: 'Impact' },
  { key: 'releaseDefect',           label: 'Release Defect' },
  { key: 'businessProcess',         label: 'Business Process' },
  { key: 'mainBusinessProcess',     label: 'Main Business Process' },
  { key: 'foundByAutomation',       label: 'Found By Automation' },
  { key: 'forRegressionTest',       label: 'For Regression Test' },
  { key: 'productionReason',        label: 'Production Reason' },
  { key: 'willBeTestAtGoLive',      label: 'Will Be Test At Go Live' },
  { key: 'toBeTestedOnProd',        label: 'To Be Tested On Prod' },
];

export const TABLE_FIELD_LABEL: Record<string, string> = Object.fromEntries(TABLE_COLUMN_FIELDS.map(f => [f.key, f.label]));
export const DETAIL_FIELD_LABEL: Record<string, string> = Object.fromEntries(DETAIL_FIELDS.map(f => [f.key, f.label]));

// Built-in panels of the defect view/update form - used when no admin layout
// is set, and as the starting point in AdminPanel's "תבנית טופס תקלה" editor.
// title/description/notes are rendered outside the panels.
// `wide` = fields that take a full row of their panel (long values).
export const DEFAULT_OPEN_PROD_DETAIL_GROUPS: { title: string; fields: string[]; wide?: string[] }[] = [
  { title: 'זיהוי', fields: ['id', 'status', 'severity', 'priority', 'secondaryPriority', 'defectType', 'category', 'itemType'] },
  { title: 'גילוי', fields: ['detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle', 'testPhase', 'detectedApkVersion', 'detectedHotAppApk', 'reproducible', 'environment', 'environmentComponent', 'system', 'platform', 'subModule', 'mainModule', 'systemComponent'] },
  { title: 'אחריות', fields: ['assignedTo', 'qaTester', 'responsibility', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo', 'vendorStatus'] },
  { title: 'טיפול ותיקון', fields: ['fixType', 'estimatedFixTime', 'actualFixTime', 'estimateFixTime', 'fixedUntil', 'fixedInProd', 'closedBy', 'reopenYn', 'supportStatus', 'supportReferenceNumber', 'responseDate'] },
  { title: 'יעד וגרסה', fields: ['targetRelease', 'targetCycle', 'targetHotAppApk', 'targetType', 'targetReleaseReason', 'targetScopeApproved', 'crStatus', 'crReferenceNumber', 'crHbrNumberReference', 'dropNumber', 'releaseDefect'], wide: ['crHbrNumberReference'] },
  { title: 'השפעה עסקית', fields: ['impact', 'influence', 'businessProcess', 'mainBusinessProcess', 'deploymentCategory', 'deploymentReason', 'productionReason', 'toBeTestedOnProd', 'deploymentDateProd', 'willBeTestAtGoLive', 'forRegressionTest', 'foundByAutomation', 'modified'] },
];
export const DEFECT_FORM_FIXED_FIELDS = new Set(['title', 'description', 'notes']);

// Attachments as a placeable form item (user ask 2026-10-06): the layout
// editor can put it in any panel; a layout that doesn't mention it shows it
// at the end of the FIRST panel. Not a real QC field — never sent to QC.
export const ATTACHMENTS_FIELD = '__attachments';
export const ATTACHMENTS_FIELD_DEF = { key: ATTACHMENTS_FIELD, label: '📎 קבצים מצורפים' };

// Shown in the built-in panels even when an older saved detail-field list
// (OpenProdDefectsConfigPanel) predates them.
export const BUILTIN_ALWAYS_SHOWN_FIELDS = ['detectedApkVersion', 'detectedHotAppApk', 'targetHotAppApk',
  // release/cycle pairs + team component (2026-10-08) - a pair is never shown half
  'detectedInRelease', 'detectedInCycle', 'targetRelease', 'targetCycle', 'environmentComponent',
  // QC-required, release-scoped pickers (2026-10-09)
  'crHbrNumberReference', 'system',
  // filled by the cycle (2026-10-09)
  'testPhase'];

// ── New-defect form (2026-10-09) ─────────────────────────────────────────
// The create form uses the same layout as the update form, field for field
// (user 2026-10-09: no 🆕 subset, nothing locked but what QC itself fills).
// Fields QC marks Required (production field dump) carry "*" in both forms.
export const CREATE_REQUIRED_FIELDS = new Set([
  'severity', 'priority', 'detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle',
  'environment', 'responsibility', 'system', 'crHbrNumberReference',
]);
// ── Test Phase follows the cycle (user, 2026-10-09) ─────────────────────
// production defect → Production; Cycle 0 → Integration Test; Cycle 1-4,
// UAT, Stand Alone Items → System Test; Dress Rehearsal (any spelling QC
// has) / Go Live → Sanity Test; a cycle named Production → Production;
// anything else (Automation, SHOTEF…) → no rule, the user chooses.
export function testPhaseFor(cycle: string, environment: string): string | null {
  if (/prod/i.test(environment ?? '')) return 'Production';
  const c = (cycle ?? '').trim();
  if (!c) return null;
  if (/^cycle\s*0$/i.test(c)) return 'Integration Test';
  if (/^cycle\s*[1-4]$/i.test(c) || /^uat$/i.test(c) || /^stand\s*alone/i.test(c)) return 'System Test';
  if (/^dress\s*re/i.test(c) || /^go\s*live$/i.test(c)) return 'Sanity Test';
  if (/^production$/i.test(c)) return 'Production';
  return null;
}

// No admin layout anywhere → the built-in panels, trimmed to the admin's
// field list (open-prod-defects-config) — the same in both forms.
export function builtinPanels(detailFields: string[]): { name: string; fields: string[]; wide?: string[] }[] {
  const allowed = new Set([...(detailFields.length ? detailFields : DETAIL_FIELDS.map(f => f.key)), ...BUILTIN_ALWAYS_SHOWN_FIELDS]);
  return DEFAULT_OPEN_PROD_DETAIL_GROUPS
    .map(g => ({ name: g.title, fields: g.fields.filter(k => allowed.has(k)), wide: g.wide }))
    .filter(g => g.fields.length > 0);
}

// A saved layout may predate a QC-required field (Project, 2026-10-09): both
// forms then show it in the panel that holds most of its built-in neighbours,
// right after the nearest one — so the create and update forms stay alike.
export function withRequiredFields<P extends { fields: string[] }>(panels: P[]): P[] {
  if (panels.length === 0) return panels;
  const out = panels.map(p => ({ ...p, fields: [...p.fields] }));
  const present = new Set(out.flatMap(p => p.fields));
  for (const f of [...Array.from(CREATE_REQUIRED_FIELDS), 'testPhase']) {
    if (present.has(f)) continue;
    const home = DEFAULT_OPEN_PROD_DETAIL_GROUPS.find(g => g.fields.includes(f));
    let target = out[0];
    if (home) {
      let best = 0;
      for (const p of out) {
        const n = p.fields.filter(x => home.fields.includes(x)).length;
        if (n > best) { best = n; target = p; }
      }
      const before = home.fields.slice(0, home.fields.indexOf(f)).reverse().find(x => target.fields.includes(x));
      if (before) { target.fields.splice(target.fields.indexOf(before) + 1, 0, f); present.add(f); continue; }
    }
    target.fields.push(f);
    present.add(f);
  }
  return out;
}

// ── Form shape (user, 2026-10-09) ─────────────────────────────────────────
// Up to three panels side by side, and under them one full-width panel
// ("שדות נוספים") — `below: true`. A layout saved before that (no panel
// marked below) keeps its first three panels on top and gets the rest
// merged into one "שדות נוספים" panel, so existing templates take the new
// shape without anyone re-saving them.
export const TOP_PANEL_COUNT = 3;
export const MORE_FIELDS_PANEL = 'שדות נוספים';
export type LayoutPanel = { name: string; fields: string[]; wide?: string[]; below?: boolean };
export function normalizeLayout<P extends LayoutPanel>(panels: P[]): LayoutPanel[] {
  if (panels.some(p => p.below)) return panels.map(p => ({ ...p, fields: [...p.fields], wide: [...(p.wide ?? [])] }));
  const top = panels.slice(0, TOP_PANEL_COUNT).map(p => ({ ...p, fields: [...p.fields], wide: [...(p.wide ?? [])] }));
  const rest = panels.slice(TOP_PANEL_COUNT);
  if (rest.length === 0) return top;
  return [...top, {
    name: MORE_FIELDS_PANEL,
    fields: rest.flatMap(p => p.fields),
    wide: rest.flatMap(p => p.wide ?? []),
    below: true,
  }];
}
