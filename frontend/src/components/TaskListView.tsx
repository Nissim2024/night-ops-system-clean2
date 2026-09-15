/**
 * TaskListView — Asana-style task list
 * Hierarchy: Phase (Section) → Sub-phase (Group) → Task (Row)
 * editable=true adds: "+ הוסף משימה" per sub-phase, delete on hover, full detail panel editing.
 */
import React, { useState, useEffect, useMemo, useRef } from 'react';
import axios from 'axios';
import { C, statusColor } from '../theme';
import { cn } from '../lib/utils';
import { useDialog } from '../context/DialogContext';
import { Avatar, StatusChip, Spinner, VersionStatusChip } from './ui';
import { TaskDetailPanel } from './TaskDetailPanel';
import { formatDate as fmtDateShared, formatTime as fmtTimeShared } from '../utils/dateFormat';

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
const fmtTime = (iso: string) => iso ? fmtTimeShared(iso) : '';
const fmtDate = (iso: string) => iso ? fmtDateShared(iso) : '';

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
  <div
    className={cn(
      'px-2 text-xs font-semibold text-subtle-foreground uppercase tracking-[0.04em] whitespace-nowrap',
      flex ? 'flex-1' : 'shrink-0',
      center ? 'text-center' : 'text-right'
    )}
    style={width ? { width: `${width}px` } : undefined}
  >
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
    <div onClick={onToggle} className="flex items-center py-2 bg-muted border-t-2 border-b border-border cursor-pointer select-none mt-1">
      <div style={{ width: `${C_W.expand}px` }} className="shrink-0 flex justify-center items-center">
        <span className={cn('text-xs text-subtle-foreground inline-block transition-transform duration-fast ease-out', isCollapsed ? '-rotate-90' : 'rotate-0')}>▼</span>
      </div>
      <div className="flex-1 flex items-center gap-2 min-w-0">
        <span className="text-sm font-bold text-foreground">{phase.name}</span>
        {phase.environment && (
          <span className="text-xs rounded-sm px-[7px] py-px shrink-0" style={{ color: envColor, background: envColor + '18' }}>
            {phase.environment}
          </span>
        )}
        <span className="text-xs text-subtle-foreground">{done}/{tasks.length}</span>
        <div className="w-12 h-1 bg-muted rounded-full overflow-hidden shrink-0">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{
              width: tasks.length > 0 ? `${Math.round((done / tasks.length) * 100)}%` : '0%',
              background: done === tasks.length && tasks.length > 0 ? C.success : C.brand,
            }}
          />
        </div>
      </div>
      {editable && <div style={{ width: `${C_W.actions}px` }} className="shrink-0" />}
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
    <div onClick={onToggle} className="flex items-center ps-[18px] pt-1 pb-1 border-b border-border bg-card cursor-pointer select-none">
      <div style={{ width: `${C_W.expand}px` }} className="shrink-0 flex justify-center items-center">
        <span className={cn('text-[11px] text-subtle-foreground inline-block transition-transform duration-fast ease-out', isCollapsed ? '-rotate-90' : 'rotate-0')}>▼</span>
      </div>
      <div className="flex-1 flex items-center gap-2">
        <span className="text-sm font-semibold text-muted-foreground">{sub.name}</span>
        <span className="text-xs text-subtle-foreground">{done}/{tasks.length}</span>
      </div>
      {editable && <div style={{ width: `${C_W.actions}px` }} className="shrink-0" />}
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
      className="flex items-center min-h-[38px] border-b border-border cursor-pointer transition-colors duration-fast ease-out"
      style={{
        background: isSelected ? C.bgActive : hov ? C.bgHover : C.bgCard,
        borderInlineStart: `3px solid ${sColor}`,
        paddingInlineStart: `${INDENT * depth}px`,
      }}
    >
      {/* Circle checkbox */}
      <div style={{ width: `${C_W.expand}px` }} className="shrink-0 flex justify-center items-center">
        <div
          className="w-[18px] h-[18px] rounded-full shrink-0 flex items-center justify-center transition-colors duration-fast ease-out"
          style={{ border: `1.5px solid ${sColor}55`, background: isDone ? sColor + '20' : 'transparent' }}>
          {isDone && (
            <svg width="9" height="7" viewBox="0 0 9 7" fill="none">
              <path d="M1 3.5L3.5 6L8 1" stroke={sColor} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          )}
        </div>
      </div>

      {/* Name */}
      <div className="flex-1 min-w-0 px-2 flex items-center gap-2">
        <span className={cn('text-sm font-medium overflow-hidden text-ellipsis whitespace-nowrap flex-1', isDone ? 'text-subtle-foreground line-through' : 'text-foreground no-underline')}>
          {task.isCritical && <span className="me-1 text-[11px]" style={{ color: C.statusBlocked }}>●</span>}
          {task.title}
        </span>
        {task.crNumber && (
          <span className="text-xs text-info bg-info-bg px-1.5 py-px rounded-sm whitespace-nowrap shrink-0">
            {task.crNumber}
          </span>
        )}
        {task.dependencies?.length > 0 && (
          <span className="text-xs text-subtle-foreground shrink-0" title={`${task.dependencies.length} תלויות`}>🔗</span>
        )}
      </div>

      {/* Duration */}
      <div style={{ width: `${C_W.duration}px` }} className="shrink-0 px-2 text-center">
        <span className="text-xs text-subtle-foreground">{task.duration || '—'}</span>
      </div>

      {/* Start */}
      <div style={{ width: `${C_W.start}px` }} className="shrink-0 px-2">
        <span className="text-xs text-subtle-foreground block">
          {task.plannedStart ? fmtTime(task.plannedStart) : '—'}
        </span>
        {task.actualStart && (
          <span className="text-xs block" style={{ color: C.statusDone }}>▶ {fmtTime(task.actualStart)}</span>
        )}
      </div>

      {/* End */}
      <div style={{ width: `${C_W.end}px` }} className="shrink-0 px-2">
        <span className="text-xs text-subtle-foreground block">
          {task.plannedEnd ? fmtTime(task.plannedEnd) : '—'}
        </span>
        {task.actualFinish && (
          <span className="text-xs block" style={{ color: C.statusDone }}>■ {fmtTime(task.actualFinish)}</span>
        )}
      </div>

      {/* Due */}
      <div style={{ width: `${C_W.due}px` }} className="shrink-0 px-2">
        <span className="text-xs text-subtle-foreground">
          {task.plannedEnd ? fmtDate(task.plannedEnd) : '—'}
        </span>
      </div>

      {/* Team */}
      <div style={{ width: `${C_W.team}px` }} className="shrink-0 px-2 overflow-hidden">
        {task.assignedTeam?.name ? (
          <span className="text-xs text-primary py-0.5 px-[7px] rounded-sm overflow-hidden text-ellipsis whitespace-nowrap block" style={{ background: C.brandDim }}>
            {task.assignedTeam.name}
          </span>
        ) : <span className="text-xs text-subtle-foreground">—</span>}
      </div>

      {/* Assignee */}
      <div style={{ width: `${C_W.assignee}px` }} className="shrink-0 px-2 flex items-center gap-[5px] overflow-hidden" dir="ltr">
        {task.assignedUserName ? (
          <>
            <Avatar name={task.assignedUserName} size={20} />
            <span className="text-xs text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap flex-1">
              {task.assignedUserName}
            </span>
          </>
        ) : <span className="text-xs text-subtle-foreground">—</span>}
      </div>

      {/* Application */}
      <div style={{ width: `${C_W.app}px` }} className="shrink-0 px-2 overflow-hidden">
        {task.application ? (
          <span className="text-xs text-subtle-foreground overflow-hidden text-ellipsis whitespace-nowrap block">
            {task.application}
          </span>
        ) : <span className="text-xs text-subtle-foreground">—</span>}
      </div>

      {/* Dependencies */}
      <div style={{ width: `${C_W.deps}px` }} className="shrink-0 px-2 flex flex-wrap gap-[3px] items-center">
        {task.dependencies?.length > 0 ? (
          task.dependencies.slice(0, 2).map((d: any) => {
            const dep = d.dependsOn;
            const isDone = dep?.status === 'DONE';
            return (
              <span key={d.dependsOnTaskId}
                title={dep?.title || d.dependsOnTaskId}
                className="text-xs whitespace-nowrap overflow-hidden text-ellipsis max-w-[44px] inline-block py-px px-[5px] rounded-sm"
                style={{
                  color: isDone ? C.statusDone : C.statusBlocked,
                  background: isDone ? C.bgDone : C.bgBlocked,
                  border: `1px solid ${isDone ? C.statusDone + '44' : C.statusBlocked + '44'}`,
                }}>
                {isDone ? '✓' : '⏳'} {dep?.title?.slice(0, 6) || '?'}
              </span>
            );
          })
        ) : (
          <span className="text-xs text-subtle-foreground">—</span>
        )}
        {task.dependencies?.length > 2 && (
          <span className="text-xs text-subtle-foreground">+{task.dependencies.length - 2}</span>
        )}
      </div>

      {/* Status */}
      <div style={{ width: `${C_W.status}px` }} className="shrink-0 px-2">
        <StatusChip status={task.status} size="xs" dot />
      </div>

      {/* Delete (editable + hover) */}
      {editable && (
        <div style={{ width: `${C_W.actions}px` }} className="shrink-0 flex justify-center items-center">
          {hov && onDelete && (
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              title="מחק משימה"
              className="bg-transparent border-none cursor-pointer text-base leading-none p-0.5 rounded-sm transition-colors duration-fast ease-out"
              style={{ color: C.textDisabled }}
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
      className="flex items-center gap-2 pt-[5px] pb-[5px] cursor-pointer border-b border-border bg-card transition-colors duration-fast ease-out"
      style={{ paddingInlineStart: `${INDENT * depth + C_W.expand}px`, color: C.textMuted }}
      onMouseEnter={e => (e.currentTarget.style.color = C.brand)}
      onMouseLeave={e => (e.currentTarget.style.color = C.textMuted)}
    >
      <span className="text-[15px]">+</span>
      <span className="text-sm">הוסף משימה</span>
    </div>
  );

  return (
    <div
      className="flex items-center gap-2 py-1 border-b border-border"
      style={{ paddingInlineStart: `${INDENT * depth + C_W.expand}px`, background: C.bgActive, borderInlineStart: `3px solid ${C.brand}` }}>
      <input
        ref={inputRef}
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') { setOpen(false); setTitle(''); }
        }}
        placeholder="שם המשימה..."
        className="flex-1 text-sm text-foreground bg-card rounded-md py-1 px-3 outline-none"
        style={{ border: `1px solid ${C.borderFocus}` }}
      />
      <button onClick={submit} disabled={!title.trim() || saving}
        className={cn('text-xs font-semibold py-[5px] px-3 text-white border-none rounded-md shrink-0', title.trim() ? 'cursor-pointer' : 'cursor-not-allowed')}
        style={{ background: title.trim() ? C.brand : C.textDisabled }}>
        {saving ? '...' : 'הוסף'}
      </button>
      <button onClick={() => { setOpen(false); setTitle(''); }}
        className="bg-transparent border-none cursor-pointer text-subtle-foreground text-[17px] py-0.5 px-1 shrink-0">
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
    <div className="flex items-center justify-center h-[300px] gap-3 text-subtle-foreground">
      <Spinner size={24} /> טוען...
    </div>
  );
  if (!version) return null;

  return (
    <div className="flex h-full overflow-hidden bg-background">

      {/* ── Main list ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">

        {/* Version header */}
        <div className="bg-card border-b border-border py-3 px-4 flex items-center gap-3 shrink-0 flex-wrap">
          <h2 className="m-0 text-xl font-bold text-foreground">
            {versionName}
          </h2>
          <VersionStatusChip status={version?.status || versionStatus} size="sm" />

          {/* ── Status progression ── */}
          <div className="flex items-center gap-2 ms-auto">
            {/* Back button */}
            {BACK_STATUS[version?.status] && editable && (
              <button
                onClick={() => changeVersionStatus(BACK_STATUS[version.status])}
                disabled={statusLoading}
                className={cn(
                  'text-xs font-medium py-1.5 px-3 rounded-md bg-muted text-subtle-foreground border border-border transition-opacity duration-fast ease-out',
                  statusLoading ? 'cursor-not-allowed opacity-50' : 'cursor-pointer opacity-100'
                )}>
                {BACK_LABEL[version.status]}
              </button>
            )}

            {/* Progress indicator */}
            <span className="text-xs text-subtle-foreground">
              {doneTasks}/{allTasks.length} הושלמו
            </span>

            {/* Next button */}
            {NEXT_STATUS[version?.status] && (
              <button
                onClick={() => changeVersionStatus(NEXT_STATUS[version.status])}
                disabled={statusLoading}
                className={cn(
                  'text-sm font-semibold py-1.5 px-4 rounded-md text-white border-none whitespace-nowrap transition-[background-color,box-shadow] duration-fast ease-out',
                  statusLoading ? 'cursor-not-allowed shadow-none' : 'cursor-pointer shadow-sm'
                )}
                style={{ background: statusLoading ? C.textDisabled : C.brand }}>
                {statusLoading ? '...' : NEXT_LABEL[version.status]}
              </button>
            )}
          </div>

          {/* Collapse controls */}
          <button onClick={() => setCollapsed(new Set([
            ...(version?.phases || []).map((p: any) => p.id),
            ...(version?.phases || []).flatMap((p: any) => (p.subPhases || []).map((s: any) => s.id)),
          ]))} className="text-xs py-1 px-2.5 bg-muted text-muted-foreground border border-border rounded-md cursor-pointer">
            ▶ קפל הכל
          </button>
          <button onClick={() => setCollapsed(new Set())}
            className="text-xs py-1 px-2.5 bg-muted text-muted-foreground border border-border rounded-md cursor-pointer">
            ▼ פתח הכל
          </button>
        </div>

        {/* Status error */}
        {statusError && (
          <div className="bg-danger-bg border border-danger/[26.7%] py-2 px-4 shrink-0 flex justify-between items-center text-sm text-danger">
            ⚠️ {statusError}
            <button onClick={() => setStatusError(null)}
              className="bg-transparent border-none cursor-pointer text-danger font-bold">✕</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-card border-b border-border py-2 px-4 flex items-center gap-3 shrink-0">
          {/* Search */}
          <div className="relative shrink-0">
            <span className="absolute start-2.5 top-1/2 -translate-y-1/2 text-subtle-foreground pointer-events-none text-[15px]">🔍</span>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="חיפוש משימה..."
              className="text-sm text-foreground bg-muted rounded-md outline-none w-[200px] py-1 ps-3 pe-8"
              style={{ border: `1px solid ${C.borderEm}` }}
            />
          </div>

          {/* Status pills */}
          <div className="flex gap-1 flex-wrap items-center">
            <span className="text-xs text-subtle-foreground shrink-0">סטטוס:</span>
            <button onClick={() => setFilterStatus(null)}
              className={cn('text-xs py-[3px] px-2.5 rounded-full cursor-pointer border', !filterStatus ? 'text-primary' : 'text-subtle-foreground bg-transparent')}
              style={{ background: !filterStatus ? C.bgActive : undefined, borderColor: !filterStatus ? `${C.brand}50` : C.border }}>
              הכל ({allTasks.length})
            </button>
            {Object.entries(taskStatusCounts).map(([s, count]) => {
              const sc = statusColor(s);
              const isF = filterStatus === s;
              return (
                <button key={s} onClick={() => setFilterStatus(isF ? null : s)}
                  className="text-xs py-[3px] px-2.5 rounded-full cursor-pointer border"
                  style={{
                    background: isF ? sc + '20' : 'transparent',
                    color: isF ? sc : C.textMuted,
                    borderColor: isF ? sc + '60' : C.border,
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
              className={cn(
                'ms-auto text-xs font-semibold py-1.5 px-3 rounded-md text-white border-none flex items-center gap-1.5 shrink-0 whitespace-nowrap',
                converting ? 'cursor-not-allowed' : 'cursor-pointer'
              )}
              style={{ background: converting ? C.textDisabled : '#4573D2' }}
            >
              {converting ? '⏳ משבץ...' : `📥 שבץ הצעות מאושרות`}
              <span className="rounded-full py-0 px-[7px] text-[13px] font-bold" style={{ background: 'rgba(255,255,255,0.25)' }}>{proposalCount}</span>
            </button>
          )}
        </div>

        {/* Table header */}
        <div className="flex items-center bg-card border-b-2 border-border py-1 shrink-0 sticky top-0 z-[5]">
          <div style={{ width: `${C_W.expand}px` }} className="shrink-0" />
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
          {editable && <div style={{ width: `${C_W.actions}px` }} className="shrink-0" />}
        </div>

        {/* Rows */}
        <div className="flex-1 overflow-y-auto">
          {flatRows.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-[200px] text-subtle-foreground gap-3">
              <span className="text-4xl opacity-40">📋</span>
              <span className="text-lg">
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
        <div className="fixed inset-0 flex items-center justify-center z-[200]" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={() => setConvertResult(null)}>
          <div onClick={e => e.stopPropagation()} className="bg-card rounded-lg p-6 min-w-[340px] max-w-[480px] w-[90%] shadow-lg">
            <h3 className="mb-4 mt-0 text-lg font-bold text-foreground">
              תוצאות שיבוץ הצעות
            </h3>

            {/* Created */}
            <div
              className={cn('flex items-center gap-2 py-2 px-3', convertResult.tasks.length > 0 ? 'rounded-t-md' : 'rounded-md mb-3')}
              style={{ background: 'rgba(40,167,69,0.1)' }}>
              <span className="text-lg">✅</span>
              <span className="text-sm font-semibold" style={{ color: '#28a745' }}>
                {convertResult.created > 0 ? `שובצו ${convertResult.created} משימות` : 'לא שובצו משימות חדשות'}
              </span>
            </div>
            {convertResult.tasks.length > 0 && (
              <div className="border border-t-0 rounded-b-md max-h-[200px] overflow-y-auto mb-3" style={{ borderColor: 'rgba(40,167,69,0.25)', background: 'rgba(40,167,69,0.04)' }}>
                {convertResult.tasks.map((t, i) => (
                  <div key={i} className={cn('py-2 px-3 flex flex-col gap-0.5', i < convertResult.tasks.length - 1 && 'border-b')} style={{ borderColor: i < convertResult.tasks.length - 1 ? 'rgba(40,167,69,0.12)' : undefined }}>
                    <span className="text-sm text-foreground font-medium">{t.title}</span>
                    <span className="text-xs text-subtle-foreground">
                      {t.phaseName}{t.subPhaseName ? ` › ${t.subPhaseName}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Skipped */}
            {convertResult.skipped.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 py-2 px-3 rounded-t-md" style={{ background: 'rgba(255,193,7,0.12)' }}>
                  <span className="text-[17px]">⚠️</span>
                  <span className="text-sm font-semibold" style={{ color: '#856404' }}>
                    דולגו {convertResult.skipped.length} הצעות:
                  </span>
                </div>
                <div className="border border-t-0 rounded-b-md max-h-[180px] overflow-y-auto" style={{ borderColor: 'rgba(255,193,7,0.3)', background: 'rgba(255,193,7,0.05)' }}>
                  {convertResult.skipped.map((s, i) => (
                    <div key={i} className={cn('py-2 px-3 flex gap-2 items-start', i < convertResult.skipped.length - 1 && 'border-b')} style={{ borderColor: i < convertResult.skipped.length - 1 ? 'rgba(255,193,7,0.2)' : undefined }}>
                      <span className="text-xs text-foreground font-medium flex-1">{s.title}</span>
                      <span className="text-xs text-subtle-foreground shrink-0">{s.reason}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              onClick={() => setConvertResult(null)}
              className="w-full py-2 bg-muted border border-border rounded-md text-foreground text-sm cursor-pointer"
            >
              סגור
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
