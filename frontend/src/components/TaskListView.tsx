/**
 * TaskListView — Asana-style task list
 * Hierarchy: Phase (Section) → Sub-phase (Group) → Task (Row)
 * editable=true adds: "+ הוסף משימה" per sub-phase, delete on hover, full detail panel editing.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE, statusColor } from '../theme';
import { useDialog } from '../context/DialogContext';
import { Avatar, StatusChip, Spinner, VersionStatusChip } from './ui';
import { TaskDetailPanel } from './TaskDetailPanel';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Column widths ─────────────────────────────────────────────────────────────
const C_W = {
  expand:   30,
  duration: 82,
  start:    96,
  end:      96,
  due:      90,
  team:     114,
  assignee: 140,
  app:      98,
  deps:     100,
  status:   108,
  actions:  36, // delete btn — only in edit mode
};
const INDENT = 18;

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtTime = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDate = (iso: string) =>
  iso ? new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' }) : '';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Props {
  token: string;
  versionId: string;
  versionName: string;
  versionStatus: string;
  editable?: boolean;
  onVersionStatusChange?: () => void;
}

const NEXT_STATUS: Record<string, string> = {
  DRAFT: 'COLLECTING', COLLECTING: 'CR_REVIEW', CR_REVIEW: 'REFINING',
  REFINING: 'REVIEW', REVIEW: 'APPROVED', APPROVED: 'REHEARSAL',
};
const NEXT_LABEL: Record<string, string> = {
  DRAFT:      'פתח לאיסוף משימות →',
  COLLECTING: 'פתח לסקירת CRים →',
  CR_REVIEW:  'עבור לטיוב →',
  REFINING:   'פתח ישיבת מעבר →',
  REVIEW:     'אשר תוכנית →',
  APPROVED:   'התחל חזרה גנרלית →',
};
const BACK_STATUS: Record<string, string> = {
  COLLECTING: 'DRAFT', CR_REVIEW: 'COLLECTING', REFINING: 'CR_REVIEW',
  REVIEW: 'REFINING', APPROVED: 'REVIEW',
};
const BACK_LABEL: Record<string, string> = {
  COLLECTING: '← חזור לטיוטה', CR_REVIEW: '← חזור לאיסוף',
  REFINING: '← חזור לסקירת CR', REVIEW: '← חזור לטיוב', APPROVED: '← חזור לסקירה',
};

type RowKind = 'phase' | 'subphase' | 'task' | 'add';
interface FlatRow {
  id: string;
  kind: RowKind;
  depth: number;
  data: any;
  subPhaseId?: string; // for 'add' rows
}

// ── Column header ─────────────────────────────────────────────────────────────
const ColH: React.FC<{ label: string; width?: number; flex?: boolean; center?: boolean }> = ({ label, width, flex, center }) => (
  <div style={{
    width: width ? `${width}px` : undefined,
    flex: flex ? 1 : undefined, flexShrink: flex ? undefined : 0,
    padding: `0 ${SP[2]}`,
    ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textMuted, fontFamily: FONT,
    textAlign: (center ? 'center' : 'right') as any,
    textTransform: 'uppercase' as any, letterSpacing: '0.04em', whiteSpace: 'nowrap' as any,
  }}>
    {label}
  </div>
);

// ── Phase row (Section) ───────────────────────────────────────────────────────
const PhaseRow: React.FC<{ phase: any; isCollapsed: boolean; onToggle: () => void; editable: boolean }> = ({
  phase, isCollapsed, onToggle, editable,
}) => {
  const tasks = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
  const done  = tasks.filter((t: any) => t.status === 'DONE').length;
  const ENV_COLOR: Record<string, string> = { HOT: C.statusBlocked, HOTNET: C.statusOpen, BOTH: C.textSecondary };
  const envColor = ENV_COLOR[phase.environment] ?? C.textSecondary;
  return (
    <div onClick={onToggle} style={{
      display: 'flex', alignItems: 'center',
      padding: `${SP[2]} 0`,
      background: C.bgNested,
      borderTop: `2px solid ${C.border}`, borderBottom: `1px solid ${C.border}`,
      cursor: 'pointer', userSelect: 'none' as any, marginTop: SP[1],
    }}>
      <div style={{ width: `${C_W.expand}px`, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: C.textDisabled, display: 'inline-block', transition: EASE.fast, transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: SP[2], minWidth: 0 }}>
        <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, fontFamily: FONT }}>{phase.name}</span>
        {phase.environment && (
          <span style={{ ...TEXT.xs, color: envColor, background: envColor + '18', padding: '1px 7px', borderRadius: RADIUS.sm, fontFamily: FONT, flexShrink: 0 }}>
            {phase.environment}
          </span>
        )}
        <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{done}/{tasks.length}</span>
        <div style={{ width: '48px', height: '4px', background: C.bgHover, borderRadius: RADIUS.full, overflow: 'hidden', flexShrink: 0 }}>
          <div style={{
            width: tasks.length > 0 ? `${Math.round((done / tasks.length) * 100)}%` : '0%',
            height: '100%', background: done === tasks.length && tasks.length > 0 ? C.success : C.brand,
            borderRadius: RADIUS.full, transition: 'width 0.3s',
          }} />
        </div>
      </div>
      {editable && <div style={{ width: `${C_W.actions}px`, flexShrink: 0 }} />}
    </div>
  );
};

// ── Sub-phase row (Group) ─────────────────────────────────────────────────────
const SubPhaseRow: React.FC<{ sub: any; isCollapsed: boolean; onToggle: () => void; editable: boolean }> = ({
  sub, isCollapsed, onToggle, editable,
}) => {
  const tasks = sub.tasks || [];
  const done  = tasks.filter((t: any) => t.status === 'DONE').length;
  return (
    <div onClick={onToggle} style={{
      display: 'flex', alignItems: 'center',
      paddingRight: `${INDENT}px`, paddingTop: SP[1], paddingBottom: SP[1],
      borderBottom: `1px solid ${C.border}`, background: C.bgCard,
      cursor: 'pointer', userSelect: 'none' as any,
    }}>
      <div style={{ width: `${C_W.expand}px`, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <span style={{ fontSize: '9px', color: C.textDisabled, display: 'inline-block', transition: EASE.fast, transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}>▼</span>
      </div>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: SP[2] }}>
        <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textSecondary, fontFamily: FONT }}>{sub.name}</span>
        <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{done}/{tasks.length}</span>
      </div>
      {editable && <div style={{ width: `${C_W.actions}px`, flexShrink: 0 }} />}
    </div>
  );
};

// ── Task row ──────────────────────────────────────────────────────────────────
const TaskRow: React.FC<{
  task: any;
  depth: number;
  isSelected: boolean;
  editable: boolean;
  onClick: () => void;
  onDelete?: () => void;
}> = ({ task, depth, isSelected, editable, onClick, onDelete }) => {
  const [hov, setHov] = useState(false);
  const sColor = statusColor(task.status);
  const isDone = task.status === 'DONE';

  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'flex', alignItems: 'center', minHeight: '38px',
        background: isSelected ? C.bgActive : hov ? C.bgHover : C.bgCard,
        borderBottom: `1px solid ${C.border}`,
        borderRight: `3px solid ${sColor}`,
        cursor: 'pointer', transition: EASE.fast,
        paddingRight: `${INDENT * depth}px`,
      }}
    >
      {/* Circle checkbox */}
      <div style={{ width: `${C_W.expand}px`, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{
          width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0,
          border: `1.5px solid ${sColor}55`,
          background: isDone ? sColor + '20' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: EASE.fast,
        }}>
          {isDone && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5L3.5 6L8 1" stroke={sColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>

      {/* Name */}
      <div style={{ flex: 1, minWidth: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: SP[2] }}>
        <span style={{
          ...TEXT.sm, fontWeight: WEIGHT.medium, fontFamily: FONT,
          color: isDone ? C.textDisabled : C.textPrimary,
          textDecoration: isDone ? 'line-through' : 'none',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1,
        }}>
          {task.isCritical && <span style={{ color: C.statusBlocked, marginLeft: '4px', fontSize: '9px' }}>●</span>}
          {task.title}
        </span>
        {task.crNumber && (
          <span style={{ ...TEXT.xs, color: C.info, background: C.infoBg, fontFamily: FONT, padding: '1px 6px', borderRadius: RADIUS.sm, whiteSpace: 'nowrap', flexShrink: 0 }}>
            {task.crNumber}
          </span>
        )}
        {task.dependencies?.length > 0 && (
          <span style={{ ...TEXT.xs, color: C.textDisabled, flexShrink: 0 }} title={`${task.dependencies.length} תלויות`}>🔗</span>
        )}
      </div>

      {/* Duration */}
      <div style={{ width: `${C_W.duration}px`, flexShrink: 0, padding: `0 ${SP[2]}`, textAlign: 'center' }}>
        <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>{task.duration || '—'}</span>
      </div>

      {/* Start */}
      <div style={{ width: `${C_W.start}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
        <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, display: 'block' }}>
          {task.plannedStart ? fmtTime(task.plannedStart) : '—'}
        </span>
        {task.actualStart && (
          <span style={{ ...TEXT.xs, color: C.statusDone, fontFamily: FONT, display: 'block' }}>▶ {fmtTime(task.actualStart)}</span>
        )}
      </div>

      {/* End */}
      <div style={{ width: `${C_W.end}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
        <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, display: 'block' }}>
          {task.plannedEnd ? fmtTime(task.plannedEnd) : '—'}
        </span>
        {task.actualFinish && (
          <span style={{ ...TEXT.xs, color: C.statusDone, fontFamily: FONT, display: 'block' }}>■ {fmtTime(task.actualFinish)}</span>
        )}
      </div>

      {/* Due */}
      <div style={{ width: `${C_W.due}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
        <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>
          {task.plannedEnd ? fmtDate(task.plannedEnd) : '—'}
        </span>
      </div>

      {/* Team */}
      <div style={{ width: `${C_W.team}px`, flexShrink: 0, padding: `0 ${SP[2]}`, overflow: 'hidden' }}>
        {task.assignedTeam?.name ? (
          <span style={{ ...TEXT.xs, color: C.brand, background: C.brandDim, fontFamily: FONT, padding: '2px 7px', borderRadius: RADIUS.sm, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {task.assignedTeam.name}
          </span>
        ) : <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
      </div>

      {/* Assignee */}
      <div style={{ width: `${C_W.assignee}px`, flexShrink: 0, padding: `0 ${SP[2]}`, display: 'flex', alignItems: 'center', gap: '5px', overflow: 'hidden', direction: 'ltr' }}>
        {task.assignedUserName ? (
          <>
            <Avatar name={task.assignedUserName} size={20} />
            <span style={{ ...TEXT.xs, color: C.textSecondary, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
              {task.assignedUserName}
            </span>
          </>
        ) : <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
      </div>

      {/* Application */}
      <div style={{ width: `${C_W.app}px`, flexShrink: 0, padding: `0 ${SP[2]}`, overflow: 'hidden' }}>
        {task.application ? (
          <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
            {task.application}
          </span>
        ) : <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
      </div>

      {/* Dependencies */}
      <div style={{ width: `${C_W.deps}px`, flexShrink: 0, padding: `0 ${SP[2]}`, display: 'flex', flexWrap: 'wrap', gap: '3px', alignItems: 'center' }}>
        {task.dependencies?.length > 0 ? (
          task.dependencies.slice(0, 2).map((d: any) => {
            const dep = d.dependsOn;
            const isDone = dep?.status === 'DONE';
            return (
              <span key={d.dependsOnTaskId}
                title={dep?.title || d.dependsOnTaskId}
                style={{
                  ...TEXT.xs, fontFamily: FONT,
                  color: isDone ? C.statusDone : C.statusBlocked,
                  background: isDone ? C.bgDone : C.bgBlocked,
                  border: `1px solid ${isDone ? C.statusDone + '44' : C.statusBlocked + '44'}`,
                  padding: '1px 5px', borderRadius: RADIUS.sm,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  maxWidth: '44px', display: 'inline-block',
                }}>
                {isDone ? '✓' : '⏳'} {dep?.title?.slice(0, 6) || '?'}
              </span>
            );
          })
        ) : (
          <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>
        )}
        {task.dependencies?.length > 2 && (
          <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>+{task.dependencies.length - 2}</span>
        )}
      </div>

      {/* Status */}
      <div style={{ width: `${C_W.status}px`, flexShrink: 0, padding: `0 ${SP[2]}` }}>
        <StatusChip status={task.status} size="xs" dot />
      </div>

      {/* Delete (editable + hover) */}
      {editable && (
        <div style={{ width: `${C_W.actions}px`, flexShrink: 0, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          {hov && onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              title="מחק משימה"
              style={{
                background: 'none', border: 'none', cursor: 'pointer',
                color: C.textDisabled, fontSize: '15px', lineHeight: 1, padding: '2px',
                borderRadius: RADIUS.sm, transition: EASE.fast,
              }}
              onMouseEnter={e => (e.currentTarget.style.color = C.danger)}
              onMouseLeave={e => (e.currentTarget.style.color = C.textDisabled)}
            >✕</button>
          )}
        </div>
      )}
    </div>
  );
};

// ── Inline Add Task row ───────────────────────────────────────────────────────
const AddTaskRow: React.FC<{
  depth: number;
  subPhaseId: string;
  onAdd: (title: string, subPhaseId: string) => Promise<void>;
}> = ({ depth, subPhaseId, onAdd }) => {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    await onAdd(title.trim(), subPhaseId);
    setTitle('');
    setSaving(false);
    setOpen(false);
  };

  if (!open) return (
    <div
      onClick={() => { setOpen(true); setTimeout(() => inputRef.current?.focus(), 50); }}
      style={{
        display: 'flex', alignItems: 'center', gap: SP[2],
        paddingRight: `${INDENT * depth + C_W.expand}px`,
        paddingTop: '5px', paddingBottom: '5px',
        cursor: 'pointer', color: C.textMuted, fontFamily: FONT,
        borderBottom: `1px solid ${C.border}`,
        background: C.bgCard,
        transition: EASE.fast,
      }}
      onMouseEnter={e => (e.currentTarget.style.color = C.brand)}
      onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
    >
      <span style={{ fontSize: '14px' }}>+</span>
      <span style={{ ...TEXT.sm }}>הוסף משימה</span>
    </div>
  );

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: SP[2],
      paddingRight: `${INDENT * depth + C_W.expand}px`,
      paddingTop: SP[1], paddingBottom: SP[1],
      borderBottom: `1px solid ${C.border}`,
      background: C.bgActive,
      borderRight: `3px solid ${C.brand}`,
    }}>
      <input
        ref={inputRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') { setOpen(false); setTitle(''); }
        }}
        placeholder="שם המשימה..."
        style={{
          flex: 1, fontFamily: FONT, ...TEXT.sm, color: C.textPrimary,
          background: C.bgCard, border: `1px solid ${C.borderFocus}`,
          borderRadius: RADIUS.md, padding: `${SP[1]} ${SP[3]}`, outline: 'none',
        }}
      />
      <button onClick={submit} disabled={!title.trim() || saving}
        style={{
          fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold,
          padding: '5px 12px', background: title.trim() ? C.brand : C.textDisabled,
          color: 'white', border: 'none', borderRadius: RADIUS.md,
          cursor: title.trim() ? 'pointer' : 'not-allowed', flexShrink: 0,
        }}>
        {saving ? '...' : 'הוסף'}
      </button>
      <button onClick={() => { setOpen(false); setTitle(''); }}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: '16px', padding: '2px 4px', flexShrink: 0 }}>
        ✕
      </button>
    </div>
  );
};

// ── Main component ────────────────────────────────────────────────────────────
export const TaskListView: React.FC<Props> = ({ token, versionId, versionName, versionStatus, editable = false, onVersionStatusChange }) => {
  const dialog = useDialog();
  const [version,        setVersion]        = useState<any>(null);
  const [loading,        setLoading]        = useState(true);
  const [collapsed,      setCollapsed]      = useState<Set<string>>(new Set());
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [search,         setSearch]         = useState('');
  const [filterStatus,   setFilterStatus]   = useState<string | null>(null);
  const [statusLoading,  setStatusLoading]  = useState(false);
  const [statusError,    setStatusError]    = useState<string | null>(null);
  const [proposalCount,  setProposalCount]  = useState(0);
  const [converting,     setConverting]     = useState(false);
  const [convertResult,  setConvertResult]  = useState<{ created: number; skipped: { title: string; reason: string }[]; tasks: { title: string; phaseName: string; subPhaseName: string }[] } | null>(null);

  const headers = { Authorization: `Bearer ${token}` };

  const fetchProposalCount = async () => {
    try {
      const res = await axios.get(`${API}/task-proposals/version/${versionId}/count-pending`, { headers });
      setProposalCount(res.data.count ?? 0);
    } catch { setProposalCount(0); }
  };

  const handleConvertProposals = async () => {
    setConverting(true);
    try {
      const res = await axios.post(`${API}/task-proposals/version/${versionId}/convert-approved`, {}, { headers });
      setConvertResult({ created: res.data.created ?? 0, skipped: res.data.skipped ?? [], tasks: res.data.tasks ?? [] });
      await fetchVersion();
      await fetchProposalCount();
    } catch (err: any) {
      setConvertResult({ created: 0, skipped: [{ title: '—', reason: err?.response?.data?.message || 'שגיאה בשיבוץ' }], tasks: [] });
    } finally { setConverting(false); }
  };

  const changeVersionStatus = async (newStatus: string) => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      await axios.patch(`${API}/versions/${versionId}/status`, { status: newStatus }, { headers });
      await fetchVersion();
      onVersionStatusChange?.();
    } catch (err: any) {
      setStatusError(err?.response?.data?.message || 'שגיאה במעבר סטטוס');
    } finally { setStatusLoading(false); }
  };

  const fetchVersion = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/versions/${versionId}`, { headers });
      setVersion(res.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchVersion(); fetchProposalCount(); setSelectedId(null); }, [versionId]); // eslint-disable-line

  const toggleCollapse = (id: string) =>
    setCollapsed(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // Add task under a sub-phase
  const addTask = async (title: string, subPhaseId: string) => {
    await axios.post(`${API}/tasks`, { title, subPhaseId, versionId }, { headers });
    fetchVersion();
  };

  // Delete task
  const deleteTask = async (taskId: string) => {
    if (!await dialog.confirm('למחוק את המשימה?', 'מחיקת משימה', 'danger')) return;
    await axios.delete(`${API}/tasks/${taskId}`, { headers });
    if (selectedId === taskId) setSelectedId(null);
    fetchVersion();
  };

  // Build flat list
  const flatRows = useMemo((): FlatRow[] => {
    if (!version?.phases) return [];
    const rows: FlatRow[] = [];
    const phases = [...version.phases].sort((a: any, b: any) => a.orderIndex - b.orderIndex);

    for (const phase of phases) {
      const allPhaseTasks = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
      const phaseVisible = allPhaseTasks.some((t: any) =>
        (!search || t.title?.toLowerCase().includes(search.toLowerCase())) &&
        (!filterStatus || t.status === filterStatus)
      ) || (editable && allPhaseTasks.length === 0);

      if (!phaseVisible && !editable) continue;

      rows.push({ id: phase.id, kind: 'phase', depth: 0, data: phase });
      if (collapsed.has(phase.id)) continue;

      const subs = [...(phase.subPhases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
      for (const sub of subs) {
        const subTasks = (sub.tasks || []).filter((t: any) =>
          (!search || t.title?.toLowerCase().includes(search.toLowerCase())) &&
          (!filterStatus || t.status === filterStatus)
        );
        if (subTasks.length === 0 && !editable) continue;

        rows.push({ id: sub.id, kind: 'subphase', depth: 1, data: sub });
        if (collapsed.has(sub.id)) continue;

        const sorted = [...subTasks].sort((a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
        for (const task of sorted) {
          rows.push({ id: task.id, kind: 'task', depth: 2, data: task });
        }

        // Add task row (edit mode, no active search/filter)
        if (editable && !search && !filterStatus) {
          rows.push({ id: `add-${sub.id}`, kind: 'add', depth: 2, data: sub, subPhaseId: sub.id });
        }
      }
    }
    return rows;
  }, [version, collapsed, search, filterStatus, editable]);

  // Find selected task
  const selectedTask = useMemo(() => {
    if (!selectedId || !version?.phases) return null;
    for (const phase of version.phases) {
      for (const sub of (phase.subPhases || [])) {
        const t = (sub.tasks || []).find((x: any) => x.id === selectedId);
        if (t) return t;
      }
    }
    return null;
  }, [selectedId, version]);

  const allTasks  = useMemo(() =>
    (version?.phases || []).flatMap((p: any) => (p.subPhases || []).flatMap((s: any) => s.tasks || [])),
    [version]);
  const doneTasks = allTasks.filter((t: any) => t.status === 'DONE').length;

  const taskStatusCounts = allTasks.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {});

  const STATUS_LABELS: Record<string, string> = {
    WAITING: 'ממתין', OPEN: 'פתוח', IN_PROGRESS: 'בביצוע',
    DONE: 'הושלם', BLOCKED: 'חסום', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
  };

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '300px', gap: SP[3], color: C.textMuted, fontFamily: FONT }}>
      <Spinner size={24} /> טוען...
    </div>
  );
  if (!version) return null;

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', background: C.bgApp }}>

      {/* ── Main list ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Version header */}
        <div style={{
          background: C.bgCard, borderBottom: `1px solid ${C.border}`,
          padding: `${SP[3]} ${SP[4]}`,
          display: 'flex', alignItems: 'center', gap: SP[3],
          flexShrink: 0, flexWrap: 'wrap',
        }}>
          <h2 style={{ margin: 0, ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary, fontFamily: FONT }}>
            {versionName}
          </h2>
          <VersionStatusChip status={version?.status || versionStatus} size="sm" />

          {/* ── Status progression ── */}
          <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginRight: 'auto' }}>
            {/* Back button */}
            {BACK_STATUS[version?.status] && editable && (
              <button
                onClick={() => changeVersionStatus(BACK_STATUS[version.status])}
                disabled={statusLoading}
                style={{
                  fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.medium,
                  padding: '5px 12px', borderRadius: RADIUS.md, cursor: statusLoading ? 'not-allowed' : 'pointer',
                  background: C.bgNested, color: C.textMuted,
                  border: `1px solid ${C.borderEm}`,
                  transition: EASE.fast, opacity: statusLoading ? 0.5 : 1,
                }}>
                {BACK_LABEL[version.status]}
              </button>
            )}

            {/* Progress indicator */}
            <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT }}>
              {doneTasks}/{allTasks.length} הושלמו
            </span>

            {/* Next button */}
            {NEXT_STATUS[version?.status] && (
              <button
                onClick={() => changeVersionStatus(NEXT_STATUS[version.status])}
                disabled={statusLoading}
                style={{
                  fontFamily: FONT, ...TEXT.sm, fontWeight: WEIGHT.semibold,
                  padding: '7px 16px', borderRadius: RADIUS.md,
                  cursor: statusLoading ? 'not-allowed' : 'pointer',
                  background: statusLoading ? C.textDisabled : C.brand,
                  color: 'white', border: 'none',
                  boxShadow: statusLoading ? 'none' : SHADOW.sm,
                  transition: EASE.fast, whiteSpace: 'nowrap' as any,
                }}>
                {statusLoading ? '...' : NEXT_LABEL[version.status]}
              </button>
            )}
          </div>

          {/* Collapse controls */}
          <button onClick={() => setCollapsed(new Set([
            ...(version?.phases || []).map((p: any) => p.id),
            ...(version?.phases || []).flatMap((p: any) => (p.subPhases || []).map((s: any) => s.id)),
          ]))} style={{ ...TEXT.xs, fontFamily: FONT, padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
            ▶ קפל הכל
          </button>
          <button onClick={() => setCollapsed(new Set())}
            style={{ ...TEXT.xs, fontFamily: FONT, padding: '4px 10px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer' }}>
            ▼ פתח הכל
          </button>
        </div>

        {/* Status error */}
        {statusError && (
          <div style={{
            background: C.dangerBg, border: `1px solid ${C.danger}44`,
            padding: `${SP[2]} ${SP[4]}`, flexShrink: 0,
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            fontFamily: FONT, ...TEXT.sm, color: C.danger,
          }}>
            ⚠️ {statusError}
            <button onClick={() => setStatusError(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.danger, fontWeight: 'bold' }}>✕</button>
          </div>
        )}

        {/* Toolbar */}
        <div style={{
          background: C.bgCard, borderBottom: `1px solid ${C.border}`,
          padding: `${SP[2]} ${SP[4]}`,
          display: 'flex', alignItems: 'center', gap: SP[3],
          flexShrink: 0,
        }}>
          {/* Search */}
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: C.textMuted, pointerEvents: 'none', fontSize: '13px' }}>🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש משימה..."
              style={{
                fontFamily: FONT, ...TEXT.sm, color: C.textPrimary,
                background: C.bgNested, border: `1px solid ${C.borderEm}`,
                borderRadius: RADIUS.md, padding: `${SP[1]} ${SP[3]} ${SP[1]} ${SP[8]}`,
                outline: 'none', width: '200px',
              }}
            />
          </div>

          {/* Status pills */}
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ ...TEXT.xs, color: C.textMuted, fontFamily: FONT, flexShrink: 0 }}>סטטוס:</span>
            <button onClick={() => setFilterStatus(null)} style={{
              ...TEXT.xs, fontFamily: FONT, padding: '3px 9px', borderRadius: RADIUS.full,
              background: !filterStatus ? C.bgActive : 'transparent',
              color: !filterStatus ? C.brand : C.textMuted,
              border: `1px solid ${!filterStatus ? C.brand + '50' : C.border}`,
              cursor: 'pointer',
            }}>
              הכל ({allTasks.length})
            </button>
            {Object.entries(taskStatusCounts).map(([s, count]) => {
              const sc = statusColor(s);
              const isF = filterStatus === s;
              return (
                <button key={s} onClick={() => setFilterStatus(isF ? null : s)} style={{
                  ...TEXT.xs, fontFamily: FONT, padding: '3px 9px', borderRadius: RADIUS.full,
                  background: isF ? sc + '20' : 'transparent',
                  color: isF ? sc : C.textMuted,
                  border: `1px solid ${isF ? sc + '60' : C.border}`,
                  cursor: 'pointer',
                }}>
                  {STATUS_LABELS[s] || s} ({count as number})
                </button>
              );
            })}
          </div>

          {/* Auto-assign proposals button — managers in edit mode only */}
          {editable && proposalCount > 0 && (
            <button
              onClick={handleConvertProposals}
              disabled={converting}
              style={{
                marginRight: 'auto',
                fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.semibold,
                padding: '5px 12px', borderRadius: RADIUS.md,
                background: converting ? C.textDisabled : '#4573D2',
                color: 'white', border: 'none',
                cursor: converting ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: '6px',
                flexShrink: 0, whiteSpace: 'nowrap' as any,
              }}
            >
              {converting ? '⏳ משבץ...' : `📥 שבץ הצעות מאושרות`}
              <span style={{
                background: 'rgba(255,255,255,0.25)',
                borderRadius: RADIUS.full,
                padding: '0px 7px',
                fontSize: '11px',
                fontWeight: WEIGHT.bold,
              }}>{proposalCount}</span>
            </button>
          )}
        </div>

        {/* Table header */}
        <div style={{
          display: 'flex', alignItems: 'center',
          background: C.bgCard, borderBottom: `2px solid ${C.border}`,
          padding: `${SP[1]} 0`,
          flexShrink: 0, position: 'sticky', top: 0, zIndex: 5,
        }}>
          <div style={{ width: `${C_W.expand}px`, flexShrink: 0 }} />
          <ColH label="שם משימה" flex />
          <ColH label="משך"       width={C_W.duration} center />
          <ColH label="התחלה"    width={C_W.start} />
          <ColH label="סיום"     width={C_W.end} />
          <ColH label="יעד"      width={C_W.due} />
          <ColH label="צוות"     width={C_W.team} />
          <ColH label="אחראי"    width={C_W.assignee} />
          <ColH label="אפליקציה" width={C_W.app} />
          <ColH label="תלויות"   width={C_W.deps} />
          <ColH label="סטטוס"    width={C_W.status} />
          {editable && <div style={{ width: `${C_W.actions}px`, flexShrink: 0 }} />}
        </div>

        {/* Rows */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {flatRows.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '200px', color: C.textMuted, fontFamily: FONT, gap: SP[3] }}>
              <span style={{ fontSize: '40px', opacity: 0.4 }}>📋</span>
              <span style={{ ...TEXT.md }}>
                {search || filterStatus ? 'לא נמצאו משימות תואמות' : 'אין משימות בגרסה זו'}
              </span>
            </div>
          ) : flatRows.map(row => {
            if (row.kind === 'phase') return (
              <PhaseRow key={row.id} phase={row.data}
                isCollapsed={collapsed.has(row.id)}
                onToggle={() => toggleCollapse(row.id)}
                editable={editable} />
            );
            if (row.kind === 'subphase') return (
              <SubPhaseRow key={row.id} sub={row.data}
                isCollapsed={collapsed.has(row.id)}
                onToggle={() => toggleCollapse(row.id)}
                editable={editable} />
            );
            if (row.kind === 'add') return (
              <AddTaskRow key={row.id}
                depth={row.depth}
                subPhaseId={row.subPhaseId!}
                onAdd={addTask} />
            );
            // task
            return (
              <TaskRow key={row.id} task={row.data} depth={row.depth}
                isSelected={selectedId === row.id}
                editable={editable}
                onClick={() => setSelectedId(prev => prev === row.id ? null : row.id)}
                onDelete={editable ? () => deleteTask(row.data.id) : undefined} />
            );
          })}
        </div>
      </div>

      {/* ── Task detail panel ── */}
      {selectedTask && (
        <TaskDetailPanel
          task={selectedTask}
          token={token}
          teams={[]}
          users={[]}
          crItems={[]}
          onClose={() => setSelectedId(null)}
          onSave={fetchVersion}
        />
      )}

      {/* ── Convert proposals result dialog ── */}
      {convertResult && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
        }} onClick={() => setConvertResult(null)}>
          <div onClick={e => e.stopPropagation()} style={{
            background: C.bgCard, borderRadius: RADIUS.lg, padding: SP[6],
            minWidth: '340px', maxWidth: '480px', width: '90%',
            boxShadow: SHADOW.lg, direction: 'rtl', fontFamily: FONT,
          }}>
            <h3 style={{ margin: `0 0 ${SP[4]} 0`, ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              תוצאות שיבוץ הצעות
            </h3>

            {/* Created */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: SP[2],
              padding: `${SP[2]} ${SP[3]}`, borderRadius: convertResult.tasks.length > 0 ? `${RADIUS.md} ${RADIUS.md} 0 0` : RADIUS.md,
              background: 'rgba(40,167,69,0.1)', marginBottom: convertResult.tasks.length > 0 ? 0 : SP[3],
            }}>
              <span style={{ fontSize: '18px' }}>✅</span>
              <span style={{ ...TEXT.sm, color: '#28a745', fontWeight: WEIGHT.semibold }}>
                {convertResult.created > 0 ? `שובצו ${convertResult.created} משימות` : 'לא שובצו משימות חדשות'}
              </span>
            </div>
            {convertResult.tasks.length > 0 && (
              <div style={{
                border: '1px solid rgba(40,167,69,0.25)', borderTop: 'none',
                borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                background: 'rgba(40,167,69,0.04)',
                maxHeight: '200px', overflowY: 'auto',
                marginBottom: SP[3],
              }}>
                {convertResult.tasks.map((t, i) => (
                  <div key={i} style={{
                    padding: `${SP[2]} ${SP[3]}`,
                    borderBottom: i < convertResult.tasks.length - 1 ? '1px solid rgba(40,167,69,0.12)' : 'none',
                    display: 'flex', flexDirection: 'column', gap: '2px',
                  }}>
                    <span style={{ ...TEXT.sm, color: C.textPrimary, fontWeight: WEIGHT.medium }}>{t.title}</span>
                    <span style={{ ...TEXT.xs, color: C.textMuted }}>
                      {t.phaseName}{t.subPhaseName ? ` › ${t.subPhaseName}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Skipped */}
            {convertResult.skipped.length > 0 && (
              <div style={{ marginBottom: SP[4] }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: SP[2],
                  padding: `${SP[2]} ${SP[3]}`, borderRadius: `${RADIUS.md} ${RADIUS.md} 0 0`,
                  background: 'rgba(255,193,7,0.12)',
                }}>
                  <span style={{ fontSize: '16px' }}>⚠️</span>
                  <span style={{ ...TEXT.sm, color: '#856404', fontWeight: WEIGHT.semibold }}>
                    דולגו {convertResult.skipped.length} הצעות:
                  </span>
                </div>
                <div style={{
                  border: `1px solid rgba(255,193,7,0.3)`, borderTop: 'none',
                  borderRadius: `0 0 ${RADIUS.md} ${RADIUS.md}`,
                  background: 'rgba(255,193,7,0.05)',
                  maxHeight: '180px', overflowY: 'auto',
                }}>
                  {convertResult.skipped.map((s, i) => (
                    <div key={i} style={{
                      padding: `${SP[2]} ${SP[3]}`,
                      borderBottom: i < convertResult.skipped.length - 1 ? `1px solid rgba(255,193,7,0.2)` : 'none',
                      display: 'flex', gap: SP[2], alignItems: 'flex-start',
                    }}>
                      <span style={{ ...TEXT.xs, color: C.textPrimary, fontWeight: WEIGHT.medium, flex: 1 }}>{s.title}</span>
                      <span style={{ ...TEXT.xs, color: C.textMuted, flexShrink: 0 }}>{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setConvertResult(null)}
              style={{
                width: '100%', padding: `${SP[2]} 0`,
                background: C.bgNested, border: `1px solid ${C.border}`,
                borderRadius: RADIUS.md, color: C.textPrimary,
                fontFamily: FONT, ...TEXT.sm, cursor: 'pointer',
              }}
            >
              סגור
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
