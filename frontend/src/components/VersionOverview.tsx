import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { C, FONT, WEIGHT, RADIUS, SHADOW } from '../theme';
import { VersionStatusChip } from './ui';
import { hasHebrew, NameBadge, PersonAvatar, renderNotesField, DetailGroupsDialog, DetailGroup, FieldChangeHistorySection, useColumnWidths, ColumnResizeHandle, useColumnFilters, ColumnFilterRow } from './shared/defectFieldDisplay';
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
// Same severity palette as DefectDrilldownModal's SEVERITY_COLOR (release-intelligence
// module) — duplicated per this file's own established convention rather than a
// cross-file import, so severity always reads the same color everywhere it appears.
const SEVERITY_COLOR: Record<string, string> = {
  'Show Stopper': C.danger, Severe: C.danger, Medium: '#e8af00', Low: C.textMuted,
};
function renderTargetDefectValue(key: keyof TargetDefect, value: unknown, qcUserNames?: Record<string, string>) {
  const s = String(value ?? '');
  if (!s) return '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={qcUserNames?.[s.toLowerCase()] ?? s} />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'severity') return <span style={{ color: SEVERITY_COLOR[s] ?? C.textPrimary, fontWeight: WEIGHT.semibold }}>{s}</span>;
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
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', background: C.bgNested, color: C.textSecondary,
        border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px',
        fontWeight: WEIGHT.semibold, padding: '6px 14px', marginBottom: '16px', fontFamily: FONT,
      }}
    >
      → חזרה
    </button>
  );
}

function StatTile({ label, value, sub, accent }: { label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) {
  return (
    <div style={{
      flex: '1 1 140px', background: C.bgCard, borderRadius: RADIUS.lg, boxShadow: SHADOW.sm,
      border: `1px solid ${C.border}`, padding: '14px 16px', minWidth: '140px',
    }}>
      <div style={{ fontSize: '12px', fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: '24px', fontWeight: WEIGHT.bold, color: accent ?? C.textPrimary, marginTop: '4px' }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: C.textMuted, marginTop: '2px' }}>{sub}</div>}
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

  if (slices.length === 0) {
    return (
      <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: '16px' }}>
        <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '8px' }}>{icon} {title}</div>
        <div style={{ fontSize: '13px', color: C.textMuted, textAlign: 'center', padding: '20px 0' }}>אין נתונים להצגה</div>
      </div>
    );
  }

  return (
    <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '16px 20px', marginBottom: '16px' }}>
      <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '10px' }}>{icon} {title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px' }}>
        {slices.map((s, i) => {
          const pct = (s.value / total) * 100;
          const color = s.label === 'אחר' ? OTHER_COLOR : CATEGORY_COLORS[i % CATEGORY_COLORS.length];
          return (
            <div
              key={s.label}
              title={`${s.label}: ${Math.round(s.value * 100) / 100} ${unitLabel} (${Math.round(pct * 10) / 10}%)`}
              style={{
                flex: `0 1 ${Math.max(pct, 8)}%`, minWidth: '90px', height: '90px',
                background: color, borderRadius: RADIUS.sm, padding: '8px 10px',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                overflow: 'hidden', boxSizing: 'border-box',
              }}
            >
              <span style={{ fontSize: '12px', fontWeight: WEIGHT.semibold, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {s.label}
              </span>
              <span style={{ fontSize: '15px', fontWeight: WEIGHT.bold, color: 'white' }}>
                {Math.round(s.value * 100) / 100}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const columnMoveBtnStyle: React.CSSProperties = {
  padding: '4px 10px', background: C.bgNested, color: C.textPrimary,
  border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, cursor: 'pointer',
  fontSize: '13px', fontFamily: FONT, minWidth: '36px',
};

// "Select Columns" picker — two listboxes (available / visible) with move and
// reorder controls, matching the reference ALM/QC dialog the user provided.
// Kept as an overlay dialog (not a full-screen drill-down like the CR/TARGET
// list screens) since it's a transient utility picker, not navigation.
function SelectColumnsDialog({
  allColumns, visibleKeys, onApply, onClose,
}: {
  allColumns: { key: keyof TargetDefect; label: string }[];
  visibleKeys: (keyof TargetDefect)[];
  onApply: (keys: (keyof TargetDefect)[]) => void;
  onClose: () => void;
}) {
  const [visible, setVisible] = useState(
    visibleKeys.map(k => allColumns.find(c => c.key === k)).filter((c): c is { key: keyof TargetDefect; label: string } => !!c)
  );
  const [available, setAvailable] = useState(
    allColumns.filter(c => !visibleKeys.includes(c.key))
  );
  const [selAvailable, setSelAvailable] = useState<Set<keyof TargetDefect>>(new Set());
  const [selVisible, setSelVisible] = useState<Set<keyof TargetDefect>>(new Set());

  const toggle = (set: Set<keyof TargetDefect>, key: keyof TargetDefect, setFn: (s: Set<keyof TargetDefect>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setFn(next);
  };

  const moveToVisible = () => {
    if (selAvailable.size === 0) return;
    setVisible(v => [...v, ...available.filter(c => selAvailable.has(c.key))]);
    setAvailable(a => a.filter(c => !selAvailable.has(c.key)));
    setSelAvailable(new Set());
  };
  const moveToAvailable = () => {
    if (selVisible.size === 0) return;
    setAvailable(a => [...a, ...visible.filter(c => selVisible.has(c.key))]);
    setVisible(v => v.filter(c => !selVisible.has(c.key)));
    setSelVisible(new Set());
  };
  const moveAllToVisible = () => { setVisible(v => [...v, ...available]); setAvailable([]); setSelAvailable(new Set()); };
  const moveAllToAvailable = () => { setAvailable(a => [...a, ...visible]); setVisible([]); setSelVisible(new Set()); };

  const reorder = (dir: -1 | 1) => {
    if (selVisible.size !== 1) return;
    const key = Array.from(selVisible)[0];
    const idx = visible.findIndex(c => c.key === key);
    const newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= visible.length) return;
    const next = [...visible];
    [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
    setVisible(next);
  };

  const listBoxStyle: React.CSSProperties = {
    border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, height: '280px',
    overflowY: 'auto', background: C.bgNested,
  };
  const itemStyle = (selected: boolean): React.CSSProperties => ({
    padding: '4px 8px', fontSize: '13px', cursor: 'pointer',
    background: selected ? C.brandDim : 'transparent', color: C.textPrimary,
  });

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 5000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
    >
      <div onClick={e => e.stopPropagation()} style={{ background: C.bgCard, borderRadius: RADIUS.lg, padding: '20px', width: '660px', maxWidth: '94vw', boxShadow: '0 20px 48px rgba(0,0,0,.25)', fontFamily: FONT }}>
        <div style={{ fontSize: '15px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '14px', textAlign: 'right' }}>בחירת עמודות</div>
        <div style={{ display: 'flex', gap: '10px', direction: 'ltr' }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '12px', color: C.textMuted, marginBottom: '4px' }}>Available Columns:</div>
            <div style={listBoxStyle}>
              {available.map(c => (
                <div key={c.key} onClick={() => toggle(selAvailable, c.key, setSelAvailable)} style={itemStyle(selAvailable.has(c.key))}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '6px' }}>
            <button onClick={moveToVisible} style={columnMoveBtnStyle}>&gt;</button>
            <button onClick={moveAllToVisible} style={columnMoveBtnStyle}>&gt;&gt;</button>
            <button onClick={moveToAvailable} style={columnMoveBtnStyle}>&lt;</button>
            <button onClick={moveAllToAvailable} style={columnMoveBtnStyle}>&lt;&lt;</button>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <span style={{ fontSize: '12px', color: C.textMuted }}>Visible Columns:</span>
              <div style={{ display: 'flex', gap: '4px' }}>
                <button onClick={() => reorder(-1)} style={{ ...columnMoveBtnStyle, padding: '2px 8px' }}>↑</button>
                <button onClick={() => reorder(1)} style={{ ...columnMoveBtnStyle, padding: '2px 8px' }}>↓</button>
              </div>
            </div>
            <div style={listBoxStyle}>
              {visible.map(c => (
                <div key={c.key} onClick={() => toggle(selVisible, c.key, setSelVisible)} style={itemStyle(selVisible.has(c.key))}>
                  {c.label}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
          <button onClick={onClose} style={{ padding: '8px 20px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}>Cancel</button>
          <button onClick={() => onApply(visible.map(c => c.key))} style={{ padding: '8px 20px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontWeight: WEIGHT.semibold, fontFamily: FONT }}>OK</button>
        </div>
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
    <div style={{ fontFamily: FONT, direction: 'rtl' }}>
      {/* ── Header — hidden on the TARGET-defect screens (list + detail),
          since both already show their own contextual title and this row
          (version name/status/go-live warning) is just redundant clutter
          once drilled in that far (feedback confirmed 2026-08-30). ── */}
      {screen.type !== 'target-list' && screen.type !== 'target-defect-detail' && (
        <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '18px 24px', marginBottom: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '18px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>{version.name}</span>
            <VersionStatusChip status={version.status} size="md" />
            {goLiveLabel && (
              <span style={{
                fontSize: '13px', fontWeight: WEIGHT.bold, color: daysToGoLive! < 0 ? C.danger : C.brand,
                background: daysToGoLive! < 0 ? C.dangerBg : C.brandDim, borderRadius: RADIUS.full, padding: '3px 12px',
              }}>
                {goLiveLabel}
              </span>
            )}
            <span
              onClick={() => onJumpToStep('open')}
              style={{ marginRight: 'auto', fontSize: '13px', color: C.brand, fontWeight: WEIGHT.semibold, cursor: 'pointer' }}
            >
              🗓 ניהול תאריכים ›
            </span>
          </div>
        </div>
      )}

      {screen.type === 'overview' && (
        <>
          {/* ── תכולה והיקף הגרסה — stat tiles ── */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
            <div onClick={() => pushScreen({ type: 'cr-list' })} style={{ cursor: 'pointer', flex: '1 1 140px', minWidth: '140px' }}>
              <StatTile label="סה״כ CR-ים" value={scope?.crCount ?? '—'} />
            </div>
            <StatTile label="CR-ים בליבה" value={scope?.coreCrCount ?? '—'} />
            <StatTile label="CR-ים Stand Alone" value={scope?.saCrCount ?? '—'} />
            <div onClick={() => pushScreen({ type: 'target-list' })} style={{ cursor: 'pointer', flex: '1 1 140px', minWidth: '140px' }}>
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
          <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '12px' }}>📋 רשימת פיתוחים ({sortedCrList.length})</div>
            {!scope ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>טוען...</div>
            ) : sortedCrList.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>אין CR-ים בתכולת הגרסה</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {sortedCrList.map(c => (
                  <div
                    key={c.crNumber}
                    onClick={() => openCrDetail(c.crNumber)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', cursor: 'pointer',
                      background: c.needsAttention ? C.warningBg : C.bgNested,
                      border: `1px solid ${c.needsAttention ? C.warning : C.border}`, borderRadius: RADIUS.md,
                    }}
                  >
                    <span style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary, minWidth: '90px' }}>{c.crNumber}</span>
                    <span style={{ color: C.textSecondary, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.crLabel?.replace(/^\d+\s*-\s*/, '') ?? '—'}
                    </span>
                    <span style={{ fontSize: '12px', color: C.textMuted }}>{c.teams.map(t => t.teamName).join(', ')}</span>
                    {c.needsAttention && <span style={{ fontSize: '12px', color: C.warning, fontWeight: WEIGHT.bold }}>⚠</span>}
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
          <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
              <span style={{ fontSize: '16px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>🎯 תקלות TARGET ({targetSummary?.defects.length ?? 0})</span>
              <button
                onClick={() => setShowColumnPicker(true)}
                style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT }}
              >
                ⚙ בחירת עמודות
              </button>
            </div>
            {!targetSummary ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>טוען...</div>
            ) : targetSummary.defects.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>אין תקלות TARGET בגרסה זו</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: '13px', direction: 'rtl' }}>
                  <thead>
                    <tr>
                      {targetDefectColumns.map(key => (
                        <th
                          key={key}
                          onClick={() => toggleTargetDefectSort(key)}
                          style={{
                            position: 'sticky', top: 0, textAlign: 'right', padding: '8px 10px', color: C.textMuted, fontWeight: WEIGHT.bold,
                            borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            background: C.bgCard, width: getTargetColWidth(key),
                            cursor: 'pointer', userSelect: 'none',
                          }}
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
                        style={{ borderBottom: `1px solid ${C.border}`, cursor: 'pointer' }}
                      >
                        {targetDefectColumns.map(key => {
                          const raw = String(d[key] ?? '');
                          const rtl = hasHebrew(raw);
                          return (
                            <td
                              key={key}
                              style={{
                                padding: '7px 10px', color: C.textSecondary, whiteSpace: 'nowrap',
                                overflow: 'hidden', textOverflow: 'ellipsis', width: getTargetColWidth(key),
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
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <BackButton onClick={goBack} />
              <button
                onClick={() => setShowDetailGroupsPicker(true)}
                style={{ padding: '6px 14px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', fontFamily: FONT, marginBottom: '16px' }}
              >
                ⚙ התאמת שדות וקטגוריות
              </button>
            </div>
            <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '20px' }}>
              {!d ? (
                <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>תקלה לא נמצאה</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ fontSize: '17px', fontWeight: WEIGHT.bold, color: C.textPrimary }}>
                    🎯 תקלה {d.id} — {d.summary || d.subject || d.title || '—'}
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
                    <div key={group.title} style={{ borderTop: `1px solid ${C.border}`, paddingTop: '12px' }}>
                      <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '8px' }}>{group.title}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px 16px', fontSize: '14px' }}>
                        {(group.fields as (keyof TargetDefect)[]).map(key => (
                          // direction:ltr (not just inherited rtl) — label and value are two
                          // separate spans, and the page's rtl base direction lets the Unicode
                          // bidi algorithm flip their order whenever the value is a neutral/atomic
                          // run (empty "—", a colored badge, a date with an embedded Hebrew month
                          // name) — plain single-language text happened to stay glued together by
                          // luck. Forcing ltr keeps "Label: value" order stable for every value
                          // shape, since these labels are always English. textAlign:left per
                          // spec (bug fixed / alignment changed 2026-08-30).
                          <div key={key} style={{ direction: 'ltr', textAlign: 'left' }}>
                            <span style={{ color: C.textMuted }}>{targetDefectFieldLabel(key)}: </span>
                            <span style={{ color: C.textSecondary }}>{renderTargetDefectValue(key, d[key], targetSummary?.qcUserNames)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}

                  {/* Description + Notes — side by side (each wraps to its own row
                      below ~380px so they don't get squeezed on a narrow window). */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', borderTop: `1px solid ${C.border}`, paddingTop: '12px' }}>
                    <div style={{ flex: '1 1 380px', minWidth: '280px' }}>
                      <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '6px' }}>תיאור</div>
                      <div style={{
                        direction: 'rtl', textAlign: 'right', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        minHeight: '110px', maxHeight: '320px', overflowY: 'auto', lineHeight: 1.7, fontSize: '15px',
                        color: C.textPrimary, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
                        padding: '12px 14px',
                      }}>
                        {d.description || '—'}
                      </div>
                    </div>

                    <div style={{ flex: '1 1 380px', minWidth: '280px' }}>
                      <div style={{ fontSize: '14px', fontWeight: WEIGHT.bold, color: C.textMuted, marginBottom: '6px' }}>הערות</div>
                      <div style={{
                        minHeight: '110px', maxHeight: '320px', overflowY: 'auto', lineHeight: 1.7, fontSize: '15px',
                        color: C.textPrimary, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md,
                        padding: '12px 14px',
                      }}>
                        {renderNotesField(d.notes)}
                      </div>
                    </div>
                  </div>

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
          <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '12px' }}>CR {screen.crNumber}</div>
            {!crDetail ? (
              <div style={{ textAlign: 'center', padding: '30px', color: C.textMuted }}>טוען...</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '14px' }}>
                <div style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{crDetail.crLabel}</div>
                {crDetail.crDescription && <div style={{ color: C.textSecondary }}>{crDetail.crDescription}</div>}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '4px' }}>
                  <div><span style={{ color: C.textMuted }}>מנהל CR: </span>{crDetail.crManager || '—'}</div>
                  <div><span style={{ color: C.textMuted }}>מאפיין: </span>{crDetail.application || '—'}</div>
                  <div><span style={{ color: C.textMuted }}>הערכת ימים: </span>{crDetail.estimateDays ?? '—'}</div>
                  <div><span style={{ color: C.textMuted }}>סטטוס במקור: </span>{crDetail.status || '—'}</div>
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: C.textMuted }}>צוותים: </span>{(crDetail.teams ?? []).join(', ') || '—'}</div>
                </div>
                {crDetail.notes && <div style={{ color: C.textSecondary, fontStyle: 'italic' }}>הערה: {crDetail.notes}</div>}

                <div style={{ borderTop: `1px solid ${C.border}`, marginTop: '6px', paddingTop: '10px' }}>
                  {(crsByNumber.get(screen.crNumber)?.teams ?? []).map(t => (
                    <button
                      key={t.teamId}
                      onClick={() => openHistory(screen.crNumber, t.teamId)}
                      style={{ padding: '6px 12px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', fontSize: '13px', marginLeft: '6px' }}
                    >
                      🕘 היסטוריית שינויים — {t.teamName}
                    </button>
                  ))}
                </div>

                {crDetail.archiveHistory?.length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.border}`, marginTop: '6px', paddingTop: '10px' }}>
                    <div style={{ fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '6px' }}>📦 היסטוריית ארכיון (QA)</div>
                    {crDetail.archiveHistory.map((h: any) => (
                      <div key={h.id} style={{ fontSize: '13px', color: C.textSecondary, marginBottom: '4px' }}>
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
          <div style={{ background: C.bgCard, borderRadius: RADIUS.xl, boxShadow: SHADOW.sm, border: `1px solid ${C.border}`, padding: '20px' }}>
            <div style={{ fontSize: '16px', fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: '12px' }}>🕘 היסטוריית שינויים — {screen.crNumber}</div>
            {!historyDetail ? (
              <div style={{ textAlign: 'center', padding: '20px', color: C.textMuted }}>טוען...</div>
            ) : (
              <div style={{ fontSize: '14px', color: C.textSecondary, lineHeight: 1.7 }}>{historyDetail.reason}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
