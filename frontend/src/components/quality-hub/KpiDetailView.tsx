import React, { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS } from '../../theme';
import { useReleaseCount } from './releaseCountSetting';

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
      style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: '14px 16px', flex: 1, minWidth: '140px', cursor: onClick ? 'pointer' : undefined }}
    >
      <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: valueColor ?? C.textPrimary, lineHeight: 1.2 }}>{value}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>{label}</div>
    </div>
  );
}

const summaryCellStyle: React.CSSProperties = { padding: '12px 8px', textAlign: 'center', color: C.textPrimary, fontWeight: WEIGHT.semibold };
const itemCellStyle: React.CSSProperties = { padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textPrimary, verticalAlign: 'top' };
const iconBtnStyle: React.CSSProperties = { background: 'none', border: 'none', cursor: 'pointer', fontSize: '13px', padding: '2px 4px' };
const itemInputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '4px 6px', borderRadius: RADIUS.sm, border: `1px solid ${C.borderEm}`, background: C.bgCard, color: C.textPrimary, fontFamily: FONT, fontSize: '12px' };
const itemTextareaStyle: React.CSSProperties = { ...itemInputStyle, resize: 'vertical', minHeight: '48px' };

function ProblemNoteEditRow({ draft, setDraft, saving, onSave, onCancel }: {
  draft: ProblemDraft; setDraft: React.Dispatch<React.SetStateAction<ProblemDraft>>;
  saving: boolean; onSave: () => void; onCancel: () => void;
}) {
  const set = (patch: Partial<ProblemDraft>) => setDraft(prev => ({ ...prev, ...patch }));
  return (
    <tr style={{ background: C.bgNested }}>
      <td style={itemCellStyle}><textarea rows={2} style={itemTextareaStyle} value={draft.problemCharacteristics} onChange={e => set({ problemCharacteristics: e.target.value })} /></td>
      <td style={itemCellStyle}><input style={{ ...itemInputStyle, textAlign: 'center' }} type="number" value={draft.defectCount} onChange={e => set({ defectCount: e.target.value })} /></td>
      <td style={{ ...itemCellStyle, whiteSpace: 'nowrap' }}>
        <button onClick={onSave} disabled={saving} style={{ ...iconBtnStyle, color: C.brand, fontWeight: WEIGHT.semibold, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
        <button onClick={onCancel} disabled={saving} style={{ ...iconBtnStyle, color: C.textMuted }}>ביטול</button>
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
    <tr style={{ background: C.bgNested }}>
      <td style={itemCellStyle}><textarea rows={2} style={itemTextareaStyle} value={draft.requiredImprovement} onChange={e => set({ requiredImprovement: e.target.value })} /></td>
      <td style={itemCellStyle}><textarea rows={2} style={itemTextareaStyle} value={draft.mainDevelopments} onChange={e => set({ mainDevelopments: e.target.value })} /></td>
      <td style={itemCellStyle}><input style={itemInputStyle} value={draft.responsibility} onChange={e => set({ responsibility: e.target.value })} /></td>
      <td style={itemCellStyle}>
        <select style={itemInputStyle} value={draft.status} onChange={e => set({ status: e.target.value })}>
          {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </td>
      <td style={{ ...itemCellStyle, whiteSpace: 'nowrap' }}>
        <button onClick={onSave} disabled={saving} style={{ ...iconBtnStyle, color: C.brand, fontWeight: WEIGHT.semibold, opacity: saving ? 0.6 : 1 }}>{saving ? '...' : 'שמור'}</button>
        <button onClick={onCancel} disabled={saving} style={{ ...iconBtnStyle, color: C.textMuted }}>ביטול</button>
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
    return <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6], textAlign: 'center' }}>אין נתונים להצגה.</div>;
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
    <div ref={containerRef} style={{ overflowX: 'auto', width: '100%' }}>
      <svg width={width} height={CHART_HEIGHT + 40} style={{ display: 'block' }}>
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

interface Props { token: string; role: string; kpiName: string; releaseName: string; onBack: () => void; }

export const KpiDetailView: React.FC<Props> = ({ token, role, kpiName, releaseName, onBack }) => {
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

  const toggleDefects = () => {
    if (showDefects) { setShowDefects(false); return; }
    setShowDefects(true);
    if (defects != null || defectsError || !qcLink?.versionId) return;
    setDefectsLoading(true);
    setDefectsError(null);
    axios.get(`${API}/qc/defects-by-kpi?versionId=${qcLink.versionId}&kpiName=${encodeURIComponent(kpiName)}`, { headers })
      .then(res => setDefects(res.data ?? []))
      .catch(e => setDefectsError(e?.response?.data?.message || e.message || 'שגיאה בטעינת התקלות'))
      .finally(() => setDefectsLoading(false));
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
    <div style={{ fontFamily: FONT, direction: 'rtl', display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔍 {kpiName} — {releaseName}</div>
        <button
          onClick={onBack}
          style={{ padding: '8px 16px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textSecondary, ...TEXT.sm, fontWeight: WEIGHT.semibold }}
        >
          → חזרה למטריצה
        </button>
      </div>

      {loading ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>טוען...</div>
      ) : !data ? (
        <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[6] }}>לא ניתן לטעון נתונים.</div>
      ) : (
        <>
          {data.definition.purpose && (
            <div style={{ ...TEXT.sm, color: C.textSecondary, background: C.bgNested, borderRadius: RADIUS.md, padding: SP[3] }}>
              {data.definition.purpose}{data.definition.description ? ` — ${data.definition.description}` : ''}
            </div>
          )}

          <div style={{ overflowX: 'auto', background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.sm, minWidth: '760px' }}>
              <thead>
                <tr style={{ background: C.bgNested }}>
                  {['Target', 'Grade', 'Weight', 'Relative Score', 'Score', 'Difference score', 'Average (Year)', 'Total Defects', 'Show Stopper', 'Severe', 'Medium', 'Low'].map(h => (
                    <th key={h} style={{ padding: '10px 8px', textAlign: 'center', fontWeight: WEIGHT.bold, color: C.textSecondary, borderBottom: `2px solid ${C.border}`, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={summaryCellStyle}>{fmtGradeOrPct(data.target, data.definition.kpiType)}</td>
                  <td style={summaryCellStyle}>{fmtGradeOrPct(data.grade, data.definition.kpiType)}</td>
                  <td style={summaryCellStyle}>{`${(data.weight * 100).toFixed(2)}%`}</td>
                  <td style={{ ...summaryCellStyle, color: scoreColor(data.relativeScorePct), fontWeight: WEIGHT.bold }}>{fmtPct(data.relativeScorePct)}</td>
                  <td style={summaryCellStyle}>{fmtPct(data.contributionPct)}</td>
                  <td style={{ ...summaryCellStyle, color: data.scoreLostPct != null && data.scoreLostPct < 0 ? C.danger : C.success, fontWeight: WEIGHT.bold }}>{fmtPct(data.scoreLostPct)}</td>
                  <td style={summaryCellStyle}>{fmtGradeOrPct(data.yearAverageGrade, data.definition.kpiType)}</td>
                  <td style={{ ...summaryCellStyle, fontWeight: WEIGHT.bold }}>
                    {fmtCount((data.severity.showStopper ?? 0) + (data.severity.severe ?? 0) + (data.severity.medium ?? 0) + (data.severity.low ?? 0))}
                  </td>
                  <td style={{ ...summaryCellStyle, color: C.danger }}>{fmtCount(data.severity.showStopper)}</td>
                  <td style={{ ...summaryCellStyle, color: '#e8af00' }}>{fmtCount(data.severity.severe)}</td>
                  <td style={summaryCellStyle}>{fmtCount(data.severity.medium)}</td>
                  <td style={summaryCellStyle}>{fmtCount(data.severity.low)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {data.liveSeverity && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ ...TEXT.xs, color: C.textMuted }}>
                לצורך השוואה — מחושב חי מרשימת התקלות האמיתית של {releaseName} (לא מהקובץ המיובא):
              </div>
              <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap' }}>
                <KpiCard
                  value={fmtCount(
                    data.liveSeverity.showStopper + data.liveSeverity.severe + data.liveSeverity.medium + data.liveSeverity.low
                  )}
                  label='סה"כ תקלות (חי)'
                  onClick={qcLink?.hasQcData && hasDefectDrillDown ? toggleDefects : undefined}
                />
                <KpiCard value={fmtCount(data.liveSeverity.showStopper)} label="Show Stopper (חי)" valueColor={C.danger} />
                <KpiCard value={fmtCount(data.liveSeverity.severe)} label="Severe (חי)" valueColor="#e8af00" />
                <KpiCard value={fmtCount(data.liveSeverity.medium)} label="Medium (חי)" />
                <KpiCard value={fmtCount(data.liveSeverity.low)} label="Low (חי)" />
              </div>
            </div>
          )}

          {qcLink?.hasQcData && hasDefectDrillDown && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>תקלות (QC) — מסונן לפי {kpiName} — {releaseName}</div>
                <button
                  onClick={toggleDefects}
                  style={{ padding: '6px 14px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                >
                  {showDefects ? 'הסתר' : '🐛 צפה בתקלות'}
                </button>
              </div>
              {showDefects && (
                <div style={{ marginTop: SP[3], overflowX: 'auto' }}>
                  {defectsLoading ? (
                    <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[3] }}>טוען...</div>
                  ) : defectsError ? (
                    <div style={{ ...TEXT.xs, color: C.danger, padding: SP[3] }}>⚠️ שגיאה בטעינת התקלות: {defectsError}</div>
                  ) : !defects || defects.length === 0 ? (
                    <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[3] }}>אין תקלות זמינות לגרסה זו</div>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs }}>
                      <thead>
                        <tr style={{ background: C.bgNested }}>
                          {['תקלה', 'כותרת', 'חומרה', 'סטטוס', 'אחראי', 'תאריך גילוי'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {defects.map(d => (
                          <tr key={d.id}>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}`, color: C.textLink, fontWeight: WEIGHT.semibold }}>{d.id}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.title}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.severity}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.status}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.assignedTo}</td>
                            <td style={{ padding: '6px 8px', borderBottom: `1px solid ${C.border}` }}>{d.discoveryDate}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          )}

          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: SP[3] }}>
              מגמת ערך בפועל (Grade) לאורך גרסאות — {releaseCount} הגרסאות האחרונות
            </div>
            <GradeTrendChart points={data.trend.slice(-releaseCount)} />
          </div>

          {/* ── AI-suggested analysis (draft only) ── */}
          {qcLink?.hasQcData && hasDefectDrillDown && canEditImprovements && (
            <div style={{ background: C.bgCard, border: `1px solid ${C.brand}40`, borderRadius: RADIUS.lg, padding: SP[4] }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>🤖 ניתוח AI (טיוטה בלבד — לא נשמר אוטומטית)</div>
                <button
                  onClick={runAiSuggest}
                  disabled={aiLoading}
                  style={{ padding: '6px 14px', background: C.brand, color: '#fff', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold, opacity: aiLoading ? 0.6 : 1 }}
                >
                  {aiLoading ? 'מנתח...' : '🤖 הצע ניתוח'}
                </button>
              </div>

              {aiError && (
                <div style={{ ...TEXT.xs, color: C.danger, marginTop: SP[2] }}>⚠️ {aiError}</div>
              )}

              {(aiSuggestedNotes || aiSuggestedTasks) && (
                <div style={{ marginTop: SP[3], display: 'flex', flexDirection: 'column', gap: SP[3] }}>
                  {aiSuggestedNotes && aiSuggestedNotes.length > 0 && (
                    <div>
                      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted, marginBottom: '6px' }}>מאפייני בעיות מוצעים:</div>
                      {aiSuggestedNotes.map((n, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', background: C.bgNested, borderRadius: RADIUS.sm, marginBottom: '6px' }}>
                          <div style={{ flex: 1, ...TEXT.xs, color: C.textPrimary }}>{n.problemCharacteristics} {n.defectCount != null && <span style={{ color: C.textMuted }}>({n.defectCount} תקלות)</span>}</div>
                          <button onClick={() => acceptAiNote(idx)} style={{ ...iconBtnStyle, color: C.success, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' }}>✓ הוסף</button>
                          <button onClick={() => setAiSuggestedNotes(prev => prev ? prev.filter((_, i) => i !== idx) : prev)} style={{ ...iconBtnStyle, color: C.textMuted, whiteSpace: 'nowrap' }}>✗ התעלם</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiSuggestedTasks && aiSuggestedTasks.length > 0 && (
                    <div>
                      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted, marginBottom: '6px' }}>משימות שיפור מוצעות:</div>
                      {aiSuggestedTasks.map((t, idx) => (
                        <div key={idx} style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', padding: '8px 10px', background: C.bgNested, borderRadius: RADIUS.sm, marginBottom: '6px' }}>
                          <div style={{ flex: 1, ...TEXT.xs, color: C.textPrimary }}>
                            {t.requiredImprovement}
                            {t.mainDevelopments && <div style={{ color: C.textMuted, marginTop: '2px' }}>{t.mainDevelopments}</div>}
                            {t.responsibility && <div style={{ color: C.textMuted, marginTop: '2px' }}>אחריות מוצעת: {t.responsibility}</div>}
                          </div>
                          <button onClick={() => acceptAiTask(idx)} style={{ ...iconBtnStyle, color: C.success, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap' }}>✓ הוסף</button>
                          <button onClick={() => setAiSuggestedTasks(prev => prev ? prev.filter((_, i) => i !== idx) : prev)} style={{ ...iconBtnStyle, color: C.textMuted, whiteSpace: 'nowrap' }}>✗ התעלם</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {aiSuggestedNotes?.length === 0 && aiSuggestedTasks?.length === 0 && (
                    <div style={{ ...TEXT.xs, color: C.textMuted }}>ה-AI לא זיהה דפוסים ברורים ברשימת התקלות.</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Problem notes ── */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[3] }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>מאפייני הבעיות</div>
              {canEditImprovements && editingNoteId === null && (
                <button
                  onClick={startAddNote}
                  style={{ padding: '4px 12px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textSecondary, ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                >
                  + הוסף שורה
                </button>
              )}
            </div>

            {notesLoading ? (
              <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[2] }}>טוען...</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs, minWidth: '480px' }}>
                  <thead>
                    <tr style={{ background: C.bgNested }}>
                      {['מאפייני הבעיות', 'סה"כ תקלות', ''].map(h => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {notes && notes.map(note => editingNoteId === note.id ? (
                      <ProblemNoteEditRow key={note.id} draft={noteDraft} setDraft={setNoteDraft} saving={savingNoteRow} onSave={saveNoteRow} onCancel={() => setEditingNoteId(null)} />
                    ) : (
                      <tr key={note.id}>
                        <td style={{ ...itemCellStyle, whiteSpace: 'pre-wrap' }}>{note.problemCharacteristics || '—'}</td>
                        <td style={{ ...itemCellStyle, textAlign: 'center' }}>{note.defectCount ?? '—'}</td>
                        <td style={{ ...itemCellStyle, whiteSpace: 'nowrap' }}>
                          {canEditImprovements && editingNoteId === null && (
                            <>
                              <button onClick={() => startEditNote(note)} style={iconBtnStyle} title="ערוך">✏️</button>
                              <button onClick={() => deleteNote(note.id)} style={iconBtnStyle} title="מחק">🗑</button>
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
                        <td colSpan={3} style={{ ...TEXT.xs, color: C.textDisabled, textAlign: 'center', padding: SP[3] }}>עדיין אין שורות</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Improvement tasks ── */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4] }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: SP[3] }}>
              <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary }}>משימות שיפור</div>
              {canEditImprovements && editingTaskId === null && (
                <button
                  onClick={startAddTask}
                  style={{ padding: '4px 12px', background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', color: C.textSecondary, ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                >
                  + הוסף שורה
                </button>
              )}
            </div>

            {tasksLoading ? (
              <div style={{ ...TEXT.xs, color: C.textMuted, padding: SP[2] }}>טוען...</div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.xs, minWidth: '720px' }}>
                  <thead>
                    <tr style={{ background: C.bgNested }}>
                      {['שיפורים נדרשים', 'פיתוחים עיקריים', 'אחריות', 'סטטוס', ''].map(h => (
                        <th key={h} style={{ padding: '6px 8px', textAlign: 'right', fontWeight: WEIGHT.semibold, color: C.textSecondary, borderBottom: `1px solid ${C.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tasks && tasks.map(task => editingTaskId === task.id ? (
                      <ImprovementTaskEditRow key={task.id} draft={taskDraft} setDraft={setTaskDraft} saving={savingTask} onSave={saveTask} onCancel={() => setEditingTaskId(null)} />
                    ) : (
                      <tr key={task.id}>
                        <td style={{ ...itemCellStyle, whiteSpace: 'pre-wrap' }}>{task.requiredImprovement || '—'}</td>
                        <td style={{ ...itemCellStyle, whiteSpace: 'pre-wrap' }}>{task.mainDevelopments || '—'}</td>
                        <td style={itemCellStyle}>{task.responsibility || '—'}</td>
                        <td style={itemCellStyle}>
                          <span style={{ color: statusLabel(task.status).color, fontWeight: WEIGHT.semibold }}>{statusLabel(task.status).label}</span>
                        </td>
                        <td style={{ ...itemCellStyle, whiteSpace: 'nowrap' }}>
                          {canEditImprovements && editingTaskId === null && (
                            <>
                              <button onClick={() => startEditTask(task)} style={iconBtnStyle} title="ערוך">✏️</button>
                              <button onClick={() => deleteTask(task.id)} style={iconBtnStyle} title="מחק">🗑</button>
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
                        <td colSpan={5} style={{ ...TEXT.xs, color: C.textDisabled, textAlign: 'center', padding: SP[3] }}>עדיין אין שורות</td>
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
