import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, JIRA } from '../theme';
import { VersionStatusChip, BackLink } from './ui';
import {
  hasHebrew, NameBadge, PersonAvatar, renderNotesField, DetailGroupsDialog, DetailGroup,
  FieldChangeHistorySection, AttachmentsSection, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow,
  IssueKeyLink, StatusBadge, SeverityBadge, PriorityCell, SelectColumnsDialog,
} from './shared/defectFieldDisplay';
import { formatDateTime } from '../utils/dateFormat';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface Props {
  version: any;
  token: string;
  onJumpToStep: (view: string) => void;
  // Lets the module shell (VersionManagementModuleView) hide its own version
  // picker row while the TARGET-defect list/detail screens are open — those
  // already show their own contextual header, so the picker is redundant
  // clutter once drilled in that far (feedback confirmed 2026-08-30).
  onDrilledInChange?: (drilledIn: boolean) => void;
}

interface ScopeCr {
  crNumber: string; crLabel: string | null; needsAttention: boolean;
  actualEffortDays: number | null;
  teams: { teamId: string; teamName: string }[];
}
interface ScopeOverview {
  crCount: number; coreCrCount: number; saCrCount: number; targetCrCount: number;
  plannedDays: number; actualDays: number; ratioPct: number | null;
  crs: ScopeCr[];
}
// Mirrors backend TargetDefectDto (qc.service.ts) 1:1 — every BUG column
// TARGET_CR_DEFECTS_SQL pulls has a field here so the column-picker below can
// offer all of them, not just the small "always useful" subset the list used
// to hard-code.
interface TargetDefect {
  id: string; title: string; status: string; severity: string;
  system: string; crReferenceNumber: string; assignedTo: string;
  subject: string; summary: string; description: string; notes: string; reproducible: string;
  priority: string; detectedBy: string; detectedOnDate: string; estimatedFixTime: string;
  actualFixTime: string; environment: string; responsibility: string; testPhase: string;
  defectType: string; closedBy: string; deploymentReason: string; fixedUntil: string;
  crHbrNumberReference: string; vendorStatus: string; responseDate: string;
  supportReferenceNumber: string; subModule: string; fixedInProd: string; mainModule: string;
  reason: string; supportStatus: string; vendorAssignTo: string; category: string;
  itemType: string; estimateFixTime: string; platform: string; modified: string;
  detectedInRelease: string; detectedInCycle: string; targetRelease: string; targetCycle: string;
  crStatus: string; dropNumber: string; reopenYn: string; influence: string; fixType: string;
  qaTester: string; secondaryPriority: string; releaseDefect: string; businessProcess: string;
  foundByAutomation: string; mainBusinessProcess: string; impact: string; productionReason: string;
  environmentComponent: string; willBeTestAtGoLive: string; deploymentCategory: string;
  defectResponsible: string; targetReleaseReason: string; targetType: string;
  systemComponent: string; forRegressionTest: string; escDefectResponsible: string;
  toBeTestedOnProd: string; deploymentDateProd: string; targetScopeApproved: string;
}

// Column catalog for the "Select Columns" picker — label style intentionally
// mirrors the reference ALM/QC "Select Columns" dialog the user provided
// (English labels), since this data originates from that BUG-table export.
const TARGET_DEFECT_COLUMNS: { key: keyof TargetDefect; label: string }[] = [
  { key: 'id', label: 'Defect ID' },
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'qaTester', label: 'QA' },
  { key: 'crReferenceNumber', label: 'CR Reference Number' },
  { key: 'system', label: 'Project' },
  { key: 'subject', label: 'Subject' },
  { key: 'summary', label: 'Summary' },
  { key: 'description', label: 'Description' },
  { key: 'notes', label: 'Comments' },
  { key: 'reproducible', label: 'Reproducible Y/N' },
  { key: 'status', label: 'Bug Status' },
  { key: 'severity', label: 'Severity' },
  { key: 'priority', label: 'Priority' },
  { key: 'detectedBy', label: 'Detected By' },
  { key: 'detectedOnDate', label: 'Detected on Date' },
  { key: 'estimatedFixTime', label: 'Estimated Fix Time' },
  { key: 'actualFixTime', label: 'Fix Time' },
  { key: 'environment', label: 'Environment' },
  { key: 'responsibility', label: 'Responsibility' },
  { key: 'testPhase', label: 'Test Phase' },
  { key: 'defectType', label: 'Bug Type' },
  { key: 'closedBy', label: 'Closed By' },
  { key: 'deploymentReason', label: 'Deployment Reason' },
  { key: 'fixedUntil', label: 'Fixed Until' },
  { key: 'crHbrNumberReference', label: 'CR/HBR Number reference' },
  { key: 'vendorStatus', label: 'Vendor Status' },
  { key: 'responseDate', label: 'Response Date' },
  { key: 'supportReferenceNumber', label: 'Support Reference Number' },
  { key: 'subModule', label: 'Sub Module' },
  { key: 'fixedInProd', label: 'Fixed in Prod' },
  { key: 'mainModule', label: 'Main Module' },
  { key: 'reason', label: 'Reason' },
  { key: 'supportStatus', label: 'Support Status' },
  { key: 'vendorAssignTo', label: 'Assign To (Vendor)' },
  { key: 'category', label: 'Category' },
  { key: 'itemType', label: 'Item Type' },
  { key: 'estimateFixTime', label: 'Estimate Fix Time' },
  { key: 'platform', label: 'Platform' },
  { key: 'modified', label: 'Modified' },
  { key: 'detectedInRelease', label: 'Detected in Release' },
  { key: 'detectedInCycle', label: 'Detected in Cycle' },
  { key: 'targetRelease', label: 'Target Release' },
  { key: 'targetCycle', label: 'Target Cycle' },
  { key: 'crStatus', label: 'CR Status' },
  { key: 'dropNumber', label: 'Drop#' },
  { key: 'reopenYn', label: 'Reopen Y/N' },
  { key: 'influence', label: 'Influence' },
  { key: 'fixType', label: 'Fix Type' },
  { key: 'secondaryPriority', label: 'Secondary Priority' },
  { key: 'releaseDefect', label: 'Release Defect' },
  { key: 'businessProcess', label: 'Business Process' },
  { key: 'foundByAutomation', label: 'Found By Automation' },
  { key: 'mainBusinessProcess', label: 'Main Business Process' },
  { key: 'impact', label: 'Impact' },
  { key: 'productionReason', label: 'Production Reason' },
  { key: 'environmentComponent', label: 'Environment Component' },
  { key: 'willBeTestAtGoLive', label: 'Will Be Test At Go Live' },
  { key: 'deploymentCategory', label: 'Deployment Category' },
  { key: 'defectResponsible', label: 'Defect Responsible' },
  { key: 'targetReleaseReason', label: 'Target Release Reason' },
  { key: 'targetType', label: 'Target Type' },
  { key: 'systemComponent', label: 'System Component' },
  { key: 'forRegressionTest', label: 'For Regression Test' },
  { key: 'escDefectResponsible', label: 'Esc Defect Responsible' },
  { key: 'toBeTestedOnProd', label: 'To Be Tested On Prod' },
  { key: 'deploymentDateProd', label: 'Deployment Date (Prod)' },
  { key: 'targetScopeApproved', label: 'Target Scope Approved' },
];

const DEFAULT_TARGET_DEFECT_COLUMNS: (keyof TargetDefect)[] = [
  'id', 'detectedOnDate', 'severity', 'detectedBy', 'assignedTo', 'qaTester',
  'status', 'summary', 'responsibility', 'crHbrNumberReference', 'environment',
  'subModule', 'willBeTestAtGoLive', 'secondaryPriority', 'targetScopeApproved',
  'fixType', 'detectedInRelease', 'targetRelease', 'crReferenceNumber',
  'forRegressionTest', 'dropNumber', 'testPhase',
];

const TARGET_DEFECT_COLUMNS_STORAGE_KEY = 'deploycenter_target_defect_columns';

// Person-owner fields resolve their raw QC login (e.g. "guyp") to a real
// name via qcUserNames and render as an avatar; `responsibility` is the team
// field and keeps the flat color-badge treatment (spec confirmed 2026-08-30).
const PERSON_BADGE_FIELDS = new Set<keyof TargetDefect>([
  'assignedTo', 'qaTester', 'detectedBy', 'closedBy', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo',
]);
const TEAM_BADGE_FIELDS = new Set<keyof TargetDefect>(['responsibility']);
// Jira-style id/severity/status — shared with every other defect table in the
// app (feedback 2026-09-10: one consistent look, not a per-file duplicate).
function renderTargetDefectValue(key: keyof TargetDefect, value: unknown, qcUserNames?: Record<string, string>) {
  const s = String(value ?? '');
  if (!s) return '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={qcUserNames?.[s.toLowerCase()] ?? s} />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'id') return <IssueKeyLink id={s} />;
  if (key === 'status') return <StatusBadge status={s} />;
  if (key === 'severity') return <SeverityBadge severity={s} />;
  if (key === 'priority' || key === 'secondaryPriority') return <PriorityCell value={s} />;
  return s;
}

// Field-detail form grouping for the defect-detail screen — logical reading
// order (identification → description/notes → detection → ownership → fix →
// target/release → business impact), not the flat column-picker order.
// description/notes are handled separately as large free-text blocks, not
// part of any group's grid.
const TARGET_DETAIL_GROUPS_STORAGE_KEY = 'deploycenter_target_defect_detail_groups';

// summary/description/notes always render in their own fixed spots (title
// line, and the side-by-side boxes) — never offered in the category picker,
// so they can't be reassigned/hidden like the other fields (spec confirmed
// 2026-08-30).
const DETAIL_GROUPS_FIXED_FIELDS = new Set<keyof TargetDefect>(['summary', 'description', 'notes']);
const DETAIL_GROUPS_ASSIGNABLE_COLUMNS = TARGET_DEFECT_COLUMNS.filter(c => !DETAIL_GROUPS_FIXED_FIELDS.has(c.key));

const DEFAULT_TARGET_DEFECT_DETAIL_GROUPS: DetailGroup[] = [
  {
    title: 'זיהוי',
    fields: ['id', 'status', 'severity', 'priority', 'defectType', 'category', 'itemType'],
  },
  {
    title: 'גילוי',
    fields: [
      'detectedBy', 'detectedOnDate', 'detectedInRelease', 'detectedInCycle',
      'reproducible', 'environment', 'platform', 'subModule', 'mainModule', 'systemComponent',
    ],
  },
  {
    title: 'אחריות',
    fields: ['assignedTo', 'qaTester', 'responsibility', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo', 'vendorStatus'],
  },
  {
    title: 'טיפול ותיקון',
    fields: [
      'fixType', 'estimatedFixTime', 'actualFixTime', 'fixedUntil', 'fixedInProd',
      'closedBy', 'reopenYn', 'supportStatus', 'supportReferenceNumber', 'responseDate',
    ],
  },
  {
    title: 'יעד וגרסה',
    fields: [
      'targetRelease', 'targetCycle', 'targetType', 'targetReleaseReason', 'targetScopeApproved',
      'crStatus', 'crReferenceNumber', 'crHbrNumberReference', 'dropNumber', 'releaseDefect',
    ],
  },
  {
    title: 'השפעה עסקית',
    fields: [
      'impact', 'influence', 'businessProcess', 'mainBusinessProcess', 'deploymentCategory',
      'deploymentReason', 'productionReason', 'toBeTestedOnProd', 'deploymentDateProd',
      'willBeTestAtGoLive', 'forRegressionTest', 'foundByAutomation', 'secondaryPriority', 'modified',
    ],
  },
];

function targetDefectFieldLabel(key: keyof TargetDefect): string {
  return TARGET_DEFECT_COLUMNS.find(c => c.key === key)?.label ?? key;
}

interface TargetSummary {
  total: number;
  byArea: { area: string; count: number }[];
  defects: TargetDefect[];
  // Lowercased QC-login → real full name (only for logins that matched a
  // synced User.qcLogin — see resolveQcUserNames in target-cr.service.ts).
  // Raw QC logins (e.g. "guyp") have no space to derive initials/first name
  // from, so unresolved ones fall back to showing the login itself.
  qcUserNames?: Record<string, string>;
}

// Fixed-order categorical palette — same validated set already used by the QA
// work-plan Gantt chart (dataviz skill's validated default, CVD-safe adjacent
// -pair contrast). Reused here rather than re-validated from scratch.
const CATEGORY_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const OTHER_COLOR = '#8b93a7'; // muted gray — "Other" never takes a generated hue (dataviz anti-pattern)
const MAX_SLICES = 8;

function BackButton({ onClick }: { onClick: () => void }) {
  return <BackLink onClick={onClick} style={{ marginBottom: '16px' }} />;
}

// → new kit (2026-09-12): restyled onto Tailwind tokens; `group-hover:` responds
// to the `group` class the two clickable call sites (סה"כ CR-ים / TARGET) add
// on their wrapping <div> — StatTile itself has no onClick and never did, so
// no click/navigation behavior changed here, only the visuals + a hover lift
// on the wrapper that's already clickable.
function StatTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div className="min-w-[140px] flex-1 rounded-lg border border-border bg-card p-3.5 shadow-xs transition-[box-shadow,border-color,transform] duration-base ease-out group-hover:-translate-y-0.5 group-hover:border-neutral-300 group-hover:shadow-md">
      <div className="text-xs font-bold uppercase tracking-wide text-subtle-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold text-foreground" style={accent ? { color: accent } : undefined}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-subtle-foreground">{sub}</div>}
    </div>
  );
}

// Simplified treemap: each tile's width is proportional to its share of the
// displayed total, flex-wrapping into new rows as needed. Not a true
// squarified treemap (no variable row heights), but the same core idea —
// categorical identity (fixed hue order) sized by magnitude — at a fraction
// of the complexity, per the dataviz "pick the form" step: the job here is
// magnitude-by-category, which this satisfies without needing a full
// treemap-packing algorithm.
function SimpleTreemap({ title, icon, items, unitLabel, maxSlices = MAX_SLICES }: {
  title: string; icon: string; items: { label: string; value: number }[]; unitLabel: string; maxSlices?: number;
}) {
  const sorted = [...items].filter(i => i.value > 0).sort((a, b) => b.value - a.value);
  const top = sorted.slice(0, maxSlices);
  const rest = sorted.slice(maxSlices);
  const restTotal = rest.reduce((s, r) => s + r.value, 0);
  const slices = restTotal > 0 ? [...top, { label: 'אחר', value: restTotal }] : top;
  const total = slices.reduce((s, r) => s + r.value, 0) || 1;

  // → new kit (2026-09-12): restyled onto Tailwind tokens. Sorting, the
  // maxSlices/"אחר" bucketing, and the title="" tooltip content (percentage
  // math) are byte-for-byte unchanged — only style objects became classNames.
  // CATEGORY_COLORS/OTHER_COLOR deliberately untouched: dataviz hues, not
  // chrome, and each slice's own inline `background` still carries them.
  if (slices.length === 0) {
    return (
      <div className="mb-4 rounded-xl border border-border bg-card p-5 shadow-xs">
        <div className="mb-2 text-sm font-bold text-foreground">{icon} {title}</div>
        <div className="py-5 text-center text-[13px] text-subtle-foreground">אין נתונים להצגה</div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-border bg-card p-5 shadow-xs">
      <div className="mb-2.5 text-sm font-bold text-foreground">{icon} {title}</div>
      <div className="flex flex-wrap gap-1">
        {slices.map((s, i) => {
          const pct = (s.value / total) * 100;
          const color = s.label === 'אחר' ? OTHER_COLOR : CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          return (
            <div
              key={s.label}
              title={`${s.label}: ${Math.round(s.value * 100) / 100} ${unitLabel} (${Math.round(pct * 10) / 10}%)`}
              className="box-border flex h-[90px] min-w-[90px] flex-col justify-between overflow-hidden rounded-md p-2 transition-transform duration-fast ease-out hover:scale-[1.02]"
              style={{ flex: `0 1 ${Math.max(pct, 8)}%`, background: color }}
            >
              <span className="truncate text-xs font-semibold text-white">{s.label}</span>
              <span className="text-[15px] font-bold text-white">{Math.round(s.value * 100) / 100}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// A compact "landing" summary for the version-management module — reachable
// via the sidebar's "סקירה כללית" and the module's own default view. Scope &
// reach dashboard: CR/effort/TARGET-defect tiles + developments/defects
// treemaps, replacing the old 4-step lifecycle view entirely (version
// creation and the step-by-step wizard live elsewhere now — see
// onJumpToStep for the one remaining bridge, to the dates-management step).
// Drill-down navigation within the module's overview pane — a small explicit
// stack (not routing) so "חזרה" always returns to exactly where the user came
// from: overview → cr-list → cr-detail → history, or overview → target-list.
type Screen =
  | { type: 'overview' }
  | { type: 'cr-list' }
  | { type: 'target-list' }
  | { type: 'target-defect-detail'; defectId: string }
  | { type: 'cr-detail'; crNumber: string }
  | { type: 'history'; crNumber: string; teamId: string };

export const VersionOverview: React.FC<Props> = ({ version, token, onJumpToStep, onDrilledInChange }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [scope, setScope] = useState<ScopeOverview | null>(null);
  const [targetSummary, setTargetSummary] = useState<TargetSummary | null>(null);
  const [totalTests, setTotalTests] = useState<number | null>(null);

  const [screenStack, setScreenStack] = useState<Screen[]>([{ type: 'overview' }]);
  const screen = screenStack[screenStack.length - 1];
  const pushScreen = (s: Screen) => setScreenStack(prev => [...prev, s]);
  const goBack = () => setScreenStack(prev => (prev.length > 1 ? prev.slice(0, -1) : prev));

  const [crDetail, setCrDetail] = useState<any | null>(null);
  const [historyDetail, setHistoryDetail] = useState<any | null>(null);

  const [targetDefectColumns, setTargetDefectColumns] = useState<(keyof TargetDefect)[]>(() => {
    try {
      const saved = localStorage.getItem(TARGET_DEFECT_COLUMNS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return DEFAULT_TARGET_DEFECT_COLUMNS;
  });
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const applyTargetDefectColumns = (keys: (keyof TargetDefect)[]) => {
    setTargetDefectColumns(keys);
    localStorage.setItem(TARGET_DEFECT_COLUMNS_STORAGE_KEY, JSON.stringify(keys));
    setShowColumnPicker(false);
  };

  const [detailGroups, setDetailGroups] = useState<DetailGroup[]>(() => {
    try {
      const saved = localStorage.getItem(TARGET_DETAIL_GROUPS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return DEFAULT_TARGET_DEFECT_DETAIL_GROUPS;
  });
  const [showDetailGroupsPicker, setShowDetailGroupsPicker] = useState(false);
  const applyDetailGroups = (groups: DetailGroup[]) => {
    setDetailGroups(groups);
    localStorage.setItem(TARGET_DETAIL_GROUPS_STORAGE_KEY, JSON.stringify(groups));
    setShowDetailGroupsPicker(false);
  };

  const [targetDefectSort, setTargetDefectSort] = useState<{ key: keyof TargetDefect; dir: 'asc' | 'desc' } | null>(null);
  const [hoverTargetRow, setHoverTargetRow] = useState<string | null>(null);
  const toggleTargetDefectSort = (key: keyof TargetDefect) => {
    setTargetDefectSort(prev => prev?.key === key ? (prev.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' });
  };
  const { getWidth: getTargetColWidth, startResize: startTargetColResize } = useColumnWidths('deploycenter_target_defect_column_widths');
  const targetFilters = useColumnFilters(targetSummary?.defects as any, targetDefectColumns);

  const sortedTargetDefects = React.useMemo(() => {
    const defects = (targetSummary?.defects ?? []).filter(d => targetFilters.matches(d as any));
    if (!targetDefectSort) return defects;
    const { key, dir } = targetDefectSort;
    return [...defects].sort((a, b) => {
      const av = String(a[key] ?? ''); const bv = String(b[key] ?? '');
      const cmp = av.localeCompare(bv, 'he');
      return dir === 'asc' ? cmp : -cmp;
    });
  }, [targetSummary, targetDefectSort, targetFilters.matches]);

  useEffect(() => {
    setScreenStack([{ type: 'overview' }]);
    axios.get(`${API}/version-cr-assignments/version/${version.id}/scope-overview`, { headers })
      .then(r => setScope(r.data))
      .catch(() => setScope(null));
    axios.get(`${API}/target-cr/version/${version.id}/defect-summary`, { headers })
      .then(r => setTargetSummary(r.data))
      .catch(() => setTargetSummary(null));
    axios.get(`${API}/qa/workplan?versionId=${version.id}`, { headers })
      .then(r => {
        const plan = r.data;
        if (!plan?.cycles) { setTotalTests(null); return; }
        const count = plan.cycles.reduce((sum: number, c: any) =>
          sum + (c.tasks?.filter((t: any) => t.taskType === 'CR').length ?? 0), 0);
        setTotalTests(count);
      })
      .catch(() => setTotalTests(null));
  }, [version.id]); // eslint-disable-line

  const openCrDetail = (crNumber: string) => {
    setCrDetail(null);
    pushScreen({ type: 'cr-detail', crNumber });
    axios.get(`${API}/version-cr-assignments/version/${version.id}/cr/${crNumber}/detail`, { headers })
      .then(r => setCrDetail(r.data))
      .catch(() => setCrDetail(null));
  };

  const openHistory = (crNumber: string, teamId: string) => {
    setHistoryDetail(null);
    pushScreen({ type: 'history', crNumber, teamId });
    axios.get(`${API}/version-cr-assignments/version/${version.id}/cr/${crNumber}/team/${teamId}/change-detail`, { headers })
      .then(r => setHistoryDetail(r.data))
      .catch(() => setHistoryDetail(null));
  };

  useEffect(() => {
    onDrilledInChange?.(screen.type === 'target-list' || screen.type === 'target-defect-detail');
    return () => onDrilledInChange?.(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen.type]);

  const goLive = version.plannedStart ? new Date(version.plannedStart) : null;
  const daysToGoLive = goLive ? Math.ceil((goLive.getTime() - Date.now()) / 86400000) : null;
  const goLiveLabel = !goLive ? null
    : daysToGoLive! < 0 ? '⚠ תאריך היעד חלף'
    : daysToGoLive === 0 ? '🚀 עולים לאוויר היום'
    : `🚀 בעוד ${daysToGoLive} ${daysToGoLive === 1 ? 'יום' : 'ימים'}`;

  const crsByNumber = new Map<string, ScopeCr>();
  (scope?.crs ?? []).forEach(c => crsByNumber.set(c.crNumber, c));
  const sortedCrList = [...(scope?.crs ?? [])].sort((a, b) => a.crNumber.localeCompare(b.crNumber));

  return (
    <div dir="rtl">
      {/* ── Header — hidden on the TARGET-defect screens (list + detail),
          since both already show their own contextual title and this row
          (version name/status/go-live warning) is just redundant clutter
          once drilled in that far (feedback confirmed 2026-08-30). ── */}
      {screen.type !== 'target-list' && screen.type !== 'target-defect-detail' && (
        <div className="mb-4 rounded-2xl border border-border bg-card px-6 py-[18px] shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-lg font-bold text-foreground">{version.name}</span>
            <VersionStatusChip status={version.status} size="md" />
            {goLiveLabel && (
              <span
                className="rounded-full px-3 py-[3px] text-[13px] font-bold"
                style={{ color: daysToGoLive! < 0 ? C.danger : C.brand, background: daysToGoLive! < 0 ? C.dangerBg : C.brandDim }}
              >
                {goLiveLabel}
              </span>
            )}
            <span
              onClick={() => onJumpToStep('open')}
              className="ms-auto cursor-pointer text-[13px] font-semibold text-primary"
            >
              🗓 ניהול תאריכים ›
            </span>
          </div>
        </div>
      )}

      {screen.type === 'overview' && (
        <>
          {/* ── תכולה והיקף הגרסה — stat tiles ── */}
          <div className="mb-4 flex flex-wrap gap-2.5">
            <div onClick={() => pushScreen({ type: 'cr-list' })} className="group min-w-[140px] flex-1 cursor-pointer">
              <StatTile label="סה״כ CR-ים" value={scope?.crCount ?? '—'} />
            </div>
            <StatTile label="CR-ים בליבה" value={scope?.coreCrCount ?? '—'} />
            <StatTile label="CR-ים Stand Alone" value={scope?.saCrCount ?? '—'} />
            <div onClick={() => pushScreen({ type: 'target-list' })} className="group min-w-[140px] flex-1 cursor-pointer">
              <StatTile label="סה״כ TARGET" value={targetSummary?.total ?? scope?.targetCrCount ?? '—'} accent={C.brand} />
            </div>
            <StatTile label="סה״כ בדיקות" value={totalTests ?? '—'} />
            <StatTile
              label="ימי השקעה"
              value={scope ? `${scope.actualDays}` : '—'}
              accent={C.success}
              sub={scope ? `מתוך ${scope.plannedDays} מתוכננים${scope.ratioPct != null ? ` · ${scope.ratioPct}%` : ''}` : undefined}
            />
          </div>

          {/* ── Treemaps ── */}
          <SimpleTreemap
            title="ימי דיווח בפועל לפי CR"
            icon="🧩"
            unitLabel="ימי דיווח בפועל"
            maxSlices={(scope?.crs ?? []).length || 1}
            items={(scope?.crs ?? []).map(c => ({ label: c.crLabel || c.crNumber, value: c.actualEffortDays ?? 0 }))}
          />
          <SimpleTreemap
            title="תקלות TARGET לפי אזורים"
            icon="🎯"
            unitLabel="תקלות"
            items={(targetSummary?.byArea ?? []).map(a => ({ label: a.area, value: a.count }))}
          />
        </>
      )}

      {/* ── CR list screen ── */}
      {screen.type === 'cr-list' && (
        <div>
          <BackButton onClick={goBack} />
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 text-base font-bold text-foreground">📋 רשימת פיתוחים ({sortedCrList.length})</div>
            {!scope ? (
              <div className="p-8 text-center text-subtle-foreground">טוען...</div>
            ) : sortedCrList.length === 0 ? (
              <div className="p-8 text-center text-subtle-foreground">אין CR-ים בתכולת הגרסה</div>
            ) : (
              <div className="flex flex-col gap-1">
                {sortedCrList.map(c => (
                  <div
                    key={c.crNumber}
                    onClick={() => openCrDetail(c.crNumber)}
                    className="flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2.5"
                    style={{
                      background: c.needsAttention ? C.warningBg : C.bgNested,
                      borderColor: c.needsAttention ? C.warning : C.border,
                    }}
                  >
                    <span className="min-w-[90px] font-semibold text-foreground">{c.crNumber}</span>
                    <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground">
                      {c.crLabel?.replace(/^\d+\s*-\s*/, '') ?? '—'}
                    </span>
                    <span className="text-xs text-subtle-foreground">{c.teams.map(t => t.teamName).join(', ')}</span>
                    {c.needsAttention && <span className="text-xs font-bold text-warning">⚠</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TARGET defects list screen ── */}
      {screen.type === 'target-list' && (
        <div>
          <BackButton onClick={goBack} />
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-base font-bold text-foreground">🎯 תקלות TARGET ({targetSummary?.defects.length ?? 0})</span>
              <button
                onClick={() => setShowColumnPicker(true)}
                className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 text-[13px] text-muted-foreground"
              >
                ⚙ בחירת עמודות
              </button>
            </div>
            {!targetSummary ? (
              <div className="p-8 text-center text-subtle-foreground">טוען...</div>
            ) : targetSummary.defects.length === 0 ? (
              <div className="p-8 text-center text-subtle-foreground">אין תקלות TARGET בגרסה זו</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full table-fixed border-collapse text-[13px]" dir="rtl">
                  <thead>
                    <tr>
                      {targetDefectColumns.map(key => (
                        <th
                          key={key}
                          onClick={() => toggleTargetDefectSort(key)}
                          className="sticky top-0 cursor-pointer select-none overflow-hidden text-ellipsis whitespace-nowrap border-b-2 px-2.5 py-2 text-right text-[11px] font-bold tracking-wide"
                          style={{ color: JIRA.textSubtle, borderBottomColor: JIRA.greyN40, background: C.bgCard, width: getTargetColWidth(key) }}
                        >
                          {TARGET_DEFECT_COLUMNS.find(c => c.key === key)?.label ?? key}
                          {targetDefectSort?.key === key ? (targetDefectSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                          <ColumnResizeHandle onMouseDown={e => startTargetColResize(key, e)} />
                        </th>
                      ))}
                    </tr>
                    <ColumnFilterRow
                      columns={targetDefectColumns.map(key => ({ key, label: TARGET_DEFECT_COLUMNS.find(c => c.key === key)?.label ?? key }))}
                      getWidth={getTargetColWidth}
                      filters={targetFilters}
                    />
                  </thead>
                  <tbody>
                    {sortedTargetDefects.map(d => (
                      <tr
                        key={d.id}
                        onClick={() => pushScreen({ type: 'target-defect-detail', defectId: d.id })}
                        onMouseEnter={() => setHoverTargetRow(d.id)}
                        onMouseLeave={() => setHoverTargetRow(r => (r === d.id ? null : r))}
                        className="cursor-pointer"
                        style={{ background: hoverTargetRow === d.id ? JIRA.rowHover : undefined }}
                      >
                        {targetDefectColumns.map(key => {
                          const raw = String(d[key] ?? '');
                          const rtl = hasHebrew(raw);
                          return (
                            <td
                              key={key}
                              className="overflow-hidden text-ellipsis whitespace-nowrap border-b px-2.5 py-2"
                              style={{
                                color: JIRA.text, borderBottomColor: JIRA.greyN40, width: getTargetColWidth(key),
                                direction: rtl ? 'rtl' : 'ltr', textAlign: rtl ? 'right' : 'left',
                              }}
                            >
                              {renderTargetDefectValue(key, d[key], targetSummary.qcUserNames)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {showColumnPicker && (
        <SelectColumnsDialog
          allColumns={TARGET_DEFECT_COLUMNS}
          visibleKeys={targetDefectColumns}
          onApply={applyTargetDefectColumns}
          onClose={() => setShowColumnPicker(false)}
        />
      )}

      {showDetailGroupsPicker && (
        <DetailGroupsDialog
          allColumns={DETAIL_GROUPS_ASSIGNABLE_COLUMNS}
          groups={detailGroups}
          defaultGroups={DEFAULT_TARGET_DEFECT_DETAIL_GROUPS}
          onApply={applyDetailGroups}
          onClose={() => setShowDetailGroupsPicker(false)}
        />
      )}

      {/* ── TARGET defect detail screen — logical field groups, description/ ──
          notes get large RTL-preserved free-text boxes (both may contain
          long Hebrew text with residual entities from the source system). */}
      {screen.type === 'target-defect-detail' && (() => {
        const d = (targetSummary?.defects ?? []).find(x => x.id === screen.defectId);
        return (
          <div>
            <div className="flex items-center justify-between">
              <BackButton onClick={goBack} />
              <button
                onClick={() => setShowDetailGroupsPicker(true)}
                className="mb-4 cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 text-[13px] text-muted-foreground"
              >
                ⚙ התאמת שדות וקטגוריות
              </button>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
              {!d ? (
                <div className="p-8 text-center text-subtle-foreground">תקלה לא נמצאה</div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 text-[17px] font-bold text-foreground">
                    🎯 תקלה <IssueKeyLink id={d.id} /> — {d.summary || d.subject || d.title || '—'}
                  </div>

                  {/* Category groups — moved right under the title (spec 2026-08-30):
                      order is now title → categories → description+notes.
                      Filter out summary/description/notes defensively: they're excluded
                      from the picker going forward, but a group saved to localStorage
                      before that exclusion existed could still list them, which would
                      render them a second time inline here on top of their fixed
                      side-by-side box below (bug reported 2026-08-30). */}
                  {detailGroups
                    .map(group => ({ ...group, fields: group.fields.filter(k => !DETAIL_GROUPS_FIXED_FIELDS.has(k as keyof TargetDefect)) }))
                    .filter(group => group.fields.length > 0)
                    .map(group => (
                    <div key={group.title} className="border-t border-border pt-3">
                      <div className="mb-2 text-sm font-bold text-subtle-foreground">{group.title}</div>
                      <div className="grid gap-x-4 gap-y-2 text-sm" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
                        {(group.fields as (keyof TargetDefect)[]).map(key => (
                          // direction:ltr (not just inherited rtl) — label and value are two
                          // separate spans, and the page's rtl base direction lets the Unicode
                          // bidi algorithm flip their order whenever the value is a neutral/atomic
                          // run (empty "—", a colored badge, a date with an embedded Hebrew month
                          // name) — plain single-language text happened to stay glued together by
                          // luck. Forcing ltr keeps "Label: value" order stable for every value
                          // shape, since these labels are always English. textAlign:left per
                          // spec (bug fixed / alignment changed 2026-08-30).
                          <div key={key} className="text-left" dir="ltr">
                            <span className="text-subtle-foreground">{targetDefectFieldLabel(key)}: </span>
                            <span className="text-muted-foreground">{renderTargetDefectValue(key, d[key], targetSummary?.qcUserNames)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Description + Notes — side by side (each wraps to its own row
                      below ~380px so they don't get squeezed on a narrow window). */}
                  <div className="flex flex-wrap gap-4 border-t border-border pt-3">
                    <div className="min-w-[280px] flex-[1_1_380px]">
                      <div className="mb-1.5 text-sm font-bold text-subtle-foreground">תיאור</div>
                      <div
                        className="max-h-80 min-h-[110px] overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted px-3.5 py-3 text-[15px] leading-[1.7] text-foreground"
                        dir="rtl"
                      >
                        {d.description || '—'}
                      </div>
                    </div>

                    <div className="min-w-[280px] flex-[1_1_380px]">
                      <div className="mb-1.5 text-sm font-bold text-subtle-foreground">הערות</div>
                      <div className="max-h-80 min-h-[110px] overflow-y-auto rounded-md border border-border bg-muted px-3.5 py-3 text-[15px] leading-[1.7] text-foreground">
                        {renderNotesField(d.notes)}
                      </div>
                    </div>
                  </div>

                  {/* Attachments — same shared section as OpenProdDefectsView's
                      defect-detail screen (spec confirmed 2026-09-03). */}
                  <AttachmentsSection defectId={d.id} token={token} />

                  {/* Change history — end of form, filterable by which field changed
                      (spec confirmed 2026-08-30). Shared with every other defect-detail
                      screen via FieldChangeHistorySection. Data source: QC's AUDIT_LOG/
                      AUDIT_PROPERTIES tables (see DEFECT_FIELD_HISTORY_SQL) — real
                      Oracle query untested against this live instance; mock fallback
                      only covers defect 62034. */}
                  <FieldChangeHistorySection defectId={d.id} token={token} />
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* ── CR detail screen ── */}
      {screen.type === 'cr-detail' && (
        <div>
          <BackButton onClick={goBack} />
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 text-base font-bold text-foreground">CR {screen.crNumber}</div>
            {!crDetail ? (
              <div className="p-8 text-center text-subtle-foreground">טוען...</div>
            ) : (
              <div className="flex flex-col gap-2.5 text-sm">
                <div className="font-semibold text-foreground">{crDetail.crLabel}</div>
                {crDetail.crDescription && <div className="text-muted-foreground">{crDetail.crDescription}</div>}
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <div><span className="text-subtle-foreground">מנהל CR: </span>{crDetail.crManager || '—'}</div>
                  <div><span className="text-subtle-foreground">מאפיין: </span>{crDetail.application || '—'}</div>
                  <div><span className="text-subtle-foreground">הערכת ימים: </span>{crDetail.estimateDays ?? '—'}</div>
                  <div><span className="text-subtle-foreground">סטטוס במקור: </span>{crDetail.status || '—'}</div>
                  <div className="col-span-full"><span className="text-subtle-foreground">צוותים: </span>{(crDetail.teams ?? []).join(', ') || '—'}</div>
                </div>
                {crDetail.notes && <div className="italic text-muted-foreground">הערה: {crDetail.notes}</div>}

                <div className="mt-1.5 border-t border-border pt-2.5">
                  {(crsByNumber.get(screen.crNumber)?.teams ?? []).map(t => (
                    <button
                      key={t.teamId}
                      onClick={() => openHistory(screen.crNumber, t.teamId)}
                      className="me-1.5 cursor-pointer rounded-md border border-border bg-muted px-3 py-1.5 text-[13px] text-muted-foreground"
                    >
                      🕘 היסטוריית שינויים — {t.teamName}
                    </button>
                  ))}
                </div>

                {crDetail.archiveHistory?.length > 0 && (
                  <div className="mt-1.5 border-t border-border pt-2.5">
                    <div className="mb-1.5 font-semibold text-foreground">📦 היסטוריית ארכיון (QA)</div>
                    {crDetail.archiveHistory.map((h: any) => (
                      <div key={h.id} className="mb-1 text-[13px] text-muted-foreground">
                        {h.action === 'TASK_ARCHIVED' ? '📦 הועבר לארכיון' : '↺ שוחזר מהארכיון'}
                        {h.reason ? ` — ${h.reason}` : ''} · {formatDateTime(h.createdAt)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Change-history screen (NEW/REMOVED sync reason) ── */}
      {screen.type === 'history' && (
        <div>
          <BackButton onClick={goBack} />
          <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
            <div className="mb-3 text-base font-bold text-foreground">🕘 היסטוריית שינויים — {screen.crNumber}</div>
            {!historyDetail ? (
              <div className="p-5 text-center text-subtle-foreground">טוען...</div>
            ) : (
              <div className="text-sm leading-[1.7] text-muted-foreground">{historyDetail.reason}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
