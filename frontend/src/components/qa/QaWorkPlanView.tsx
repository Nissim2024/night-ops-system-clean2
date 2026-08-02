import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW } from '../../theme';
import { useDialog } from '../../context/DialogContext';
import { ConfirmDialog, DialogConfig } from '../ConfirmDialog';
import { DateField } from '../DatePicker';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Version {
  id: string;
  name: string;
  status: string;
  isArchived: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
  qaStart: string | null;
  qaEnd: string | null;
}

interface CycleTask {
  id: string;
  crNumber: string;
  crLabel: string | null;
  taskType: 'CR' | 'STAND_ALONE' | 'REGRESSION';
  userId: string;
  user: { id: string; fullName: string; email: string };
  effortDays: number;
  plannedStart: string;
  plannedEnd: string;
  isActive: boolean;
  isPrimary: boolean;
  sortOrder: number;
}

// A task shown read-only inside a cycle card it doesn't actually belong to
// (see the cross-cycle ghost logic in CycleCard) — ghostLabel names whichever
// cycle it's really scheduled in, so the marker reads correctly regardless of
// which direction it's surfaced (SA task shown inside a core cycle, or a core
// task shown inside the SA cycle).
interface GhostTask extends CycleTask {
  ghostLabel: string;
  // True only if this ghost's own date range genuinely intersects one of the
  // tester's real (active) tasks in the cycle it's shown inside — as opposed
  // to merely falling somewhere within that cycle's overall calendar window.
  // Should never happen given the scheduler's own conflict-avoidance, but
  // surfacing it explicitly (instead of only ever showing the neutral
  // "co-occurring, not conflicting" ghost style) is what actually answers
  // "is there an overlap or not" at a glance, per a manual reassignment/edit
  // bypassing the scheduler.
  hasConflict: boolean;
}

function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

interface QaAssignment {
  id: string;
  crNumber: string;
  crLabel: string | null;
  userId: string;
  qaEffort: number | null;
  sortOrder: number | null;
  secondaryTesterId: string | null;
  secondarySkillLevel: number | null;
  secondaryUser?: { id: string; fullName: string; email: string } | null;
  cycles: string[];
  user?: { id: string; fullName: string; email: string };
}

interface SecondaryCandidate {
  userId: string;
  fullName: string;
  totalScore: number;
  isCurrentSecondary: boolean;
  estimatedSecondaryEffort: number;
  estimatedPrimaryEffort: number;
  timeSavingDays: number;
  secondarySkillLevel: number;
  breakdown: { skill: { level: number | null; requiredLevel: number }; load: { rawScore: number } };
}

interface SecondaryData {
  crNumber: string;
  crLabel: string | null;
  qaEffortDays: number;
  primaryTesterId: string | null;
  currentSecondaryId: string | null;
  candidates: SecondaryCandidate[];
}

interface ArchivedTask {
  id: string;
  crNumber: string;
  crLabel: string | null;
  taskType: 'CR' | 'STAND_ALONE' | 'REGRESSION';
  userId: string;
  user: { id: string; fullName: string; email: string };
  effortDays: number;
  plannedStart: string;
  plannedEnd: string;
  cycle: { cycleType: string };
  updatedAt: string;
}

interface Cycle {
  id: string;
  cycleType: string;
  plannedStart: string;
  plannedEnd: string;
  notes: string | null;
  tasks: CycleTask[];
}

interface ChangeLogEntry {
  id: string;
  action: 'EFFORT_CHANGED' | 'TASK_DELETED' | 'TASK_ARCHIVED' | 'TASK_RESTORED' | 'TASK_REASSIGNED' | 'TASK_TOGGLED';
  crNumber: string | null;
  userEmail: string | null;
  beforeData: Record<string, any> | null;
  afterData: Record<string, any> | null;
  createdAt: string;
}

interface OverflowIssue {
  type: 'CORE_OVERFLOW' | 'SA_DUE_DATE_MISSED' | 'GO_LIVE_OVERFLOW' | 'SA_TESTING_END_OVERFLOW';
  message: string;
  crNumber?: string;
  userName?: string;
  userId?: string;
  cycleType?: string;
  daysOver: number;
  suggestions: string[];
}

interface WorkPlan {
  id: string;
  versionId: string;
  status: 'DRAFT' | 'APPROVED';
  cycle1Start: string;
  testingEnd: string;
  cycle1LengthDays?: number | null;
  cycle2LengthDays?: number | null;
  cycle3LengthDays?: number | null;
  notes: string | null;
  createdAt: string;
  approvedBy: string | null;
  cycles: Cycle[];
  overflowIssues?: OverflowIssue[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1:     'סבב 1',
  CYCLE_2:     'סבב 2',
  CYCLE_3:     'סבב 3',
  STAND_ALONE: 'Stand Alone',
  UAT:         'UAT',
  REHEARSAL:   'חזרה גנרלית',
  GO_LIVE:     'עליה לאוויר',
};

const CYCLE_ACCENT: Record<string, string> = {
  CYCLE_1:     C.info,
  CYCLE_2:     C.warning,
  CYCLE_3:     '#F0883E',
  STAND_ALONE: C.success,
  UAT:         '#00897b',
  REHEARSAL:   C.statusWaiting,
  GO_LIVE:     C.brand,
};

const CYCLE_BG: Record<string, string> = {
  CYCLE_1:     C.infoBg,
  CYCLE_2:     C.warningBg,
  CYCLE_3:     'rgba(240,136,62,0.08)',
  STAND_ALONE: C.successBg,
  UAT:         'rgba(0,137,123,0.08)',
  REHEARSAL:   'rgba(156,106,222,0.08)',
  GO_LIVE:     C.brandDim,
};

// One-line human description per change-log action — every write site in
// qa-workplan.service.ts (EFFORT_CHANGED/TASK_DELETED/TASK_ARCHIVED/
// TASK_RESTORED/TASK_REASSIGNED/TASK_TOGGLED) must have a case here, or it
// silently falls through to the generic fallback below.
function describeChangeLogEntry(entry: ChangeLogEntry): string {
  const cr = entry.crNumber ?? entry.beforeData?.crNumber ?? '—';
  switch (entry.action) {
    case 'TASK_DELETED':
      return `נמחקה משימה — CR ${cr}`;
    case 'EFFORT_CHANGED':
      return `שונה מאמץ — CR ${cr}: ${entry.beforeData?.effortDays ?? '?'} ← ${entry.afterData?.effortDays ?? '?'} ימים`;
    case 'TASK_ARCHIVED':
      return `הועברה לארכיון — CR ${cr}${entry.afterData?.reason ? ` (${entry.afterData.reason})` : ''}`;
    case 'TASK_RESTORED':
      return `שוחזרה מהארכיון — CR ${cr}${entry.afterData?.reason ? ` (${entry.afterData.reason})` : ''}`;
    case 'TASK_REASSIGNED':
      return `הוחלף בודק — CR ${cr}: ${entry.beforeData?.userName ?? '?'} ← ${entry.afterData?.userName ?? '?'}`;
    case 'TASK_TOGGLED':
      return `${entry.afterData?.isActive ? 'הופעלה' : 'הושבתה'} משימה — CR ${cr}`;
    default:
      return `שינוי — CR ${cr}`;
  }
}

const EDITABLE_CYCLES = new Set(['CYCLE_2', 'CYCLE_3', 'UAT', 'REHEARSAL', 'GO_LIVE']);

// ── Helpers ───────────────────────────────────────────────────────────────────

// Overflow issues only carry a tester's full name + crNumber (no task id), so
// this composite key is how a problem message links back to its schedule row.
function rowKey(fullName: string, crNumber: string): string {
  return `${fullName}::${crNumber}`;
}
function rowElementId(fullName: string, crNumber: string): string {
  return `wp-row-${rowKey(fullName, crNumber)}`.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toInputDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().split('T')[0];
}

function countTasks(cycle: Cycle) {
  const nonReg = cycle.tasks.filter(t => t.taskType !== 'REGRESSION');
  return {
    total:      nonReg.length,
    active:     nonReg.filter(t => t.isActive).length,
    regression: cycle.tasks.filter(t => t.taskType === 'REGRESSION').length,
  };
}

// Israeli work week (Sun–Thu) — mirrors backend/src/qa/qa.scheduler.ts's isWorkDay.
// `holidayDays` (yyyy-mm-dd keys) mirrors the backend's approved-season holiday
// set (Season.isActive), fetched from GET /leaves/seasons, so stats/axis math
// derived from already-scheduled dates doesn't count a holiday as a work day.
function isWorkDay(d: Date, holidayDays?: Set<string>): boolean {
  const dow = d.getDay();
  if (dow === 5 || dow === 6) return false;
  if (holidayDays && holidayDays.has(d.toISOString().slice(0, 10))) return false;
  return true;
}
function countWorkDaysBetween(start: string, end: string, holidayDays?: Set<string>): number {
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(0, 0, 0, 0);
  let count = 0;
  const d = new Date(s);
  while (d <= e) { if (isWorkDay(d, holidayDays)) count++; d.setDate(d.getDate() + 1); }
  return count;
}

// Sum of effortDays actually assigned in this cycle — the round's real testing-day
// load, as opposed to the CR-count badge above. Filtering by tester answers "how many
// of the round's days does THIS person's own workload actually fill?"
function cycleAssignedDays(cycle: Cycle, filterUserId: string): number {
  return cycle.tasks
    .filter(t => t.isActive && t.taskType !== 'REGRESSION')
    .filter(t => !filterUserId || t.userId === filterUserId)
    .reduce((sum, t) => sum + t.effortDays, 0);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  token:              string;
  initialVersionId?:  string;
  versionQaStart?:    string | null;
  versionQaEnd?:      string | null;
}

export default function QaWorkPlanView({ token, initialVersionId, versionQaStart, versionQaEnd }: Props) {
  const dialog = useDialog();
  const [confirmDialog, setConfirmDialog] = useState<DialogConfig | null>(null);
  const ax = useMemo(
    () => axios.create({ headers: { Authorization: `Bearer ${token}` } }),
    [token],
  );

  const [versions, setVersions]           = useState<Version[]>([]);
  const [versionId, setVersionId]         = useState(initialVersionId ?? '');
  const [assignedUserIds, setAssignedUserIds] = useState<Set<string>>(new Set());
  const [urgentCrNumbers, setUrgentCrNumbers] = useState<Set<string>>(new Set());
  const [assignments, setAssignments]     = useState<QaAssignment[]>([]);
  const [workPlan, setWorkPlan]           = useState<WorkPlan | null>(null);
  const [unassigned, setUnassigned]       = useState<string[]>([]);
  const [loading, setLoading]             = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [showGenForm, setShowGenForm]     = useState(false);
  const [cycle1Start, setCycle1Start]     = useState('');
  const [testingEnd, setTestingEnd]       = useState('');
  const [cycle1LengthDays, setCycle1LengthDays] = useState(12);
  const [cycle2LengthDays, setCycle2LengthDays] = useState(6);
  const [cycle3LengthDays, setCycle3LengthDays] = useState(4);
  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<'cycles' | 'employees'>('cycles');
  const [expandedMatrixCell, setExpandedMatrixCell] = useState<string | null>(null);
  const [onlyOverflowing, setOnlyOverflowing] = useState(false);
  const [editNotes, setEditNotes]         = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes]     = useState<Record<string, boolean>>({});
  const [togglingTasks, setTogglingTasks] = useState<Set<string>>(new Set());
  const [filterUserId, setFilterUserId]   = useState('');
  const [editingEffort, setEditingEffort] = useState<string | null>(null);
  const [reverting, setReverting]         = useState(false);
  const [secondaryPanel, setSecondaryPanel] = useState<{ crNumber: string; assignmentId: string } | null>(null);
  const [secondaryData, setSecondaryData]   = useState<SecondaryData | null>(null);
  const [loadingSecondary, setLoadingSecondary] = useState(false);
  const [assigningSecondary, setAssigningSecondary] = useState(false);
  const [reorderingTask, setReorderingTask] = useState<string | null>(null);
  const [issuesCollapsed, setIssuesCollapsed] = useState(false);
  const [allTesters, setAllTesters]       = useState<{ userId: string; fullName: string }[]>([]);
  const [swappingTask, setSwappingTask]   = useState<string | null>(null);
  const [reassigning, setReassigning]     = useState<string | null>(null);
  const [deletingTask, setDeletingTask]   = useState<string | null>(null);
  const [changeLog, setChangeLog]         = useState<ChangeLogEntry[] | null>(null);
  const [showChangeLog, setShowChangeLog] = useState(false);
  const [archivedTasks, setArchivedTasks] = useState<ArchivedTask[]>([]);
  const [showArchive, setShowArchive]     = useState(false);
  const [restoringTask, setRestoringTask] = useState<string | null>(null);
  // Approved-season holiday dates (yyyy-mm-dd) — see isWorkDay above.
  const [holidayDays, setHolidayDays]     = useState<Set<string>>(new Set());

  useEffect(() => {
    ax.get(`${API}/qa/testers`).then(r => setAllTesters(r.data ?? [])).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    ax.get(`${API}/leaves/seasons`)
      .then(r => {
        const keys = new Set<string>();
        (r.data as { isActive: boolean; dates: { date: string }[] }[])
          .filter(s => s.isActive)
          .forEach(s => s.dates.forEach(d => keys.add(new Date(d.date).toISOString().slice(0, 10))));
        setHolidayDays(keys);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync versionId when parent changes initialVersionId
  useEffect(() => {
    if (initialVersionId) setVersionId(initialVersionId);
  }, [initialVersionId]);

  // Pre-fill dates immediately from parent props (no timing dependency on versions fetch)
  useEffect(() => {
    if (versionQaStart) setCycle1Start(toInputDate(versionQaStart));
    if (versionQaEnd)   setTestingEnd(toInputDate(versionQaEnd));
  }, [versionQaStart, versionQaEnd]);

  // Load versions (always needed for date pre-fill; only auto-select if no initialVersionId)
  useEffect(() => {
    ax.get(`${API}/versions`).then(r => {
      const active = (r.data as Version[]).filter(v => !v.isArchived);
      setVersions(active);
      if (!initialVersionId && active.length > 0) setVersionId(active[0].id);
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load work plan + current assignments when version changes
  useEffect(() => {
    if (!versionId) return;
    setLoading(true);
    Promise.all([
      ax.get(`${API}/qa/workplan?versionId=${versionId}`),
      ax.get(`${API}/qa/assignments?versionId=${versionId}`).catch(() => ({ data: [] })),
      ax.get(`${API}/version-cr-assignments/version/${versionId}`).catch(() => ({ data: [] })),
    ]).then(([wpRes, asgRes, vcaRes]) => {
      setWorkPlan(wpRes.data ?? null);
      const asgList = asgRes.data as QaAssignment[];
      setAssignments(asgList);
      setAssignedUserIds(new Set(asgList.map(a => a.userId)));
      if (wpRes.data?.cycles) {
        const allIds = new Set<string>(wpRes.data.cycles.map((c: Cycle) => c.id as string));
        setExpandedCycles(allIds);
      }
      if (wpRes.data?.cycle1LengthDays) setCycle1LengthDays(wpRes.data.cycle1LengthDays);
      if (wpRes.data?.cycle2LengthDays) setCycle2LengthDays(wpRes.data.cycle2LengthDays);
      if (wpRes.data?.cycle3LengthDays) setCycle3LengthDays(wpRes.data.cycle3LengthDays);
      // Purely visual — same urgent/priorityTestDate flags QaAssignmentView shows,
      // just surfaced here too so it's clear at a glance why a task already sits
      // first in its tester's queue (sortOrder already handles the actual ordering).
      const urgentRows = (vcaRes.data as any[] ?? []).filter(c => c.urgent || c.priorityTestDate);
      setUrgentCrNumbers(new Set(urgentRows.map(c => c.crNumber)));
    }).catch(() => setWorkPlan(null))
      .finally(() => setLoading(false));
  }, [versionId]);

  // Pre-fill dates from version — prefer qaStart/qaEnd, fall back to plannedStart/plannedEnd
  useEffect(() => {
    const v = versions.find(x => x.id === versionId);
    if (v) {
      const start = v.qaStart ?? v.plannedStart;
      const end   = v.qaEnd   ?? v.plannedEnd;
      if (start) setCycle1Start(toInputDate(start));
      if (end)   setTestingEnd(toInputDate(end));
    }
  }, [versionId, versions]);

  // ── Assignment map (crNumber → assignment) ────────────────────────────────
  const assignmentMap = useMemo(() => {
    const m = new Map<string, QaAssignment>();
    assignments.forEach(a => m.set(a.crNumber, a));
    return m;
  }, [assignments]);

  // ── Secondary tester panel ────────────────────────────────────────────────
  const openSecondaryPanel = async (crNumber: string) => {
    const asg = assignmentMap.get(crNumber);
    if (!asg) return;
    setSecondaryPanel({ crNumber, assignmentId: asg.id });
    setSecondaryData(null);
    setLoadingSecondary(true);
    try {
      const r = await ax.get(`${API}/qa/assignments/secondary-suggest?versionId=${versionId}&crNumber=${encodeURIComponent(crNumber)}`);
      setSecondaryData(r.data);
    } catch {
      dialog.alert('שגיאה בטעינת הצעות בודק שני', 'שגיאה', 'danger');
      setSecondaryPanel(null);
    } finally {
      setLoadingSecondary(false);
    }
  };

  const assignSecondary = async (assignmentId: string, candidate: SecondaryCandidate | null) => {
    setAssigningSecondary(true);
    try {
      const r = await ax.patch(`${API}/qa/assignments/${assignmentId}/secondary`, {
        secondaryTesterId:   candidate?.userId ?? null,
        secondarySkillLevel: candidate?.secondarySkillLevel ?? null,
      });
      if (r.data.workPlan) {
        setWorkPlan(r.data.workPlan);
        if (r.data.workPlan?.cycles) {
          const allIds = new Set<string>(r.data.workPlan.cycles.map((c: Cycle) => c.id as string));
          setExpandedCycles(allIds);
        }
      }
      // Refresh assignments
      const asgRes = await ax.get(`${API}/qa/assignments?versionId=${versionId}`).catch(() => ({ data: [] }));
      setAssignments(asgRes.data as QaAssignment[]);
      setSecondaryPanel(null);
      setSecondaryData(null);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בשיבוץ בודק שני', 'שגיאה', 'danger');
    } finally {
      setAssigningSecondary(false);
    }
  };

  // ── Reorder task ──────────────────────────────────────────────────────────
  const reorderTask = async (taskId: string, newSortOrder: number) => {
    setReorderingTask(taskId);
    try {
      const r = await ax.patch(`${API}/qa/workplan/task/${taskId}/sort`, { newSortOrder });
      if (r.data) setWorkPlan(r.data);
    } catch {
      dialog.alert('שגיאה בעדכון סדר המשימות', 'שגיאה', 'danger');
    } finally {
      setReorderingTask(null);
    }
  };

  const generate = async () => {
    if (!cycle1Start || !testingEnd) return;
    setGenerating(true);
    try {
      const [genRes, asgRes] = await Promise.all([
        ax.post(`${API}/qa/workplan/generate`, { versionId, cycle1Start, testingEnd, cycle1LengthDays, cycle2LengthDays, cycle3LengthDays }),
        ax.get(`${API}/qa/assignments?versionId=${versionId}`).catch(() => ({ data: [] })),
      ]);
      setWorkPlan(genRes.data.workPlan);
      setUnassigned(genRes.data.unassignedCrs ?? []);
      const asgList = asgRes.data as QaAssignment[];
      setAssignments(asgList);
      setAssignedUserIds(new Set(asgList.map(a => a.userId)));
      setShowGenForm(false);
      if (genRes.data.workPlan?.cycles) {
        const allIds = new Set<string>(genRes.data.workPlan.cycles.map((c: Cycle) => c.id as string));
        setExpandedCycles(allIds);
      }
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית העבודה', 'שגיאה', 'danger');
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!await dialog.confirm('האם לאשר את תוכנית העבודה?', 'אישור תוכנית', 'success')) return;
    try {
      await ax.post(`${API}/qa/workplan/approve`, { versionId });
      setWorkPlan(prev => prev ? { ...prev, status: 'APPROVED' } : null);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה', 'שגיאה', 'danger');
    }
  };

  // Deactivating a task frees up its slot in the tester's queue, so the
  // backend recalculates the whole cascaded schedule — use its response
  // rather than optimistically patching just this one task's flag.
  const toggleTask = async (task: CycleTask) => {
    setTogglingTasks(prev => new Set(Array.from(prev).concat(task.id)));
    try {
      const r = await ax.patch(`${API}/qa/workplan/task/${task.id}/toggle`, { isActive: !task.isActive });
      if (r.data) setWorkPlan(r.data);
    } catch {
      dialog.alert('שגיאה בעדכון המשימה', 'שגיאה', 'danger');
    } finally {
      setTogglingTasks(prev => new Set(Array.from(prev).filter(id => id !== task.id)));
    }
  };

  // Moves a task to a different tester's queue — mirrors the update into the
  // QaAssignment board (same CR, same version) so both screens agree on who
  // owns it, and refreshes the cascaded schedule the same way reorder does.
  const reassignTester = async (taskId: string, newUserId: string) => {
    setReassigning(taskId);
    try {
      const r = await ax.patch(`${API}/qa/workplan/task/${taskId}/reassign`, { userId: newUserId });
      if (r.data) setWorkPlan(r.data);
      const asgRes = await ax.get(`${API}/qa/assignments?versionId=${versionId}`).catch(() => ({ data: [] }));
      const asgList = asgRes.data as QaAssignment[];
      setAssignments(asgList);
      setAssignedUserIds(new Set(asgList.map(a => a.userId)));
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בהחלפת בודק', 'שגיאה', 'danger');
    } finally {
      setReassigning(null);
      setSwappingTask(null);
    }
  };

  const saveNotes = async (cycleId: string) => {
    setSavingNotes(prev => ({ ...prev, [cycleId]: true }));
    try {
      await ax.patch(`${API}/qa/workplan/cycle/${cycleId}/notes`, { notes: editNotes[cycleId] ?? '' });
      setWorkPlan(prev => prev ? {
        ...prev,
        cycles: prev.cycles.map(c => c.id === cycleId ? { ...c, notes: editNotes[cycleId] ?? '' } : c),
      } : null);
    } catch {
      dialog.alert('שגיאה בשמירת הערות', 'שגיאה', 'danger');
    } finally {
      setSavingNotes(prev => ({ ...prev, [cycleId]: false }));
    }
  };

  // A duration change shifts everyone queued after this task, so — like
  // toggleTask — this takes the backend's cascaded schedule instead of
  // patching only the edited task's own effortDays.
  const saveTaskEffort = async (taskId: string, effortStr: string) => {
    const effort = parseFloat(effortStr);
    setEditingEffort(null);
    if (isNaN(effort) || effort < 0.5) return;
    try {
      const r = await ax.patch(`${API}/qa/workplan/task/${taskId}/effort`, { effortDays: effort });
      if (r.data) setWorkPlan(r.data);
    } catch { dialog.alert('שגיאה בעדכון מאמץ המשימה', 'שגיאה', 'danger'); }
  };

  // Soft-remove (recoverable — see restoreTask/showArchive below), not a hard
  // delete: allowed even after the plan is approved, since pulling a task
  // that shouldn't be in the plan is exactly the kind of fix a team lead
  // needs post-approval. A reason is always required, regardless of approval
  // status, so the archive trail (shown here and in the CR-detail modal)
  // always explains why.
  const archiveTask = (task: CycleTask) => {
    const label = task.crLabel ?? task.crNumber;
    setConfirmDialog({
      title: 'העברה לארכיון',
      message: `סיבת העברה לארכיון עבור "${label}" (${task.user.fullName}):`,
      inputLabel: 'סיבה',
      inputPlaceholder: 'לדוגמה: הוסר מהיקף הגרסה',
      variant: 'warning',
      confirmLabel: 'העבר לארכיון',
      cancelLabel: 'ביטול',
      onConfirm: async (reason?: string) => {
        setDeletingTask(task.id);
        try {
          const r = await ax.patch(`${API}/qa/workplan/task/${task.id}/archive`, { reason: reason!.trim() });
          if (r.data) setWorkPlan(r.data);
        } catch (e: any) {
          dialog.alert(e?.response?.data?.message ?? 'שגיאה בהעברה לארכיון', 'שגיאה', 'danger');
        } finally {
          setDeletingTask(null);
        }
      },
      onCancel: () => {},
    });
  };

  const loadArchive = async () => {
    if (!versionId) return;
    try {
      const r = await ax.get(`${API}/qa/workplan/archived?versionId=${versionId}`);
      setArchivedTasks(r.data);
      setShowArchive(true);
    } catch {
      dialog.alert('שגיאה בטעינת הארכיון', 'שגיאה', 'danger');
    }
  };

  const restoreTask = (task: ArchivedTask) => {
    const label = task.crLabel ?? task.crNumber;
    setConfirmDialog({
      title: 'שחזור מהארכיון',
      message: `סיבת שחזור עבור "${label}" (${task.user.fullName}):`,
      inputLabel: 'סיבה',
      inputPlaceholder: 'לדוגמה: הוחזר להיקף הגרסה',
      variant: 'info',
      confirmLabel: 'שחזר',
      cancelLabel: 'ביטול',
      onConfirm: async (reason?: string) => {
        setRestoringTask(task.id);
        try {
          const r = await ax.patch(`${API}/qa/workplan/task/${task.id}/restore`, { reason: reason!.trim() });
          if (r.data) setWorkPlan(r.data);
          setArchivedTasks(prev => prev.filter(t => t.id !== task.id));
        } catch (e: any) {
          dialog.alert(e?.response?.data?.message ?? 'שגיאה בשחזור המשימה', 'שגיאה', 'danger');
        } finally {
          setRestoringTask(null);
        }
      },
      onCancel: () => {},
    });
  };

  const loadChangeLog = async () => {
    if (!versionId) return;
    try {
      const r = await ax.get(`${API}/qa/workplan/changelog?versionId=${versionId}`);
      setChangeLog(r.data);
      setShowChangeLog(true);
    } catch {
      dialog.alert('שגיאה בטעינת יומן השינויים', 'שגיאה', 'danger');
    }
  };

  const revertToOriginal = async () => {
    if (!workPlan || !versionId) return;
    if (!await dialog.confirm('לחזור לתוכנית המקורית? כל השינויים הידניים יאבדו.', 'חזרה לתוכנית המקורית', 'danger')) return;
    setReverting(true);
    try {
      const r = await ax.post(`${API}/qa/workplan/generate`, {
        versionId,
        cycle1Start: toInputDate(workPlan.cycle1Start),
        testingEnd:  toInputDate(workPlan.testingEnd),
        cycle1LengthDays: workPlan.cycle1LengthDays ?? cycle1LengthDays,
        cycle2LengthDays: workPlan.cycle2LengthDays ?? cycle2LengthDays,
        cycle3LengthDays: workPlan.cycle3LengthDays ?? cycle3LengthDays,
      });
      setWorkPlan(r.data.workPlan);
      if (r.data.workPlan?.cycles) {
        setExpandedCycles(new Set<string>(r.data.workPlan.cycles.map((c: Cycle) => c.id as string)));
      }
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית', 'שגיאה', 'danger');
    } finally { setReverting(false); }
  };

  // Deletes the whole generated work plan — the granular counterpart to the
  // old whole-version delete. Doesn't touch QA assignments (who's assigned
  // to what); a new plan can be generated again from those at any time.
  const [deletingPlan, setDeletingPlan] = useState(false);
  const deleteWorkPlan = async () => {
    if (!versionId) return;
    if (!await dialog.confirm('למחוק את כל תוכנית העבודה (כל הסבבים והמשימות המתוזמנות) לצמיתות? שיבוצי הבודקים עצמם לא יימחקו — ניתן ליצור תוכנית חדשה מהם בכל עת.', 'מחיקת תוכנית בדיקות', 'danger')) return;
    setDeletingPlan(true);
    try {
      await ax.delete(`${API}/qa/workplan?versionId=${versionId}`);
      setWorkPlan(null);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה במחיקת תוכנית העבודה', 'שגיאה', 'danger');
    } finally { setDeletingPlan(false); }
  };

  // All unique testers who appear in work plan tasks
  const allPlanTesters = useMemo(() => {
    if (!workPlan) return [] as { userId: string; fullName: string }[];
    const m = new Map<string, string>();
    workPlan.cycles.forEach(c => c.tasks.forEach(t => {
      if (!m.has(t.userId)) m.set(t.userId, t.user.fullName);
    }));
    return Array.from(m.entries())
      .map(([userId, fullName]) => ({ userId, fullName }))
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'));
  }, [workPlan]);

  const exportExcel = () => {
    const link = document.createElement('a');
    link.href = `${API}/qa/workplan/export?versionId=${versionId}`;
    link.setAttribute('Authorization', `Bearer ${token}`);
    // Use fetch to include auth header
    fetch(`${API}/qa/workplan/export?versionId=${versionId}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'qa-workplan.xlsx';
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => dialog.alert('שגיאה בייצוא', 'שגיאה', 'danger'));
  };

  const toggleCycle = (id: string) => {
    setExpandedCycles(prev => {
      const arr = Array.from(prev);
      return prev.has(id)
        ? new Set<string>(arr.filter(x => x !== id))
        : new Set<string>(arr.concat(id));
    });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  // Staleness: users in work plan not in current assignments
  const staleUserInfo = useMemo(() => {
    if (!workPlan) return [];
    const seen = new Map<string, string>(); // userId → fullName
    workPlan.cycles.forEach(c => c.tasks.forEach(t => {
      if (!assignedUserIds.has(t.userId) && !seen.has(t.userId))
        seen.set(t.userId, t.user.fullName);
    }));
    return Array.from(seen.values());
  }, [workPlan, assignedUserIds]);

  // CRs assigned (with tester) but absent from current work plan
  const missingFromPlan = useMemo(() => {
    if (!workPlan) return [] as QaAssignment[];
    const planCrNumbers = new Set(
      workPlan.cycles.flatMap(c => c.tasks.map(t => t.crNumber)),
    );
    return assignments.filter(
      a => a.userId && !planCrNumbers.has(a.crNumber),
    );
  }, [assignments, workPlan]);

  // Rows referenced by an overflow issue — highlighted in the schedule below,
  // and the issue message links/scrolls to the matching row.
  const problematicKeys = useMemo(() => {
    const keys = new Set<string>();
    (workPlan?.overflowIssues ?? []).forEach(i => {
      if (i.userName && i.crNumber) keys.add(rowKey(i.userName, i.crNumber));
    });
    return keys;
  }, [workPlan]);

  return (
    <>
    <div style={{ padding: initialVersionId ? 0 : SP[6], fontFamily: FONT, direction: 'rtl', minHeight: initialVersionId ? undefined : '100vh', backgroundColor: initialVersionId ? undefined : C.bgApp }}>

      {/* ── Header — only when standalone page ── */}
      {!initialVersionId && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[5], flexWrap: 'wrap', gap: SP[3] }}>
          <div>
            <h2 style={{ margin: 0, ...TEXT.xl, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              תוכנית עבודה לבדיקות QA
            </h2>
            <p style={{ margin: `${SP[1]} 0 0`, ...TEXT.sm, color: C.textMuted }}>
              תכנון סבבי בדיקות, שיבוץ בודקים, ייצוא לאקסל
            </p>
          </div>

          {workPlan && (
            <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
              {allPlanTesters.length > 0 && (
                <select value={filterUserId} onChange={e => setFilterUserId(e.target.value)} style={selectStyle}>
                  <option value="">כל הבודקים</option>
                  {allPlanTesters.map(t => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
                </select>
              )}
              {workPlan.status === 'DRAFT' && (
                <button onClick={approve} style={btnStyle(C.success)}>✓ אשר תוכנית</button>
              )}
              <button onClick={exportExcel} style={btnStyle(C.info)}>⬇ ייצוא Excel</button>
              {workPlan.status === 'APPROVED' && (
                <button onClick={loadChangeLog} style={btnStyle('#6366F1')}>🕘 יומן שינויים</button>
              )}
              <button onClick={loadArchive} style={btnStyle('#6B7280')}>📦 ארכיון</button>
              <button onClick={() => setShowGenForm(f => !f)} style={btnStyle(C.warning)}>↺ יצור מחדש</button>
              <button onClick={revertToOriginal} disabled={reverting} style={btnStyle('#6B7280', reverting)}>{reverting ? 'מחשב...' : '⟲ חזור למקור'}</button>
              <button onClick={deleteWorkPlan} disabled={deletingPlan} style={btnStyle(C.danger, deletingPlan)}>{deletingPlan ? 'מוחק...' : '🗑 מחק תוכנית בדיקות'}</button>
            </div>
          )}
        </div>
      )}

      {/* ── Action bar (when embedded in assignment page) ── */}
      {initialVersionId && workPlan && (
        <div style={{ display: 'flex', gap: SP[2], marginBottom: SP[4], flexWrap: 'wrap', alignItems: 'center' }}>
          {workPlan.status === 'DRAFT' && (
            <button onClick={approve} style={btnStyle(C.success)}>✓ אשר תוכנית</button>
          )}
          <button onClick={exportExcel} style={btnStyle(C.info)}>⬇ ייצוא Excel</button>
          {workPlan.status === 'APPROVED' && (
            <button onClick={loadChangeLog} style={btnStyle('#6366F1')}>🕘 יומן שינויים</button>
          )}
          <button onClick={loadArchive} style={btnStyle('#6B7280')}>📦 ארכיון</button>
          <button onClick={() => setShowGenForm(f => !f)} style={btnStyle(C.warning)}>↺ יצור מחדש</button>
          <button onClick={revertToOriginal} disabled={reverting} style={btnStyle('#6B7280', reverting)}>{reverting ? 'מחשב...' : '⟲ חזור לתוכנית המקורית'}</button>
          <button onClick={deleteWorkPlan} disabled={deletingPlan} style={btnStyle(C.danger, deletingPlan)}>{deletingPlan ? 'מוחק...' : '🗑 מחק תוכנית בדיקות'}</button>
          {/* Filter by employee */}
          {allPlanTesters.length > 0 && (
            <select value={filterUserId} onChange={e => setFilterUserId(e.target.value)} style={{ ...selectStyle, minWidth: 160, marginRight: 'auto' }}>
              <option value="">כל הבודקים</option>
              {allPlanTesters.map(t => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
            </select>
          )}
        </div>
      )}

      {/* ── Overflow / conflict issues panel ── */}
      {workPlan && workPlan.overflowIssues && workPlan.overflowIssues.length > 0 && (
        <div style={{
          marginBottom: SP[4], borderRadius: RADIUS.lg, border: `1px solid ${C.danger}`,
          background: C.dangerBg, overflow: 'hidden',
        }}>
          <div
            onClick={() => setIssuesCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${SP[3]} ${SP[4]}`, cursor: 'pointer' }}
          >
            <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.danger }}>
              ⚠️ {workPlan.overflowIssues.length} בעיות בתוכנית העבודה — בודקים שלא מספיקים בתוך הסבב שלהם
            </span>
            <span style={{ ...TEXT.sm, color: C.danger }}>{issuesCollapsed ? '▸ הצג' : '▾ הסתר'}</span>
          </div>
          {!issuesCollapsed && (
            <div style={{ padding: `0 ${SP[4]} ${SP[4]}`, display: 'flex', flexDirection: 'column', gap: SP[3] }}>
              {workPlan.overflowIssues.map((issue, i) => {
                const hasRow = !!(issue.userName && issue.crNumber);
                const goToRow = () => {
                  if (!hasRow) return;
                  // Make sure the owning cycle is expanded before scrolling to it.
                  const owningCycle = workPlan.cycles.find(c =>
                    c.tasks.some(t => t.taskType !== 'REGRESSION' && t.user.fullName === issue.userName && t.crNumber === issue.crNumber),
                  );
                  if (owningCycle && !expandedCycles.has(owningCycle.id)) toggleCycle(owningCycle.id);
                  requestAnimationFrame(() => {
                    setTimeout(() => {
                      document.getElementById(rowElementId(issue.userName!, issue.crNumber!))
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }, owningCycle && !expandedCycles.has(owningCycle.id) ? 150 : 0);
                  });
                };
                return (
                  <div
                    key={i}
                    onClick={hasRow ? goToRow : undefined}
                    style={{
                      padding: SP[3], background: C.bgCard, borderRadius: RADIUS.md, border: `1px solid ${C.border}`,
                      cursor: hasRow ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ ...TEXT.sm, color: C.textPrimary, marginBottom: SP[2] }}>
                      {issue.message}
                      {hasRow && <span style={{ color: C.info, ...TEXT.xs, fontWeight: WEIGHT.semibold, marginRight: SP[2], whiteSpace: 'nowrap' }}>↓ עבור לשורה</span>}
                    </div>
                    <ul style={{ margin: 0, paddingRight: 18, ...TEXT.xs, color: C.textSecondary, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {issue.suggestions.map((s, si) => <li key={si}>{s}</li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Version picker (standalone only) ── */}
      {!initialVersionId && (
        <div style={{ display: 'flex', gap: SP[3], alignItems: 'center', marginBottom: SP[5] }}>
          <label style={{ ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.medium, whiteSpace: 'nowrap' }}>
            גרסה:
          </label>
          <select value={versionId} onChange={e => setVersionId(e.target.value)} style={selectStyle}>
            {versions.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          {!workPlan && !loading && (
            <button onClick={() => setShowGenForm(true)} style={btnStyle(C.brand)}>
              + צור תוכנית עבודה
            </button>
          )}
        </div>
      )}

      {/* ── Embedded: no work plan yet ── */}
      {initialVersionId && !workPlan && !loading && !showGenForm && (
        <div style={{ marginBottom: SP[4] }}>
          {assignments.length === 0 ? (
            <div style={{
              padding: `${SP[3]} ${SP[4]}`,
              borderRadius: RADIUS.md,
              border: `1px solid ${C.warning}`,
              backgroundColor: C.warningBg,
              color: C.warning,
              ...TEXT.sm, fontWeight: WEIGHT.medium,
            }}>
              ⚠ יש לשבץ בודקים לפני יצירת תוכנית עבודה — עבור לטאב &quot;שיבוץ בודקים&quot;
            </div>
          ) : (
            <button onClick={() => setShowGenForm(true)} style={btnStyle(C.brand)}>
              + צור תוכנית עבודה
            </button>
          )}
        </div>
      )}

      {/* ── Generate form ── */}
      {(showGenForm || (!workPlan && !loading)) && (
        <div style={cardStyle}>
          <h3 style={{ margin: `0 0 ${SP[4]}`, ...TEXT.md, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>
            {workPlan ? 'יצירת תוכנית מחדש' : 'צור תוכנית עבודה'}
          </h3>
          <div style={{ display: 'flex', gap: SP[4], flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label style={labelStyle}>
              תאריך התחלה (סבב 1)
              <DateField
                value={cycle1Start}
                onChange={v => setCycle1Start(v)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              תאריך סיום בדיקות
              <DateField
                value={testingEnd}
                onChange={v => setTestingEnd(v)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle} title="גבול קבוע לסבב 1. מי שלא מספיק מסומן כחורג, לא מותח את הסבב לכל הצוות">
              אורך סבב 1 (ימי עבודה)
              <input
                type="number" min={1} value={cycle1LengthDays}
                onChange={e => setCycle1LengthDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...inputStyle, width: 90 }}
              />
            </label>
            <label style={labelStyle} title="גבול קבוע לסבב 2, בלתי תלוי בסבב 1">
              אורך סבב 2 (ימי עבודה)
              <input
                type="number" min={1} value={cycle2LengthDays}
                onChange={e => setCycle2LengthDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...inputStyle, width: 90 }}
              />
            </label>
            <label style={labelStyle} title="גבול קבוע לסבב 3, בלתי תלוי בסבב 1/2">
              אורך סבב 3 (ימי עבודה)
              <input
                type="number" min={1} value={cycle3LengthDays}
                onChange={e => setCycle3LengthDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
                style={{ ...inputStyle, width: 90 }}
              />
            </label>
            <button
              onClick={generate}
              disabled={generating || !cycle1Start || !testingEnd}
              style={btnStyle(C.brand, generating || !cycle1Start || !testingEnd)}
            >
              {generating ? 'מחשב...' : 'צור תוכנית'}
            </button>
            {workPlan && (
              <button onClick={() => setShowGenForm(false)} style={btnStyle(C.textMuted)}>
                ביטול
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Unassigned warning ── */}
      {unassigned.length > 0 && (
        <div style={{ ...cardStyle, borderRight: `4px solid ${C.warning}`, backgroundColor: C.warningBg, marginBottom: SP[4] }}>
          <strong style={{ color: C.warning, ...TEXT.sm }}>⚠ {unassigned.length} CRים ללא שיבוץ בודק — לא נכללו בתוכנית:</strong>
          <span style={{ ...TEXT.sm, color: C.textSecondary, marginRight: SP[2] }}>
            {unassigned.join(', ')}
          </span>
        </div>
      )}

      {/* ── Loading ── */}
      {loading && (
        <div style={{ textAlign: 'center', padding: SP[8], color: C.textMuted, ...TEXT.base }}>
          טוען...
        </div>
      )}

      {/* ── Work plan status banner ── */}
      {workPlan && (
        <div style={{
          ...cardStyle,
          display: 'flex', gap: SP[6], alignItems: 'center',
          backgroundColor: workPlan.status === 'APPROVED' ? C.successBg : C.bgNested,
          borderRight: `4px solid ${workPlan.status === 'APPROVED' ? C.success : C.border}`,
          marginBottom: SP[4],
        }}>
          <span style={{ ...TEXT.sm, color: C.textSecondary }}>
            <strong>סטטוס:</strong>{' '}
            <span style={{ color: workPlan.status === 'APPROVED' ? C.success : C.warning, fontWeight: WEIGHT.semibold }}>
              {workPlan.status === 'APPROVED' ? 'מאושר' : 'טיוטה'}
            </span>
          </span>
          {workPlan.approvedBy && (
            <span style={{ ...TEXT.sm, color: C.textSecondary }}>
              <strong>אושר ע"י:</strong> {workPlan.approvedBy}
            </span>
          )}
          <span style={{ ...TEXT.sm, color: C.textSecondary }}>
            <strong>התחלת סבב 1:</strong> {fmtDate(workPlan.cycle1Start)}
          </span>
          <span style={{ ...TEXT.sm, color: C.textSecondary }}>
            <strong>סיום בדיקות:</strong> {fmtDate(workPlan.testingEnd)}
          </span>
        </div>
      )}

      {/* ── Staleness warning ── */}
      {staleUserInfo.length > 0 && (
        <div style={{ ...cardStyle, borderRight: `4px solid ${C.danger}`, backgroundColor: C.dangerBg, marginBottom: SP[4], display: 'flex', gap: SP[2], alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <strong style={{ color: C.danger, ...TEXT.sm, whiteSpace: 'nowrap' }}>⚠ תוכנית לא מעודכנת:</strong>
          <span style={{ ...TEXT.sm, color: C.textSecondary }}>
            {staleUserInfo.join(', ')} מופיעים בתוכנית אך אינם משובצים כרגע. מומלץ לייצר מחדש.
          </span>
        </div>
      )}

      {/* ── New CRs assigned but not in plan ── */}
      {missingFromPlan.length > 0 && (
        <div style={{ ...cardStyle, borderRight: `4px solid ${C.warning}`, backgroundColor: C.warningBg, marginBottom: SP[4] }}>
          <div style={{ display: 'flex', gap: SP[2], alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: SP[2] }}>
            <strong style={{ color: C.warning, ...TEXT.sm, whiteSpace: 'nowrap' }}>
              ⚠ {missingFromPlan.length} {missingFromPlan.length === 1 ? 'CR משובץ' : 'CRים משובצים'} שאינ{missingFromPlan.length === 1 ? 'ו' : 'ם'} בתוכנית:
            </strong>
            <span style={{ ...TEXT.sm, color: C.textSecondary }}>
              {missingFromPlan.map(a => a.crLabel ? `${a.crNumber} (${a.crLabel})` : a.crNumber).join(', ')}
            </span>
          </div>
          <div style={{ display: 'flex', gap: SP[2], alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ ...TEXT.xs, color: C.textMuted }}>
              לשלב אותם בתוכנית — לחץ "↺ יצור מחדש"
            </span>
            <button
              onClick={() => setShowGenForm(true)}
              style={{ ...btnStyle(C.warning), fontSize: 12, padding: '4px 10px' }}
            >
              ↺ יצור מחדש
            </button>
          </div>
        </div>
      )}

      {/* ── View mode toggle ── */}
      {workPlan && (
        <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: SP[4] }}>
          <div style={{ display: 'flex', border: `1px solid ${C.border}`, borderRadius: RADIUS.md, overflow: 'hidden' }}>
            <button
              onClick={() => setViewMode('cycles')}
              style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: FONT,
                fontWeight: WEIGHT.semibold, background: viewMode === 'cycles' ? C.brand : C.bgCard,
                color: viewMode === 'cycles' ? '#fff' : C.textSecondary,
              }}
            >📅 לפי סבב</button>
            <button
              onClick={() => setViewMode('employees')}
              style={{
                padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 13, fontFamily: FONT,
                fontWeight: WEIGHT.semibold, background: viewMode === 'employees' ? C.brand : C.bgCard,
                color: viewMode === 'employees' ? '#fff' : C.textSecondary,
              }}
            >👤 לפי עובד</button>
          </div>
          {viewMode === 'employees' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, ...TEXT.sm, color: C.textSecondary, cursor: 'pointer' }}>
              <input type="checkbox" checked={onlyOverflowing} onChange={e => setOnlyOverflowing(e.target.checked)} />
              הצג רק חורגים
            </label>
          )}
        </div>
      )}

      {/* ── Cycle cards ── */}
      {viewMode === 'cycles' && (workPlan?.cycles ?? []).map(cycle => (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
          standAloneCycle={workPlan?.cycles.find(c => c.cycleType === 'STAND_ALONE')}
          coreCycles={(workPlan?.cycles ?? []).filter(c => ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'].includes(c.cycleType))}
          expanded={expandedCycles.has(cycle.id)}
          onToggleExpand={() => toggleCycle(cycle.id)}
          onToggleTask={toggleTask}
          togglingTasks={togglingTasks}
          editNotes={editNotes}
          onNotesChange={text => setEditNotes(prev => ({ ...prev, [cycle.id]: text }))}
          onSaveNotes={() => saveNotes(cycle.id)}
          savingNotes={!!savingNotes[cycle.id]}
          planApproved={workPlan?.status === 'APPROVED'}
          filterUserId={filterUserId}
          editingEffort={editingEffort}
          onEditEffort={setEditingEffort}
          onSaveEffort={saveTaskEffort}
          assignmentMap={assignmentMap}
          allAssignments={assignments}
          onOpenSecondary={openSecondaryPanel}
          onReorderTask={reorderTask}
          reorderingTask={reorderingTask}
          problematicKeys={problematicKeys}
          allTesters={allTesters}
          swappingTask={swappingTask}
          onStartSwap={setSwappingTask}
          onReassignTester={reassignTester}
          reassigning={reassigning}
          onDeleteTask={archiveTask}
          deletingTask={deletingTask}
          urgentCrNumbers={urgentCrNumbers}
          holidayDays={holidayDays}
        />
      ))}

      {/* ── Employee × cycle matrix ── */}
      {viewMode === 'employees' && workPlan && (
        <EmployeeCycleMatrix
          workPlan={workPlan}
          allPlanTesters={allPlanTesters}
          urgentCrNumbers={urgentCrNumbers}
          holidayDays={holidayDays}
          onlyOverflowing={onlyOverflowing}
          expandedCell={expandedMatrixCell}
          onToggleCell={key => setExpandedMatrixCell(prev => prev === key ? null : key)}
          onGoToRow={(userName, crNumber) => {
            const owningCycle = workPlan.cycles.find(c =>
              c.tasks.some(t => t.taskType !== 'REGRESSION' && t.user.fullName === userName && t.crNumber === crNumber),
            );
            setViewMode('cycles');
            if (owningCycle && !expandedCycles.has(owningCycle.id)) toggleCycle(owningCycle.id);
            requestAnimationFrame(() => {
              setTimeout(() => {
                document.getElementById(rowElementId(userName, crNumber))
                  ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, owningCycle && !expandedCycles.has(owningCycle.id) ? 150 : 0);
            });
          }}
        />
      )}

      {/* ── Secondary reviewer panel ── */}
      {secondaryPanel && (
        <SecondaryPanel
          crNumber={secondaryPanel.crNumber}
          assignmentId={secondaryPanel.assignmentId}
          data={secondaryData}
          loading={loadingSecondary}
          assigning={assigningSecondary}
          hasExistingSecondary={!!assignmentMap.get(secondaryPanel.crNumber)?.secondaryTesterId}
          existingSecondaryName={assignmentMap.get(secondaryPanel.crNumber)?.secondaryUser?.fullName ?? null}
          onAssign={candidate => assignSecondary(secondaryPanel.assignmentId, candidate)}
          onRemove={() => assignSecondary(secondaryPanel.assignmentId, null)}
          onClose={() => { setSecondaryPanel(null); setSecondaryData(null); }}
        />
      )}

      {/* ── Change log — entries written only for corrections made after approval ── */}
      {showChangeLog && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowChangeLog(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.bgCard, borderRadius: RADIUS.lg, padding: SP[5], maxWidth: 560, width: '92vw', maxHeight: '78vh', overflowY: 'auto', boxShadow: '0 20px 48px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[3] }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🕘 יומן שינויים</span>
              <button onClick={() => setShowChangeLog(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.textMuted }}>✕</button>
            </div>
            {!changeLog || changeLog.length === 0 ? (
              <div style={{ textAlign: 'center', padding: SP[6], color: C.textMuted }}>אין תיקונים שבוצעו מאז אישור התוכנית</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                {changeLog.map(entry => (
                  <div key={entry.id} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, ...TEXT.sm }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: SP[2] }}>
                      <span style={{ fontWeight: WEIGHT.medium, color: C.textPrimary }}>
                        {describeChangeLogEntry(entry)}
                      </span>
                      <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap' }}>
                        {new Date(entry.createdAt).toLocaleString('he-IL')}
                      </span>
                    </div>
                    {entry.userEmail && (
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: 2 }}>ע"י {entry.userEmail}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Archive — soft-removed tasks, restorable ── */}
      {showArchive && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 4000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowArchive(false)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: C.bgCard, borderRadius: RADIUS.lg, padding: SP[5], maxWidth: 640, width: '92vw', maxHeight: '78vh', overflowY: 'auto', boxShadow: '0 20px 48px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[3] }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📦 ארכיון משימות</span>
              <button onClick={() => setShowArchive(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 18, color: C.textMuted }}>✕</button>
            </div>
            {archivedTasks.length === 0 ? (
              <div style={{ textAlign: 'center', padding: SP[6], color: C.textMuted }}>אין משימות בארכיון</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                {archivedTasks.map(task => (
                  <div key={task.id} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, ...TEXT.sm, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[3] }}>
                    <div>
                      <div style={{ fontWeight: WEIGHT.medium, color: C.textPrimary }}>
                        CR {task.crNumber} {task.crLabel ? `— ${task.crLabel}` : ''}
                      </div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: 2 }}>
                        {task.user.fullName} · {CYCLE_LABEL[task.cycle.cycleType] ?? task.cycle.cycleType} · {task.effortDays} ימים · הועבר לארכיון {new Date(task.updatedAt).toLocaleString('he-IL')}
                      </div>
                    </div>
                    <button
                      onClick={() => restoreTask(task)}
                      disabled={restoringTask === task.id}
                      style={{ ...btnStyle(C.success, restoringTask === task.id), fontSize: 12, padding: '5px 10px', whiteSpace: 'nowrap' }}
                    >
                      {restoringTask === task.id ? '...' : '↺ שחזר'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
    <ConfirmDialog config={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </>
  );
}

// ── Gantt chart ───────────────────────────────────────────────────────────────
// One horizontal timeline per cycle: a top bar for the cycle's own span, then
// one row per tester with a segment per active task (colored in fixed order
// per row — CVD-safe categorical set, see dataviz skill). Time reads right→left
// (day 0 anchored next to the tester-name column, matching this card's RTL
// reading direction). A task that runs past the cycle's own end (overflow) is
// never clipped — the axis stretches to fit it, with a dashed marker at the
// cycle's real end so the overrun stays visible instead of disappearing off
// the edge.

// Fixed-order categorical palette (dataviz skill's validated default — CVD-safe
// adjacent-pair contrast). Colors distinguish *adjacent tasks within one row*,
// not a cross-row shared category, so there's no global legend — each segment
// carries its own identity via a direct label (CR number) instead. TARGET CRs
// (shared defect-handling duty — every active tester gets their own copy, see
// ALL_TESTERS_PATTERN in qa.service.ts) get their own reserved color instead of
// a rotation slot, so the same visual identity marks them in every row they
// appear in and no regular CR is ever colored the same way.
const GANTT_TASK_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];
const GANTT_TARGET_COLOR = '#14152A'; // app's own dark-indigo sidebar tone — distinct from every categorical slot
const TARGET_CR_PATTERN = /target/i;

function ganttDayOf(fromIso: string, toIso: string, holidayDays?: Set<string>): number {
  // 1-based work-day index of `to` relative to `from` (from itself = day 1).
  return countWorkDaysBetween(fromIso, toIso, holidayDays);
}

function GanttChart({ cycle, label, testerGroups, saGhostsByUser, urgentCrNumbers, holidayDays }: {
  cycle: Cycle;
  label: string;
  testerGroups: Map<string, { name: string; tasks: CycleTask[] }>;
  saGhostsByUser: Map<string, GhostTask[]>;
  urgentCrNumbers: Set<string>;
  holidayDays: Set<string>;
}) {
  const [collapsed, setCollapsed] = useState(false);
  // Custom fixed-position tooltip instead of the native `title` attribute —
  // native tooltips are unreliable on these thin, absolutely-positioned
  // segments (delayed, easily lost to a re-render, sometimes never fire).
  const [hoveredSeg, setHoveredSeg] = useState<{ text: string; x: number; y: number } | null>(null);
  const cycleLengthDays = Math.max(1, countWorkDaysBetween(cycle.plannedStart, cycle.plannedEnd, holidayDays));

  type Seg = { id: string; crNumber: string; label: string; startDay: number; durationDays: number; color: string | null; isTarget: boolean; isGhost: boolean; ghostLabel?: string; hasConflict?: boolean; isUrgent: boolean };
  const rows = Array.from(testerGroups.entries())
    .map(([userId, group]) => {
      const active = group.tasks.filter(t => t.isActive).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
      let colorIdx = 0;
      const segs: Seg[] = active.map(t => {
        const startDay = ganttDayOf(cycle.plannedStart, t.plannedStart, holidayDays);
        const endDay   = ganttDayOf(cycle.plannedStart, t.plannedEnd, holidayDays);
        const isFiller = t.taskType === 'REGRESSION';
        const isTarget = !isFiller && TARGET_CR_PATTERN.test(t.crLabel ?? t.crNumber);
        const color = isFiller ? null : isTarget ? GANTT_TARGET_COLOR : GANTT_TASK_COLORS[colorIdx++ % GANTT_TASK_COLORS.length];
        return {
          id: t.id, crNumber: isFiller ? 'רגרסיה' : t.crNumber, label: t.crLabel ?? t.crNumber,
          startDay, durationDays: Math.max(1, endDay - startDay + 1), color, isTarget, isGhost: false,
          isUrgent: !isFiller && urgentCrNumbers.has(t.crNumber),
        };
      });
      // Ghost segments — this tester's Stand Alone tasks that chronologically fall
      // inside this cycle's own window (see saGhostsByUser in CycleCard). Positioned
      // the same way, but never consume a rotation color and render read-only.
      // Dashed brand border = co-occurring, no actual day-level overlap (the normal,
      // expected case). Solid red + ⚠ = ghost.hasConflict — its dates genuinely
      // intersect one of the tester's real tasks here, which the scheduler should
      // never produce on its own; only a manual reassignment/edit could cause it.
      for (const t of saGhostsByUser.get(userId) ?? []) {
        const startDay = ganttDayOf(cycle.plannedStart, t.plannedStart, holidayDays);
        const endDay   = ganttDayOf(cycle.plannedStart, t.plannedEnd, holidayDays);
        segs.push({
          id: `ghost-${t.id}`, crNumber: t.crNumber, label: t.crLabel ?? t.crNumber,
          startDay, durationDays: Math.max(1, endDay - startDay + 1), color: null, isTarget: false, isGhost: true,
          ghostLabel: t.ghostLabel, hasConflict: t.hasConflict, isUrgent: false,
        });
      }
      segs.sort((a, b) => a.startDay - b.startDay);
      return { name: group.name, segs };
    })
    .filter(r => r.segs.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));

  if (rows.length === 0) return null;

  const axisMaxDays = Math.max(
    cycleLengthDays,
    ...rows.flatMap(r => r.segs.map(s => s.startDay + s.durationDays - 1)),
  );
  const pct = (days: number) => (days / axisMaxDays) * 100;

  // ~5 round ticks across the axis, always including 0 and the cycle length.
  const tickStep = Math.max(1, Math.round(cycleLengthDays / 5 / 5) * 5) || Math.ceil(cycleLengthDays / 5);
  const ticks = Array.from({ length: Math.floor(axisMaxDays / tickStep) + 1 }, (_, i) => i * tickStep)
    .filter(t => t <= axisMaxDays);
  if (ticks[ticks.length - 1] !== axisMaxDays) ticks.push(axisMaxDays);

  const ROW_H = 30;
  const LABEL_W = 156; // wide enough for full first+last names ("Stanislav Abramyan") without ellipsis

  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, marginBottom: SP[4], overflow: 'hidden' }}>
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: SP[4], paddingBottom: collapsed ? SP[4] : SP[3], cursor: 'pointer', userSelect: 'none', direction: 'rtl' }}
      >
        <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', flex: 1 }}>
          📊 ציר זמן — עומס בודקים ב{label}
        </span>
        <span style={{ color: C.textMuted, fontSize: '13px' }}>{collapsed ? '▼' : '▲'}</span>
      </div>

      {!collapsed && (
        <div style={{ padding: `0 ${SP[4]} ${SP[4]}`, direction: 'rtl' }}>
          {/* Cycle-span row */}
          <div style={{ display: 'flex', alignItems: 'center', height: ROW_H, marginBottom: SP[2] }}>
            <div style={{ width: LABEL_W, flexShrink: 0, ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary, paddingRight: SP[2], boxSizing: 'border-box' }}>
              {label}
            </div>
            <div style={{ flex: 1, position: 'relative', height: 14 }}>
              <div style={{
                position: 'absolute', top: 0, height: '100%', borderRadius: RADIUS.full,
                right: 0, width: `${pct(cycleLengthDays)}%`,
                background: C.brandDim, border: `1px solid ${C.brand}55`,
              }} />
            </div>
          </div>

          {/* Tester rows */}
          {rows.map(row => (
            <div key={row.name} style={{ display: 'flex', alignItems: 'center', height: ROW_H }}>
              <div
                title={row.name}
                style={{
                  width: LABEL_W, flexShrink: 0, ...TEXT.xs, fontWeight: WEIGHT.medium, color: C.textPrimary,
                  paddingRight: SP[2], boxSizing: 'border-box', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}
              >
                {row.name}
              </div>
              <div style={{ flex: 1, position: 'relative', height: 18, background: C.bgNested, borderRadius: RADIUS.sm }}>
                {/* Cycle-end marker — segments crossing it are overflowing the cycle */}
                {cycleLengthDays < axisMaxDays && (
                  <div style={{ position: 'absolute', top: -2, bottom: -2, right: `${pct(cycleLengthDays)}%`, borderRight: `1px dashed ${C.danger}88` }} />
                )}
                {row.segs.map(seg => {
                  const rightPct = pct(seg.startDay - 1);
                  const widthPct = pct(seg.durationDays);
                  const wide = widthPct > 6;
                  const ghostColor = seg.hasConflict ? C.danger : C.brand;
                  const titlePrefix = seg.isGhost
                    ? (seg.hasConflict ? `⚠ חפיפה בפועל! ↗ ${seg.ghostLabel} (סבב אחר) — ` : `↗ ${seg.ghostLabel} (סבב אחר, אין חפיפה בפועל) — `)
                    : seg.isTarget ? '🎯 TARGET — ' : '';
                  const tooltipText = `${titlePrefix}${seg.crNumber} — ${seg.label} (${seg.durationDays} ${seg.durationDays === 1 ? 'יום' : 'ימים'})`;
                  return (
                    <div
                      key={seg.id}
                      onMouseEnter={e => {
                        const r = e.currentTarget.getBoundingClientRect();
                        setHoveredSeg({ text: tooltipText, x: r.left + r.width / 2, y: r.top });
                      }}
                      onMouseLeave={() => setHoveredSeg(null)}
                      style={{
                        position: 'absolute', top: 0, height: '100%',
                        right: `${rightPct}%`, width: `${widthPct}%`,
                        background: seg.isGhost ? C.bgCard : seg.color ?? C.bgCard,
                        ...(seg.isGhost
                          ? { border: `1px dashed ${ghostColor}88`, opacity: 0.75 }
                          : seg.color ? {} : { backgroundImage: `repeating-linear-gradient(45deg, ${C.textDisabled}, ${C.textDisabled} 3px, ${C.bgCard} 3px, ${C.bgCard} 6px)` }),
                        borderRadius: RADIUS.sm,
                        boxSizing: 'border-box', border: seg.isGhost ? `1px dashed ${ghostColor}88` : `1px solid ${C.bgCard}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                        cursor: 'default',
                      }}
                    >
                      {/* Urgent marker — always at the left edge of the bar (regardless of
                          bar width/RTL day-direction), per explicit request: a fixed visual
                          landmark independent of the segment's own text label. */}
                      {seg.isUrgent && (
                        <span
                          title="דחוף"
                          style={{
                            position: 'absolute', left: 2, top: '50%', transform: 'translateY(-50%)',
                            fontWeight: WEIGHT.bold, fontSize: 11, color: C.danger, lineHeight: 1,
                          }}
                        >!</span>
                      )}
                      {seg.isGhost && seg.hasConflict && (
                        <span title="חפיפה בפועל" style={{ position: 'absolute', left: 2, top: '50%', transform: 'translateY(-50%)', fontSize: 11, lineHeight: 1 }}>⚠</span>
                      )}
                      {wide && (
                        <span style={{ fontWeight: WEIGHT.bold, color: seg.isGhost ? ghostColor : seg.color ? '#fff' : C.textMuted, whiteSpace: 'nowrap', fontSize: 11 }}>
                          {seg.isGhost ? `↗ ${seg.ghostLabel} ${seg.crNumber}` : seg.isTarget ? `🎯 ${seg.crNumber}` : seg.crNumber}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Axis */}
          <div style={{ display: 'flex', height: 18 }}>
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            <div style={{ flex: 1, position: 'relative' }}>
              {ticks.map(t => (
                <span key={t} style={{
                  position: 'absolute', right: `${pct(t)}%`, transform: 'translateX(50%)',
                  color: C.textMuted, fontSize: 11, top: 2,
                }}>
                  {t}
                </span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex' }}>
            <div style={{ width: LABEL_W, flexShrink: 0 }} />
            <div style={{ flex: 1, textAlign: 'center', color: C.textMuted, fontSize: 11 }}>
              ימים בסבב הבדיקות{axisMaxDays > cycleLengthDays ? ' (כולל חריגה מהסבב)' : ''}
            </div>
          </div>
        </div>
      )}
      {hoveredSeg && (
        <div style={{
          position: 'fixed', left: hoveredSeg.x, top: hoveredSeg.y, transform: 'translate(-50%, -100%) translateY(-6px)',
          background: C.textPrimary, color: C.bgCard, ...TEXT.xs, fontWeight: WEIGHT.medium,
          padding: `${SP[1]} ${SP[2]}`, borderRadius: RADIUS.sm, boxShadow: SHADOW.md,
          whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 1000, direction: 'rtl',
        }}>
          {hoveredSeg.text}
        </div>
      )}
    </div>
  );
}

// ── EmployeeCycleMatrix ───────────────────────────────────────────────────────
// "Full picture per employee" — a row per tester, a column per cycle, so you
// can see everything they have (and where they exceed) without switching
// between cycle cards. Overflow coloring comes from the SAME overflowIssues
// the server already computes (matched via userId/cycleType) — not a
// separate client-side estimate, so this can never disagree with the
// warning panel above.

const MATRIX_CYCLES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE', 'UAT'];

function EmployeeCycleMatrix({
  workPlan, allPlanTesters, urgentCrNumbers, holidayDays, onlyOverflowing, expandedCell, onToggleCell, onGoToRow,
}: {
  workPlan: WorkPlan;
  allPlanTesters: { userId: string; fullName: string }[];
  urgentCrNumbers: Set<string>;
  holidayDays: Set<string>;
  onlyOverflowing: boolean;
  expandedCell: string | null;
  onToggleCell: (key: string) => void;
  onGoToRow: (userName: string, crNumber: string) => void;
}) {
  const cycles = MATRIX_CYCLES
    .map(ct => workPlan.cycles.find(c => c.cycleType === ct))
    .filter((c): c is Cycle => !!c && c.tasks.length > 0);

  const issuesByCell = useMemo(() => {
    const map = new Map<string, OverflowIssue[]>();
    (workPlan.overflowIssues ?? []).forEach(issue => {
      if (!issue.userId || !issue.cycleType) return;
      const key = `${issue.userId}::${issue.cycleType}`;
      const list = map.get(key) ?? [];
      list.push(issue);
      map.set(key, list);
    });
    return map;
  }, [workPlan.overflowIssues]);

  const tasksByCell = useMemo(() => {
    const map = new Map<string, CycleTask[]>();
    for (const cycle of cycles) {
      for (const t of cycle.tasks) {
        if (!t.isActive || t.taskType === 'REGRESSION') continue;
        const key = `${t.userId}::${cycle.cycleType}`;
        const list = map.get(key) ?? [];
        list.push(t);
        map.set(key, list);
      }
    }
    return map;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cycles]);

  const rows = useMemo(() => {
    return allPlanTesters.map(tester => {
      const cells = cycles.map(cycle => {
        const key = `${tester.userId}::${cycle.cycleType}`;
        const tasks = (tasksByCell.get(key) ?? []).slice().sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
        const assignedDays = tasks.reduce((s, t) => s + t.effortDays, 0);
        const hasFixedCapacity = cycle.cycleType === 'CYCLE_1' || cycle.cycleType === 'CYCLE_2' || cycle.cycleType === 'CYCLE_3';
        const capacityDays = hasFixedCapacity ? countWorkDaysBetween(cycle.plannedStart, cycle.plannedEnd, holidayDays) : null;
        const issues = issuesByCell.get(key) ?? [];
        return { cycleType: cycle.cycleType, key, tasks, assignedDays, capacityDays, issues, hasOverflow: issues.length > 0 };
      });
      const anyOverflow = cells.some(c => c.hasOverflow);
      const totalDays = cells.reduce((s, c) => s + c.assignedDays, 0);
      return { tester, cells, anyOverflow, totalDays };
    })
      .filter(r => !onlyOverflowing || r.anyOverflow)
      .sort((a, b) => (b.anyOverflow ? 1 : 0) - (a.anyOverflow ? 1 : 0) || a.tester.fullName.localeCompare(b.tester.fullName, 'he'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPlanTesters, cycles, tasksByCell, issuesByCell, onlyOverflowing]);

  if (cycles.length === 0) return null;

  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'hidden', marginBottom: SP[4] }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', direction: 'rtl' }}>
          <thead>
            <tr style={{ background: C.bgNested }}>
              <th style={{ padding: SP[3], textAlign: 'right', ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, whiteSpace: 'nowrap' }}>עובד</th>
              {cycles.map(c => (
                <th key={c.cycleType} style={{ padding: SP[3], textAlign: 'center', ...TEXT.xs, fontWeight: WEIGHT.bold, color: CYCLE_ACCENT[c.cycleType] ?? C.textMuted, whiteSpace: 'nowrap' }}>
                  {CYCLE_LABEL[c.cycleType] ?? c.cycleType}
                </th>
              ))}
              <th style={{ padding: SP[3], textAlign: 'center', ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, whiteSpace: 'nowrap' }}>סה״כ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.tester.userId} style={{ borderTop: `1px solid ${C.border}` }}>
                <td style={{ padding: SP[3], ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, whiteSpace: 'nowrap' }}>
                  {row.anyOverflow && <span title="חורג באחד הסבבים" style={{ marginLeft: 6 }}>⚠️</span>}
                  {row.tester.fullName}
                </td>
                {row.cells.map(cell => {
                  const isExpanded = expandedCell === cell.key;
                  const isEmpty = cell.tasks.length === 0;
                  return (
                    <td key={cell.cycleType} style={{ padding: SP[2], textAlign: 'center', verticalAlign: 'top' }}>
                      {isEmpty ? (
                        <span style={{ color: C.textDisabled, ...TEXT.xs }}>—</span>
                      ) : (
                        <div>
                          <button
                            onClick={() => onToggleCell(cell.key)}
                            style={{
                              border: `1px solid ${cell.hasOverflow ? C.danger : C.border}`,
                              background: cell.hasOverflow ? C.dangerBg : C.bgNested,
                              color: cell.hasOverflow ? C.danger : C.textSecondary,
                              borderRadius: RADIUS.md, padding: '4px 10px', cursor: 'pointer',
                              fontFamily: FONT, ...TEXT.xs, fontWeight: WEIGHT.bold, whiteSpace: 'nowrap',
                            }}
                          >
                            {cell.capacityDays != null ? `${cell.assignedDays}/${cell.capacityDays} ימים` : `${cell.assignedDays} ימים`}
                            {' · '}{cell.tasks.length} CR{cell.tasks.length === 1 ? '' : 'ים'}
                            {cell.hasOverflow && ' ⚠'}
                          </button>
                          {isExpanded && (
                            <div style={{ marginTop: SP[2], textAlign: 'right', background: C.bgApp, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: SP[2], minWidth: 220 }}>
                              {cell.tasks.map(t => (
                                <div
                                  key={t.id}
                                  onClick={() => onGoToRow(row.tester.fullName, t.crNumber)}
                                  style={{ display: 'flex', justifyContent: 'space-between', gap: SP[2], padding: '3px 0', cursor: 'pointer', borderBottom: `1px solid ${C.border}` }}
                                >
                                  <span style={{ ...TEXT.xs, color: C.textPrimary }}>
                                    {urgentCrNumbers.has(t.crNumber) && <span title="דחוף" style={{ color: C.danger, marginLeft: 4 }}>🔴</span>}
                                    {t.crNumber} — {t.crLabel ?? t.crNumber}
                                  </span>
                                  <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap' }}>{t.effortDays}י׳</span>
                                </div>
                              ))}
                              {cell.issues.map((issue, i) => (
                                <div key={i} style={{ ...TEXT.xs, color: C.danger, marginTop: SP[2] }}>⚠ {issue.message}</div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td style={{ padding: SP[2], textAlign: 'center', ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
                  {row.totalDays} ימים
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={cycles.length + 2} style={{ padding: SP[5], textAlign: 'center', color: C.textMuted, ...TEXT.sm }}>
                  {onlyOverflowing ? 'אין חריגות כרגע 🎉' : 'אין בודקים בתוכנית'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── CycleCard ─────────────────────────────────────────────────────────────────

interface CycleCardProps {
  cycle:           Cycle;
  expanded:        boolean;
  onToggleExpand:  () => void;
  onToggleTask:    (t: CycleTask) => void;
  togglingTasks:   Set<string>;
  allAssignments:  QaAssignment[];
  editNotes:       Record<string, string>;
  onNotesChange:   (text: string) => void;
  onSaveNotes:     () => void;
  savingNotes:     boolean;
  planApproved:    boolean;
  filterUserId:    string;
  editingEffort:   string | null;
  onEditEffort:    (taskId: string | null) => void;
  onSaveEffort:    (taskId: string, value: string) => void;
  assignmentMap:   Map<string, QaAssignment>;
  onOpenSecondary: (crNumber: string) => void;
  onReorderTask:   (taskId: string, newSortOrder: number) => void;
  reorderingTask:  string | null;
  problematicKeys: Set<string>;
  allTesters:      { userId: string; fullName: string }[];
  swappingTask:    string | null;
  onStartSwap:     (taskId: string | null) => void;
  onReassignTester: (taskId: string, newUserId: string) => void;
  reassigning:     string | null;
  onDeleteTask:    (t: CycleTask) => void;
  deletingTask:    string | null;
  urgentCrNumbers: Set<string>;
  standAloneCycle: Cycle | undefined;
  coreCycles:      Cycle[];
  holidayDays:     Set<string>;
}

function CycleCard({
  cycle, expanded, onToggleExpand, onToggleTask,
  togglingTasks, editNotes, onNotesChange, onSaveNotes, savingNotes, planApproved,
  filterUserId, editingEffort, onEditEffort, onSaveEffort,
  assignmentMap, onOpenSecondary, onReorderTask, reorderingTask,
  allAssignments, problematicKeys,
  allTesters, swappingTask, onStartSwap, onReassignTester, reassigning,
  onDeleteTask, deletingTask,
  urgentCrNumbers, standAloneCycle, coreCycles, holidayDays,
}: CycleCardProps) {
  const accent = CYCLE_ACCENT[cycle.cycleType] ?? C.textMuted;
  const bg     = CYCLE_BG[cycle.cycleType]     ?? C.bgNested;
  const label  = CYCLE_LABEL[cycle.cycleType]  ?? cycle.cycleType;
  const counts = countTasks(cycle);
  const totalWorkDays = countWorkDaysBetween(cycle.plannedStart, cycle.plannedEnd, holidayDays);
  const assignedDays  = cycleAssignedDays(cycle, filterUserId);
  const editable = EDITABLE_CYCLES.has(cycle.cycleType) && !planApproved;
  const isRehearsalOrGoLive = cycle.cycleType === 'REHEARSAL' || cycle.cycleType === 'GO_LIVE';
  const markedCrs = isRehearsalOrGoLive
    ? allAssignments.filter(a => (a.cycles ?? []).includes(cycle.cycleType))
    : [];

  // Group tasks by tester (applying employee filter)
  const testerGroups = new Map<string, { name: string; tasks: CycleTask[] }>();
  for (const task of cycle.tasks) {
    if (filterUserId && task.userId !== filterUserId) continue;
    if (!testerGroups.has(task.userId)) {
      testerGroups.set(task.userId, { name: task.user.fullName, tasks: [] });
    }
    testerGroups.get(task.userId)!.tasks.push(task);
  }

  // Cross-cycle visibility, both directions — a tester's Stand Alone task can
  // chronologically fall inside a core cycle's window (e.g. their SA load
  // overflowed into it), and just as easily a core-cycle task can fall inside
  // the SA cycle's own window — either way it's otherwise invisible since SA
  // and core are fully separate cycles. Surface it as a read-only "ghost"
  // entry, only for testers who already have a real row in this cycle (never
  // creates a new row just for a ghost). The scheduler itself never lets these
  // overlap in time for the same tester (scheduleStandAlone conflict-checks
  // against the tester's core busy periods) — this is purely about making
  // that already-true fact visible here instead of only inferable by
  // cross-referencing two separate cards.
  const isCoreCycle = cycle.cycleType === 'CYCLE_1' || cycle.cycleType === 'CYCLE_2' || cycle.cycleType === 'CYCLE_3';
  const isStandAloneCycle = cycle.cycleType === 'STAND_ALONE';
  const saGhostsByUser = new Map<string, GhostTask[]>();
  if (isCoreCycle && standAloneCycle) {
    for (const t of standAloneCycle.tasks) {
      if (!t.isActive || !testerGroups.has(t.userId)) continue;
      if (filterUserId && t.userId !== filterUserId) continue;
      if (t.plannedStart > cycle.plannedEnd || t.plannedEnd < cycle.plannedStart) continue; // no calendar overlap with this cycle
      const hasConflict = testerGroups.get(t.userId)!.tasks
        .some(real => real.isActive && rangesOverlap(t.plannedStart, t.plannedEnd, real.plannedStart, real.plannedEnd));
      if (!saGhostsByUser.has(t.userId)) saGhostsByUser.set(t.userId, []);
      saGhostsByUser.get(t.userId)!.push({ ...t, ghostLabel: CYCLE_LABEL.STAND_ALONE, hasConflict });
    }
  } else if (isStandAloneCycle) {
    for (const coreCycle of coreCycles) {
      const ghostLabel = CYCLE_LABEL[coreCycle.cycleType] ?? coreCycle.cycleType;
      for (const t of coreCycle.tasks) {
        if (!t.isActive || !testerGroups.has(t.userId)) continue;
        if (filterUserId && t.userId !== filterUserId) continue;
        if (t.plannedStart > cycle.plannedEnd || t.plannedEnd < cycle.plannedStart) continue; // no calendar overlap with the SA cycle's own window
        const hasConflict = testerGroups.get(t.userId)!.tasks
          .some(real => real.isActive && rangesOverlap(t.plannedStart, t.plannedEnd, real.plannedStart, real.plannedEnd));
        if (!saGhostsByUser.has(t.userId)) saGhostsByUser.set(t.userId, []);
        saGhostsByUser.get(t.userId)!.push({ ...t, ghostLabel, hasConflict });
      }
    }
  }

  const noteVal = editNotes[cycle.id] ?? (cycle.notes ?? '');

  return (
    <div style={{ ...cardStyle, marginBottom: SP[3], padding: 0, overflow: 'hidden' }}>
      {/* Header */}
      <div
        onClick={onToggleExpand}
        style={{
          display: 'flex', alignItems: 'center', gap: SP[3],
          padding: `${SP[3]} ${SP[4]}`,
          backgroundColor: bg, cursor: 'pointer',
          borderBottom: expanded ? `1px solid ${C.border}` : 'none',
          userSelect: 'none',
        }}
      >
        <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: accent }}>{label}</span>

        <span style={{ ...TEXT.sm, color: C.textSecondary }}>
          {fmtDate(cycle.plannedStart)} — {fmtDate(cycle.plannedEnd)}
        </span>

        {!isRehearsalOrGoLive && (
          <span style={{
            ...TEXT.xs, fontWeight: WEIGHT.medium,
            backgroundColor: accent + '22', color: accent,
            padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm,
          }}>
            {counts.active}/{counts.total} CRים פעילים
          </span>
        )}
        {!isRehearsalOrGoLive && (
          <span
            title={filterUserId ? 'ימי עבודה של העובד המסונן בסבב, מתוך ימי הסבב' : 'סה"כ ימי עבודה משובצים בסבב, מתוך ימי הסבב'}
            style={{
              ...TEXT.xs, fontWeight: WEIGHT.medium,
              backgroundColor: assignedDays > totalWorkDays ? C.dangerBg : accent + '22',
              color: assignedDays > totalWorkDays ? C.danger : accent,
              padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm,
            }}>
            {assignedDays}/{totalWorkDays} ימי בדיקה{filterUserId ? ' לעובד' : ''}
          </span>
        )}
        {isRehearsalOrGoLive && markedCrs.length > 0 && (
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.medium, backgroundColor: accent + '22', color: accent, padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm }}>
            {markedCrs.length} CRים · עד 3 שעות
          </span>
        )}

        {counts.regression > 0 && (
          <span style={{
            ...TEXT.xs,
            backgroundColor: C.bgNested, color: C.textMuted,
            padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm,
            border: `1px solid ${C.border}`,
          }}>
            + רגרסיה
          </span>
        )}

        <span style={{ marginRight: 'auto', color: C.textMuted, fontSize: '14px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: SP[4] }}>
          {isRehearsalOrGoLive ? (
            <div>
              {/* Marked CRs list */}
              <div style={{ marginBottom: SP[3] }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: SP[2] }}>
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: accent, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    CRים מסומנים לסבב זה
                  </span>
                  <span style={{ ...TEXT.xs, color: C.textMuted, background: C.bgNested, border: `1px solid ${C.border}`, padding: `1px ${SP[2]}`, borderRadius: RADIUS.full }}>
                    {markedCrs.length} CRים · עד 3 שעות
                  </span>
                </div>
                {markedCrs.length === 0 ? (
                  <div style={{ ...TEXT.sm, color: C.textMuted, fontStyle: 'italic', padding: `${SP[2]} 0` }}>
                    לא סומנו CRים לסבב זה — סמן CRים בלשונית השיבוץ
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    {markedCrs.map((a, idx) => (
                      <div key={a.crNumber} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: `${SP[1]} ${SP[2]}`, background: C.bgNested, borderRadius: RADIUS.sm, border: `1px solid ${C.border}` }}>
                        <span style={{ ...TEXT.xs, color: C.textMuted, minWidth: 20, textAlign: 'center' }}>{idx + 1}.</span>
                        <span style={{ background: bg, color: accent, padding: `1px ${SP[2]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>{a.crNumber}</span>
                        <span style={{ ...TEXT.xs, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                          {a.crLabel?.replace(/^\d+\s*-\s*/, '') ?? ''}
                        </span>
                        {a.user && (
                          <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>
                            {a.user.fullName.split(' ')[0]}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Freeform notes */}
              <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: SP[1] }}>הוראות ותכולה ידנית לסבב:</div>
              <textarea
                value={noteVal}
                onChange={e => onNotesChange(e.target.value)}
                rows={4}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: SP[3], borderRadius: RADIUS.md,
                  border: `1px solid ${C.border}`,
                  fontFamily: FONT, ...TEXT.sm, color: C.textPrimary,
                  resize: 'vertical',
                }}
                placeholder="הוסף הוראות ספציפיות, CRים נוספים או הגדרות לסבב זה..."
              />
              <div style={{ marginTop: SP[2], display: 'flex', gap: SP[2] }}>
                <button onClick={onSaveNotes} disabled={savingNotes} style={btnStyle(C.info, savingNotes)}>
                  {savingNotes ? 'שומר...' : 'שמור הערות'}
                </button>
              </div>
            </div>
          ) : testerGroups.size === 0 ? (
            <p style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[4] }}>
              אין משימות בסבב זה
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
              <GanttChart cycle={cycle} label={label} testerGroups={testerGroups} saGhostsByUser={saGhostsByUser} urgentCrNumbers={urgentCrNumbers} holidayDays={holidayDays} />
              {Array.from(testerGroups.entries()).map(([userId, group]) => (
                <TesterSection
                  key={userId}
                  testerName={group.name}
                  tasks={group.tasks}
                  ghostTasks={saGhostsByUser.get(userId) ?? []}
                  editable={editable}
                  onToggleTask={onToggleTask}
                  togglingTasks={togglingTasks}
                  editingEffort={editingEffort}
                  onEditEffort={onEditEffort}
                  onSaveEffort={onSaveEffort}
                  assignmentMap={assignmentMap}
                  onOpenSecondary={onOpenSecondary}
                  onReorderTask={onReorderTask}
                  reorderingTask={reorderingTask}
                  isCycle1={cycle.cycleType === 'CYCLE_1'}
                  problematicKeys={problematicKeys}
                  allTesters={allTesters}
                  swappingTask={swappingTask}
                  onStartSwap={onStartSwap}
                  onReassignTester={onReassignTester}
                  reassigning={reassigning}
                  onDeleteTask={onDeleteTask}
                  deletingTask={deletingTask}
                  urgentCrNumbers={urgentCrNumbers}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TesterSection ─────────────────────────────────────────────────────────────

interface TesterSectionProps {
  testerName:      string;
  tasks:           CycleTask[];
  ghostTasks:      GhostTask[];
  editable:        boolean;
  onToggleTask:    (t: CycleTask) => void;
  togglingTasks:   Set<string>;
  editingEffort:   string | null;
  onEditEffort:    (taskId: string | null) => void;
  onSaveEffort:    (taskId: string, value: string) => void;
  assignmentMap:   Map<string, QaAssignment>;
  onOpenSecondary: (crNumber: string) => void;
  onReorderTask:   (taskId: string, newSortOrder: number) => void;
  reorderingTask:  string | null;
  isCycle1:        boolean;
  problematicKeys: Set<string>;
  allTesters:      { userId: string; fullName: string }[];
  swappingTask:    string | null;
  onStartSwap:     (taskId: string | null) => void;
  onReassignTester: (taskId: string, newUserId: string) => void;
  reassigning:     string | null;
  onDeleteTask:    (t: CycleTask) => void;
  deletingTask:    string | null;
  urgentCrNumbers: Set<string>;
}

function TesterSection({
  testerName, tasks, ghostTasks, editable, onToggleTask, togglingTasks,
  editingEffort, onEditEffort, onSaveEffort,
  assignmentMap, onOpenSecondary, onReorderTask, reorderingTask, isCycle1,
  problematicKeys, allTesters, swappingTask, onStartSwap, onReassignTester, reassigning,
  onDeleteTask, deletingTask,
  urgentCrNumbers,
}: TesterSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const crTasks = sorted.filter(t => t.taskType !== 'REGRESSION' && t.isPrimary);
  const totalDays = crTasks.filter(t => t.isActive).reduce((s, t) => s + t.effortDays, 0);

  // Real rows (unchanged order/index logic) merged with read-only Stand Alone
  // "ghost" rows at their true chronological position, for display only — the
  // ghosts never enter sortOrder/crTasks/reorder math above.
  type DisplayRow = { kind: 'real'; task: CycleTask } | { kind: 'ghost'; task: GhostTask };
  const displayRows: DisplayRow[] = [
    ...sorted.map(t => ({ kind: 'real' as const, task: t })),
    ...ghostTasks.map(t => ({ kind: 'ghost' as const, task: t })),
  ].sort((a, b) => a.task.plannedStart.localeCompare(b.task.plannedStart));
  const colCount = 9 + (editable ? 2 : 0);

  // Drag-and-drop reorder — same onReorderTask call the ▲▼ arrows already use,
  // just computing the target position from where the row was dropped instead
  // of ±1. Only within this tester's own CYCLE_1 queue (arrows have the same
  // restriction — cycles 2/3 are derived downstream, not manually reordered).
  const handleDrop = (targetTask: CycleTask) => {
    const draggedId = dragTaskId;
    setDragTaskId(null);
    setDragOverTaskId(null);
    if (!draggedId || draggedId === targetTask.id) return;
    const targetOrder = crTasks.findIndex(t => t.id === targetTask.id) + 1;
    if (targetOrder > 0) onReorderTask(draggedId, targetOrder);
  };

  return (
    <div>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex', alignItems: 'center', gap: SP[2],
          marginBottom: collapsed ? 0 : SP[2],
          paddingBottom: SP[2],
          borderBottom: `2px solid ${C.border}`,
          cursor: 'pointer', userSelect: 'none',
        }}
      >
        <div style={{
          width: 32, height: 32, borderRadius: '50%',
          backgroundColor: C.infoBg,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.info,
          flexShrink: 0,
        }}>
          {testerName.charAt(0)}
        </div>
        <span style={{ ...TEXT.base, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>
          {testerName}
        </span>
        <span style={{ ...TEXT.xs, color: C.textMuted }}>
          סה"כ: {totalDays} ימים · {crTasks.length} CR
        </span>
        <span style={{ marginRight: 'auto', ...TEXT.xs, color: C.textMuted }}>{collapsed ? '▼' : '▲'}</span>
      </div>

      {!collapsed && (
        <table style={{ width: '100%', borderCollapse: 'collapse', ...TEXT.sm, tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: 56 }} />
            <col style={{ width: 80 }} />
            <col />
            <col style={{ width: 100 }} />
            <col style={{ width: 140 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 68 }} />
            <col style={{ width: 34 }} />
            {editable && <col style={{ width: 60 }} />}
            {editable && <col style={{ width: 130 }} />}
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: C.bgNested }}>
              <th style={{ ...thStyle, textAlign: 'center' }}>#</th>
              <th style={thStyle}>מס' CR</th>
              <th style={thStyle}>תיאור</th>
              <th style={thStyle}>סוג</th>
              <th style={thStyle}>בודק שני</th>
              <th style={thStyle}>התחלה</th>
              <th style={thStyle}>סיום</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>ימים</th>
              <th style={{ ...thStyle, textAlign: 'center' }}></th>
              {editable && <th style={{ ...thStyle, textAlign: 'center' }}>פעיל</th>}
              {editable && <th style={{ ...thStyle, textAlign: 'center' }}>בודק</th>}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row) => {
              if (row.kind === 'ghost') {
                const t = row.task;
                const ghostColor = t.hasConflict ? C.danger : C.brand;
                return (
                  <tr key={`ghost-${t.id}`} style={{ backgroundColor: t.hasConflict ? C.dangerBg : C.brandDim }}>
                    <td colSpan={colCount} style={{ ...tdStyle, padding: `${SP[1]} ${SP[2]}` }}>
                      <span style={{ ...TEXT.xs, color: ghostColor, fontWeight: WEIGHT.bold }}>
                        {t.hasConflict ? `⚠ חפיפה בפועל — ↗ ${t.ghostLabel}` : `↗ ${t.ghostLabel} (אין חפיפה בפועל)`}
                      </span>
                      <span style={{ ...TEXT.xs, color: C.textSecondary, fontStyle: 'italic', marginRight: SP[2] }}>
                        {t.crNumber} — {t.crLabel ?? t.crNumber} · {fmtDate(t.plannedStart)}–{fmtDate(t.plannedEnd)} · {t.effortDays} ימים
                      </span>
                    </td>
                  </tr>
                );
              }
              const task = row.task;
              const isReg      = task.taskType === 'REGRESSION';
              const isSecondary = !task.isPrimary;
              const isInactive = !task.isActive;
              const rowBg      = isInactive ? C.bgNested : isSecondary ? 'rgba(99,179,237,0.06)' : isReg ? 'rgba(156,106,222,0.05)' : C.bgCard;
              const isEditingThisEffort = editingEffort === task.id;
              const orderNum   = (isReg || isSecondary) ? null : crTasks.findIndex(t => t.id === task.id) + 1;
              const isReordering = reorderingTask === task.id;

              // Secondary tester info (only for primary non-reg tasks in CYCLE_1)
              const asg = (!isReg && !isSecondary) ? assignmentMap.get(task.crNumber) : null;
              const secondaryName = asg?.secondaryTesterId
                ? (asg as any)?.secondaryUser?.fullName ?? `בודק שני (${asg.secondaryTesterId.slice(0,6)})`
                : null;

              const isProblematic = !isReg && problematicKeys.has(rowKey(testerName, task.crNumber));

              return (
                <tr
                  key={task.id}
                  id={rowElementId(testerName, task.crNumber)}
                  onDragOver={isCycle1 && orderNum != null ? e => { e.preventDefault(); if (dragTaskId && dragTaskId !== task.id) setDragOverTaskId(task.id); } : undefined}
                  onDragLeave={isCycle1 && orderNum != null ? () => setDragOverTaskId(prev => prev === task.id ? null : prev) : undefined}
                  onDrop={isCycle1 && orderNum != null ? e => { e.preventDefault(); handleDrop(task); } : undefined}
                  style={{
                    backgroundColor: dragOverTaskId === task.id ? C.infoBg : isProblematic ? C.dangerBg : rowBg,
                    opacity: isInactive ? 0.45 : 1,
                    textDecoration: isInactive ? 'line-through' : 'none',
                    outline: dragOverTaskId === task.id ? `2px dashed ${C.info}` : isProblematic ? `2px solid ${C.danger}` : 'none',
                    outlineOffset: '-2px',
                    transition: 'outline-color 0.3s',
                  }}
                >
                  {/* # + drag handle + reorder arrows */}
                  <td style={{ ...tdStyle, textAlign: 'center', padding: `${SP[1]} 4px` }}>
                    {orderNum != null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                        {isCycle1 && !isReordering && (
                          <span
                            draggable
                            title="גרור לשינוי סדר"
                            onDragStart={e => { e.dataTransfer.effectAllowed = 'move'; setDragTaskId(task.id); }}
                            onDragEnd={() => { setDragTaskId(null); setDragOverTaskId(null); }}
                            style={{ cursor: 'grab', color: C.textDisabled, ...TEXT.xs, lineHeight: 1, userSelect: 'none' }}
                          >⠿</span>
                        )}
                        <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.medium, minWidth: 16 }}>{orderNum}</span>
                        {isCycle1 && !isReordering && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                            <button
                              title="הזז למעלה"
                              disabled={orderNum === 1}
                              onClick={() => onReorderTask(task.id, orderNum - 1)}
                              style={{ ...arrowBtnStyle, opacity: orderNum === 1 ? 0.2 : 0.6 }}
                            >▲</button>
                            <button
                              title="הזז למטה"
                              disabled={orderNum === crTasks.length}
                              onClick={() => onReorderTask(task.id, orderNum + 1)}
                              style={{ ...arrowBtnStyle, opacity: orderNum === crTasks.length ? 0.2 : 0.6 }}
                            >▼</button>
                          </div>
                        )}
                        {isReordering && <span style={{ ...TEXT.xs, color: C.textMuted }}>⟳</span>}
                      </div>
                    ) : isSecondary ? (
                      <span style={{ ...TEXT.xs, color: C.info, opacity: 0.6 }}>↳</span>
                    ) : null}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ ...TEXT.xs, fontWeight: WEIGHT.medium, color: isReg ? C.statusWaiting : isSecondary ? C.info : C.textLink }}>
                      {!isReg && urgentCrNumbers.has(task.crNumber) && (
                        <span title="דחוף — מתוזמן ראשון בתור הבודק" style={{ marginLeft: 3 }}>🔴</span>
                      )}
                      {isReg ? '—' : task.crNumber}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isSecondary
                      ? <span style={{ ...TEXT.xs, color: C.textMuted, fontStyle: 'italic' }}>↳ {task.crLabel ?? task.crNumber}</span>
                      : (task.crLabel ?? task.crNumber)
                    }
                  </td>
                  <td style={tdStyle}>
                    {isSecondary
                      ? <span style={{ ...TEXT.xs, color: C.info, backgroundColor: C.infoBg, padding: `1px ${SP[1]}`, borderRadius: RADIUS.sm }}>בודק שני</span>
                      : <TaskTypeBadge type={task.taskType} />
                    }
                  </td>
                  {/* Secondary tester cell */}
                  <td style={{ ...tdStyle, padding: `${SP[1]} ${SP[2]}` }}>
                    {!isReg && !isSecondary ? (
                      secondaryName ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
                          <span style={{ ...TEXT.xs, color: C.info, fontWeight: WEIGHT.medium, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 90 }}>
                            {secondaryName}
                          </span>
                          <button
                            title="שנה / הסר בודק שני"
                            onClick={() => onOpenSecondary(task.crNumber)}
                            style={{ ...smallBtnStyle, backgroundColor: C.infoBg, color: C.info, border: `1px solid ${C.info}` }}
                          >✎</button>
                        </div>
                      ) : (
                        <button
                          title="הוסף בודק שני"
                          onClick={() => onOpenSecondary(task.crNumber)}
                          style={{ ...smallBtnStyle, backgroundColor: C.bgNested, color: C.textMuted, border: `1px dashed ${C.border}` }}
                        >+ בודק שני</button>
                      )
                    ) : null}
                  </td>
                  <td style={tdStyle}>{fmtDate(task.plannedStart)}</td>
                  <td style={tdStyle}>{fmtDate(task.plannedEnd)}</td>
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {isReg ? (
                      <span style={{ ...TEXT.xs, color: C.textMuted }}>{task.effortDays}</span>
                    ) : isEditingThisEffort ? (
                      <input
                        autoFocus
                        type="number" min="0.5" step="0.5"
                        defaultValue={task.effortDays}
                        style={{ width: 52, padding: '1px 4px', border: `1px solid ${C.info}`, borderRadius: RADIUS.sm, ...TEXT.xs, textAlign: 'center', fontFamily: FONT }}
                        onBlur={e => onSaveEffort(task.id, e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') onSaveEffort(task.id, (e.target as HTMLInputElement).value);
                          if (e.key === 'Escape') onEditEffort(null);
                        }}
                      />
                    ) : (
                      <span
                        title="לחץ לעריכה"
                        onClick={() => !isSecondary && onEditEffort(task.id)}
                        style={{ cursor: isSecondary ? 'default' : 'pointer', ...TEXT.xs, color: C.textPrimary, fontWeight: WEIGHT.medium, padding: '1px 6px', borderRadius: RADIUS.sm, border: `1px solid transparent` }}
                        onMouseEnter={e => { if (!isSecondary) (e.currentTarget as HTMLSpanElement).style.border = `1px solid ${C.border}`; }}
                        onMouseLeave={e => (e.currentTarget as HTMLSpanElement).style.border = '1px solid transparent'}
                      >
                        {task.effortDays}
                      </span>
                    )}
                  </td>
                  {/* Archive — a corrective, recoverable action (see the "ארכיון"
                      panel), always available regardless of the cycle's
                      editable/approval gate (unlike toggle/reassign below) */}
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {!isReg && !isSecondary && (
                      <button
                        title="העבר לארכיון (ניתן לשחזור)"
                        onClick={() => onDeleteTask(task)}
                        disabled={deletingTask === task.id}
                        style={{
                          ...smallBtnStyle, backgroundColor: 'transparent', color: C.danger,
                          border: '1px solid transparent', cursor: deletingTask === task.id ? 'not-allowed' : 'pointer',
                        }}
                      >
                        {deletingTask === task.id ? '…' : '📦'}
                      </button>
                    )}
                  </td>
                  {editable && (
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {!isReg && !isSecondary && (
                        <button
                          onClick={() => onToggleTask(task)}
                          disabled={togglingTasks.has(task.id)}
                          style={{
                            padding: `2px ${SP[2]}`,
                            borderRadius: RADIUS.sm,
                            border: `1px solid ${task.isActive ? C.success : C.border}`,
                            backgroundColor: task.isActive ? C.successBg : C.bgNested,
                            color: task.isActive ? C.success : C.textMuted,
                            cursor: 'pointer',
                            ...TEXT.xs, fontWeight: WEIGHT.medium,
                          }}
                        >
                          {togglingTasks.has(task.id) ? '...' : task.isActive ? 'כן' : 'לא'}
                        </button>
                      )}
                    </td>
                  )}
                  {editable && (
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {!isReg && (
                        swappingTask === task.id ? (
                          <select
                            autoFocus
                            defaultValue=""
                            disabled={reassigning === task.id}
                            onChange={e => { if (e.target.value) onReassignTester(task.id, e.target.value); }}
                            onBlur={() => onStartSwap(null)}
                            style={{ ...TEXT.xs, padding: '2px 4px', borderRadius: RADIUS.sm, border: `1px solid ${C.info}`, fontFamily: FONT, maxWidth: 120 }}
                          >
                            <option value="">-- בחר בודק --</option>
                            {allTesters.filter(t => t.userId !== task.userId).map(t => (
                              <option key={t.userId} value={t.userId}>{t.fullName}</option>
                            ))}
                          </select>
                        ) : (
                          <button
                            title="החלף בודק"
                            onClick={() => onStartSwap(task.id)}
                            disabled={reassigning === task.id}
                            style={{ ...smallBtnStyle, backgroundColor: C.bgNested, color: C.textMuted, border: `1px solid ${C.border}` }}
                          >
                            {reassigning === task.id ? '...' : '🔄 החלף'}
                          </button>
                        )
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── TaskTypeBadge ─────────────────────────────────────────────────────────────

function TaskTypeBadge({ type }: { type: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    CR:          { label: 'CR',          color: C.info,         bg: C.infoBg       },
    STAND_ALONE: { label: 'Stand Alone', color: C.success,      bg: C.successBg    },
    REGRESSION:  { label: 'רגרסיה',      color: C.statusWaiting, bg: 'rgba(156,106,222,0.10)' },
  };
  const s = map[type] ?? { label: type, color: C.textMuted, bg: C.bgNested };
  return (
    <span style={{
      ...TEXT.xs, fontWeight: WEIGHT.medium,
      color: s.color, backgroundColor: s.bg,
      padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm,
      whiteSpace: 'nowrap',
    }}>
      {s.label}
    </span>
  );
}

// ── SecondaryPanel ────────────────────────────────────────────────────────────

interface SecondaryPanelProps {
  crNumber:              string;
  assignmentId:          string;
  data:                  SecondaryData | null;
  loading:               boolean;
  assigning:             boolean;
  hasExistingSecondary:  boolean;
  existingSecondaryName: string | null;
  onAssign:              (candidate: SecondaryCandidate) => void;
  onRemove:              () => void;
  onClose:               () => void;
}

function SecondaryPanel({ crNumber, data, loading, assigning, hasExistingSecondary, existingSecondaryName, onAssign, onRemove, onClose }: SecondaryPanelProps) {
  const showRemove = hasExistingSecondary || !!data?.currentSecondaryId;
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: 'rgba(0,0,0,0.45)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          backgroundColor: C.bgCard,
          borderRadius: RADIUS.lg,
          padding: SP[6],
          width: 580, maxWidth: '95vw',
          maxHeight: '80vh', overflowY: 'auto',
          boxShadow: SHADOW.lg,
          direction: 'rtl',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[4] }}>
          <div>
            <h3 style={{ margin: 0, ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>
              שיבוץ בודק שני
            </h3>
            <p style={{ margin: `${SP[1]} 0 0`, ...TEXT.sm, color: C.textMuted }}>
              CR: {crNumber}
              {data?.crLabel && ` — ${data.crLabel}`}
            </p>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', ...TEXT.lg, color: C.textMuted, padding: SP[1] }}>✕</button>
        </div>

        {loading && (
          <div style={{ textAlign: 'center', padding: SP[8], color: C.textMuted }}>טוען הצעות...</div>
        )}

        {!loading && data && (
          <>
            {/* Stats */}
            <div style={{ display: 'flex', gap: SP[4], marginBottom: SP[4], padding: SP[3], backgroundColor: C.bgNested, borderRadius: RADIUS.md }}>
              <span style={{ ...TEXT.sm, color: C.textSecondary }}>
                <strong>מאמץ בדיקה:</strong> {data.qaEffortDays} ימים
              </span>
              {data.currentSecondaryId && (
                <span style={{ ...TEXT.sm, color: C.info }}>
                  ✓ בודק שני משובץ כרגע
                </span>
              )}
            </div>

            {/* Remove button if secondary exists */}
            {showRemove && (
              <div style={{ marginBottom: SP[4], display: 'flex', alignItems: 'center', gap: SP[3], padding: SP[3], backgroundColor: C.infoBg, borderRadius: RADIUS.md, border: `1px solid ${C.info}` }}>
                <span style={{ ...TEXT.sm, color: C.textPrimary, flex: 1 }}>
                  <strong>בודק שני נוכחי:</strong> {existingSecondaryName ?? data?.candidates.find(c => c.userId === data?.currentSecondaryId)?.fullName ?? '—'}
                </span>
                <button
                  onClick={onRemove}
                  disabled={assigning}
                  style={{ ...btnStyle(C.danger, assigning), padding: `${SP[1]} ${SP[3]}` }}
                >
                  {assigning ? 'מסיר...' : '✕ הסר'}
                </button>
              </div>
            )}

            {/* Candidates */}
            {data.candidates.length === 0 ? (
              <p style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[4] }}>
                אין בודקים זמינים לתפקיד בודק שני
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                <p style={{ ...TEXT.xs, color: C.textMuted, margin: `0 0 ${SP[2]}` }}>
                  בודקים מוצעים לפי ציון (מיון יורד):
                </p>
                {data.candidates.map((c, idx) => {
                  const isCurrent = c.userId === data.currentSecondaryId;
                  return (
                    <div
                      key={c.userId}
                      style={{
                        display: 'flex', alignItems: 'center', gap: SP[3],
                        padding: SP[3],
                        borderRadius: RADIUS.md,
                        border: `1px solid ${isCurrent ? C.info : C.border}`,
                        backgroundColor: isCurrent ? C.infoBg : (idx === 0 ? C.successBg : C.bgCard),
                      }}
                    >
                      {/* Rank */}
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%',
                        backgroundColor: idx === 0 ? C.success : C.bgNested,
                        color: idx === 0 ? '#fff' : C.textMuted,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        ...TEXT.sm, fontWeight: WEIGHT.bold, flexShrink: 0,
                      }}>
                        {idx + 1}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], flexWrap: 'wrap' }}>
                          <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>
                            {c.fullName}
                          </span>
                          {isCurrent && (
                            <span style={{ ...TEXT.xs, color: C.info, backgroundColor: C.infoBg, padding: `1px ${SP[1]}`, borderRadius: RADIUS.sm }}>
                              ✓ נוכחי
                            </span>
                          )}
                          <span style={{ ...TEXT.xs, color: C.textMuted }}>
                            ציון: <strong style={{ color: C.textPrimary }}>{c.totalScore}</strong>
                          </span>
                          <span style={{ ...TEXT.xs, color: C.textMuted }}>
                            רמה: {c.breakdown.skill.level ?? '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: SP[3], marginTop: SP[1], flexWrap: 'wrap' }}>
                          <span style={{ ...TEXT.xs, color: C.textSecondary }}>
                            ⏱ בודק ראשי: <strong>{c.estimatedPrimaryEffort} יום</strong> (חוסך <strong style={{ color: C.success }}>{c.timeSavingDays} יום</strong>)
                          </span>
                          <span style={{ ...TEXT.xs, color: C.textSecondary }}>
                            בודק שני: <strong>{c.estimatedSecondaryEffort} יום</strong>
                          </span>
                          <span style={{ ...TEXT.xs, color: C.textMuted }}>
                            עומס: {c.breakdown.load.rawScore}%
                          </span>
                        </div>
                      </div>

                      {/* Assign button */}
                      <button
                        onClick={() => onAssign(c)}
                        disabled={assigning || isCurrent}
                        style={{
                          ...btnStyle(isCurrent ? C.textMuted : C.brand, assigning || isCurrent),
                          flexShrink: 0, minWidth: 64, padding: `${SP[1]} ${SP[3]}`,
                        }}
                      >
                        {assigning ? '...' : isCurrent ? 'פעיל' : 'שבץ'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Style helpers ─────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  backgroundColor: C.bgCard,
  border: `1px solid ${C.border}`,
  borderRadius: RADIUS.lg,
  padding: SP[4],
  marginBottom: SP[3],
};

const selectStyle: React.CSSProperties = {
  padding: `${SP[2]} ${SP[3]}`,
  borderRadius: RADIUS.md,
  border: `1px solid ${C.border}`,
  fontFamily: FONT,
  ...TEXT.sm,
  color: C.textPrimary,
  backgroundColor: C.bgCard,
  minWidth: 220,
};

const inputStyle: React.CSSProperties = {
  display: 'block', marginTop: SP[1],
  padding: `${SP[2]} ${SP[3]}`,
  borderRadius: RADIUS.md,
  border: `1px solid ${C.border}`,
  fontFamily: FONT,
  ...TEXT.sm,
  color: C.textPrimary,
};

const labelStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  ...TEXT.xs, fontWeight: WEIGHT.medium, color: C.textSecondary,
};

function btnStyle(color: string, disabled = false): React.CSSProperties {
  return {
    padding: `${SP[2]} ${SP[4]}`,
    borderRadius: RADIUS.md,
    border: 'none',
    backgroundColor: disabled ? C.bgNested : color,
    color: disabled ? C.textDisabled : '#fff',
    fontFamily: FONT,
    ...TEXT.sm, fontWeight: WEIGHT.semibold,
    cursor: disabled ? 'not-allowed' : 'pointer',
    whiteSpace: 'nowrap',
  };
}

const thStyle: React.CSSProperties = {
  padding: `${SP[2]} ${SP[3]}`,
  textAlign: 'right',
  fontWeight: WEIGHT.semibold,
  color: C.textSecondary,
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: `${SP[2]} ${SP[3]}`,
  color: C.textPrimary,
  borderBottom: `1px solid ${C.border}`,
};

const arrowBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 1px',
  lineHeight: 1,
  fontSize: 9,
  color: C.textMuted,
};

const smallBtnStyle: React.CSSProperties = {
  padding: `2px ${SP[2]}`,
  borderRadius: RADIUS.sm,
  cursor: 'pointer',
  fontFamily: FONT,
  fontSize: 11,
  whiteSpace: 'nowrap',
};
