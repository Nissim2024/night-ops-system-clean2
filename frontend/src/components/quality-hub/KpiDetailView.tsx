import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { C, JIRA } from '../../theme';
import { useReleaseCount } from './releaseCountSetting';
import { IssueKeyLink, StatusBadge, SeverityBadge, PriorityCell, PersonAvatar, NameBadge, hasHebrew, SelectColumnsDialog } from '../shared/defectFieldDisplay';
import { BackLink } from '../ui';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

interface KpiDetail {
  kpiName: string;
  releaseName: string;
  definition: { purpose: string | null; description: string | null; measuredEntity: string; dataSource: string | null; trend: string | null; kpiType: string };
  target: number;
  grade: number | null;
  weight: number;
  relativeScorePct: number | null;
  contributionPct: number | null;
  scoreLostPct: number | null;
  yearAverageGrade: number | null;
  severity: { showStopper: number | null; severe: number | null; medium: number | null; low: number | null };
  // Computed live from the current real defect list — shown alongside
  // `severity` (as-imported from RELEASES_KPI_SCORES.xlsx) for comparison.
  // null when there's no real QC data for this release, or the KPI has no
  // defect-list concept (the two time-based KPIs).
  liveSeverity: { showStopper: number; severe: number; medium: number; low: number } | null;
  trend: { releaseName: string; value: number | null }[];
  qualitativeNote: string | null;
}

interface ProblemNote {
  id: string;
  releaseName: string;
  kpiName: string;
  problemCharacteristics: string | null;
  defectCount: number | null;
}
type ProblemDraft = { problemCharacteristics: string; defectCount: string };
const EMPTY_PROBLEM_DRAFT: ProblemDraft = { problemCharacteristics: '', defectCount: '' };

// Defect column catalog — same DefectDto shape /qc/defects-by-kpi returns
// everywhere else in the app (DefectDrilldownModal's ALL_COLUMNS, which this
// mirrors field-for-field — extended 2026-09-14 alongside it so no screen is
// left with the older, narrower/Hebrew-labeled catalog). Column picker (same
// shared dialog as every other defect table — feedback 2026-09-10) replaces
// this screen's old fixed 6-column list.
type DefectColumnKey =
  | 'id' | 'title' | 'subject' | 'severity' | 'status' | 'assignedTo' | 'qaTester' | 'discoveryDate' | 'priority'
  | 'reporter' | 'environment' | 'testPhase' | 'defectType' | 'system' | 'responsibility' | 'crHbrNumberReference'
  | 'crReferenceNumber' | 'fixType' | 'reason' | 'reopenYn' | 'targetRelease' | 'estimatedFixTime' | 'actualFixTime'
  | 'closedBy' | 'deploymentReason' | 'fixedUntil' | 'vendorStatus' | 'responseDate' | 'supportReferenceNumber'
  | 'subModule' | 'fixedInProd' | 'mainModule' | 'supportStatus' | 'vendorAssignTo' | 'category' | 'itemType'
  | 'estimateFixTime' | 'platform' | 'modified' | 'detectedInRelease' | 'detectedInCycle' | 'targetCycle'
  | 'crStatus' | 'dropNumber' | 'influence' | 'secondaryPriority' | 'releaseDefect' | 'businessProcess'
  | 'foundByAutomation' | 'mainBusinessProcess' | 'impact' | 'productionReason' | 'environmentComponent'
  | 'willBeTestAtGoLive' | 'deploymentCategory' | 'defectResponsible' | 'targetReleaseReason' | 'targetType'
  | 'systemComponent' | 'forRegressionTest' | 'escDefectResponsible' | 'toBeTestedOnProd' | 'deploymentDateProd'
  | 'targetScopeApproved';
const DEFECT_COLUMNS: { key: DefectColumnKey; label: string }[] = [
  { key: 'id', label: 'Defect ID' },
  { key: 'title', label: 'Title' },
  { key: 'subject', label: 'Subject' },
  { key: 'severity', label: 'Severity' },
  { key: 'status', label: 'Bug Status' },
  { key: 'assignedTo', label: 'Assigned To' },
  { key: 'qaTester', label: 'Tester' },
  { key: 'discoveryDate', label: 'Detected on Date' },
  { key: 'priority', label: 'Priority' },
  { key: 'reporter', label: 'Detected By' },
  { key: 'environment', label: 'Environment' },
  { key: 'testPhase', label: 'Test Phase' },
  { key: 'defectType', label: 'Bug Type' },
  { key: 'system', label: 'Project' },
  { key: 'responsibility', label: 'Responsibility' },
  { key: 'crHbrNumberReference', label: 'CR/HBR Number reference' },
  { key: 'crReferenceNumber', label: 'CR Reference Number' },
  { key: 'fixType', label: 'Fix Type' },
  { key: 'reason', label: 'Reason' },
  { key: 'reopenYn', label: 'Reopen Y/N' },
  { key: 'targetRelease', label: 'Target Release' },
  { key: 'estimatedFixTime', label: 'Estimated Fix Time' },
  { key: 'actualFixTime', label: 'Fix Time' },
  { key: 'closedBy', label: 'Closed By' },
  { key: 'deploymentReason', label: 'Deployment Reason' },
  { key: 'fixedUntil', label: 'Fixed Until' },
  { key: 'vendorStatus', label: 'Vendor Status' },
  { key: 'responseDate', label: 'Response Date' },
  { key: 'supportReferenceNumber', label: 'Support Reference Number' },
  { key: 'subModule', label: 'Sub Module' },
  { key: 'fixedInProd', label: 'Fixed in Prod' },
  { key: 'mainModule', label: 'Main Module' },
  { key: 'supportStatus', label: 'Support Status' },
  { key: 'vendorAssignTo', label: 'Assign To (Vendor)' },
  { key: 'category', label: 'Category' },
  { key: 'itemType', label: 'Item Type' },
  { key: 'estimateFixTime', label: 'Estimate Fix Time' },
  { key: 'platform', label: 'Platform' },
  { key: 'modified', label: 'Modified' },
  { key: 'detectedInRelease', label: 'Detected in Release' },
  { key: 'detectedInCycle', label: 'Detected in Cycle' },
  { key: 'targetCycle', label: 'Target Cycle' },
  { key: 'crStatus', label: 'CR Status' },
  { key: 'dropNumber', label: 'Drop#' },
  { key: 'influence', label: 'Influence' },
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
const DEFAULT_DEFECT_COLUMNS: DefectColumnKey[] = ['id', 'title', 'severity', 'status', 'assignedTo', 'discoveryDate'];
const DEFECT_COLUMNS_STORAGE_KEY = 'deploycenter_kpi_defect_columns_v1';
const PERSON_BADGE_FIELDS = new Set<DefectColumnKey>(['reporter', 'assignedTo', 'qaTester', 'closedBy', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo']);
const TEAM_BADGE_FIELDS = new Set<DefectColumnKey>(['responsibility']);
function renderDefectCell(key: DefectColumnKey, value: unknown) {
  const s = String(value ?? '');
  if (!s) return key === 'priority' ? <PriorityCell value="" /> : '—';
  if (PERSON_BADGE_FIELDS.has(key)) return <PersonAvatar name={s} full />;
  if (TEAM_BADGE_FIELDS.has(key)) return <NameBadge name={s} />;
  if (key === 'id') return <IssueKeyLink id={s} />;
  if (key === 'status') return <StatusBadge status={s} />;
  if (key === 'severity') return <SeverityBadge severity={s} />;
  if (key === 'priority') return <PriorityCell value={s} />;
  return s;
}

interface ImprovementTask {
  id: string;
  releaseName: string;
  kpiName: string;
  responsibility: string | null;
  requiredImprovement: string | null;
  mainDevelopments: string | null;
  status: string;
}
type TaskDraft = { responsibility: string; requiredImprovement: string; mainDevelopments: string; status: string };
const EMPTY_TASK_DRAFT: TaskDraft = { responsibility: '', requiredImprovement: '', mainDevelopments: '', status: 'OPEN' };

const STATUS_OPTIONS: { value: string; label: string; color: string }[] = [
  { value: 'OPEN', label: 'פתוח', color: C.danger },
  { value: 'IN_PROGRESS', label: 'בטיפול', color: '#e8af00' },
  { value: 'DONE', label: 'הושלם', color: C.success },
];
function statusLabel(status: string): { label: string; color: string } {
  const opt = STATUS_OPTIONS.find(o => o.value === status);
  return opt ? { label: opt.label, color: opt.color } : { label: status, color: C.textMuted };
}

const NOTE_EDITOR_ROLES = ['ADMIN', 'RELEASE_MANAGER'];

// Grade values ("בפועל"/ממוצע שנתי) — 3 decimal places, matching KpiMatrixView.
function fmt3(v: number | null): string {
  return v != null ? v.toFixed(3) : '—';
}

function fmtPct(v: number | null): string {
  return v != null ? `${v.toFixed(2)}%` : '—';
}

// %-type KPIs (kpiType === '%') carry a Grade that IS the percentage itself
// (e.g. 0.0847 → "8.47%") — matches how the source deck displays Target/Grade/
// Average(Year) for those KPIs. Quantity/Time-type KPIs keep the raw fmt3.
function fmtGradeOrPct(v: number | null, kpiType: string): string {
  if (v == null) return '—';
  return kpiType === '%' ? `${(v * 100).toFixed(2)}%` : fmt3(v);
}

// Severity breakdown fields are defect COUNTS — always whole, non-negative.
function fmtCount(v: number | null): string {
  return v != null ? String(Math.round(Math.abs(v))) : '—';
}

function KpiCard({ value, label, valueColor, onClick }: { value: string; label: string; valueColor?: string; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      className={`min-w-[140px] flex-1 rounded-lg border border-border bg-card px-4 py-3.5 ${onClick ? 'cursor-pointer' : ''}`}
    >
      <div className="text-lg font-bold leading-tight" style={{ color: valueColor ?? undefined }}>
        <span className={valueColor ? '' : 'text-foreground'}>{value}</span>
      </div>
      <div className="mt-1 text-xs text-subtle-foreground">{label}</div>
    </div>
  );
}

const summaryCellClass = 'p-2.5 py-3 text-center font-semibold text-foreground';
const itemCellClass = 'px-2 py-1.5 border-b border-border text-foreground align-top';
const iconBtnClass = 'bg-transparent border-none cursor-pointer text-[13px] px-1 py-0.5';
const itemInputClass = 'w-full rounded-sm border border-border bg-card px-1.5 py-1 font-sans text-xs text-foreground';

function ProblemNoteEditRow({ draft, setDraft, saving, onSave, onCancel }: {
  draft: ProblemDraft; setDraft: React.Dispatch<React.SetStateAction<ProblemDraft>>;
  saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  const set = (patch: Partial<ProblemDraft>) => setDraft(prev => ({ ...prev, ...patch }));
  return (
    <tr className="bg-muted">
      <td className={itemCellClass}><textarea rows={2} className={`${itemInputClass} min-h-[48px] resize-y`} value={draft.problemCharacteristics} onChange={e => set({ problemCharacteristics: e.target.value })} /></td>
      <td className={itemCellClass}><input className={`${itemInputClass} text-center`} type="number" value={draft.defectCount} onChange={e => set({ defectCount: e.target.value })} /></td>
      <td className={`${itemCellClass} whitespace-nowrap`}>
        <button onClick={onSave} disabled={saving} className={`${iconBtnClass} font-semibold text-primary ${saving ? 'opacity-60' : 'opacity-100'}`}>{saving ? '...' : 'שמור'}</button>
        <button onClick={onCancel} disabled={saving} className={`${iconBtnClass} text-subtle-foreground`}>ביטול</button>
      </td>
    </tr>
  );
}

// Column order follows the diagnostic narrative — what's needed, what's being
// built, who owns it, where it stands — not "who's responsible" first
// (feedback 2026-08-29: responsibility-first read backwards).
function ImprovementTaskEditRow({ draft, setDraft, saving, onSave, onCancel }: {
  draft: TaskDraft; setDraft: React.Dispatch<React.SetStateAction<TaskDraft>>;
  saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  const set = (patch: Partial<TaskDraft>) => setDraft(prev => ({ ...prev, ...patch }));
  return (
    <tr className="bg-muted">
      <td className={itemCellClass}><textarea rows={2} className={`${itemInputClass} min-h-[48px] resize-y`} value={draft.requiredImprovement} onChange={e => set({ requiredImprovement: e.target.value })} /></td>
      <td className={itemCellClass}><textarea rows={2} className={`${itemInputClass} min-h-[48px] resize-y`} value={draft.mainDevelopments} onChange={e => set({ mainDevelopments: e.target.value })} /></td>
      <td className={itemCellClass}><input className={itemInputClass} value={draft.responsibility} onChange={e => set({ responsibility: e.target.value })} /></td>
      <td className={itemCellClass}>
        <select className={itemInputClass} value={draft.status} onChange={e => set({ status: e.target.value })}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td className={`${itemCellClass} whitespace-nowrap`}>
        <button onClick={onSave} disabled={saving} className={`${iconBtnClass} font-semibold text-primary ${saving ? 'opacity-60' : 'opacity-100'}`}>{saving ? '...' : 'שמור'}</button>
        <button onClick={onCancel} disabled={saving} className={`${iconBtnClass} text-subtle-foreground`}>ביטול</button>
      </td>
    </tr>
  );
}

const CHART_HEIGHT = 200;
const BAR_GAP = 60;

// Raw Grade values span wildly different scales (0.02-0.25 for %-type KPIs,
// up to 175+ for count-type ones) — round to a sensible precision per magnitude.
function roundGrade(v: number): number {
  if (Math.abs(v) < 10) return Math.round(v * 1000) / 1000;
  if (Math.abs(v) < 100) return Math.round(v * 10) / 10;
  return Math.round(v);
}

function GradeTrendChart({ points }: { points: { releaseName: string; value: number | null }[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => setContainerWidth(entries[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const usable = points.filter(p => p.value != null);
  if (usable.length === 0) {
    return <div className="p-6 text-center text-sm text-subtle-foreground">אין נתונים להצגה.</div>;
  }
  const maxVal = Math.max(...usable.map(p => p.value as number), 0.001);
  // Fill the full available width when there's room for all points; only
  // fall back to a fixed per-bar gap (with horizontal scroll) once there are
  // more points than comfortably fit, so bars never get squished unreadable.
  const naturalWidth = Math.max(400, points.length * BAR_GAP);
  const width = Math.max(naturalWidth, containerWidth);
  const gap = points.length > 1 ? (width - 32) / points.length : width;
  const barWidth = Math.min(32, gap * 0.6);

  return (
    <div ref={containerRef} className="w-full overflow-x-auto">
      <svg width={width} height={CHART_HEIGHT + 40} className="block">
        {points.map((p, i) => {
          const x = 16 + i * gap;
          if (p.value == null) return null;
          const barHeight = Math.max(2, (p.value / maxVal) * (CHART_HEIGHT - 30));
          const y = CHART_HEIGHT - barHeight;
          return (
            <g key={p.releaseName}>
              <rect x={x} y={y} width={barWidth} height={barHeight} fill={C.brand} rx={2} />
              <text x={x + barWidth / 2} y={y - 8} fontSize={14} fontWeight="bold" fill={C.textSecondary} textAnchor="middle">
                {roundGrade(p.value)}
              </text>
              <text x={x + barWidth / 2} y={CHART_HEIGHT + 18} fontSize={12} fill={C.textMuted} textAnchor="middle">
                {p.releaseName}
              </text>
            </g>
          );
        })}
        <line x1={8} y1={CHART_HEIGHT} x2={width - 8} y2={CHART_HEIGHT} stroke={C.border} strokeWidth={1} />
      </svg>
    </div>
  );
}

interface Props { token: string; role: string; kpiName: string; releaseName: string; onBack: () => void; autoOpenDrilldown?: boolean; }

export const KpiDetailView: React.FC<Props> = ({ token, role, kpiName, releaseName, onBack, autoOpenDrilldown }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const [data, setData] = useState<KpiDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [releaseCount] = useReleaseCount();

  // Defect-level drill-down only exists for releases with a real linked QC/
  // Oracle release — most historical releases here are Excel-only rows with
  // no defect source to drill into.
  const [qcLink, setQcLink] = useState<{ versionId: string; hasQcData: boolean } | null>(null);
  const [defects, setDefects] = useState<any[] | null>(null);
  const [showDefects, setShowDefects] = useState(false);
  const [defectsLoading, setDefectsLoading] = useState(false);
  const [defectsError, setDefectsError] = useState<string | null>(null);
  const [severityFilter, setSeverityFilter] = useState<string | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [defectColumns, setDefectColumns] = useState<DefectColumnKey[]>(() => {
    try {
      const saved = localStorage.getItem(DEFECT_COLUMNS_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore malformed storage */ }
    return DEFAULT_DEFECT_COLUMNS;
  });
  const applyDefectColumns = (keys: DefectColumnKey[]) => {
    setDefectColumns(keys);
    try { localStorage.setItem(DEFECT_COLUMNS_STORAGE_KEY, JSON.stringify(keys)); } catch { /* ignore quota errors */ }
    setShowColumnPicker(false);
  };
  const visibleDefectColumns = defectColumns
    .map(key => DEFECT_COLUMNS.find(c => c.key === key))
    .filter((c): c is { key: DefectColumnKey; label: string } => !!c);

  useEffect(() => {
    setLoading(true);
    axios.get(`${API}/quality-hub/kpi-detail/${encodeURIComponent(kpiName)}/${encodeURIComponent(releaseName)}`, { headers })
      .then(res => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiName, releaseName, token]);

  useEffect(() => {
    setQcLink(null);
    setShowDefects(false);
    setDefects(null);
    setDefectsError(null);
    axios.get(`${API}/quality-hub/qc-link/${encodeURIComponent(releaseName)}`, { headers })
      .then(res => setQcLink(res.data))
      .catch(() => setQcLink(null));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [releaseName, token]);

  // These two are time-average metrics (resolution time), not a "which
  // defects count" filter — there's no meaningful filtered list for them, so
  // the drill-down button is hidden entirely rather than showing an
  // unfiltered (i.e. wrong) list under their name.
  const KPI_WITHOUT_DEFECT_LIST = ['Average Time Resolved Defect KPI', 'Defect Resolution Time KPI'];
  const hasDefectDrillDown = !KPI_WITHOUT_DEFECT_LIST.includes(kpiName);

  const ensureDefectsLoaded = () => {
    if (defects != null || defectsError || !qcLink?.versionId) return;
    setDefectsLoading(true);
    setDefectsError(null);
    axios.get(`${API}/qc/defects-by-kpi?versionId=${qcLink.versionId}&kpiName=${encodeURIComponent(kpiName)}`, { headers })
      .then(res => setDefects(res.data ?? []))
      .catch(e => setDefectsError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלות'))
      .finally(() => setDefectsLoading(false));
  };
  const toggleDefects = () => {
    if (showDefects) { setShowDefects(false); return; }
    setSeverityFilter(null);
    setShowDefects(true);
    ensureDefectsLoaded();
  };

  // Arrived here via a direct click on the matrix row's Total-Defects/
  // severity cell (KpiMatrixView) — skip the intermediate "🪲 צפה בתקלות"
  // click and land straight on the expanded list, same as if the user had
  // clicked it themselves. Guarded on qcLink resolving (async) and only
  // fires once, since toggleDefects() would otherwise re-collapse the list
  // if this effect re-ran after the user manually toggled it closed.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (!autoOpenDrilldown || autoOpenedRef.current) return;
    if (!qcLink?.hasQcData || !hasDefectDrillDown) return;
    autoOpenedRef.current = true;
    toggleDefects();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenDrilldown, qcLink, hasDefectDrillDown]);
  // Drill-down from a severity KpiCard (feedback 2026-09-14: "לאפשר דריל
  // מכל מקום שבו יש ספירה של תקלות לפי severity") — same defect list
  // toggleDefects already fetches (one KPI-scoped fetch either way), just
  // opened pre-filtered to that severity instead of showing everything.
  const showDefectsForSeverity = (severity: string) => {
    setSeverityFilter(severity);
    setShowDefects(true);
    ensureDefectsLoaded();
  };

  const canEditImprovements = NOTE_EDITOR_ROLES.includes(role);

  // ── AI-suggested analysis — draft only, never auto-saved ─────────────────
  const [aiSuggestedNotes, setAiSuggestedNotes] = useState<{ problemCharacteristics: string; defectCount: number | null }[] | null>(null);
  const [aiSuggestedTasks, setAiSuggestedTasks] = useState<{ requiredImprovement: string; mainDevelopments: string | null; responsibility: string | null }[] | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    setAiSuggestedNotes(null);
    setAiSuggestedTasks(null);
    setAiError(null);
  }, [kpiName, releaseName]);

  const runAiSuggest = async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await axios.post(`${API}/quality-hub/kpi-detail/${encodeURIComponent(kpiName)}/${encodeURIComponent(releaseName)}/ai-suggest`, {}, { headers });
      setAiSuggestedNotes(res.data.problemNotes ?? []);
      setAiSuggestedTasks(res.data.improvementTasks ?? []);
    } catch (e: any) {
      setAiError(e?.response?.data?.message || e.message || 'שגיאה בהרצת הניתוח');
    } finally {
      setAiLoading(false);
    }
  };

  const acceptAiNote = async (idx: number) => {
    const n = aiSuggestedNotes?.[idx];
    if (!n) return;
    await axios.post(`${API}/quality-hub/problem-notes`, { releaseName, kpiName, ...n }, { headers });
    setAiSuggestedNotes(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
    loadNotes();
  };

  const acceptAiTask = async (idx: number) => {
    const t = aiSuggestedTasks?.[idx];
    if (!t) return;
    await axios.post(`${API}/quality-hub/improvement-tasks`, { releaseName, kpiName, ...t }, { headers });
    setAiSuggestedTasks(prev => prev ? prev.filter((_, i) => i !== idx) : prev);
    loadTasks();
  };

  // ── Problem notes — point-in-time diagnosis for this release+KPI ─────────
  const [notes, setNotes] = useState<ProblemNote[] | null>(null);
  const [notesLoading, setNotesLoading] = useState(true);
  const [editingNoteId, setEditingNoteId] = useState<string | 'new' | null>(null);
  const [noteDraft, setNoteDraft] = useState<ProblemDraft>(EMPTY_PROBLEM_DRAFT);
  const [savingNoteRow, setSavingNoteRow] = useState(false);

  const loadNotes = () => {
    setNotesLoading(true);
    axios.get(`${API}/quality-hub/problem-notes`, { headers, params: { releaseName, kpiName } })
      .then(res => setNotes(res.data ?? []))
      .catch(() => setNotes([]))
      .finally(() => setNotesLoading(false));
  };

  useEffect(() => {
    loadNotes();
    setEditingNoteId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiName, releaseName, token]);

  // Pre-fill from the real, already-computed total (live if we have it,
  // otherwise the imported figure) — the count shouldn't be retyped by hand
  // when it's already on screen two sections up; still editable afterward.
  const startAddNote = () => {
    const s = data?.liveSeverity ?? data?.severity;
    const total = s ? (s.showStopper ?? 0) + (s.severe ?? 0) + (s.medium ?? 0) + (s.low ?? 0) : null;
    setNoteDraft({ ...EMPTY_PROBLEM_DRAFT, defectCount: total != null ? String(total) : '' });
    setEditingNoteId('new');
  };

  const startEditNote = (note: ProblemNote) => {
    setNoteDraft({
      problemCharacteristics: note.problemCharacteristics ?? '',
      defectCount: note.defectCount != null ? String(note.defectCount) : '',
    });
    setEditingNoteId(note.id);
  };

  const saveNoteRow = async () => {
    setSavingNoteRow(true);
    const payload = {
      problemCharacteristics: noteDraft.problemCharacteristics || null,
      defectCount: noteDraft.defectCount.trim() !== '' ? Number(noteDraft.defectCount) : null,
    };
    try {
      if (editingNoteId === 'new') {
        await axios.post(`${API}/quality-hub/problem-notes`, { releaseName, kpiName, ...payload }, { headers });
      } else if (editingNoteId) {
        await axios.patch(`${API}/quality-hub/problem-notes/${editingNoteId}`, payload, { headers });
      }
      setEditingNoteId(null);
      loadNotes();
    } finally {
      setSavingNoteRow(false);
    }
  };

  const deleteNote = async (id: string) => {
    if (!window.confirm('למחוק שורה זו?')) return;
    await axios.delete(`${API}/quality-hub/problem-notes/${id}`, { headers });
    loadNotes();
  };

  // ── Improvement tasks — longer-lived, status-tracked action items ────────
  const [tasks, setTasks] = useState<ImprovementTask[] | null>(null);
  const [tasksLoading, setTasksLoading] = useState(true);
  const [editingTaskId, setEditingTaskId] = useState<string | 'new' | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(EMPTY_TASK_DRAFT);
  const [savingTask, setSavingTask] = useState(false);

  const loadTasks = () => {
    setTasksLoading(true);
    axios.get(`${API}/quality-hub/improvement-tasks`, { headers, params: { releaseName, kpiName } })
      .then(res => setTasks(res.data ?? []))
      .catch(() => setTasks([]))
      .finally(() => setTasksLoading(false));
  };

  useEffect(() => {
    loadTasks();
    setEditingTaskId(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kpiName, releaseName, token]);

  const startAddTask = () => {
    setTaskDraft(EMPTY_TASK_DRAFT);
    setEditingTaskId('new');
  };

  const startEditTask = (task: ImprovementTask) => {
    setTaskDraft({
      responsibility: task.responsibility ?? '',
      requiredImprovement: task.requiredImprovement ?? '',
      mainDevelopments: task.mainDevelopments ?? '',
      status: task.status,
    });
    setEditingTaskId(task.id);
  };

  const saveTask = async () => {
    setSavingTask(true);
    const payload = {
      responsibility: taskDraft.responsibility || null,
      requiredImprovement: taskDraft.requiredImprovement || null,
      mainDevelopments: taskDraft.mainDevelopments || null,
      status: taskDraft.status,
    };
    try {
      if (editingTaskId === 'new') {
        await axios.post(`${API}/quality-hub/improvement-tasks`, { releaseName, kpiName, ...payload }, { headers });
      } else if (editingTaskId) {
        await axios.patch(`${API}/quality-hub/improvement-tasks/${editingTaskId}`, payload, { headers });
      }
      setEditingTaskId(null);
      loadTasks();
    } finally {
      setSavingTask(false);
    }
  };

  const deleteTask = async (id: string) => {
    if (!window.confirm('למחוק שורה זו?')) return;
    await axios.delete(`${API}/quality-hub/improvement-tasks/${id}`, { headers });
    loadTasks();
  };

  const scoreColor = (pct: number | null) => {
    if (pct == null) return C.textMuted;
    if (pct >= 90) return C.success;
    if (pct >= 70) return '#e8af00';
    return C.danger;
  };

  return (
    <div dir="rtl" className="flex flex-col gap-4 font-sans">
      <div className="flex flex-col gap-1.5">
        <BackLink onClick={onBack} label="חזרה למטריצה" />
        <div className="text-lg font-bold text-foreground">🔍 {kpiName} — {releaseName}</div>
      </div>

      {loading ? (
        <div className="p-6 text-sm text-subtle-foreground">טוען...</div>
      ) : !data ? (
        <div className="p-6 text-sm text-subtle-foreground">לא ניתן לטעון נתונים.</div>
      ) : (
        <>
          {data.definition.purpose && (
            <div className="rounded-md bg-muted p-3 text-sm text-muted-foreground">
              {data.definition.purpose}{data.definition.description ? ` — ${data.definition.description}` : ''}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border bg-card">
            <table className="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr className="bg-muted">
                  {['Target', 'Grade', 'Weight', 'Relative Score', 'Score', 'Difference score', 'Average (Year)', 'Total Defects', 'Show Stopper', 'Severe', 'Medium', 'Low'].map(h => (
                    <th key={h} className="whitespace-nowrap border-b-2 border-border px-2 py-2.5 text-center font-bold text-muted-foreground">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className={summaryCellClass}>{fmtGradeOrPct(data.target, data.definition.kpiType)}</td>
                  <td className={summaryCellClass}>{fmtGradeOrPct(data.grade, data.definition.kpiType)}</td>
                  <td className={summaryCellClass}>{`${(data.weight * 100).toFixed(2)}%`}</td>
                  <td className={`${summaryCellClass} font-bold`} style={{ color: scoreColor(data.relativeScorePct) }}>{fmtPct(data.relativeScorePct)}</td>
                  <td className={summaryCellClass}>{fmtPct(data.contributionPct)}</td>
                  <td className={`${summaryCellClass} font-bold`} style={{ color: data.scoreLostPct != null && data.scoreLostPct < 0 ? C.danger : C.success }}>{fmtPct(data.scoreLostPct)}</td>
                  <td className={summaryCellClass}>{fmtGradeOrPct(data.yearAverageGrade, data.definition.kpiType)}</td>
                  <td className={`${summaryCellClass} font-bold`}>
                    {fmtCount((data.severity.showStopper ?? 0) + (data.severity.severe ?? 0) + (data.severity.medium ?? 0) + (data.severity.low ?? 0))}
                  </td>
                  <td className={summaryCellClass} style={{ color: C.danger }}>{fmtCount(data.severity.showStopper)}</td>
                  <td className={summaryCellClass} style={{ color: '#e8af00' }}>{fmtCount(data.severity.severe)}</td>
                  <td className={summaryCellClass}>{fmtCount(data.severity.medium)}</td>
                  <td className={summaryCellClass}>{fmtCount(data.severity.low)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {data.liveSeverity && (
            <div className="flex flex-col gap-1.5">
              <div className="text-xs text-subtle-foreground">
                לצורך השוואה — מחושב חי מרשימת התקלות האמיתית של {releaseName} (לא מהקובץ המיובא):
              </div>
              <div className="flex flex-wrap gap-3">
                <KpiCard
                  value={fmtCount(
                    data.liveSeverity.showStopper + data.liveSeverity.severe + data.liveSeverity.medium + data.liveSeverity.low
                  )}
                  label='סה"כ תקלות (חי)'
                  onClick={qcLink?.hasQcData && hasDefectDrillDown ? toggleDefects : undefined}
                />
                <KpiCard
                  value={fmtCount(data.liveSeverity.showStopper)} label="Show Stopper (חי)" valueColor={C.danger}
                  onClick={qcLink?.hasQcData && hasDefectDrillDown ? () => showDefectsForSeverity('Show Stopper') : undefined}
                />
                <KpiCard
                  value={fmtCount(data.liveSeverity.severe)} label="Severe (חי)" valueColor="#e8af00"
                  onClick={qcLink?.hasQcData && hasDefectDrillDown ? () => showDefectsForSeverity('Severe') : undefined}
                />
                <KpiCard
                  value={fmtCount(data.liveSeverity.medium)} label="Medium (חי)"
                  onClick={qcLink?.hasQcData && hasDefectDrillDown ? () => showDefectsForSeverity('Medium') : undefined}
                />
                <KpiCard
                  value={fmtCount(data.liveSeverity.low)} label="Low (חי)"
                  onClick={qcLink?.hasQcData && hasDefectDrillDown ? () => showDefectsForSeverity('Low') : undefined}
                />
              </div>
            </div>
          )}

          {qcLink?.hasQcData && hasDefectDrillDown && (
            <div className="rounded-lg border border-border bg-card p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-muted-foreground">
                  תקלות (QC) — מסונן לפי {kpiName} — {releaseName}{severityFilter ? ` · ${severityFilter}` : ''}
                </div>
                <div className="flex gap-2">
                  {showDefects && severityFilter && (
                    <button
                      onClick={() => setSeverityFilter(null)}
                      className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-sans text-xs font-semibold text-muted-foreground"
                    >
                      ✕ נקה סינון חומרה
                    </button>
                  )}
                  {showDefects && (
                    <button
                      onClick={() => setShowColumnPicker(true)}
                      className="cursor-pointer rounded-md border border-border bg-muted px-3.5 py-1.5 font-sans text-xs font-semibold text-muted-foreground"
                    >
                      ⚙ בחירת עמודות
                    </button>
                  )}
                  <button
                    onClick={toggleDefects}
                    className="cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 font-sans text-xs font-semibold text-primary-foreground"
                  >
                    {showDefects ? 'הסתר' : '🪲 צפה בתקלות'}
                  </button>
                </div>
              </div>
              {showDefects && (
                <div className="mt-3 overflow-x-auto">
                  {defectsLoading ? (
                    <div className="p-3 text-xs text-subtle-foreground">טוען...</div>
                  ) : defectsError ? (
                    <div className="p-3 text-xs text-danger">⚠️ שגיאה בטעינת התקלות: {defectsError}</div>
                  ) : !defects || defects.length === 0 ? (
                    <div className="p-3 text-xs text-subtle-foreground">אין תקלות זמינות לגרסה זו</div>
                  ) : (() => {
                    const filteredDefects = severityFilter ? defects.filter(d => d.severity === severityFilter) : defects;
                    if (filteredDefects.length === 0) {
                      return <div className="p-3 text-xs text-subtle-foreground">אין תקלות בחומרה {severityFilter}</div>;
                    }
                    return (
                    <div className="overflow-hidden rounded-md bg-card" style={{ border: `1px solid ${JIRA.greyN40}` }}>
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr>
                            {visibleDefectColumns.map(c => (
                              <th
                                key={c.key}
                                className="px-2 py-2 text-end text-[11px] font-bold tracking-wide"
                                style={{ color: JIRA.textSubtle, borderBottom: `2px solid ${JIRA.greyN40}` }}
                              >{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {filteredDefects.map(d => (
                            <tr key={d.id}>
                              {visibleDefectColumns.map(c => {
                                const isBadge = PERSON_BADGE_FIELDS.has(c.key) || TEAM_BADGE_FIELDS.has(c.key);
                                const isCentered = c.key === 'id' || c.key === 'severity' || c.key === 'status' || c.key === 'priority' || c.key === 'reopenYn';
                                const raw = String(d[c.key] ?? '');
                                const rtl = isBadge || isCentered ? false : hasHebrew(raw);
                                return (
                                  <td
                                    key={c.key}
                                    style={{
                                      padding: '7px 8px', borderBottom: `1px solid ${JIRA.greyN40}`, color: isBadge || c.key === 'severity' || c.key === 'id' || c.key === 'priority' ? undefined : JIRA.text,
                                      textAlign: isCentered ? 'center' : (rtl ? 'right' : 'left'), direction: isCentered ? undefined : (rtl ? 'rtl' : 'ltr'),
                                    }}
                                  >
                                    {renderDefectCell(c.key, d[c.key])}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    );
                  })()}
                </div>
              )}
            </div>
          )}

          {showColumnPicker && (
            <SelectColumnsDialog
              allColumns={DEFECT_COLUMNS}
              visibleKeys={defectColumns}
              onApply={applyDefectColumns}
              onClose={() => setShowColumnPicker(false)}
            />
          )}

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 text-sm font-semibold text-muted-foreground">
              מגמת ערך בפועל (Grade) לאורך גרסאות — {releaseCount} הגרסאות האחרונות
            </div>
            <GradeTrendChart points={data.trend.slice(-releaseCount)} />
          </div>

          {/* ── AI-suggested analysis (draft only) ── */}
          {qcLink?.hasQcData && hasDefectDrillDown && canEditImprovements && (
            <div className="rounded-lg bg-card p-4" style={{ border: `1px solid ${C.brand}40` }}>
              <div className="flex items-center justify-between">
                <div className="text-sm font-semibold text-muted-foreground">🤖 ניתוח AI (טיוטה בלבד — לא נשמר אוטומטית)</div>
                <button
                  onClick={runAiSuggest}
                  disabled={aiLoading}
                  className={`cursor-pointer rounded-md border-none bg-primary px-3.5 py-1.5 font-sans text-xs font-semibold text-primary-foreground ${aiLoading ? 'opacity-60' : 'opacity-100'}`}
                >
                  {aiLoading ? 'מנתח...' : '🤖 הצע ניתוח'}
                </button>
              </div>

              {aiError && (
                <div className="mt-2 text-xs text-danger">⚠️ {aiError}</div>
              )}

              {(aiSuggestedNotes || aiSuggestedTasks) && (
                <div className="mt-3 flex flex-col gap-3">
                  {aiSuggestedNotes && aiSuggestedNotes.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-semibold text-subtle-foreground">מאפייני בעיות מוצעים:</div>
                      {aiSuggestedNotes.map((n, idx) => (
                        <div key={idx} className="mb-1.5 flex items-start gap-2.5 rounded-sm bg-muted px-2.5 py-2">
                          <div className="flex-1 text-xs text-foreground">{n.problemCharacteristics} {n.defectCount != null && <span className="text-subtle-foreground">({n.defectCount} תקלות)</span>}</div>
                          <button onClick={() => acceptAiNote(idx)} className={`${iconBtnClass} whitespace-nowrap font-semibold text-success`}>✓ הוסף</button>
                          <button onClick={() => setAiSuggestedNotes(prev => prev ? prev.filter((_, i) => i !== idx) : prev)} className={`${iconBtnClass} whitespace-nowrap text-subtle-foreground`}>✗ התעלם</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiSuggestedTasks && aiSuggestedTasks.length > 0 && (
                    <div>
                      <div className="mb-1.5 text-xs font-semibold text-subtle-foreground">משימות שיפור מוצעות:</div>
                      {aiSuggestedTasks.map((t, idx) => (
                        <div key={idx} className="mb-1.5 flex items-start gap-2.5 rounded-sm bg-muted px-2.5 py-2">
                          <div className="flex-1 text-xs text-foreground">
                            {t.requiredImprovement}
                            {t.mainDevelopments && <div className="mt-0.5 text-subtle-foreground">{t.mainDevelopments}</div>}
                            {t.responsibility && <div className="mt-0.5 text-subtle-foreground">אחריות מוצעת: {t.responsibility}</div>}
                          </div>
                          <button onClick={() => acceptAiTask(idx)} className={`${iconBtnClass} whitespace-nowrap font-semibold text-success`}>✓ הוסף</button>
                          <button onClick={() => setAiSuggestedTasks(prev => prev ? prev.filter((_, i) => i !== idx) : prev)} className={`${iconBtnClass} whitespace-nowrap text-subtle-foreground`}>✗ התעלם</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiSuggestedNotes?.length === 0 && aiSuggestedTasks?.length === 0 && (
                    <div className="text-xs text-subtle-foreground">ה-AI לא זיהה דפוסים ברורים ברשימת התקלות.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Problem notes ── */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-muted-foreground">מאפייני הבעיות</div>
              {canEditImprovements && editingNoteId === null && (
                <button
                  onClick={startAddNote}
                  className="cursor-pointer rounded-md border border-border bg-muted px-3 py-1 font-sans text-xs font-semibold text-muted-foreground"
                >
                  + הוסף שורה
                </button>
              )}
            </div>

            {notesLoading ? (
              <div className="p-2 text-xs text-subtle-foreground">טוען...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[480px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted">
                      {['מאפייני הבעיות', 'סה"כ תקלות', ''].map(h => (
                        <th key={h} className="border-b border-border px-2 py-1.5 text-end font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {notes && notes.map(note => editingNoteId === note.id ? (
                      <ProblemNoteEditRow key={note.id} draft={noteDraft} setDraft={setNoteDraft} saving={savingNoteRow} onSave={saveNoteRow} onCancel={() => setEditingNoteId(null)} />
                    ) : (
                      <tr key={note.id}>
                        <td className={`${itemCellClass} whitespace-pre-wrap`}>{note.problemCharacteristics || '—'}</td>
                        <td className={`${itemCellClass} text-center`}>{note.defectCount ?? '—'}</td>
                        <td className={`${itemCellClass} whitespace-nowrap`}>
                          {canEditImprovements && editingNoteId === null && (
                            <>
                              <button onClick={() => startEditNote(note)} className={iconBtnClass} title="ערוך">✏️</button>
                              <button onClick={() => deleteNote(note.id)} className={iconBtnClass} title="מחק">🗑</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {editingNoteId === 'new' && (
                      <ProblemNoteEditRow draft={noteDraft} setDraft={setNoteDraft} saving={savingNoteRow} onSave={saveNoteRow} onCancel={() => setEditingNoteId(null)} />
                    )}
                    {(!notes || notes.length === 0) && editingNoteId !== 'new' && (
                      <tr>
                        <td colSpan={3} className="p-3 text-center text-xs text-subtle-foreground">עדיין אין שורות</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Improvement tasks ── */}
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-muted-foreground">משימות שיפור</div>
              {canEditImprovements && editingTaskId === null && (
                <button
                  onClick={startAddTask}
                  className="cursor-pointer rounded-md border border-border bg-muted px-3 py-1 font-sans text-xs font-semibold text-muted-foreground"
                >
                  + הוסף שורה
                </button>
              )}
            </div>

            {tasksLoading ? (
              <div className="p-2 text-xs text-subtle-foreground">טוען...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted">
                      {['שיפורים נדרשים', 'פיתוחים עיקריים', 'אחריות', 'סטטוס', ''].map(h => (
                        <th key={h} className="border-b border-border px-2 py-1.5 text-end font-semibold text-muted-foreground">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tasks && tasks.map(task => editingTaskId === task.id ? (
                      <ImprovementTaskEditRow key={task.id} draft={taskDraft} setDraft={setTaskDraft} saving={savingTask} onSave={saveTask} onCancel={() => setEditingTaskId(null)} />
                    ) : (
                      <tr key={task.id}>
                        <td className={`${itemCellClass} whitespace-pre-wrap`}>{task.requiredImprovement || '—'}</td>
                        <td className={`${itemCellClass} whitespace-pre-wrap`}>{task.mainDevelopments || '—'}</td>
                        <td className={itemCellClass}>{task.responsibility || '—'}</td>
                        <td className={itemCellClass}>
                          <span className="font-semibold" style={{ color: statusLabel(task.status).color }}>{statusLabel(task.status).label}</span>
                        </td>
                        <td className={`${itemCellClass} whitespace-nowrap`}>
                          {canEditImprovements && editingTaskId === null && (
                            <>
                              <button onClick={() => startEditTask(task)} className={iconBtnClass} title="ערוך">✏️</button>
                              <button onClick={() => deleteTask(task.id)} className={iconBtnClass} title="מחק">🗑</button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                    {editingTaskId === 'new' && (
                      <ImprovementTaskEditRow draft={taskDraft} setDraft={setTaskDraft} saving={savingTask} onSave={saveTask} onCancel={() => setEditingTaskId(null)} />
                    )}
                    {(!tasks || tasks.length === 0) && editingTaskId !== 'new' && (
                      <tr>
                        <td colSpan={5} className="p-3 text-center text-xs text-subtle-foreground">עדיין אין שורות</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};
