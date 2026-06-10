import React, { useState, useEffect, useCallback, useMemo } from 'react';
import axios from 'axios';
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW } from '../../theme';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

// ── Types ─────────────────────────────────────────────────────────────────────

interface Version {
  id: string;
  name: string;
  status: string;
  isArchived: boolean;
  plannedStart: string | null;
  plannedEnd: string | null;
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

interface Cycle {
  id: string;
  cycleType: string;
  plannedStart: string;
  plannedEnd: string;
  notes: string | null;
  tasks: CycleTask[];
}

interface WorkPlan {
  id: string;
  versionId: string;
  status: 'DRAFT' | 'APPROVED';
  cycle1Start: string;
  testingEnd: string;
  notes: string | null;
  createdAt: string;
  approvedBy: string | null;
  cycles: Cycle[];
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

const EDITABLE_CYCLES = new Set(['CYCLE_2', 'CYCLE_3', 'UAT', 'REHEARSAL', 'GO_LIVE']);

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Component ─────────────────────────────────────────────────────────────────

interface Props { token: string; initialVersionId?: string }

export default function QaWorkPlanView({ token, initialVersionId }: Props) {
  const ax = useMemo(
    () => axios.create({ headers: { Authorization: `Bearer ${token}` } }),
    [token],
  );

  const [versions, setVersions]           = useState<Version[]>([]);
  const [versionId, setVersionId]         = useState(initialVersionId ?? '');
  const [assignedUserIds, setAssignedUserIds] = useState<Set<string>>(new Set());
  const [workPlan, setWorkPlan]           = useState<WorkPlan | null>(null);
  const [unassigned, setUnassigned]       = useState<string[]>([]);
  const [loading, setLoading]             = useState(false);
  const [generating, setGenerating]       = useState(false);
  const [showGenForm, setShowGenForm]     = useState(false);
  const [cycle1Start, setCycle1Start]     = useState('');
  const [testingEnd, setTestingEnd]       = useState('');
  const [expandedCycles, setExpandedCycles] = useState<Set<string>>(new Set());
  const [editNotes, setEditNotes]         = useState<Record<string, string>>({});
  const [savingNotes, setSavingNotes]     = useState<Record<string, boolean>>({});
  const [togglingTasks, setTogglingTasks] = useState<Set<string>>(new Set());
  const [filterUserId, setFilterUserId]   = useState('');
  const [editingEffort, setEditingEffort] = useState<string | null>(null); // taskId being edited
  const [reverting, setReverting]         = useState(false);

  // Sync versionId when parent changes initialVersionId
  useEffect(() => {
    if (initialVersionId) setVersionId(initialVersionId);
  }, [initialVersionId]);

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
    ]).then(([wpRes, asgRes]) => {
      setWorkPlan(wpRes.data ?? null);
      setAssignedUserIds(new Set((asgRes.data as { userId: string }[]).map(a => a.userId)));
      if (wpRes.data?.cycles) {
        const allIds = new Set<string>(wpRes.data.cycles.map((c: Cycle) => c.id as string));
        setExpandedCycles(allIds);
      }
    }).catch(() => setWorkPlan(null))
      .finally(() => setLoading(false));
  }, [versionId]);

  // Pre-fill dates from version
  useEffect(() => {
    const v = versions.find(x => x.id === versionId);
    if (v) {
      if (v.plannedStart) setCycle1Start(toInputDate(v.plannedStart));
      if (v.plannedEnd)   setTestingEnd(toInputDate(v.plannedEnd));
    }
  }, [versionId, versions]);

  const generate = async () => {
    if (!cycle1Start || !testingEnd) return;
    setGenerating(true);
    try {
      const [genRes, asgRes] = await Promise.all([
        ax.post(`${API}/qa/workplan/generate`, { versionId, cycle1Start, testingEnd }),
        ax.get(`${API}/qa/assignments?versionId=${versionId}`).catch(() => ({ data: [] })),
      ]);
      setWorkPlan(genRes.data.workPlan);
      setUnassigned(genRes.data.unassignedCrs ?? []);
      setAssignedUserIds(new Set((asgRes.data as { userId: string }[]).map(a => a.userId)));
      setShowGenForm(false);
      if (genRes.data.workPlan?.cycles) {
        const allIds = new Set<string>(genRes.data.workPlan.cycles.map((c: Cycle) => c.id as string));
        setExpandedCycles(allIds);
      }
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית העבודה');
    } finally {
      setGenerating(false);
    }
  };

  const approve = async () => {
    if (!confirm('לאשר את תוכנית העבודה?')) return;
    try {
      await ax.post(`${API}/qa/workplan/approve`, { versionId });
      setWorkPlan(prev => prev ? { ...prev, status: 'APPROVED' } : null);
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'שגיאה');
    }
  };

  const toggleTask = async (task: CycleTask) => {
    setTogglingTasks(prev => new Set(Array.from(prev).concat(task.id)));
    try {
      await ax.patch(`${API}/qa/workplan/task/${task.id}/toggle`, { isActive: !task.isActive });
      setWorkPlan(prev => {
        if (!prev) return null;
        return {
          ...prev,
          cycles: prev.cycles.map(c => ({
            ...c,
            tasks: c.tasks.map(t => t.id === task.id ? { ...t, isActive: !t.isActive } : t),
          })),
        };
      });
    } catch {
      alert('שגיאה בעדכון המשימה');
    } finally {
      setTogglingTasks(prev => new Set(Array.from(prev).filter(id => id !== task.id)));
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
      alert('שגיאה בשמירת הערות');
    } finally {
      setSavingNotes(prev => ({ ...prev, [cycleId]: false }));
    }
  };

  const saveTaskEffort = async (taskId: string, effortStr: string) => {
    const effort = parseFloat(effortStr);
    setEditingEffort(null);
    if (isNaN(effort) || effort < 0.5) return;
    try {
      await ax.patch(`${API}/qa/workplan/task/${taskId}/effort`, { effortDays: effort });
      setWorkPlan(prev => {
        if (!prev) return null;
        return {
          ...prev,
          cycles: prev.cycles.map(c => ({
            ...c,
            tasks: c.tasks.map(t => t.id === taskId ? { ...t, effortDays: effort } : t),
          })),
        };
      });
    } catch { alert('שגיאה בעדכון מאמץ המשימה'); }
  };

  const revertToOriginal = async () => {
    if (!workPlan || !versionId) return;
    if (!window.confirm('לחזור לתוכנית המקורית? כל השינויים הידניים יאבדו.')) return;
    setReverting(true);
    try {
      const r = await ax.post(`${API}/qa/workplan/generate`, {
        versionId,
        cycle1Start: toInputDate(workPlan.cycle1Start),
        testingEnd:  toInputDate(workPlan.testingEnd),
      });
      setWorkPlan(r.data.workPlan);
      if (r.data.workPlan?.cycles) {
        setExpandedCycles(new Set<string>(r.data.workPlan.cycles.map((c: Cycle) => c.id as string)));
      }
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית');
    } finally { setReverting(false); }
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
      .catch(() => alert('שגיאה בייצוא'));
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

  return (
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
              <button onClick={() => setShowGenForm(f => !f)} style={btnStyle(C.warning)}>↺ יצור מחדש</button>
              <button onClick={revertToOriginal} disabled={reverting} style={btnStyle('#6B7280', reverting)}>{reverting ? 'מחשב...' : '⟲ חזור למקור'}</button>
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
          <button onClick={() => setShowGenForm(f => !f)} style={btnStyle(C.warning)}>↺ יצור מחדש</button>
          <button onClick={revertToOriginal} disabled={reverting} style={btnStyle('#6B7280', reverting)}>{reverting ? 'מחשב...' : '⟲ חזור לתוכנית המקורית'}</button>
          {/* Filter by employee */}
          {allPlanTesters.length > 0 && (
            <select value={filterUserId} onChange={e => setFilterUserId(e.target.value)} style={{ ...selectStyle, minWidth: 160, marginRight: 'auto' }}>
              <option value="">כל הבודקים</option>
              {allPlanTesters.map(t => <option key={t.userId} value={t.userId}>{t.fullName}</option>)}
            </select>
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
          <button onClick={() => setShowGenForm(true)} style={btnStyle(C.brand)}>
            + צור תוכנית עבודה
          </button>
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
              <input
                type="date" value={cycle1Start}
                onChange={e => setCycle1Start(e.target.value)}
                style={inputStyle}
              />
            </label>
            <label style={labelStyle}>
              תאריך סיום בדיקות
              <input
                type="date" value={testingEnd}
                onChange={e => setTestingEnd(e.target.value)}
                style={inputStyle}
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

      {/* ── Cycle cards ── */}
      {(workPlan?.cycles ?? []).map(cycle => (
        <CycleCard
          key={cycle.id}
          cycle={cycle}
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
        />
      ))}
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
  editNotes:       Record<string, string>;
  onNotesChange:   (text: string) => void;
  onSaveNotes:     () => void;
  savingNotes:     boolean;
  planApproved:    boolean;
  filterUserId:    string;
  editingEffort:   string | null;
  onEditEffort:    (taskId: string | null) => void;
  onSaveEffort:    (taskId: string, value: string) => void;
}

function CycleCard({
  cycle, expanded, onToggleExpand, onToggleTask,
  togglingTasks, editNotes, onNotesChange, onSaveNotes, savingNotes, planApproved,
  filterUserId, editingEffort, onEditEffort, onSaveEffort,
}: CycleCardProps) {
  const accent = CYCLE_ACCENT[cycle.cycleType] ?? C.textMuted;
  const bg     = CYCLE_BG[cycle.cycleType]     ?? C.bgNested;
  const label  = CYCLE_LABEL[cycle.cycleType]  ?? cycle.cycleType;
  const counts = countTasks(cycle);
  const editable = EDITABLE_CYCLES.has(cycle.cycleType) && !planApproved;
  const isRehearsalOrGoLive = cycle.cycleType === 'REHEARSAL' || cycle.cycleType === 'GO_LIVE';

  // Group tasks by tester (applying employee filter)
  const testerGroups = new Map<string, { name: string; tasks: CycleTask[] }>();
  for (const task of cycle.tasks) {
    if (filterUserId && task.userId !== filterUserId) continue;
    if (!testerGroups.has(task.userId)) {
      testerGroups.set(task.userId, { name: task.user.fullName, tasks: [] });
    }
    testerGroups.get(task.userId)!.tasks.push(task);
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

        <span style={{ marginRight: 'auto', color: C.textMuted, fontSize: '12px' }}>
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Body */}
      {expanded && (
        <div style={{ padding: SP[4] }}>
          {isRehearsalOrGoLive ? (
            // Rehearsal / Go-Live: notes field only
            <div>
              <p style={{ ...TEXT.sm, color: C.textSecondary, marginTop: 0 }}>
                ראש הצוות מגדיר את תכולת הסבב — עד 3 שעות. רשום כאן את הCRים שייבדקו:
              </p>
              <textarea
                value={noteVal}
                onChange={e => onNotesChange(e.target.value)}
                rows={5}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: SP[3], borderRadius: RADIUS.md,
                  border: `1px solid ${C.border}`,
                  fontFamily: FONT, ...TEXT.sm, color: C.textPrimary,
                  resize: 'vertical',
                }}
                placeholder="רשום CRים, הוראות והגדרות לסבב זה..."
              />
              <div style={{ marginTop: SP[2], display: 'flex', gap: SP[2] }}>
                <button
                  onClick={onSaveNotes}
                  disabled={savingNotes}
                  style={btnStyle(C.info, savingNotes)}
                >
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
              {Array.from(testerGroups.entries()).map(([userId, group]) => (
                <TesterSection
                  key={userId}
                  testerName={group.name}
                  tasks={group.tasks}
                  editable={editable}
                  onToggleTask={onToggleTask}
                  togglingTasks={togglingTasks}
                  editingEffort={editingEffort}
                  onEditEffort={onEditEffort}
                  onSaveEffort={onSaveEffort}
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
  testerName:    string;
  tasks:         CycleTask[];
  editable:      boolean;
  onToggleTask:  (t: CycleTask) => void;
  togglingTasks: Set<string>;
  editingEffort: string | null;
  onEditEffort:  (taskId: string | null) => void;
  onSaveEffort:  (taskId: string, value: string) => void;
}

function TesterSection({ testerName, tasks, editable, onToggleTask, togglingTasks, editingEffort, onEditEffort, onSaveEffort }: TesterSectionProps) {
  const [collapsed, setCollapsed] = useState(false);
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder);
  const crTasks = sorted.filter(t => t.taskType !== 'REGRESSION');
  const totalDays = crTasks.filter(t => t.isActive).reduce((s, t) => s + t.effortDays, 0);

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
            <col style={{ width: 36 }} />
            <col style={{ width: 80 }} />
            <col />
            <col style={{ width: 100 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 95 }} />
            <col style={{ width: 68 }} />
            {editable && <col style={{ width: 60 }} />}
          </colgroup>
          <thead>
            <tr style={{ backgroundColor: C.bgNested }}>
              <th style={{ ...thStyle, textAlign: 'center' }}>#</th>
              <th style={thStyle}>מס' CR</th>
              <th style={thStyle}>תיאור</th>
              <th style={thStyle}>סוג</th>
              <th style={thStyle}>התחלה</th>
              <th style={thStyle}>סיום</th>
              <th style={{ ...thStyle, textAlign: 'center' }}>ימים</th>
              {editable && <th style={{ ...thStyle, textAlign: 'center' }}>פעיל</th>}
            </tr>
          </thead>
          <tbody>
            {sorted.map((task, idx) => {
              const isReg      = task.taskType === 'REGRESSION';
              const isInactive = !task.isActive;
              const rowBg      = isInactive ? C.bgNested : isReg ? 'rgba(156,106,222,0.05)' : C.bgCard;
              const isEditingThisEffort = editingEffort === task.id;
              const orderNum   = isReg ? null : crTasks.findIndex(t => t.id === task.id) + 1;

              return (
                <tr
                  key={task.id}
                  style={{
                    backgroundColor: rowBg,
                    opacity: isInactive ? 0.45 : 1,
                    textDecoration: isInactive ? 'line-through' : 'none',
                  }}
                >
                  <td style={{ ...tdStyle, textAlign: 'center' }}>
                    {orderNum != null ? (
                      <span style={{ ...TEXT.xs, color: C.textMuted, fontWeight: WEIGHT.medium }}>{orderNum}</span>
                    ) : null}
                  </td>
                  <td style={tdStyle}>
                    <span style={{ ...TEXT.xs, fontWeight: WEIGHT.medium, color: isReg ? C.statusWaiting : C.textLink }}>
                      {isReg ? '—' : task.crNumber}
                    </span>
                  </td>
                  <td style={{ ...tdStyle, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {task.crLabel ?? task.crNumber}
                  </td>
                  <td style={tdStyle}>
                    <TaskTypeBadge type={task.taskType} />
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
                        onClick={() => onEditEffort(task.id)}
                        style={{ cursor: 'pointer', ...TEXT.xs, color: C.textPrimary, fontWeight: WEIGHT.medium, padding: '1px 6px', borderRadius: RADIUS.sm, border: `1px solid transparent` }}
                        onMouseEnter={e => (e.currentTarget as HTMLSpanElement).style.border = `1px solid ${C.border}`}
                        onMouseLeave={e => (e.currentTarget as HTMLSpanElement).style.border = '1px solid transparent'}
                      >
                        {task.effortDays}
                      </span>
                    )}
                  </td>
                  {editable && (
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {!isReg && (
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
