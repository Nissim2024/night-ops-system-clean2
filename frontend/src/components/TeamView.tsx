import React, { useState, useEffect } from 'react';
import axios from 'axios';
import { usePermissions } from '../context/PermissionsContext';
import { FEATURES } from '../featureFlags';

const API = 'http://localhost:3000';

// Module-level component — avoids re-mount on parent re-render, fixing focus loss
const BlockedReasonForm: React.FC<{
  onSubmit: (reason: string) => void;
  onCancel: () => void;
}> = ({ onSubmit, onCancel }) => {
  const [reason, setReason] = useState('');
  return (
    <div style={{ marginTop: '8px', padding: '10px', background: '#fee', borderRadius: '8px', border: '1px solid #fcc' }}>
      <input
        autoFocus
        placeholder="סיבת החסימה *"
        value={reason}
        onChange={e => setReason(e.target.value)}
        style={{ width: '100%', padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', marginBottom: '6px', boxSizing: 'border-box' }}
      />
      <div style={{ display: 'flex', gap: '8px' }}>
        <button onClick={() => onSubmit(reason)} disabled={!reason}
          style={{ padding: '5px 14px', background: reason ? '#e74c3c' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: reason ? 'pointer' : 'not-allowed', fontSize: '12px' }}>
          דווח חסימה
        </button>
        <button onClick={onCancel}
          style={{ padding: '5px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
          ביטול
        </button>
      </div>
    </div>
  );
};

const STATUS_COLORS: Record<string, string> = {
  WAITING: '#9b59b6', OPEN: '#3498db', IN_PROGRESS: '#f39c12',
  BLOCKED: '#e74c3c', DONE: '#27ae60', FAILED: '#c0392b', ROLLED_BACK: '#7f8c8d',
};
const STATUS_LABELS: Record<string, string> = {
  WAITING: 'ממתין', OPEN: 'פתוח', IN_PROGRESS: 'בביצוע',
  BLOCKED: 'חסום', DONE: 'הושלם', FAILED: 'נכשל', ROLLED_BACK: 'Rollback',
};

const APPS = ['WIZ', 'CRM', 'EAI', 'OSB', 'DP', 'NC', 'ERP', 'ETL', 'אחר'];

const DELAY_THRESHOLD = 2;

const DELAY_REASONS = [
  'תקלה טכנית בלתי צפויה',
  'תלות שלא הושלמה בזמן',
  'בדיקות / Rollback נדרשו',
  'בעיית גישה / הרשאות',
  'עיכוב בצוות / לא ענו',
  'בעיית תקשורת / רשת',
  'בעיית סביבה / תשתית',
  'תיאום בעיה עם צוות אחר',
  'לא סומן בזמן (בוצע אך לא עודכן)',
  'אחר',
];

const TERMINAL = new Set(['DONE', 'FAILED', 'ROLLED_BACK']);

const sortTasks = (list: any[]): any[] =>
  [...list].sort((a, b) => {
    const aDone = TERMINAL.has(a.status) ? 1 : 0;
    const bDone = TERMINAL.has(b.status) ? 1 : 0;
    if (aDone !== bDone) return aDone - bDone;
    return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
  });

const parseDurationMins = (dur: string): number | null => {
  if (!dur) return null;
  const hM = dur.match(/(\d+)ש/);
  const mM = dur.match(/(\d+)ד/);
  if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
  const eng = dur.match(/(\d+)\s*min/i);
  if (eng) return +eng[1];
  const n = parseInt(dur);
  return isNaN(n) ? null : n;
};

const plannedMins = (task: any): number | null => {
  const f = parseDurationMins(task.duration || '');
  if (f) return f;
  if (task.plannedStart && task.plannedEnd) {
    const d = Math.round((new Date(task.plannedEnd).getTime() - new Date(task.plannedStart).getTime()) / 60000);
    return d > 0 ? d : null;
  }
  return null;
};

const actualMins = (task: any): number | null => {
  if (!task.actualStart) return null;
  const end = task.actualFinish ? new Date(task.actualFinish) : new Date();
  const d = Math.round((end.getTime() - new Date(task.actualStart).getTime()) / 60000);
  return d > 0 ? d : null;
};

const isDelayed = (task: any): boolean => {
  const p = plannedMins(task);
  const a = actualMins(task);
  return !!(p && a && a >= p * DELAY_THRESHOLD);
};

const fmtTime = (iso: string) =>
  iso ? new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' }) : '';

// Task hasn't started yet but planned start has already passed
const isOverdue = (task: any): boolean => {
  if (!task.plannedStart) return false;
  if (['IN_PROGRESS', 'DONE', 'FAILED', 'ROLLED_BACK'].includes(task.status)) return false;
  return new Date(task.plannedStart) < new Date();
};

// Task is still running but planned end has already passed
const isOvertime = (task: any): boolean => {
  if (task.status !== 'IN_PROGRESS') return false;
  const endIso = task.plannedEnd || (() => {
    const mins = parseDurationMins(task.duration || '');
    if (mins && task.plannedStart) return new Date(new Date(task.plannedStart).getTime() + mins * 60000).toISOString();
    return null;
  })();
  return !!(endIso && new Date(endIso) < new Date());
};

// Task started after its planned start time
const isLateStart = (task: any): boolean => {
  if (!task.plannedStart || !task.actualStart) return false;
  return new Date(task.actualStart) > new Date(new Date(task.plannedStart).getTime() + 5 * 60000);
};

interface Props {
  token: string;
  teamId?: string;
  teamName?: string;
  versionId?: string;
  userId?: string;
  userName?: string;
  refreshKey?: number;
  hideAddTask?: boolean;
  onTaskUpdated?: () => void;
  onSummaryReady?: (ready: boolean) => void;
  onCurrentPhaseChange?: (phaseName: string | null) => void;
  onOpenReschedule?: () => void;
}

const emptyForm = { title: '', notes: '', crNumber: '', application: '', priority: 'MEDIUM', assignedUserName: '' };

export const TeamView: React.FC<Props> = ({ token, teamId, teamName, versionId, userId, userName, refreshKey, hideAddTask, onTaskUpdated, onSummaryReady, onCurrentPhaseChange, onOpenReschedule }) => {
  const { can } = usePermissions();
  const canSelectAll = can('action:select_all_tasks');
  const [tasks, setTasks]           = useState<any[]>([]);
  const [versionData, setVersionData] = useState<any>(null);
  const [loading, setLoading]       = useState(true);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [showBlockedInput, setShowBlockedInput] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [form, setForm]             = useState(emptyForm);
  const [adding, setAdding]         = useState(false);
  const [addError, setAddError]     = useState<string | null>(null);
  const [proposals, setProposals]   = useState<any[]>([]);
  const [selectedProposalId, setSelectedProposalId] = useState<string | null>(null);
  const [delayState, setDelayState] = useState<Record<string, { category: string; freeText: string }>>({});
  const [localTeamFilter, setLocalTeamFilter] = useState<string | null>(teamId || null);
  const [localStatusFilter, setLocalStatusFilter] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [collapsedSubs, setCollapsedSubs] = useState<Set<string>>(new Set());
  const [expandedCompleted, setExpandedCompleted] = useState<Set<string>>(new Set()); // per subPhaseId or 'flat'
  const [users, setUsers] = useState<{ id: string; fullName: string }[]>([]);
  const [showAnomalies, setShowAnomalies] = useState(false);
  const [anomalyEditIdx, setAnomalyEditIdx] = useState<number | null>(null);
  const [anomalyEditForm, setAnomalyEditForm] = useState({
    plannedStart: '', plannedEnd: '', duration: '',
    assignedUserName: '', blockedReason: '', delayReason: '',
  });

  const openAnomalyEdit = (idx: number, task: any) => {
    setAnomalyEditIdx(prev => prev === idx ? null : idx);
    setAnomalyEditForm({
      plannedStart: task.plannedStart ? new Date(task.plannedStart).toISOString().slice(0, 16) : '',
      plannedEnd:   task.plannedEnd   ? new Date(task.plannedEnd).toISOString().slice(0, 16)   : '',
      duration:     task.duration || '',
      assignedUserName: task.assignedUserName || '',
      blockedReason:    task.blockedReason    || '',
      delayReason:      task.delayReason      || '',
    });
  };

  const saveAnomalyFields = async (taskId: string, fields: Record<string, any>) => {
    await axios.patch(`${API}/tasks/${taskId}`, fields, { headers });
    setAnomalyEditIdx(null);
    fetchTasks();
  };

  const removeDependency = async (taskId: string, dependsOnTaskId: string) => {
    await axios.post(`${API}/versions/tasks/${taskId}/dependencies/remove`, { dependsOnTaskId }, { headers });
    fetchTasks();
  };

  const [autoScheduling, setAutoScheduling] = useState(false);
  const [autoScheduleResult, setAutoScheduleResult] = useState<{ count: number; names: string[]; cycles: string[] } | null>(null);

  const autoSchedule = async () => {
    setAutoScheduling(true);
    try {
      // 1. Topological sort עם זיהוי מעגלים
      const color: Record<string, 0 | 1 | 2> = {};
      const topoOrder: string[] = [];
      const cycleTaskIds = new Set<string>();
      const getDepIds = (t: any): string[] => t.dependencies?.map((d: any) => d.dependsOnTaskId) || [];

      const dfs = (id: string) => {
        if (color[id] === 2) return;
        if (color[id] === 1) { cycleTaskIds.add(id); return; }
        color[id] = 1;
        const t = tasks.find(x => x.id === id);
        for (const depId of getDepIds(t)) {
          if (color[depId] === 1) cycleTaskIds.add(depId);
          dfs(depId);
          if (cycleTaskIds.has(depId)) cycleTaskIds.add(id);
        }
        color[id] = 2;
        topoOrder.push(id);
      };
      for (const t of tasks) dfs(t.id);

      // 2. מעבר לפי סדר טופולוגי — חישוב זמנים
      const computed = new Map<string, { start: Date | null; end: Date | null }>();
      const versionStart = versionData?.plannedStart ? new Date(versionData.plannedStart) : null;

      for (const taskId of topoOrder) {
        const task = tasks.find(t => t.id === taskId);
        if (!task) continue;

        // משימה שכבר בביצוע או הושלמה — משמשת כעוגן בלבד, לא נשנה אותה
        if (task.status === 'IN_PROGRESS' || task.status === 'DONE' || task.startedAt) {
          const anchorStart = task.startedAt ? new Date(task.startedAt)
            : (task.plannedStart ? new Date(task.plannedStart) : null);
          const anchorEnd = task.completedAt ? new Date(task.completedAt)
            : (task.plannedEnd ? new Date(task.plannedEnd) : null);
          computed.set(taskId, { start: anchorStart, end: anchorEnd });
          continue;
        }

        let start: Date | null = task.plannedStart ? new Date(task.plannedStart) : null;

        // דחוף את ההתחלה אחרי סיום כל התלויות
        for (const dep of (task.dependencies || [])) {
          const depComp = computed.get(dep.dependsOnTaskId);
          const depEnd = depComp?.end
            ?? (dep.dependsOn?.plannedEnd ? new Date(dep.dependsOn.plannedEnd) : null);
          if (depEnd && (!start || depEnd > start)) {
            start = new Date(depEnd.getTime());
          }
        }

        // אם עדיין אין שעת התחלה — השתמש בשעת תחילת הגרסה כברירת מחדל
        if (!start && versionStart) {
          start = new Date(versionStart.getTime());
        }

        let end: Date | null = null;
        if (start) {
          const mins = parseDurationMins(task.duration || '');
          if (mins) {
            end = new Date(start.getTime() + mins * 60000);
          } else if (task.plannedEnd) {
            end = new Date(task.plannedEnd);
          }
        }

        computed.set(taskId, { start, end });
      }

      // 3. עדכון רק משימות שהשתנו (ולא כאלה שבביצוע / הושלמו)
      const updatedNames: string[] = [];
      await Promise.all(
        Array.from(computed.entries()).map(([taskId, { start, end }]) => {
          const task = tasks.find(t => t.id === taskId);
          if (!task) return Promise.resolve();
          if (task.status === 'IN_PROGRESS' || task.status === 'DONE' || task.startedAt) return Promise.resolve();
          const fields: any = {};
          const existStart = task.plannedStart ? new Date(task.plannedStart).getTime() : null;
          const existEnd   = task.plannedEnd   ? new Date(task.plannedEnd).getTime()   : null;
          if (start && start.getTime() !== existStart) fields.plannedStart = start.toISOString();
          if (end   && end.getTime()   !== existEnd)   fields.plannedEnd   = end.toISOString();
          if (!Object.keys(fields).length) return Promise.resolve();
          updatedNames.push(task.title);
          return axios.patch(`${API}/tasks/${taskId}`, fields, { headers }).catch(console.error);
        })
      );

      const cycleNames = Array.from(cycleTaskIds)
        .map(id => tasks.find(t => t.id === id)?.title)
        .filter(Boolean) as string[];

      setAutoScheduleResult({ count: updatedNames.length, names: updatedNames, cycles: cycleNames });
      fetchTasks();
      onTaskUpdated?.();
    } finally {
      setAutoScheduling(false);
    }
  };

  const headers = { Authorization: `Bearer ${token}` };

  const fetchTasks = async () => {
    setLoading(true);
    try {
      if (versionId) {
        const [tasksRes, verRes] = await Promise.all([
          axios.get(`${API}/tasks?versionId=${versionId}`, { headers }),
          axios.get(`${API}/versions/${versionId}`, { headers }),
        ]);
        setTasks(tasksRes.data);
        setVersionData(verRes.data);
      } else {
        const params = new URLSearchParams();
        if (teamId) params.set('teamId', teamId);
        const res = await axios.get(`${API}/tasks?${params.toString()}`, { headers });
        setTasks(res.data);
      }
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  useEffect(() => {
    fetchTasks();
    axios.get(`${API}/users`, { headers })
      .then(r => setUsers(r.data.filter((u: any) => u.active).sort((a: any, b: any) => a.fullName.localeCompare(b.fullName, 'he'))))
      .catch(() => {});
  }, [teamId, versionId, refreshKey]); // eslint-disable-line

  const fetchProposals = async () => {
    if (!FEATURES.TEAM_LEAD_PROPOSAL || !versionId) return;
    try {
      const res = await axios.get(`${API}/task-proposals/version/${versionId}`, { headers });
      setProposals(res.data.filter((p: any) => !p.usedInTaskId));
    } catch { /* silent — EMPLOYEE role will get 403, that's fine */ }
  };

  // Auto-open anomaly panel in planning mode; clear stale task selection
  useEffect(() => {
    if (versionData && !['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(versionData.status)) {
      setShowAnomalies(true);
      setSelectedTaskIds(new Set());
      fetchProposals();
    }
  }, [versionData?.id]); // eslint-disable-line

  // Notify parent when all required tasks are done (for "go to summary" button)
  // Also report current phase name
  useEffect(() => {
    if (!versionData || tasks.length === 0) return;
    const vStatus = versionData.status;

    // Build subPhaseId → phase.orderIndex and phase.name maps
    const subToOrder: Record<string, number> = {};
    const subToPhase: Record<string, string> = {};
    for (const phase of (versionData.phases || [])) {
      for (const sub of (phase.subPhases || [])) {
        subToOrder[sub.id] = phase.orderIndex;
        subToPhase[sub.id] = phase.name;
      }
    }

    if (onSummaryReady) {
      if (vStatus === 'REHEARSAL') {
        onSummaryReady(tasks.every((t: any) => t.status === 'DONE'));
      } else if (vStatus === 'ACTIVE') {
        const first3 = tasks.filter((t: any) => (subToOrder[t.subPhaseId] ?? 99) <= 3);
        onSummaryReady(first3.length > 0 && first3.every((t: any) => t.status === 'DONE'));
      } else if (vStatus === 'MORNING_AFTER') {
        onSummaryReady(tasks.length > 0 && tasks.every((t: any) => t.status === 'DONE'));
      } else {
        onSummaryReady(false);
      }
    }

    if (onCurrentPhaseChange && (vStatus === 'ACTIVE' || vStatus === 'MORNING_AFTER' || vStatus === 'REHEARSAL')) {
      // Find lowest-orderIndex phase that still has non-terminal tasks
      const sortedPhases = [...(versionData.phases || [])].sort((a: any, b: any) => a.orderIndex - b.orderIndex);
      let currentPhase: string | null = null;
      for (const phase of sortedPhases) {
        const phaseTasks = tasks.filter((t: any) => subToOrder[t.subPhaseId] === phase.orderIndex);
        if (phaseTasks.length > 0 && phaseTasks.some((t: any) => !TERMINAL.has(t.status))) {
          currentPhase = phase.name;
          break;
        }
      }
      onCurrentPhaseChange(currentPhase);
    }
  }, [tasks, versionData]); // eslint-disable-line

  const updateStatus = async (taskId: string, status: string, reason?: string) => {
    setUpdatingId(taskId);
    try {
      await axios.patch(`${API}/tasks/${taskId}/status`, { status }, { headers });
      if (reason) await axios.patch(`${API}/tasks/${taskId}`, { blockedReason: reason }, { headers });
      setShowBlockedInput(null);
      fetchTasks();
      onTaskUpdated?.();
    } catch (err) { console.error(err); }
    finally { setUpdatingId(null); }
  };

  const openNoDeps = async () => {
    const eligible = tasks.filter(t =>
      t.status === 'WAITING' &&
      (!t.dependencies?.length || t.dependencies.every((d: any) => d.dependsOn?.status === 'DONE'))
    );
    await Promise.all(
      eligible.map(t => axios.patch(`${API}/tasks/${t.id}/status`, { status: 'OPEN' }, { headers }).catch(() => {}))
    );
    fetchTasks();
    onTaskUpdated?.();
  };

  const bulkUpdateStatus = async (status: 'IN_PROGRESS' | 'DONE') => {
    await Promise.all(
      Array.from(selectedTaskIds).map(id =>
        axios.patch(`${API}/tasks/${id}/status`, { status }, { headers }).catch(() => {})
      )
    );
    setSelectedTaskIds(new Set());
    fetchTasks();
    onTaskUpdated?.();
  };

  const saveDelayReason = async (taskId: string) => {
    const ds = delayState[taskId];
    if (!ds?.category) return;
    const finalReason = ds.freeText?.trim()
      ? `${ds.category}: ${ds.freeText.trim()}`
      : ds.category;
    try {
      await axios.patch(`${API}/tasks/${taskId}`, { delayReason: finalReason }, { headers });
      setDelayState(prev => { const n = { ...prev }; delete n[taskId]; return n; });
      fetchTasks();
    } catch (err) { console.error(err); }
  };

  const addTask = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.title.trim()) return;
    setAdding(true); setAddError(null);
    try {
      const res = await axios.post(`${API}/tasks`, {
        title: form.title.trim(),
        notes: form.notes.trim() || undefined,
        crNumber: form.crNumber.trim() || undefined,
        application: form.application || undefined,
        priority: form.priority,
        assignedUserName: form.assignedUserName.trim() || undefined,
        assignedTeamId: teamId,
        ...(versionId && { versionId }),
      }, { headers });
      // mark proposal as used if this task came from one
      if (FEATURES.TEAM_LEAD_PROPOSAL && selectedProposalId) {
        await axios.patch(`${API}/task-proposals/${selectedProposalId}/mark-used`, { taskId: res.data.id }, { headers }).catch(() => {});
        setSelectedProposalId(null);
      }
      setForm(emptyForm); setShowAddForm(false);
      fetchTasks(); fetchProposals(); onTaskUpdated?.();
    } catch (err: any) {
      setAddError(err?.response?.data?.message || 'שגיאה בהוספת המשימה');
    } finally { setAdding(false); }
  };

  // Teams present in tasks (for filter bar)
  const teamsInTasks: { id: string; name: string }[] = Array.from(
    new Map(
      tasks.filter(t => t.assignedTeamId && t.assignedTeam?.name)
           .map(t => [t.assignedTeamId, { id: t.assignedTeamId, name: t.assignedTeam.name }])
    ).values()
  ).sort((a, b) => a.name.localeCompare(b.name));

  const teamFilteredTasks = localTeamFilter
    ? tasks.filter(t => t.assignedTeamId === localTeamFilter)
    : tasks;

  // Returns true if this task belongs to the current user (or is unassigned / team-wide)
  const matchesUser = (t: any): boolean => {
    if (!userId) return true;
    if (!t.assignedUserId && !t.assignedUserName) return true; // team-wide
    if (t.assignedUserId === userId) return true;
    if (!t.assignedUserId && userName &&
        t.assignedUserName?.trim().toLowerCase() === userName.trim().toLowerCase()) return true;
    return false;
  };

  const userFilteredTasks = userId ? teamFilteredTasks.filter(matchesUser) : teamFilteredTasks;

  const displayTasks = localStatusFilter
    ? userFilteredTasks.filter(t => t.status === localStatusFilter)
    : userFilteredTasks;

  const statusCounts = userFilteredTasks.reduce((acc: Record<string, number>, t: any) => {
    acc[t.status] = (acc[t.status] || 0) + 1; return acc;
  }, {} as Record<string, number>);

  // subPhaseId → tasks
  const taskBySub: Record<string, any[]> = tasks.reduce((acc: any, t: any) => {
    const k = t.subPhaseId || '__none__';
    (acc[k] = acc[k] || []).push(t); return acc;
  }, {});

  // Compute earliest start / latest end across a list of tasks
  const calcSpanStart = (list: any[]): Date | null => {
    const ms = list.filter(t => t.plannedStart).map(t => new Date(t.plannedStart).getTime());
    return ms.length ? new Date(Math.min(...ms)) : null;
  };
  const calcSpanEnd = (list: any[]): Date | null => {
    const ms = list.map(t => {
      if (t.plannedEnd) return new Date(t.plannedEnd).getTime();
      if (t.plannedStart && t.duration) {
        const m = parseDurationMins(t.duration);
        if (m) return new Date(t.plannedStart).getTime() + m * 60000;
      }
      return null;
    }).filter(Boolean) as number[];
    return ms.length ? new Date(Math.max(...ms)) : null;
  };
  const fmtDurMins = (mins: number): string => {
    if (mins < 60) return `${mins} דק'`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}ש' ${m}דק'` : `${h}ש'`;
  };
  const fmtSpan = (list: any[]): { time: string; dur: string } | null => {
    const s = calcSpanStart(list);
    const e = calcSpanEnd(list);
    if (!s && !e) return null;
    const sf = s ? fmtTime(s.toISOString()) : '?';
    const ef = e ? fmtTime(e.toISOString()) : '?';
    const durStr = (s && e) ? fmtDurMins(Math.round((e.getTime() - s.getTime()) / 60000)) : '';
    return { time: `${sf} — ${ef}`, dur: durStr };
  };

  const toggleSelect = (id: string) =>
    setSelectedTaskIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const selectGroup = (ids: string[]) =>
    setSelectedTaskIds(prev => { const n = new Set(prev); ids.forEach(id => n.add(id)); return n; });

  const togglePhase = (id: string) =>
    setCollapsedPhases(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleSub = (id: string) =>
    setCollapsedSubs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const toggleCompleted = (key: string) =>
    setExpandedCompleted(prev => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });

  // ── Delay panel sub-component ──
  const DelayPanel = ({ task }: { task: any }) => {
    if (task.delayReason) {
      return (
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#7d5500', background: '#fff8e1', padding: '5px 10px', borderRadius: '6px' }}>
          ⚠️ סיבת עיכוב: {task.delayReason}
        </div>
      );
    }
    if (!isDelayed(task)) return null;
    const ds = delayState[task.id] || { category: '', freeText: '' };
    return (
      <div style={{ marginTop: '8px', padding: '10px', background: '#fff8e1', borderRadius: '8px', border: '1px solid #f0c040' }}>
        <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#7d5500', marginBottom: '6px' }}>
          ⚠️ עיכוב: {actualMins(task)} דק' בפועל / {plannedMins(task)} דק' מתוכנן — נא לציין סיבה
        </div>
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'flex-start' }}>
          <select
            value={ds.category}
            onChange={e => setDelayState(p => ({ ...p, [task.id]: { ...ds, category: e.target.value } }))}
            style={{ padding: '5px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', direction: 'rtl' }}
          >
            <option value="">— בחר סיבה —</option>
            {DELAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
          <input
            placeholder="פירוט נוסף (אופציונלי)"
            value={ds.freeText}
            onChange={e => setDelayState(p => ({ ...p, [task.id]: { ...ds, freeText: e.target.value } }))}
            style={{ flex: 1, minWidth: '150px', padding: '5px 8px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px' }}
          />
          <button
            onClick={() => saveDelayReason(task.id)}
            disabled={!ds.category}
            style={{ padding: '5px 12px', background: ds.category ? '#e67e22' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: ds.category ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
          >
            שמור
          </button>
        </div>
      </div>
    );
  };

  // ── Task row ──
  const TaskRow = ({ task }: { task: any }) => {
    const isSelected = selectedTaskIds.has(task.id);
    const delayed = isDelayed(task);
    const overdue = isOverdue(task);
    const overtime = isOvertime(task);
    const lateStart = isLateStart(task);
    const sc = STATUS_COLORS[task.status] || '#999';
    const isActive = task.status === 'OPEN' || task.status === 'IN_PROGRESS';
    const hasAlert = (delayed && !task.delayReason) || overdue || overtime;

    return (
      <div
        id={`task-row-${task.id}`}
        style={{
          borderRadius: '8px', padding: '9px 12px', marginBottom: '5px',
          borderRight: `4px solid ${sc}`,
          border: `1px solid ${overtime ? '#e74c3c' : overdue ? '#e67e22' : delayed && !task.delayReason ? '#f0c040' : sc + '33'}`,
          borderRightColor: sc,
          background: isSelected ? '#e8f4fd' : overtime ? '#fff5f5' : overdue ? '#fffaf5' : delayed && !task.delayReason ? '#fffdf0' : 'white',
        }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
          {isExecutionMode && <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(task.id)}
            style={{ marginTop: '3px', cursor: 'pointer', flexShrink: 0 }} />}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 'bold', fontSize: '14px', color: '#1a2332' }}>{task.title}</span>
              <span style={{ fontSize: '11px', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold', background: sc + '22', color: sc, border: `1px solid ${sc}` }}>
                {STATUS_LABELS[task.status] || task.status}
              </span>
              {overtime && (
                <span style={{ fontSize: '11px', background: '#fee', color: '#c0392b', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold' }}>
                  🔴 חריגת זמן
                </span>
              )}
              {overdue && !overtime && (
                <span style={{ fontSize: '11px', background: '#fff3e0', color: '#e65100', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold' }}>
                  🕐 טרם התחיל
                </span>
              )}
              {delayed && !task.delayReason && !overtime && (
                <span style={{ fontSize: '11px', background: '#fee', color: '#c0392b', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold' }}>
                  ⚠️ עיכוב
                </span>
              )}
              {lateStart && task.delayReason === null && (
                <span style={{ fontSize: '11px', background: '#f3e8ff', color: '#6c3483', padding: '1px 7px', borderRadius: '10px' }}>
                  ⏱ התחיל באיחור
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginTop: '4px', fontSize: '12px' }}>
              {task.crNumber && <span style={{ background: '#e8f4fd', color: '#2980b9', padding: '1px 7px', borderRadius: '4px' }}>{task.crNumber}</span>}
              {task.application && <span style={{ background: '#f0f0f0', color: '#555', padding: '1px 7px', borderRadius: '4px' }}>{task.application}</span>}
              {task.assignedTeam?.name && <span style={{ color: '#888' }}>👥 {task.assignedTeam.name}</span>}
              {task.assignedUserName && <span style={{ color: '#666' }}>👤 {task.assignedUserName}</span>}
              {task.plannedStart && (
                <span style={{ background: '#fff3e0', color: '#e65100', padding: '1px 7px', borderRadius: '4px' }}>
                  ⏰ {fmtTime(task.plannedStart)}{task.plannedEnd ? ` — ${fmtTime(task.plannedEnd)}` : ''}{task.duration ? ` · ${task.duration}` : ''}
                </span>
              )}
              {task.actualStart && (
                <span style={{ background: '#e8f5e9', color: '#27ae60', padding: '1px 7px', borderRadius: '4px' }}>
                  ▶ {fmtTime(task.actualStart)}{task.actualFinish ? ` ■ ${fmtTime(task.actualFinish)}` : ' …'}
                  {delayed && actualMins(task) ? ` (${actualMins(task)}דק')` : ''}
                </span>
              )}
            </div>
            {task.dependencies?.length > 0 && (
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px', fontSize: '11px', alignItems: 'center' }}>
                <span style={{ color: '#aaa' }}>ממתין ל:</span>
                {task.dependencies.map((d: any) => {
                  const done = d.dependsOn?.status === 'DONE';
                  return (
                    <span key={d.dependsOnTaskId} style={{ padding: '1px 7px', borderRadius: '10px', background: done ? '#e8f5e9' : '#fee', color: done ? '#27ae60' : '#c0392b', border: `1px solid ${done ? '#a9dfbf' : '#f5b7b1'}` }}>
                      {done ? '✓' : '⏳'} {d.dependsOn?.title || d.dependsOnTaskId}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action buttons — execution mode only */}
          {isExecutionMode && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexShrink: 0 }}>
              {task.status === 'WAITING' && (
                <button onClick={() => updateStatus(task.id, 'OPEN')} disabled={updatingId === task.id}
                  style={{ padding: '5px 10px', background: '#3498db', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                  פתח לביצוע
                </button>
              )}
              {task.status === 'OPEN' && (
                <button onClick={() => updateStatus(task.id, 'IN_PROGRESS')} disabled={updatingId === task.id}
                  style={{ padding: '5px 10px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                  ▶ התחל
                </button>
              )}
              {task.status === 'IN_PROGRESS' && (
                <button onClick={() => updateStatus(task.id, 'DONE')} disabled={updatingId === task.id}
                  style={{ padding: '5px 10px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold' }}>
                  ✓ סיים
                </button>
              )}
              {isActive && (
                <button onClick={() => setShowBlockedInput(task.id)}
                  style={{ padding: '5px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
                  🚫 חסום
                </button>
              )}
              {task.status === 'BLOCKED' && (
                <>
                  <button onClick={() => updateStatus(task.id, 'IN_PROGRESS')} disabled={updatingId === task.id}
                    style={{ padding: '5px 10px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
                    ♻️ חזור
                  </button>
                  <button onClick={() => updateStatus(task.id, 'FAILED')} disabled={updatingId === task.id}
                    style={{ padding: '5px 10px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
                    ✗ נכשל
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Blocked reason input */}
        {showBlockedInput === task.id && (
          <BlockedReasonForm
            onSubmit={reason => updateStatus(task.id, 'BLOCKED', reason)}
            onCancel={() => setShowBlockedInput(null)}
          />
        )}
        {task.blockedReason && task.status === 'BLOCKED' && (
          <div style={{ marginTop: '5px', fontSize: '12px', color: '#c0392b' }}>🚫 {task.blockedReason}</div>
        )}

        <DelayPanel task={task} />
      </div>
    );
  };

  // ── Anomaly detection ──
  type Severity = 'high' | 'medium' | 'low';
  interface Anomaly { task: any; type: string; reason: string; severity: Severity }

  const detectAnomalies = (): Anomaly[] => {
    const now = new Date();
    const result: Anomaly[] = [];
    // Runtime checks (overtime, overdue, delays) only make sense when the deployment is live
    const isExecMode = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(versionData?.status);

    // ── Helper: compute planned end time of a task (ms) ──
    const plannedEndMs = (t: any): number | null => {
      if (t.plannedEnd) return new Date(t.plannedEnd).getTime();
      if (t.plannedStart && t.duration) {
        const mins = parseDurationMins(t.duration);
        if (mins) return new Date(t.plannedStart).getTime() + mins * 60000;
      }
      return null;
    };

    // ── Circular dependency detection (DFS coloring) ──
    const depMap: Record<string, string[]> = {};
    for (const t of tasks) {
      depMap[t.id] = t.dependencies?.map((d: any) => d.dependsOnTaskId) || [];
    }
    // 0=unvisited, 1=on-stack, 2=done
    const color: Record<string, number> = {};
    const cycleNodes = new Set<string>();

    const dfsColor = (id: string): boolean => {
      if (color[id] === 1) return true;
      if (color[id] === 2) return false;
      color[id] = 1;
      let inCycle = false;
      for (const nid of (depMap[id] || [])) {
        if (dfsColor(nid)) { inCycle = true; cycleNodes.add(nid); }
      }
      color[id] = 2;
      if (inCycle) cycleNodes.add(id);
      return inCycle;
    };
    for (const t of tasks) { if (!color[t.id]) dfsColor(t.id); }

    for (const t of tasks) {
      if (['DONE', 'ROLLED_BACK'].includes(t.status)) continue;

      // ── Runtime anomalies (execution mode only) ──
      if (isExecMode) {
        if (t.status === 'BLOCKED' && !t.blockedReason) {
          result.push({ task: t, type: 'חסום ללא סיבה', severity: 'high',
            reason: 'משימה חסומה אך לא הוזנה סיבת חסימה' });
        }
        if (t.status === 'BLOCKED' && t.blockedReason) {
          result.push({ task: t, type: 'חסומה', severity: 'high',
            reason: `סיבה: ${t.blockedReason}` });
        }
        if (isOvertime(t)) {
          result.push({ task: t, type: 'חריגת זמן', severity: 'high',
            reason: `בביצוע מעבר לשעת הסיום המתוכננת${t.plannedEnd ? ` (${fmtTime(t.plannedEnd)})` : ''}` });
        }
        if (isOverdue(t)) {
          const delayMins = Math.round((now.getTime() - new Date(t.plannedStart).getTime()) / 60000);
          result.push({ task: t, type: 'טרם התחילה', severity: delayMins > 30 ? 'high' : 'medium',
            reason: `הייתה אמורה להתחיל ב-${fmtTime(t.plannedStart)} — איחור של ${delayMins} דק'` });
        }
        if (isDelayed(t) && !t.delayReason) {
          result.push({ task: t, type: 'עיכוב משמעותי', severity: 'medium',
            reason: `${actualMins(t)} דק' בפועל לעומת ${plannedMins(t)} דק' מתוכנן` });
        }
        if (isLateStart(t) && !t.delayReason) {
          const lateBy = Math.round((new Date(t.actualStart).getTime() - new Date(t.plannedStart).getTime()) / 60000);
          result.push({ task: t, type: 'התחיל באיחור', severity: 'low',
            reason: `התחיל ${lateBy} דק' לאחר הזמן (תוכנן ${fmtTime(t.plannedStart)}, התחיל ${fmtTime(t.actualStart)})` });
        }

        // Runtime dependency anomalies
        if (['OPEN', 'IN_PROGRESS'].includes(t.status) && t.dependencies?.some((d: any) => d.dependsOn?.status !== 'DONE')) {
          const pending = t.dependencies
            .filter((d: any) => d.dependsOn?.status !== 'DONE')
            .map((d: any) => d.dependsOn?.title || '?')
            .join(', ');
          result.push({ task: t, type: 'תלות לא הושלמה', severity: 'medium',
            reason: `תלויה במשימות שטרם סיימו: ${pending}` });
        }
        if (t.actualStart && t.dependencies?.length) {
          const startedEarlyDeps = t.dependencies.filter((d: any) => {
            const dep = d.dependsOn;
            return dep?.actualFinish && new Date(t.actualStart) < new Date(dep.actualFinish);
          });
          if (startedEarlyDeps.length) {
            const names = startedEarlyDeps.map((d: any) => d.dependsOn?.title || '?').join(', ');
            result.push({ task: t, type: 'הופעלה לפני תלות', severity: 'high',
              reason: `החלה לפני שהתלויות שלה הסתיימו: ${names}` });
          }
        }
        if (['OPEN', 'IN_PROGRESS'].includes(t.status) && !t.assignedUserId && !t.assignedUserName) {
          result.push({ task: t, type: 'ללא אחראי', severity: 'low',
            reason: 'משימה פעילה ללא עובד משוייך' });
        }
      }

      // ── Planning dependency anomalies ──
      // Scheduling conflict: task planned to start before its dependency ends
      if (t.plannedStart && t.dependencies?.length) {
        const tStart = new Date(t.plannedStart).getTime();
        for (const d of t.dependencies) {
          const dep = d.dependsOn;
          if (!dep) continue;
          const depEnd = plannedEndMs(dep);
          if (depEnd && tStart < depEnd) {
            result.push({ task: t, type: 'קונפליקט תזמון', severity: 'high',
              reason: `מתוזמנת להתחיל ב-${fmtTime(t.plannedStart)} אך תלויה ב"${dep.title}" שמסתיימת ב-${fmtTime(new Date(depEnd).toISOString())}` });
            break;
          }
        }
      }

      // ── Circular dependency ──
      if (cycleNodes.has(t.id)) {
        const cycleDeps = t.dependencies
          ?.filter((d: any) => cycleNodes.has(d.dependsOnTaskId))
          .map((d: any) => d.dependsOn?.title || '?')
          .join(', ');
        result.push({ task: t, type: 'תלות מעגלית', severity: 'high',
          reason: cycleDeps
            ? `יוצרת מעגל עם: ${cycleDeps}`
            : 'תלות מעגלית — המשימה תלויה (בעקיפין) בעצמה' });
      }

    }

    // ── Phase-level overrun checks ──
    if (versionData?.phases?.length) {
      for (const phase of versionData.phases) {
        // Only check when phase has an explicit end time — avoids false positives
        // when version.plannedStart doesn't match actual task dates
        const cutoffMs: number | null = phase.plannedEnd
          ? new Date(phase.plannedEnd).getTime()
          : null;
        if (!cutoffMs) continue;

        const phaseTasks: any[] = (phase.subPhases || []).flatMap((s: any) => s.tasks || []);
        // Only duration-having tasks: no-duration tasks are skipped by the reschedule engine so their stale plannedEnd causes false positives.
        const active = phaseTasks.filter((t: any) =>
          !['DONE', 'ROLLED_BACK'].includes(t.status) &&
          parseDurationMins(t.duration || '') !== null,
        );
        let latestEndMs = 0;
        let lastTask: any = null;
        for (const t of active) {
          const endMs = plannedEndMs(t);
          if (endMs && endMs > latestEndMs) { latestEndMs = endMs; lastTask = t; }
        }
        if (lastTask && latestEndMs > cutoffMs) {
          const overrunMins = Math.round((latestEndMs - cutoffMs) / 60000);
          result.push({
            task: lastTask,
            type: 'חריגת שלב',
            severity: 'medium',
            reason: `שלב "${phase.name}" צפוי לסיים ב-${fmtTime(new Date(latestEndMs).toISOString())} — חורג ב-${overrunMins} דק' מהמועד ${fmtTime(new Date(cutoffMs).toISOString())}`,
          });
        }
      }
    }

    const sevOrder: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
    return result.sort((a, b) => sevOrder[a.severity] - sevOrder[b.severity]);
  };

  const anomalies = detectAnomalies();
  const anomalyCount = anomalies.length;
  const highCount = anomalies.filter(a => a.severity === 'high').length;

  if (loading) return <div style={{ textAlign: 'center', padding: '60px', color: '#666' }}>טוען...</div>;

  const usePhaseView = !!(versionData?.phases?.length);
  const isLocked = versionData?.status === 'ACTIVE';
  const isExecutionMode = ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(versionData?.status);

  // Delay summary counters
  const overdueCount  = tasks.filter(t => isOverdue(t)).length;
  const overtimeCount = tasks.filter(t => isOvertime(t)).length;
  const needReasonCount = tasks.filter(t => isDelayed(t) && !t.delayReason).length;
  const hasDelayAlerts = overdueCount > 0 || overtimeCount > 0 || needReasonCount > 0;

  return (
    <div style={{ direction: 'rtl', fontFamily: 'Arial' }}>

      {/* ── Lock banner ── */}
      {isLocked && (
        <div style={{ background: '#fff3e0', border: '2px solid #e65100', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '20px' }}>🔒</span>
          <div>
            <span style={{ fontWeight: 'bold', color: '#b7380a', fontSize: '14px' }}>גרסה פעילה — מצב ביצוע</span>
            <span style={{ color: '#e65100', fontSize: '12px', marginRight: '8px' }}>לא ניתן להוסיף משימות או לערוך פרטים</span>
          </div>
        </div>
      )}

      {/* ── Delay summary panel ── */}
      {hasDelayAlerts && (
        <div style={{ background: '#fff8f0', border: '1px solid #f0c040', borderRadius: '10px', padding: '10px 16px', marginBottom: '10px', display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontWeight: 'bold', color: '#7d5500', fontSize: '13px' }}>⚠️ עיכובים:</span>
          {overdueCount > 0 && (
            <span style={{ background: '#fff3e0', color: '#e65100', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #ffcc80' }}>
              🕐 {overdueCount} טרם התחילו (איחור)
            </span>
          )}
          {overtimeCount > 0 && (
            <span style={{ background: '#fee', color: '#c0392b', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #f5b7b1' }}>
              🔴 {overtimeCount} חרגו מזמן הסיום
            </span>
          )}
          {needReasonCount > 0 && (
            <span style={{ background: '#fff8e1', color: '#7d5500', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #f0c040' }}>
              📝 {needReasonCount} ממתינות לסיבת עיכוב
            </span>
          )}
        </div>
      )}

      {/* ── Anomaly panel ── */}
      {showAnomalies && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.1)', border: `2px solid ${highCount > 0 ? '#e74c3c' : anomalyCount > 0 ? '#e67e22' : '#27ae60'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '18px' }}>🔍</span>
              <span style={{ fontWeight: 'bold', color: '#1a2332', fontSize: '15px' }}>
                בדיקת חריגות
              </span>
              <span style={{ fontSize: '12px', color: '#888' }}>
                {anomalyCount === 0 ? '✅ לא נמצאו חריגות' : `נמצאו ${anomalyCount} חריגות`}
              </span>
              {highCount > 0 && (
                <span style={{ background: '#fee', color: '#c0392b', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: 'bold', border: '1px solid #f5b7b1' }}>
                  {highCount} דחופות
                </span>
              )}
            </div>
            <button onClick={() => setShowAnomalies(false)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '18px', color: '#999', lineHeight: 1 }}>
              ✕
            </button>
          </div>

          {anomalyCount === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px', color: '#27ae60', fontSize: '14px' }}>
              ✅ כל המשימות תקינות — אין חריגות
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {anomalies.map((a, i) => {
                const sevStyle: Record<Severity, { bg: string; border: string; badge: string; badgeBg: string; icon: string }> = {
                  high:   { bg: '#fff5f5', border: '#f5b7b1', badge: 'דחוף',   badgeBg: '#e74c3c', icon: '🔴' },
                  medium: { bg: '#fffaf0', border: '#f0c040', badge: 'בינוני', badgeBg: '#e67e22', icon: '🟡' },
                  low:    { bg: '#f8f9ff', border: '#c5cae9', badge: 'נמוך',   badgeBg: '#7f8c8d', icon: '🔵' },
                };
                const s = sevStyle[a.severity];
                return (
                  <div key={i} style={{ background: s.bg, border: `1px solid ${s.border}`, borderRadius: '8px', padding: '10px 14px' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ fontSize: '16px', flexShrink: 0, marginTop: '1px' }}>{s.icon}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '3px' }}>
                        <span style={{ fontWeight: 'bold', fontSize: '13px', color: '#1a2332' }}>
                          {a.task.title}
                        </span>
                        <span style={{ background: s.badgeBg, color: 'white', fontSize: '10px', fontWeight: 'bold', padding: '1px 7px', borderRadius: '8px' }}>
                          {a.type}
                        </span>
                        <span style={{ background: s.badgeBg + '22', color: s.badgeBg, fontSize: '10px', padding: '1px 7px', borderRadius: '8px', border: `1px solid ${s.badgeBg}44` }}>
                          {s.badge}
                        </span>
                      </div>
                      <div style={{ fontSize: '12px', color: '#555' }}>
                        {a.reason}
                        {a.task.assignedTeam?.name && (
                          <span style={{ color: '#888', marginRight: '8px' }}>· {a.task.assignedTeam.name}</span>
                        )}
                        {a.task.assignedUserName && (
                          <span style={{ color: '#888', marginRight: '4px' }}>· {a.task.assignedUserName}</span>
                        )}
                      </div>
                    </div>
                    {a.type === 'חריגת שלב' && onOpenReschedule ? (
                      <button
                        onClick={onOpenReschedule}
                        style={{ flexShrink: 0, padding: '4px 12px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                      >
                        📅 תזמון מחדש
                      </button>
                    ) : (
                      <button
                        onClick={() => openAnomalyEdit(i, a.task)}
                        style={{ flexShrink: 0, padding: '4px 12px', background: anomalyEditIdx === i ? '#555' : '#2d4a7a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap' }}
                      >
                        {anomalyEditIdx === i ? '✕ סגור' : '✏️ ערוך'}
                      </button>
                    )}
                    </div>{/* end inner row */}

                  {/* ── Inline anomaly edit form ── */}
                  {anomalyEditIdx === i && (
                    <div style={{ marginTop: '10px', background: '#f4f6ff', borderRadius: '8px', padding: '12px 14px', border: '1px solid #c5cae9', display: 'flex', flexDirection: 'column', gap: '12px' }}>

                      {/* Time fields — for scheduling / overtime / overdue anomalies */}
                      {['קונפליקט תזמון', 'טרם התחילה', 'חריגת זמן', 'עיכוב משמעותי'].includes(a.type) && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#2d4a7a', marginBottom: '8px' }}>⏰ עדכון זמנים</div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '8px' }}>
                            <div>
                              <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '2px' }}>תחילה מתוכננת</label>
                              <input type="datetime-local" value={anomalyEditForm.plannedStart}
                                onChange={e => setAnomalyEditForm(f => ({ ...f, plannedStart: e.target.value }))}
                                style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '2px' }}>סיום מתוכנן</label>
                              <input type="datetime-local" value={anomalyEditForm.plannedEnd}
                                onChange={e => setAnomalyEditForm(f => ({ ...f, plannedEnd: e.target.value }))}
                                style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px', boxSizing: 'border-box' }} />
                            </div>
                            <div>
                              <label style={{ fontSize: '11px', color: '#777', display: 'block', marginBottom: '2px' }}>משך (45ד׳ / 1ש׳ 30ד׳)</label>
                              <input value={anomalyEditForm.duration}
                                onChange={e => setAnomalyEditForm(f => ({ ...f, duration: e.target.value }))}
                                placeholder="לדוגמה: 45ד'"
                                style={{ width: '100%', padding: '5px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px', boxSizing: 'border-box' }} />
                            </div>
                          </div>
                          <button onClick={() => saveAnomalyFields(a.task.id, {
                              plannedStart: anomalyEditForm.plannedStart || null,
                              plannedEnd:   anomalyEditForm.plannedEnd   || null,
                              duration:     anomalyEditForm.duration     || null,
                            })}
                            style={{ padding: '5px 16px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}>
                            שמור זמנים
                          </button>
                        </div>
                      )}

                      {/* Dependency list with remove buttons */}
                      {['תלות מעגלית', 'קונפליקט תזמון', 'הופעלה לפני תלות', 'תלות לא הושלמה'].includes(a.type) && a.task.dependencies?.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#2d4a7a', marginBottom: '6px' }}>🔗 תלויות — הסר קישורים שגויים</div>
                          {a.task.dependencies.map((d: any) => {
                            const dep = d.dependsOn;
                            const isProblematic = (() => {
                              if (!dep) return false;
                              if (a.type === 'תלות מעגלית') return true;
                              if (a.type === 'תלות לא הושלמה') return dep.status !== 'DONE';
                              if ((a.type === 'קונפליקט תזמון' || a.type === 'הופעלה לפני תלות') && a.task.plannedStart && dep.plannedStart) {
                                const depEndMs = dep.plannedEnd
                                  ? new Date(dep.plannedEnd).getTime()
                                  : (() => { const m = parseDurationMins(dep.duration || ''); return m && dep.plannedStart ? new Date(dep.plannedStart).getTime() + m * 60000 : null; })();
                                return !!(depEndMs && new Date(a.task.plannedStart).getTime() < depEndMs);
                              }
                              return false;
                            })();
                            return (
                              <div key={d.dependsOnTaskId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 8px', background: isProblematic ? '#fff5f5' : 'white', borderRadius: '6px', marginBottom: '4px', border: `1px solid ${isProblematic ? '#f5b7b1' : '#e0e0e0'}` }}>
                                <span style={{ fontSize: '12px' }}>
                                  {isProblematic ? '⚠️' : '🔗'} {dep?.title || d.dependsOnTaskId}
                                  {dep?.plannedEnd && <span style={{ color: '#888', marginRight: '6px', fontSize: '11px' }}>· סיום: {fmtTime(dep.plannedEnd)}</span>}
                                </span>
                                <button onClick={() => removeDependency(a.task.id, d.dependsOnTaskId)}
                                  style={{ padding: '2px 10px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '11px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                                  הסר
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* User assignment */}
                      {a.type === 'ללא אחראי' && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#2d4a7a', marginBottom: '6px' }}>👤 שיוך עובד אחראי</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select value={anomalyEditForm.assignedUserName}
                              onChange={e => setAnomalyEditForm(f => ({ ...f, assignedUserName: e.target.value }))}
                              style={{ flex: 1, padding: '5px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px', direction: 'rtl' }}>
                              <option value="">— בחר עובד —</option>
                              {users.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
                            </select>
                            <button onClick={() => saveAnomalyFields(a.task.id, { assignedUserName: anomalyEditForm.assignedUserName })}
                              disabled={!anomalyEditForm.assignedUserName}
                              style={{ padding: '5px 16px', background: anomalyEditForm.assignedUserName ? '#27ae60' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: anomalyEditForm.assignedUserName ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              שמור
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Blocked reason */}
                      {['חסום ללא סיבה', 'חסומה'].includes(a.type) && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#2d4a7a', marginBottom: '6px' }}>🚫 סיבת חסימה</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <input value={anomalyEditForm.blockedReason} placeholder="הזן סיבת חסימה"
                              onChange={e => setAnomalyEditForm(f => ({ ...f, blockedReason: e.target.value }))}
                              style={{ flex: 1, padding: '5px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px' }} />
                            <button onClick={() => saveAnomalyFields(a.task.id, { blockedReason: anomalyEditForm.blockedReason })}
                              disabled={!anomalyEditForm.blockedReason}
                              style={{ padding: '5px 16px', background: anomalyEditForm.blockedReason ? '#e74c3c' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: anomalyEditForm.blockedReason ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              שמור
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Delay reason */}
                      {['התחיל באיחור'].includes(a.type) && (
                        <div>
                          <div style={{ fontWeight: 'bold', fontSize: '12px', color: '#2d4a7a', marginBottom: '6px' }}>⚠️ סיבת עיכוב</div>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <select value={anomalyEditForm.delayReason}
                              onChange={e => setAnomalyEditForm(f => ({ ...f, delayReason: e.target.value }))}
                              style={{ flex: 1, padding: '5px', border: '1px solid #ddd', borderRadius: '5px', fontSize: '12px', direction: 'rtl' }}>
                              <option value="">— בחר סיבה —</option>
                              {DELAY_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button onClick={() => saveAnomalyFields(a.task.id, { delayReason: anomalyEditForm.delayReason })}
                              disabled={!anomalyEditForm.delayReason}
                              style={{ padding: '5px 16px', background: anomalyEditForm.delayReason ? '#e67e22' : '#ccc', color: 'white', border: 'none', borderRadius: '6px', cursor: anomalyEditForm.delayReason ? 'pointer' : 'not-allowed', fontSize: '12px', fontWeight: 'bold', whiteSpace: 'nowrap' }}>
                              שמור
                            </button>
                          </div>
                        </div>
                      )}

                    </div>
                  )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Header + stats ── */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '14px 20px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
          <h2 style={{ margin: 0, color: '#1a2332', fontSize: '17px' }}>
            {isExecutionMode ? '🎯 ביצוע פעילות' : '📋 סקירת תוכנית'}
            {versionData && <span style={{ fontSize: '13px', color: '#888', fontWeight: 'normal', marginRight: '8px' }}>— {versionData.name}</span>}
            {teamName && !versionData && <span style={{ fontSize: '13px', color: '#888', fontWeight: 'normal', marginRight: '8px' }}>— {teamName}</span>}
          </h2>
          <div style={{ display: 'flex', gap: '8px' }}>
            {usePhaseView && (
              <>
                <button onClick={() => setCollapsedPhases(new Set(versionData.phases.map((p: any) => p.id)))}
                  style={{ padding: '6px 12px', background: '#f0f0f0', color: '#555', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
                  ▶ קפל הכל
                </button>
                <button onClick={() => { setCollapsedPhases(new Set()); setCollapsedSubs(new Set()); }}
                  style={{ padding: '6px 12px', background: '#f0f0f0', color: '#555', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer', fontSize: '12px' }}>
                  ▼ פתח הכל
                </button>
              </>
            )}
            {isExecutionMode && tasks.some(t => t.status === 'WAITING' && (!t.dependencies?.length || t.dependencies.every((d: any) => d.dependsOn?.status === 'DONE'))) && (
              <button onClick={openNoDeps}
                style={{ padding: '6px 14px', background: '#8e44ad', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
                🔓 פתח ללא תלות
              </button>
            )}
            {!isLocked && !hideAddTask && <button onClick={() => { setShowAddForm(v => !v); setAddError(null); }}
              style={{ padding: '6px 14px', background: showAddForm ? '#e0e0e0' : '#2d4a7a', color: showAddForm ? '#333' : 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
              {showAddForm ? '✕ ביטול' : '+ משימה'}
            </button>}
            {!isExecutionMode && versionData && (
              <button
                onClick={autoSchedule}
                disabled={autoScheduling}
                title="חשב שעות סיום לפי משך, והתחל משימות תלויות אחרי שהתלות שלהן מסתיימת"
                style={{ padding: '6px 14px', background: autoScheduling ? '#aaa' : '#7d3c98', color: 'white', border: 'none', borderRadius: '8px', cursor: autoScheduling ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '13px', whiteSpace: 'nowrap' }}
              >
                {autoScheduling ? '...' : '📅 חשב לוחות זמנים'}
              </button>
            )}
            {!isExecutionMode && (
              <button
                onClick={() => setShowAnomalies(v => !v)}
                style={{
                  position: 'relative', padding: '6px 14px', border: 'none', borderRadius: '8px', cursor: 'pointer',
                  fontWeight: 'bold', fontSize: '13px',
                  background: showAnomalies ? '#c0392b' : highCount > 0 ? '#e74c3c' : anomalyCount > 0 ? '#e67e22' : '#27ae60',
                  color: 'white',
                }}
              >
                🔍 חריגות
                {anomalyCount > 0 && (
                  <span style={{
                    position: 'absolute', top: '-6px', left: '-6px',
                    background: highCount > 0 ? '#7b0000' : '#5d4037',
                    color: 'white', borderRadius: '10px', fontSize: '10px', fontWeight: 'bold',
                    padding: '1px 5px', minWidth: '16px', textAlign: 'center',
                  }}>
                    {anomalyCount}
                  </span>
                )}
              </button>
            )}
            <button onClick={fetchTasks}
              style={{ padding: '6px 12px', background: '#f0f0f0', color: '#555', border: '1px solid #ddd', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
              ↻
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {Object.entries(STATUS_LABELS).map(([status, label]) =>
            statusCounts[status] > 0 ? (
              <div key={status} style={{ background: STATUS_COLORS[status] + '22', border: `2px solid ${STATUS_COLORS[status]}`, borderRadius: '8px', padding: '3px 10px', textAlign: 'center' }}>
                <div style={{ fontSize: '17px', fontWeight: 'bold', color: STATUS_COLORS[status] }}>{statusCounts[status]}</div>
                <div style={{ fontSize: '10px', color: '#666' }}>{label}</div>
              </div>
            ) : null
          )}
        </div>
      </div>

      {/* ── Auto-schedule result ── */}
      {autoScheduleResult && (
        <div style={{ marginBottom: '10px' }}>
          <div style={{ background: '#f0fdf4', border: '2px solid #27ae60', borderRadius: autoScheduleResult.cycles.length > 0 ? '10px 10px 0 0' : '10px', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
            <span style={{ fontSize: '20px', flexShrink: 0 }}>📅</span>
            <div style={{ flex: 1 }}>
              <strong style={{ color: '#1a7a3c', fontSize: '13px' }}>
                {autoScheduleResult.count === 0
                  ? 'לא נמצאו שינויים — כל הזמנים כבר מחושבים'
                  : `עודכנו ${autoScheduleResult.count} משימות:`}
              </strong>
              {autoScheduleResult.names.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                  {autoScheduleResult.names.map((name, i) => (
                    <span key={i} style={{ background: '#d1fae5', color: '#065f46', padding: '2px 8px', borderRadius: '10px', fontSize: '12px' }}>
                      {name}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => setAutoScheduleResult(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#999', lineHeight: 1, flexShrink: 0 }}>
              ✕
            </button>
          </div>
          {autoScheduleResult.cycles.length > 0 && (
            <div style={{ background: '#fff0f0', border: '2px solid #e74c3c', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '10px 16px', display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
              <span style={{ fontSize: '16px', flexShrink: 0 }}>🔁</span>
              <div>
                <strong style={{ color: '#c0392b', fontSize: '13px' }}>נמצאו תלויות מעגליות — המשימות הבאות לא חושבו:</strong>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '5px' }}>
                  {autoScheduleResult.cycles.map((name, i) => (
                    <span key={i} style={{ background: '#fde8e8', color: '#922b21', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', border: '1px solid #f5b7b1' }}>
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Team filter ── */}
      {teamsInTasks.length > 1 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', background: 'white', borderRadius: '10px', padding: '8px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#999', marginLeft: '4px' }}>סנן:</span>
          {[{ id: null, name: 'כולם', count: tasks.length }, ...teamsInTasks.map(t => ({ ...t, count: tasks.filter(x => x.assignedTeamId === t.id).length }))].map(t => (
            <button key={t.id ?? '__all__'}
              onClick={() => setLocalTeamFilter(t.id)}
              style={{ padding: '3px 11px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', border: 'none', background: localTeamFilter === t.id ? '#1a2332' : '#f0f0f0', color: localTeamFilter === t.id ? 'white' : '#555' }}>
              {t.name} ({t.count})
            </button>
          ))}
        </div>
      )}

      {/* ── Status filter ── */}
      {Object.keys(statusCounts).length > 0 && (
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '10px', background: 'white', borderRadius: '10px', padding: '8px 14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: '#999', marginLeft: '4px' }}>סטטוס:</span>
          <button
            onClick={() => setLocalStatusFilter(null)}
            style={{ padding: '3px 11px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', border: 'none', background: localStatusFilter === null ? '#1a2332' : '#f0f0f0', color: localStatusFilter === null ? 'white' : '#555' }}>
            הכל ({teamFilteredTasks.length})
          </button>
          {Object.entries(STATUS_LABELS).map(([status, label]) => {
            const count = statusCounts[status];
            if (!count) return null;
            const color = STATUS_COLORS[status];
            const isActive = localStatusFilter === status;
            return (
              <button key={status}
                onClick={() => setLocalStatusFilter(isActive ? null : status)}
                style={{ padding: '3px 11px', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', cursor: 'pointer', border: `1px solid ${color}`, background: isActive ? color : color + '18', color: isActive ? 'white' : color }}>
                {label} ({count})
              </button>
            );
          })}
        </div>
      )}

      {/* ── Multi-select toolbar (execution mode only) ── */}
      {isExecutionMode && selectedTaskIds.size > 0 && (
        <div style={{ position: 'sticky', top: '68px', zIndex: 50, background: '#1a2332', color: 'white', borderRadius: '10px', padding: '9px 16px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px', boxShadow: '0 4px 12px rgba(0,0,0,0.3)', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 'bold', fontSize: '14px' }}>{selectedTaskIds.size} נבחרו</span>
          <button onClick={() => bulkUpdateStatus('IN_PROGRESS')}
            style={{ padding: '5px 14px', background: '#f39c12', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
            ▶ התחל הכל
          </button>
          <button onClick={() => bulkUpdateStatus('DONE')}
            style={{ padding: '5px 14px', background: '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
            ✓ סיים הכל
          </button>
          <button onClick={() => setSelectedTaskIds(new Set())}
            style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.15)', color: 'white', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
            ✕ בטל
          </button>
        </div>
      )}

      {/* ── Add task form ── */}
      {showAddForm && (
        <form onSubmit={addTask} style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', marginBottom: '12px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', border: '2px solid #2d4a7a' }}>
          <h3 style={{ margin: '0 0 10px', color: '#1a2332', fontSize: '14px' }}>➕ הוספת משימה</h3>
          {/* proposals from team leads */}
          {FEATURES.TEAM_LEAD_PROPOSAL && proposals.length > 0 && (
            <div style={{ marginBottom: '12px', background: '#f0f7ff', border: '1px solid #bee3f8', borderRadius: '8px', padding: '10px 14px' }}>
              <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#2c5282', marginBottom: '8px' }}>
                📋 משימות שהוגשו ע"י ראשי צוותים ({proposals.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', maxHeight: '180px', overflowY: 'auto' }}>
                {proposals.map((p: any) => (
                  <div
                    key={p.id}
                    onClick={() => {
                      setSelectedProposalId(p.id);
                      setForm(f => ({
                        ...f,
                        title: p.title,
                        crNumber: p.crNumber ?? '',
                        application: p.app ?? '',
                        notes: p.notes ?? '',
                      }));
                    }}
                    style={{
                      padding: '7px 12px', borderRadius: '6px', cursor: 'pointer',
                      background: selectedProposalId === p.id ? '#2d4a7a' : 'white',
                      color: selectedProposalId === p.id ? 'white' : '#333',
                      border: `1px solid ${selectedProposalId === p.id ? '#2d4a7a' : '#ddd'}`,
                      fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}
                  >
                    <span style={{ fontWeight: 'bold' }}>{p.title}</span>
                    <span style={{ fontSize: '11px', opacity: 0.8 }}>
                      {p.app && `${p.app} · `}{p.estimatedMins ? `${p.estimatedMins} דק'` : ''}{p.crNumber ? ` · ${p.crNumber}` : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: '6px', fontSize: '11px', color: '#666' }}>
                לחץ על הצעה לטעינה אוטומטית לטופס — או מלא ידנית מטה
              </div>
              {selectedProposalId && (
                <button type="button" onClick={() => { setSelectedProposalId(null); setForm(emptyForm); }}
                  style={{ marginTop: '6px', fontSize: '11px', color: '#c0392b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
                  ✕ נקה בחירה
                </button>
              )}
            </div>
          )}
          {addError && <div style={{ background: '#fee', border: '1px solid #f99', borderRadius: '6px', padding: '5px 10px', marginBottom: '8px', color: '#c0392b', fontSize: '12px' }}>{addError}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '7px', marginBottom: '7px' }}>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="שם המשימה *" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
            <input value={form.crNumber} onChange={e => setForm(f => ({ ...f, crNumber: e.target.value }))} placeholder="CR#" style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }} />
            <select value={form.application} onChange={e => setForm(f => ({ ...f, application: e.target.value }))} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
              <option value="">מערכת</option>
              {APPS.map(a => <option key={a} value={a}>{a}</option>)}
            </select>
            <select value={form.assignedUserName} onChange={e => setForm(f => ({ ...f, assignedUserName: e.target.value }))} style={{ padding: '7px', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px' }}>
              <option value="">-- אחראי --</option>
              {users.map(u => <option key={u.id} value={u.fullName}>{u.fullName}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button type="submit" disabled={adding || !form.title.trim()}
              style={{ padding: '7px 18px', background: adding || !form.title.trim() ? '#ccc' : '#27ae60', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' }}>
              {adding ? 'מוסיף...' : '✓ הוסף'}
            </button>
            <button type="button" onClick={() => { setShowAddForm(false); setForm(emptyForm); setAddError(null); }}
              style={{ padding: '7px 14px', background: '#f0f0f0', color: '#333', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>
              ביטול
            </button>
          </div>
        </form>
      )}

      {/* ── Phase-based view ── */}
      {usePhaseView ? (
        versionData.phases.map((phase: any) => {
          const subs = phase.subPhases || [];
          const phaseTasks = subs.flatMap((sp: any) =>
            (taskBySub[sp.id] || []).filter((t: any) =>
              (!localTeamFilter || t.assignedTeamId === localTeamFilter) &&
              matchesUser(t) &&
              (!localStatusFilter || t.status === localStatusFilter)
            )
          );
          if (phaseTasks.length === 0) return null;

          const doneCount = phaseTasks.filter((t: any) => t.status === 'DONE').length;
          const blockedCount = phaseTasks.filter((t: any) => t.status === 'BLOCKED').length;
          const inProgCount = phaseTasks.filter((t: any) => t.status === 'IN_PROGRESS').length;
          const isCollapsed = collapsedPhases.has(phase.id);
          const selectableIds = phaseTasks.filter((t: any) => !TERMINAL.has(t.status)).map((t: any) => t.id);

          const envColor = phase.environment === 'HOT' ? '#c0392b' : phase.environment === 'HOTNET' ? '#2980b9' : '#555';
          const envBg   = phase.environment === 'HOT' ? '#fee' : phase.environment === 'HOTNET' ? '#e8f4fd' : '#f0f0f0';
          const progress = Math.round((doneCount / phaseTasks.length) * 100);

          return (
            <div key={phase.id} style={{ background: 'white', borderRadius: '12px', marginBottom: '10px', boxShadow: '0 2px 8px rgba(0,0,0,0.08)', overflow: 'hidden' }}>
              {/* Phase header */}
              <div onClick={() => togglePhase(phase.id)}
                style={{ padding: '11px 16px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', background: '#f8f9fa', borderBottom: isCollapsed ? 'none' : '2px solid #e0e0e0', userSelect: 'none' as any }}>
                <span style={{ color: '#bbb', fontSize: '12px' }}>{isCollapsed ? '►' : '▼'}</span>
                <span style={{ background: envBg, color: envColor, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 'bold' }}>{phase.environment}</span>
                <span style={{ fontWeight: 'bold', fontSize: '15px', color: '#1a2332', flex: 1 }}>{phase.name}</span>
                {(() => { const span = fmtSpan(phaseTasks.filter((t: any) => parseDurationMins(t.duration || '') !== null)); return span ? (
                  <span style={{ fontSize: '12px', color: '#555', background: '#f0f4ff', border: '1px solid #c5cae9', padding: '2px 10px', borderRadius: '8px', fontWeight: 'bold', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    ⏰ {span.time}
                    {span.dur && <span style={{ color: '#7d3c98', background: '#f3e8ff', padding: '1px 7px', borderRadius: '6px', fontSize: '11px' }}>{span.dur}</span>}
                  </span>
                ) : null; })()}
                <div style={{ display: 'flex', gap: '8px', fontSize: '12px', alignItems: 'center' }}>
                  {/* Progress bar */}
                  <div style={{ width: '60px', height: '6px', background: '#e0e0e0', borderRadius: '3px', overflow: 'hidden' }}>
                    <div style={{ width: `${progress}%`, height: '100%', background: progress === 100 ? '#27ae60' : '#3498db', borderRadius: '3px' }} />
                  </div>
                  <span style={{ color: '#888', whiteSpace: 'nowrap' }}>{doneCount}/{phaseTasks.length}</span>
                  {inProgCount > 0 && <span style={{ background: '#fff3e0', color: '#f39c12', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold' }}>{inProgCount} בביצוע</span>}
                  {blockedCount > 0 && <span style={{ background: '#fee', color: '#e74c3c', padding: '1px 7px', borderRadius: '10px', fontWeight: 'bold' }}>{blockedCount} חסום</span>}
                  {isExecutionMode && selectableIds.length > 0 && canSelectAll && (
                    <button onClick={e => { e.stopPropagation(); selectGroup(selectableIds); }}
                      style={{ padding: '2px 8px', background: '#e8f4fd', color: '#2980b9', border: '1px solid #bee3f8', borderRadius: '6px', cursor: 'pointer', fontSize: '11px' }}>
                      ✓ בחר הכל
                    </button>
                  )}
                </div>
              </div>

              {/* SubPhases */}
              {!isCollapsed && subs.map((sub: any) => {
                const allSubTasks = sortTasks(
                  (taskBySub[sub.id] || []).filter((t: any) =>
                    (!localTeamFilter || t.assignedTeamId === localTeamFilter) &&
                    matchesUser(t) &&
                    (!localStatusFilter || t.status === localStatusFilter)
                  )
                );
                if (allSubTasks.length === 0) return null;

                const activeTasks = allSubTasks.filter((t: any) => !TERMINAL.has(t.status));
                const doneTasks   = allSubTasks.filter((t: any) => TERMINAL.has(t.status));
                const subDone     = doneTasks.length;
                const isSubCollapsed = collapsedSubs.has(sub.id);

                return (
                  <div key={sub.id} style={{ padding: '4px 16px 10px', borderBottom: '1px solid #f5f5f5' }}>
                    {/* SubPhase header — clickable to collapse */}
                    <div
                      onClick={() => toggleSub(sub.id)}
                      style={{ padding: '7px 0 5px', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', userSelect: 'none' }}
                    >
                      <span style={{ color: '#bbb', fontSize: '11px' }}>{isSubCollapsed ? '►' : '▼'}</span>
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: '#444' }}>{sub.name}</span>
                      {(() => { const span = fmtSpan(allSubTasks.filter((t: any) => parseDurationMins(t.duration || '') !== null)); return span ? (
                        <span style={{ fontSize: '11px', color: '#555', background: '#f5f7ff', border: '1px solid #dde', padding: '1px 8px', borderRadius: '6px', fontWeight: 'bold', whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
                          ⏰ {span.time}
                          {span.dur && <span style={{ color: '#7d3c98', background: '#f3e8ff', padding: '1px 6px', borderRadius: '5px', fontSize: '10px' }}>{span.dur}</span>}
                        </span>
                      ) : null; })()}
                      <span style={{ fontSize: '11px', color: subDone === allSubTasks.length ? '#27ae60' : '#bbb' }}>
                        {subDone}/{allSubTasks.length}
                      </span>
                      {activeTasks.length > 0 && (
                        <span style={{ fontSize: '11px', background: '#e8f4fd', color: '#2980b9', padding: '1px 7px', borderRadius: '10px' }}>
                          {activeTasks.length} פעילות
                        </span>
                      )}
                    </div>

                    {!isSubCollapsed && (
                      <>
                        {/* Active tasks first */}
                        {activeTasks.map((task: any) => <TaskRow key={task.id} task={task} />)}

                        {/* Done tasks — collapsible section at bottom */}
                        {doneTasks.length > 0 && (
                          <div style={{ marginTop: activeTasks.length > 0 ? '8px' : '0' }}>
                            <button
                              onClick={e => { e.stopPropagation(); toggleCompleted(sub.id); }}
                              style={{ width: '100%', padding: '9px 16px', background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#666' }}
                            >
                              <span>{expandedCompleted.has(sub.id) ? '▼' : '►'}</span>
                              <span style={{ fontWeight: 'bold' }}>הושלמו</span>
                              <span style={{ background: '#e0e0e0', color: '#555', padding: '1px 8px', borderRadius: '10px', fontSize: '12px' }}>{doneTasks.length}</span>
                            </button>
                            {expandedCompleted.has(sub.id) && (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                {doneTasks.map((task: any) => <TaskRow key={task.id} task={task} />)}
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })
      ) : (
        /* Flat view (EmployeeDashboard — no version) */
        (() => {
          const sorted      = sortTasks(displayTasks);
          const activeTasks = sorted.filter(t => !TERMINAL.has(t.status));
          const doneTasks   = sorted.filter(t => TERMINAL.has(t.status));
          const showDone    = expandedCompleted.has('flat');

          if (sorted.length === 0) return (
            <div style={{ textAlign: 'center', padding: '60px', color: '#666', background: 'white', borderRadius: '12px' }}>
              <div style={{ fontSize: '48px' }}>📭</div>
              <p>אין משימות לצוות זה</p>
              {!isLocked && (
                <button onClick={() => setShowAddForm(true)}
                  style={{ marginTop: '12px', padding: '10px 24px', background: '#2d4a7a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: 'bold' }}>
                  + הוסף משימה ראשונה
                </button>
              )}
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {/* Active tasks */}
              {activeTasks.map(task => <TaskRow key={task.id} task={task} />)}

              {/* Completed section — collapsed by default */}
              {doneTasks.length > 0 && (
                <div style={{ marginTop: '8px' }}>
                  <button
                    onClick={() => toggleCompleted('flat')}
                    style={{ width: '100%', padding: '9px 16px', background: '#f8f9fa', border: '1px solid #e0e0e0', borderRadius: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#666' }}
                  >
                    <span>{showDone ? '▼' : '►'}</span>
                    <span style={{ fontWeight: 'bold' }}>הושלמו</span>
                    <span style={{ background: '#e0e0e0', color: '#555', padding: '1px 8px', borderRadius: '10px', fontSize: '12px' }}>{doneTasks.length}</span>
                  </button>
                  {showDone && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                      {doneTasks.map(task => <TaskRow key={task.id} task={task} />)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()
      )}
    </div>
  );
};
