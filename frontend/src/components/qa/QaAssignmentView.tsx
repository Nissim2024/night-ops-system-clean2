import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import axios from 'axios';
const QaWorkPlanView    = lazy(() => import('./QaWorkPlanView'));
const QaActivityPlanView = lazy(() => import('./QaActivityPlanView'));
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
import { ConfirmDialog, DialogConfig } from '../ConfirmDialog';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const BLUE    = '#4573D2';
const BLUE_BG = 'rgba(69,115,210,0.10)';

// ── Cycle display config ───────────────────────────────────────────────────────

const ALL_CYCLES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE', 'UAT'] as const;

const CYCLE_INFO: Record<string, { label: string; fullLabel: string; color: string; bg: string }> = {
  CYCLE_1:     { label: 'ס1',  fullLabel: 'סבב 1',        color: '#1565c0', bg: 'rgba(21,101,192,0.13)' },
  CYCLE_2:     { label: 'ס2',  fullLabel: 'סבב 2',        color: '#6a1b9a', bg: 'rgba(106,27,154,0.13)' },
  CYCLE_3:     { label: 'ס3',  fullLabel: 'סבב 3',        color: '#e65100', bg: 'rgba(230,81,0,0.13)'   },
  STAND_ALONE: { label: 'SA',  fullLabel: 'Stand Alone',  color: '#b76b00', bg: 'rgba(183,107,0,0.13)'  },
  UAT:         { label: 'UAT', fullLabel: 'UAT',          color: '#00695c', bg: 'rgba(0,105,92,0.13)'   },
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface Version {
  id: string;
  name: string;
  status: string;
  isArchived: boolean;
  plannedStart: string | null;
  plannedEnd:   string | null;
}

interface CrRec {
  crNumber:     string;
  crLabel:      string | null;
  application:  string | null;
  project:      string | null;
  isStandAlone: boolean;
  qaEffortDays: number | null;
  systems:      string[];
  riskLevel:    string | null;
  testers:      { userId: string; fullName: string; email: string; score: number; matchedSkills: { skillName: string; level: number }[] }[];
}

interface Assignment {
  id:          string;
  crNumber:    string;
  crLabel:     string | null;
  userId:      string;
  autoScore:   number | null;
  qaEffort:    number | null;
  isStandAlone: boolean | null;
  cycles:      string[];
  sortOrder:   number | null;
  user:        { id: string; fullName: string; email: string };
}

interface ScoreBreakdown {
  load:       { weightedScore: number; rawScore: number; currentHours: number };
  skill:      { weightedScore: number; rawScore: number; level: number | null; requiredLevel: number };
  continuity: { weightedScore: number; rawScore: number; hasHistory: boolean };
}

interface ScoredTester {
  userId:    string;
  fullName:  string;
  email:     string;
  totalScore: number;
  breakdown: ScoreBreakdown;
}

interface ScoringResult {
  status:            'OK' | 'MANUAL_INTERVENTION';
  crNumber:          string;
  crLabel:           string | null;
  application:       string | null;
  requiredSkillName: string | null;
  requiredMinLevel:  number;
  qaEffortDays:      number;
  recommendations:   ScoredTester[];
  filteredByLeave:   string[];
  filteredBySkill:   string[];
  blockReasons:      string[];
}

// ── Work-day helpers (Israeli: Sun–Thu work, Fri+Sat off) ────────────────────

function isWorkDay(d: Date): boolean { const dow = d.getDay(); return dow !== 5 && dow !== 6; }

function countWorkDays(start: string, end: string): number {
  if (!start || !end) return 0;
  const s = new Date(start); s.setHours(0, 0, 0, 0);
  const e = new Date(end);   e.setHours(0, 0, 0, 0);
  let count = 0;
  const d = new Date(s);
  while (d <= e) { if (isWorkDay(d)) count++; d.setDate(d.getDate() + 1); }
  return count;
}

function toInputDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d).toISOString().split('T')[0];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

const riskStyle = (r: string | null) => {
  if (r === 'HIGH')   return { color: C.danger,  bg: C.dangerBg  };
  if (r === 'MEDIUM') return { color: C.warning, bg: C.warningBg };
  if (r === 'LOW')    return { color: C.success, bg: C.successBg };
  return { color: C.textMuted, bg: C.bgNested };
};

const riskLabel = (r: string | null) =>
  r === 'HIGH' ? 'סיכון גבוה' : r === 'MEDIUM' ? 'סיכון בינוני' : r === 'LOW' ? 'סיכון נמוך' : null;

const scoreStyle = (s: number) => {
  if (s >= 80) return { color: C.success, bg: C.successBg };
  if (s >= 55) return { color: C.warning, bg: C.warningBg };
  return { color: C.danger, bg: C.dangerBg };
};

const STATUS_ORDER = ['IN_PROGRESS','ACTIVE','REHEARSAL','APPROVED','REVIEW','REFINING',
                      'COLLECTING','CR_REVIEW','DRAFT','MORNING_AFTER','COMPLETED'];

// ── Score bar ──────────────────────────────────────────────────────────────────

function ScoreBar({ value, color, width = 80 }: { value: number; color: string; width?: number }) {
  return (
    <div style={{ width, height: 5, background: C.bgHover, borderRadius: RADIUS.full, overflow: 'hidden', flexShrink: 0 }}>
      <div style={{ height: '100%', width: `${value}%`, background: color, borderRadius: RADIUS.full, transition: 'width 0.4s ease' }} />
    </div>
  );
}

// ── Load bar ───────────────────────────────────────────────────────────────────

function LoadBar({ used, capacity }: { used: number; capacity: number }) {
  const pct   = capacity > 0 ? Math.min((used / capacity) * 100, 100) : 0;
  const over  = capacity > 0 && used > capacity;
  const color = over ? C.danger : pct > 85 ? C.warning : C.success;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], minWidth: 140 }}>
      <div style={{ flex: 1, height: 6, background: C.bgHover, borderRadius: RADIUS.full, overflow: 'hidden', minWidth: 70 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: RADIUS.full, transition: 'width 0.3s ease' }} />
      </div>
      <span style={{ ...TEXT.xs, color, fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>
        {used.toFixed(1)} / {capacity} י'
      </span>
      {over && <span style={{ ...TEXT.xs, color: C.danger, fontWeight: WEIGHT.bold }}>⚠</span>}
    </div>
  );
}

// ── Cycle chip ─────────────────────────────────────────────────────────────────

function CycleChip({ cycleType }: { cycleType: string }) {
  const info = CYCLE_INFO[cycleType] ?? { label: cycleType, fullLabel: cycleType, color: C.textMuted, bg: C.bgNested };
  return (
    <span
      title={info.fullLabel}
      style={{ background: info.bg, color: info.color, padding: '2px 5px', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, whiteSpace: 'nowrap', border: `1px solid ${info.color}33` }}
    >
      {info.label}
    </span>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

interface Props { token: string }

const LS_VERSION_KEY = 'qa-selected-version';

interface PickerPos { crNumber: string; top?: number; bottom?: number; right: number; maxH?: number; }

export default function QaAssignmentView({ token }: Props) {
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [versions, setVersions]         = useState<Version[]>([]);
  const [selectedVId, setSelectedVId]   = useState(() => localStorage.getItem(LS_VERSION_KEY) ?? '');
  const [activeTab, setActiveTab]       = useState<'assignments' | 'workplan' | 'activity'>('assignments');
  const [crs, setCrs]                   = useState<CrRec[]>([]);
  const [assignments, setAssignments]   = useState<Assignment[]>([]);
  const [loading, setLoading]           = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [syncing, setSyncing]           = useState(false);

  const [cycle1Start, setCycle1Start]   = useState('');
  const [testingEnd, setTestingEnd]     = useState('');

  const [openPicker, setOpenPicker]           = useState<PickerPos | null>(null);
  const [openCyclesPicker, setOpenCyclesPicker] = useState<string | null>(null);
  const [scoring, setScoring]                 = useState<Record<string, ScoringResult>>({});
  const [scoringLoading, setScoringLoading]   = useState<string | null>(null);
  const [saving, setSaving]                   = useState<string | null>(null);
  const [editingEffort, setEditingEffort]     = useState<string | null>(null);  // crNumber being edited
  const [search, setSearch]                   = useState('');
  const [confirmDialog, setConfirmDialog]     = useState<DialogConfig | null>(null);
  const [sortCol, setSortCol]                 = useState<'cr' | 'label' | 'effort' | 'tester' | 'score' | 'order'>('cr');
  const [sortDir, setSortDir]                 = useState<'asc' | 'desc'>('asc');
  const [hiddenCrs, setHiddenCrs]             = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden]           = useState(false);
  const pickerRef      = useRef<HTMLDivElement>(null);
  const cyclesPickerRef = useRef<HTMLDivElement>(null);

  // ── Fetch versions ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/versions`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        setVersions(
          (r.data as Version[])
            .filter(v => !v.isArchived)
            .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)),
        );
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Load version data ───────────────────────────────────────────────────────

  const loadVersion = useCallback(async (vId: string) => {
    if (!vId) { setCrs([]); setAssignments([]); setScoring({}); return; }
    setLoading(true);
    try {
      const [recRes, asgRes, planRes] = await Promise.all([
        axios.get(`${API}/qa/assignments/recommend?versionId=${vId}`, { headers }),
        axios.get(`${API}/qa/assignments?versionId=${vId}`, { headers }),
        axios.get(`${API}/qa/workplan?versionId=${vId}`, { headers }).catch(() => null),
      ]);
      setCrs(recRes.data);
      setAssignments(asgRes.data);
      setScoring({});

      // Restore dates only if there is an existing (even DRAFT) work plan
      const plan = planRes?.data;
      if (plan?.cycle1Start) {
        setCycle1Start(toInputDate(plan.cycle1Start));
        setTestingEnd(toInputDate(plan.testingEnd));
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { loadVersion(selectedVId); }, [selectedVId, loadVersion]);

  // ── Hidden CRs — localStorage per version ─────────────────────────────────
  useEffect(() => {
    if (!selectedVId) { setHiddenCrs(new Set()); return; }
    const stored = localStorage.getItem(`qa-hidden-crs-${selectedVId}`);
    setHiddenCrs(stored ? new Set(JSON.parse(stored)) : new Set());
    setShowHidden(false);
  }, [selectedVId]);

  const hideCr = (crNumber: string) => {
    setHiddenCrs(prev => {
      const next = new Set(prev).add(crNumber);
      localStorage.setItem(`qa-hidden-crs-${selectedVId}`, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const restoreCr = (crNumber: string) => {
    setHiddenCrs(prev => {
      const next = new Set(prev);
      next.delete(crNumber);
      localStorage.setItem(`qa-hidden-crs-${selectedVId}`, JSON.stringify(Array.from(next)));
      return next;
    });
  };

  // ── Close pickers on outside click / scroll ────────────────────────────────

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current) {
        const inDom  = pickerRef.current.contains(e.target as Node);
        const r      = pickerRef.current.getBoundingClientRect();
        const inRect = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
        if (!inDom && !inRect) setOpenPicker(null);
      }
      if (cyclesPickerRef.current && !cyclesPickerRef.current.contains(e.target as Node)) setOpenCyclesPicker(null);
    };
    const closePicker = (e: Event) => {
      if (pickerRef.current && pickerRef.current.contains(e.target as Node)) return;
      setOpenPicker(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenPicker(null);
    };
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', closePicker, true);
    window.addEventListener('resize', closePicker);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', closePicker, true);
      window.removeEventListener('resize', closePicker);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  // ── Score picker open ───────────────────────────────────────────────────────

  const openPickerFor = async (crNumber: string, buttonEl: HTMLElement) => {
    if (openPicker?.crNumber === crNumber) { setOpenPicker(null); return; }
    const rect = buttonEl.getBoundingClientRect();
    setOpenCyclesPicker(null);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openBelow  = spaceBelow >= spaceAbove;
    const pos: PickerPos = openBelow
      ? { crNumber, top:    rect.bottom + 4,                   right: window.innerWidth - rect.right, maxH: Math.max(spaceBelow, 180) }
      : { crNumber, bottom: window.innerHeight - rect.top + 4, right: window.innerWidth - rect.right, maxH: Math.max(spaceAbove, 180) };
    setOpenPicker(pos);
    if (!scoring[crNumber]) {
      setScoringLoading(crNumber);
      try {
        const res = await axios.get(
          `${API}/qa/assignments/score?versionId=${selectedVId}&crNumber=${crNumber}`,
          { headers },
        );
        setScoring(prev => ({ ...prev, [crNumber]: res.data }));
      } finally {
        setScoringLoading(null);
      }
    }
  };

  // ── Assign (manual) ────────────────────────────────────────────────────────

  const assign = async (cr: CrRec, userId: string, autoScore?: number) => {
    setSaving(cr.crNumber);
    try {
      const res = await axios.post(
        `${API}/qa/assignments`,
        { versionId: selectedVId, crNumber: cr.crNumber, crLabel: cr.crLabel, userId, autoScore },
        { headers },
      );
      setAssignments(prev => [...prev.filter(a => a.crNumber !== cr.crNumber), res.data]);
      setOpenPicker(p => p?.crNumber === cr.crNumber ? null : p);
      setScoring(prev => { const n = { ...prev }; delete n[cr.crNumber]; return n; });
    } finally {
      setSaving(null);
    }
  };

  // ── Auto-assign ─────────────────────────────────────────────────────────────

  const autoAssign = async (crNumber: string) => {
    setSaving(crNumber);
    try {
      const res = await axios.post(
        `${API}/qa/assignments/auto-assign`,
        { versionId: selectedVId, crNumber },
        { headers },
      );
      if (res.data.status === 'OK') {
        const asgRes = await axios.get(`${API}/qa/assignments?versionId=${selectedVId}`, { headers });
        setAssignments(asgRes.data);
        setScoring(prev => { const n = { ...prev }; delete n[crNumber]; return n; });
      }
      return res.data;
    } finally {
      setSaving(null);
    }
  };

  // ── Unassign ────────────────────────────────────────────────────────────────

  const unassign = async (id: string, crNumber: string) => {
    setSaving(crNumber);
    try {
      await axios.delete(`${API}/qa/assignments/${id}`, { headers });
      setAssignments(prev => prev.filter(a => a.id !== id));
      setScoring(prev => { const n = { ...prev }; delete n[crNumber]; return n; });
    } finally {
      setSaving(null);
    }
  };

  // ── Save QA effort override ────────────────────────────────────────────────

  const saveEffort = useCallback(async (crNumber: string, value: string, asgId?: string) => {
    const parsed = parseFloat(value);
    setEditingEffort(null);
    if (isNaN(parsed) || parsed < 0.5) return;
    try {
      if (asgId) {
        const res = await axios.patch(`${API}/qa/assignments/${asgId}`, { qaEffort: parsed }, { headers });
        setAssignments(prev => [...prev.filter(a => a.crNumber !== crNumber), res.data]);
      } else {
        await axios.patch(`${API}/version-cr-assignments/cr/${selectedVId}/${crNumber}`, { qaEffortOverride: parsed }, { headers });
        setCrs(prev => prev.map(c => c.crNumber === crNumber ? { ...c, qaEffortDays: parsed } : c));
      }
    } catch (e) { console.error('effort save failed', e); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, selectedVId]);

  // ── Patch assignment (isStandAlone / cycles / sortOrder) ───────────────────

  const patchAssignment = useCallback(async (
    id: string,
    crNumber: string,
    patch: { isStandAlone?: boolean | null; cycles?: string[]; sortOrder?: number },
  ) => {
    try {
      const res = await axios.patch(`${API}/qa/assignments/${id}`, patch, { headers });
      setAssignments(prev => [...prev.filter(a => a.crNumber !== crNumber), res.data]);
    } catch (e) {
      console.error('patch failed', e);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers]);

  // ── Toggle isStandAlone — with or without assignment ──────────────────────

  const toggleStandAlone = useCallback(async (
    cr: CrRec,
    asg: Assignment | undefined,
    currentSA: boolean,
  ) => {
    const newSA = !currentSA;
    if (asg) {
      const newCycles = newSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'];
      patchAssignment(asg.id, cr.crNumber, { isStandAlone: newSA, cycles: newCycles });
    } else {
      try {
        await axios.patch(`${API}/version-cr-assignments/cr/${selectedVId}/${cr.crNumber}`, { isStandAlone: newSA }, { headers });
        setCrs(prev => prev.map(c => c.crNumber === cr.crNumber ? { ...c, isStandAlone: newSA } : c));
      } catch (e) { console.error('isStandAlone patch failed', e); }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patchAssignment, headers, selectedVId]);

  // ── Sync CR_LIST from Excel ────────────────────────────────────────────────

  const syncCrList = async () => {
    if (!selectedVId) return;
    setSyncing(true);
    try {
      const r = await axios.post(
        `${API}/version-cr-assignments/version/${selectedVId}/sync`,
        {},
        { headers },
      );
      await loadVersion(selectedVId);
      alert(`✅ סנכרון הושלם — ${r.data?.synced ?? 0} שורות עודכנו`);
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'שגיאה בסנכרון');
    } finally {
      setSyncing(false);
    }
  };

  // ── Generate work plan ─────────────────────────────────────────────────────

  const doGenerateWorkPlan = async () => {
    setGenerating(true);
    try {
      const r = await axios.post(
        `${API}/qa/workplan/generate`,
        { versionId: selectedVId, cycle1Start, testingEnd },
        { headers },
      );
      const unassignedCrs: string[] = r.data.unassignedCrs ?? [];
      alert(
        `✅ תוכנית עבודה נוצרה!
` +
        (unassignedCrs.length > 0 ? `
⚠ ${unassignedCrs.length} CRים ללא שיבוץ לא נכללו:
${unassignedCrs.slice(0,5).join(', ')}${unassignedCrs.length > 5 ? '...' : ''}` : ''),
      );
    } catch (e: any) {
      alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית העבודה');
    } finally {
      setGenerating(false);
    }
  };

  const generateWorkPlan = () => {
    if (!cycle1Start || !testingEnd) { alert('יש להזין תאריך התחלה ותאריך סיום בדיקות'); return; }

    const assignedCrNums = new Set(assignments.map(a => a.crNumber));
    const unassignedCount = crs.filter(cr => !assignedCrNums.has(cr.crNumber)).length;

    if (unassignedCount > 0) {
      setConfirmDialog({
        title: 'CRים ללא שיבוץ',
        message: `נמצאו ${unassignedCount} CRים שאינם משובצים לבודק.
CRים אלה לא ייכללו בתוכנית העבודה.

האם להמשיך ביצירת התוכנית?`,
        variant: 'warning',
        confirmLabel: 'צור תוכנית',
        cancelLabel: 'חזור לשיבוץ',
        onConfirm: () => doGenerateWorkPlan(),
        onCancel: () => {},
      });
      return;
    }

    doGenerateWorkPlan();
  };

  // ── Derived data ───────────────────────────────────────────────────────────

  const assignmentMap = useMemo(
    () => new Map(assignments.map(a => [a.crNumber, a])),
    [assignments],
  );

  const effortMap = useMemo(() => {
    const m = new Map<string, number>();
    crs.forEach(cr => { if (cr.qaEffortDays != null) m.set(cr.crNumber, cr.qaEffortDays); });
    return m;
  }, [crs]);

  // tester load: userId → { fullName, totalDays }
  const testerLoad = useMemo(() => {
    const map = new Map<string, { fullName: string; totalDays: number }>();
    assignments.forEach(a => {
      const days = a.qaEffort != null ? a.qaEffort : (effortMap.get(a.crNumber) ?? 0);
      const cur  = map.get(a.userId) ?? { fullName: a.user.fullName, totalDays: 0 };
      map.set(a.userId, { fullName: cur.fullName, totalDays: cur.totalDays + days });
    });
    return map;
  }, [assignments, effortMap]);

  // Per-tester queue order: crNumber → order number (1, 2, 3…)
  const testerOrderMap = useMemo(() => {
    const grouped = new Map<string, Assignment[]>();
    assignments.forEach(a => {
      const list = grouped.get(a.userId) ?? [];
      list.push(a);
      grouped.set(a.userId, list);
    });
    const orderMap = new Map<string, number>();
    grouped.forEach(list => {
      const sorted = [...list].sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));
      sorted.forEach((a, i) => orderMap.set(a.crNumber, i + 1));
    });
    return orderMap;
  }, [assignments]);

  const cycleDays     = countWorkDays(cycle1Start, testingEnd);
  const overloadCount = Array.from(testerLoad.values()).filter(l => cycleDays > 0 && l.totalDays > cycleDays).length;

  const visibleCrs = crs.filter(cr => !hiddenCrs.has(cr.crNumber));
  const assigned   = visibleCrs.filter(cr => assignmentMap.has(cr.crNumber)).length;
  const unassigned = visibleCrs.length - assigned;
  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = crs
    .filter(cr =>
      !hiddenCrs.has(cr.crNumber) &&
      (!search ||
        cr.crNumber.includes(search) ||
        (cr.crLabel || '').toLowerCase().includes(search.toLowerCase())),
    )
    .sort((a, b) => {
      const asg_a = assignmentMap.get(a.crNumber);
      const asg_b = assignmentMap.get(b.crNumber);
      let cmp = 0;
      if (sortCol === 'cr') {
        const na = parseInt(a.crNumber, 10), nb = parseInt(b.crNumber, 10);
        cmp = isNaN(na) || isNaN(nb) ? a.crNumber.localeCompare(b.crNumber) : na - nb;
      } else if (sortCol === 'label') {
        cmp = (a.crLabel ?? '').localeCompare(b.crLabel ?? '');
      } else if (sortCol === 'effort') {
        const ea = asg_a?.qaEffort ?? a.qaEffortDays ?? 0;
        const eb = asg_b?.qaEffort ?? b.qaEffortDays ?? 0;
        cmp = ea - eb;
      } else if (sortCol === 'tester') {
        cmp = (asg_a?.user.fullName ?? '').localeCompare(asg_b?.user.fullName ?? '');
      } else if (sortCol === 'score') {
        cmp = (asg_a?.autoScore ?? -1) - (asg_b?.autoScore ?? -1);
      } else if (sortCol === 'order') {
        cmp = (testerOrderMap.get(a.crNumber) ?? 999) - (testerOrderMap.get(b.crNumber) ?? 999);
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: SP[6], maxWidth: 1500, margin: '0 auto', direction: 'rtl', fontFamily: FONT }}>

      {/* Header */}
      <div style={{ marginBottom: SP[4] }}>
        <div style={{ ...TEXT.xl, fontWeight: WEIGHT.bold, display: 'flex', alignItems: 'center', gap: SP[2] }}>
          🎯 שיבוץ בודקים ותוכנית עבודה
        </div>
        <div style={{ ...TEXT.sm, color: C.textMuted, marginTop: '2px' }}>
          שבץ בודקים, הגדר סבבים וסדר בדיקות, ובנה תוכנית עבודה. כולל UAT וסבב Stand Alone.
        </div>
      </div>

      {/* Tab toggle */}
      <div style={{ display: 'flex', gap: 0, marginBottom: SP[4], borderBottom: `2px solid ${C.border}` }}>
        {(['assignments', 'workplan', 'activity'] as const).map(tab => {
          const label = tab === 'assignments' ? '📋 שיבוץ בודקים' : tab === 'workplan' ? '🗓 תוכנית עבודה' : '📅 לוח פעילויות';
          const active = activeTab === tab;
          return (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              padding: `${SP[2]} ${SP[4]}`, border: 'none', background: 'transparent',
              borderBottom: active ? `2px solid ${BLUE}` : '2px solid transparent',
              marginBottom: '-2px',
              color: active ? BLUE : C.textMuted, fontWeight: active ? WEIGHT.bold : WEIGHT.normal,
              ...TEXT.sm, cursor: 'pointer', fontFamily: FONT, transition: EASE.fast,
            }}>
              {label}
            </button>
          );
        })}
      </div>

      {/* Work plan tab */}
      {activeTab === 'workplan' && (
        <Suspense fallback={<div style={{ padding: SP[6], textAlign: 'center', color: C.textMuted }}>טוען...</div>}>
          <QaWorkPlanView token={token} initialVersionId={selectedVId} />
        </Suspense>
      )}

      {/* Activity board tab */}
      {activeTab === 'activity' && (
        <Suspense fallback={<div style={{ padding: SP[6], textAlign: 'center', color: C.textMuted }}>טוען...</div>}>
          <QaActivityPlanView token={token} versionId={selectedVId} />
        </Suspense>
      )}

      {activeTab === 'assignments' && <>

      {/* Version + dates + generate */}
      <div style={{
        background: C.bgCard, border: `1px solid ${C.border}`,
        borderRadius: RADIUS.lg, padding: SP[4], marginBottom: SP[4], boxShadow: SHADOW.sm,
        display: 'flex', flexWrap: 'wrap', gap: SP[4], alignItems: 'flex-end',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto', minWidth: 200 }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>גרסה</span>
          <select
            value={selectedVId}
            onChange={e => {
              const v = e.target.value;
              setSelectedVId(v);
              localStorage.setItem(LS_VERSION_KEY, v);
              setSearch('');
              // Reset dates — loadVersion restores them if a work plan exists
              setCycle1Start('');
              setTestingEnd('');
            }}
            style={{ padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', cursor: 'pointer', fontFamily: FONT }}
          >
            <option value="">— בחר גרסה —</option>
            {versions.map(v => (
              <option key={v.id} value={v.id}>
                {v.name}{v.status === 'IN_PROGRESS' || v.status === 'ACTIVE' ? ' 🟢' : v.status === 'DRAFT' ? ' 📝' : ' ✓'}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>התחלת בדיקות</span>
          <input type="date" value={cycle1Start} onChange={e => setCycle1Start(e.target.value)}
            style={{ padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>סיום בדיקות</span>
          <input type="date" value={testingEnd} onChange={e => setTestingEnd(e.target.value)}
            style={{ padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        {cycleDays > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>קיבולת לבודק</span>
            <div style={{ padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.semibold }}>
              {cycleDays} ימי עבודה
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {selectedVId && (
          <div style={{ display: 'flex', gap: SP[2], alignSelf: 'flex-end' }}>
            <button
              disabled={syncing}
              onClick={syncCrList}
              title="סנכרן רשימת CRים מקובץ EXCEL_FILE_PATH"
              style={{
                padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, color: C.textSecondary,
                border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold,
                cursor: syncing ? 'not-allowed' : 'pointer',
                opacity: syncing ? 0.5 : 1,
                fontFamily: FONT, transition: EASE.fast, whiteSpace: 'nowrap',
              }}
            >
              {syncing ? '⏳' : '🔄'} סנכרן משימות גרסה
            </button>
            <button
              disabled={generating || !cycle1Start || !testingEnd}
              onClick={generateWorkPlan}
              style={{
                padding: `${SP[2]} ${SP[4]}`, background: BLUE, color: '#fff',
                border: 'none', borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold,
                cursor: (generating || !cycle1Start || !testingEnd) ? 'not-allowed' : 'pointer',
                opacity: (generating || !cycle1Start || !testingEnd) ? 0.5 : 1,
                fontFamily: FONT, transition: EASE.fast, whiteSpace: 'nowrap',
              }}
            >
              {generating ? '⏳ מחשב...' : '📋 צור תוכנית עבודה'}
            </button>
          </div>
        )}
      </div>

      {loading && <EmptyState icon="⏳" title="טוען CRים..." sub="" />}
      {!loading && !selectedVId && <EmptyState icon="🗂️" title="בחר גרסה להתחיל" sub="המנוע יסרוק את כל ה-CRים ויחשב ציוני התאמה לכל בודק" />}
      {!loading && selectedVId && crs.length === 0 && <EmptyState icon="📭" title="אין CRים בגרסה זו" sub="לא נמצאו CRים מיובאים. סנכרן CRים מה-Excel דרך דשבורד > גרסאות." />}

      {!loading && crs.length > 0 && (
        <div>
          {/* Stat bar + search */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[3], gap: SP[3] }}>
            <div style={{ display: 'flex', gap: SP[2] }}>
              <StatPill value={visibleCrs.length} label="CRים"    color={BLUE}      bg={BLUE_BG}     />
              <StatPill value={assigned}     label="משובצים"    color={C.success} bg={C.successBg}  />
              {unassigned > 0 && <StatPill value={unassigned} label="ממתינים" color={C.warning} bg={C.warningBg} />}
              {hiddenCrs.size > 0 && (
                <button
                  onClick={() => setShowHidden(v => !v)}
                  style={{ padding: `2px ${SP[3]}`, background: showHidden ? '#f3e8ff' : C.bgNested, color: showHidden ? '#7c3aed' : C.textMuted, border: `1px solid ${showHidden ? '#c4b5fd' : C.border}`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
                >
                  🙈 מוסתרות ({hiddenCrs.size})
                </button>
              )}
            </div>
            <input
              type="text" placeholder="חיפוש CR / תיאור..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: `6px ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontFamily: FONT, background: C.bgNested, color: C.textPrimary, outline: 'none', width: 200 }}
            />
          </div>

          {/* Table */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'visible', boxShadow: SHADOW.sm }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
                <thead>
                  <tr style={{ background: C.bgNested }}>
                    {([
                      { key: null,     label: 'פרוייקט' },
                      { key: 'cr',     label: 'CR'    },
                      { key: 'label',  label: 'תיאור' },
                      { key: 'effort', label: 'ימי עבודה' },
                      { key: null,     label: 'סוג'   },
                      { key: null,     label: 'סבבים' },
                      { key: 'order',  label: 'סדר'   },
                      { key: 'tester', label: 'בודק'  },
                      { key: 'score',  label: 'ציון'  },
                      { key: null,     label: ''      },
                    ] as { key: typeof sortCol | null; label: string }[]).map(({ key, label }) => (
                      <th
                        key={label || '__actions'}
                        onClick={key ? () => handleSort(key) : undefined}
                        style={{
                          padding: `${SP[2]} ${SP[3]}`, textAlign: 'right', ...TEXT.xs,
                          fontWeight: WEIGHT.bold, color: key && sortCol === key ? BLUE : C.textMuted,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                          borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                          cursor: key ? 'pointer' : 'default',
                          userSelect: 'none',
                        }}
                      >
                        {label}
                        {key && sortCol === key && (
                          <span style={{ marginRight: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                        )}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((cr, i) => {
                    const asg        = assignmentMap.get(cr.crNumber);
                    const isSaving   = saving === cr.crNumber;
                    const isOpenCyc  = openCyclesPicker === cr.crNumber;
                    const result     = scoring[cr.crNumber];
                    const top1       = cr.testers.find(t => t.score > 0);
                    const risk       = riskStyle(cr.riskLevel);
                    // Team lead can override effort via assignment.qaEffort
                    const effortDays = (asg?.qaEffort ?? cr.qaEffortDays);
                    const isEditingEff = editingEffort === cr.crNumber;
                    const testerOverload = asg && cycleDays > 0
                      ? (testerLoad.get(asg.userId)?.totalDays ?? 0) > cycleDays : false;
                    const orderNum = asg ? (testerOrderMap.get(cr.crNumber) ?? null) : null;

                    // Effective isStandAlone: assignment override or VCA default
                    const effectiveSA = asg
                      ? (asg.isStandAlone !== null ? asg.isStandAlone : cr.isStandAlone)
                      : cr.isStandAlone;

                    // Effective cycles for display
                    const effectiveCycles = asg && asg.cycles?.length > 0
                      ? asg.cycles
                      : (effectiveSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);

                    return (
                      <tr key={cr.crNumber} style={{ background: i % 2 === 0 ? 'transparent' : C.bgNested, borderBottom: `1px solid ${C.border}` }}>

                        {/* Project */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap', maxWidth: 120 }}>
                          {cr.project
                            ? <span style={{ ...TEXT.xs, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }} title={cr.project}>{cr.project}</span>
                            : <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
                        </td>

                        {/* CR number */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap' }}>
                          <span style={{ background: BLUE_BG, color: BLUE, padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold }}>
                            {cr.crNumber}
                          </span>
                        </td>

                        {/* Label */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, maxWidth: 220 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ ...TEXT.sm, color: C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cr.crLabel ?? ''}>
                              {cr.crLabel ? cr.crLabel.replace(/^\d+\s*-\s*/, '') : <span style={{ color: C.textDisabled }}>—</span>}
                            </div>
                            {cr.riskLevel && (
                              <span style={{ background: risk.bg, color: risk.color, padding: '1px 5px', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.semibold, alignSelf: 'flex-start' }}>
                                {riskLabel(cr.riskLevel)}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* QA Effort — always editable */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {isEditingEff ? (
                            <input
                              autoFocus
                              type="number" min="0.5" step="0.5"
                              defaultValue={effortDays ?? 1}
                              style={{ width: 54, padding: '2px 4px', border: `1px solid ${BLUE}`, borderRadius: RADIUS.sm, ...TEXT.xs, textAlign: 'center', fontFamily: FONT, outline: 'none' }}
                              onBlur={e => saveEffort(cr.crNumber, e.target.value, asg?.id)}
                              onKeyDown={e => {
                                if (e.key === 'Enter') saveEffort(cr.crNumber, (e.target as HTMLInputElement).value, asg?.id);
                                if (e.key === 'Escape') setEditingEffort(null);
                              }}
                            />
                          ) : (
                            <span
                              title="לחץ לעריכה"
                              onClick={() => setEditingEffort(cr.crNumber)}
                              style={{ background: BLUE_BG, color: BLUE, padding: `2px 8px`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.bold, cursor: 'pointer', userSelect: 'none' }}
                            >
                              {effortDays != null ? `${effortDays}י'` : '—'}
                            </span>
                          )}
                        </td>

                        {/* סוג: integrative / SA toggle — always interactive */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap' }}>
                          <button
                            title={effectiveSA ? 'לחץ להפוך לאינטגרטיבי' : 'לחץ להפוך ל-Stand Alone'}
                            onClick={() => toggleStandAlone(cr, asg, effectiveSA)}
                            style={{
                              padding: '2px 8px',
                              background: effectiveSA ? 'rgba(183,107,0,0.13)' : BLUE_BG,
                              color:      effectiveSA ? '#b76b00'              : BLUE,
                              border:     `1px solid ${effectiveSA ? '#b76b0044' : BLUE + '44'}`,
                              borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold,
                              cursor: 'pointer', fontFamily: FONT, transition: EASE.fast,
                            }}
                          >
                            {effectiveSA ? 'SA' : 'אינטג\''}
                          </button>
                        </td>

                        {/* סבבים: cycles multiselect */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, position: 'relative', whiteSpace: 'nowrap' }}>
                          {asg ? (
                            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', cursor: 'pointer' }}
                              onClick={() => {
                                setOpenPicker(p => p?.crNumber === cr.crNumber ? null : p);
                                setOpenCyclesPicker(isOpenCyc ? null : cr.crNumber);
                              }}
                            >
                              {effectiveCycles.map(ct => <CycleChip key={ct} cycleType={ct} />)}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', opacity: 0.45 }}>
                              {(cr.isStandAlone ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']).map(ct => <CycleChip key={ct} cycleType={ct} />)}
                            </div>
                          )}

                          {/* Cycles picker popup */}
                          {isOpenCyc && asg && (
                            <div
                              ref={cyclesPickerRef}
                              style={{ position: 'absolute', top: '100%', right: 0, background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.lg, width: 210, zIndex: 400, padding: SP[2] }}
                            >
                              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, padding: `${SP[1]} ${SP[2]}`, marginBottom: SP[1], textTransform: 'uppercase', letterSpacing: '0.04em' }}>סבבי בדיקות</div>
                              {ALL_CYCLES.map(ct => {
                                const info     = CYCLE_INFO[ct];
                                const selected = effectiveCycles.includes(ct);
                                return (
                                  <label key={ct} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: `${SP[1]} ${SP[2]}`, cursor: 'pointer', borderRadius: RADIUS.sm, background: selected ? info.bg : 'transparent' }}>
                                    <input
                                      type="checkbox"
                                      checked={selected}
                                      style={{ accentColor: info.color, cursor: 'pointer' }}
                                      onChange={() => {
                                        const newCycles = selected
                                          ? effectiveCycles.filter(c => c !== ct)
                                          : [...effectiveCycles, ct];
                                        patchAssignment(asg.id, cr.crNumber, { cycles: newCycles });
                                      }}
                                    />
                                    <span style={{ background: info.bg, color: info.color, padding: '1px 5px', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, minWidth: 28, textAlign: 'center', border: `1px solid ${info.color}33` }}>
                                      {info.label}
                                    </span>
                                    <span style={{ ...TEXT.xs, color: C.textSecondary }}>{info.fullLabel}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </td>

                        {/* סדר: queue position per tester */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {orderNum != null ? (
                            <span style={{ background: C.bgNested, border: `1px solid ${C.border}`, color: C.textSecondary, padding: '2px 7px', borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.bold }}>
                              {orderNum}
                            </span>
                          ) : (
                            <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>
                          )}
                        </td>

                        {/* Assigned tester */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, minWidth: 160 }}>
                          {asg ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: testerOverload ? C.dangerBg : BLUE_BG, color: testerOverload ? C.danger : BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: WEIGHT.bold, fontSize: '10px', flexShrink: 0, border: testerOverload ? `1px solid ${C.danger}44` : 'none' }}>
                                {asg.user.fullName.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: testerOverload ? C.danger : C.textPrimary }}>{asg.user.fullName}</span>
                              {testerOverload && <span title="בודק זה חורג ממשך הסבב" style={{ cursor: 'help' }}>⚠️</span>}
                              <button
                                disabled={isSaving}
                                onClick={() => unassign(asg.id, cr.crNumber)}
                                title="הסר שיבוץ"
                                style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.border}`, background: 'transparent', color: C.textDisabled, fontSize: '9px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, transition: EASE.fast }}
                                onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.background = C.dangerBg; (e.currentTarget as HTMLButtonElement).style.color = C.danger; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; (e.currentTarget as HTMLButtonElement).style.color = C.textDisabled; }}
                              >✕</button>
                            </div>
                          ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: SP[1] }}>
                              <span style={{ ...TEXT.xs, color: C.textDisabled }}>לא שובץ</span>
                              {top1 && (
                                <span style={{ background: C.successBg, color: C.success, padding: `1px 6px`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.medium, whiteSpace: 'nowrap' }}>
                                  ⭐ {top1.fullName}
                                </span>
                              )}
                            </div>
                          )}
                        </td>

                        {/* Score */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap' }}>
                          {asg?.autoScore != null ? (
                            <ScoreBadge score={asg.autoScore} />
                          ) : (
                            <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>
                          )}
                        </td>

                        {/* Actions + score picker */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', gap: SP[1], alignItems: 'center' }}>
                            <button
                              disabled={isSaving}
                              onClick={async () => { const r = await autoAssign(cr.crNumber); if (r?.status === 'MANUAL_INTERVENTION') { alert('⚠️ שיבוץ ידני נדרש:\n\n' + r.blockReasons.join('\n')); } }}
                              title="שיבוץ אוטומטי"
                              style={{ padding: `5px 8px`, background: C.successBg, color: C.success, border: `1px solid ${C.success}44`, borderRadius: RADIUS.md, ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: isSaving ? 'not-allowed' : 'pointer', fontFamily: FONT, transition: EASE.fast, opacity: isSaving ? 0.5 : 1 }}
                              onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.background = C.success + '22'}
                              onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.background = C.successBg}
                            >⚡ אוטו</button>
                            <button
                              disabled={isSaving}
                              onClick={e => { setOpenCyclesPicker(null); openPickerFor(cr.crNumber, e.currentTarget); }}
                              style={{ padding: `5px ${SP[3]}`, background: asg ? C.bgNested : BLUE, color: asg ? C.textSecondary : '#fff', border: `1px solid ${asg ? C.border : BLUE}`, borderRadius: RADIUS.md, ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: isSaving ? 'not-allowed' : 'pointer', fontFamily: FONT, transition: EASE.fast, opacity: isSaving ? 0.5 : 1 }}
                            >{isSaving ? '...' : asg ? 'החלף' : 'שבץ'}</button>
                            <button
                              title="הסתר CR מהרשימה (ניתן לשחזור)"
                              onClick={() => hideCr(cr.crNumber)}
                              style={{ padding: '5px 7px', background: 'transparent', color: C.textDisabled, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.xs, cursor: 'pointer', fontFamily: FONT, lineHeight: 1 }}
                              onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#dc2626'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#dc2626'; }}
                              onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = C.textDisabled; (e.currentTarget as HTMLButtonElement).style.borderColor = C.border; }}
                            >🙈</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Hidden CRs section */}
          {showHidden && hiddenCrs.size > 0 && (
            <div style={{ marginTop: SP[3], background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: RADIUS.lg, padding: SP[3] }}>
              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: '#7c3aed', marginBottom: SP[2] }}>
                🙈 CRים מוסתרים — {hiddenCrs.size} משימות
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[2] }}>
                {crs.filter(cr => hiddenCrs.has(cr.crNumber)).map(cr => (
                  <div key={cr.crNumber} style={{ display: 'flex', alignItems: 'center', gap: SP[1], background: '#fff', border: '1px solid #e9d5ff', borderRadius: RADIUS.md, padding: `4px ${SP[2]}` }}>
                    <span style={{ background: BLUE_BG, color: BLUE, padding: `1px ${SP[1]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold }}>{cr.crNumber}</span>
                    {cr.crLabel && <span style={{ ...TEXT.xs, color: C.textSecondary, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cr.crLabel.replace(/^\d+\s*-\s*/, '')}</span>}
                    <button
                      onClick={() => restoreCr(cr.crNumber)}
                      title="שחזר לרשימה"
                      style={{ padding: '2px 6px', background: 'transparent', color: '#7c3aed', border: '1px solid #c4b5fd', borderRadius: RADIUS.sm, ...TEXT.xs, cursor: 'pointer', fontFamily: FONT, fontWeight: WEIGHT.semibold }}
                    >↩ שחזר</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score picker — fixed-position so it's never clipped by overflow containers */}
          {openPicker && (() => {
            const cr     = crs.find(c => c.crNumber === openPicker.crNumber);
            const asg    = cr ? assignmentMap.get(cr.crNumber) : undefined;
            const result = cr ? scoring[cr.crNumber] : undefined;
            return cr ? (
              <div
                ref={pickerRef}
                style={{
                  position: 'fixed',
                  ...(openPicker.top    !== undefined ? { top:    openPicker.top    } : {}),
                  ...(openPicker.bottom !== undefined ? { bottom: openPicker.bottom } : {}),
                  right: openPicker.right,
                  background: C.bgCard, border: `1px solid ${C.border}`,
                  borderRadius: RADIUS.lg, boxShadow: SHADOW.lg,
                  width: 380, maxHeight: openPicker.maxH ?? 520, overflowY: 'auto',
                  zIndex: 1000, padding: SP[2], direction: 'rtl',
                }}
              >
                {scoringLoading === cr.crNumber ? (
                  <div style={{ padding: SP[4], textAlign: 'center', ...TEXT.sm, color: C.textMuted }}>⏳ מחשב ציונים...</div>
                ) : result ? (
                  <ScoringPickerContent result={result} allTesters={cr.testers} currentUserId={asg?.userId} onAssign={(userId, score) => assign(cr, userId, score)} />
                ) : (
                  <div style={{ padding: SP[4], textAlign: 'center', ...TEXT.sm, color: C.textMuted }}>שגיאה בטעינת הניקוד</div>
                )}
              </div>
            ) : null;
          })()}

          {/* Progress bar */}
          <div style={{ marginTop: SP[3], padding: SP[3], background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, display: 'flex', alignItems: 'center', gap: SP[3] }}>
            <div style={{ flex: 1, height: 6, background: C.bgHover, borderRadius: RADIUS.full, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: visibleCrs.length === assigned ? C.success : BLUE, width: `${visibleCrs.length > 0 ? Math.round((assigned / visibleCrs.length) * 100) : 0}%`, transition: 'width 0.4s ease', borderRadius: RADIUS.full }} />
            </div>
            <div style={{ ...TEXT.sm, color: C.textMuted, whiteSpace: 'nowrap' }}>
              {assigned} / {visibleCrs.length} משובצים{visibleCrs.length > 0 && ` (${Math.round((assigned / visibleCrs.length) * 100)}%)`}
            </div>
            {visibleCrs.length > 0 && assigned === visibleCrs.length && (
              <span style={{ background: C.successBg, color: C.success, padding: `2px ${SP[2]}`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>✓ כל ה-CRים משובצים!</span>
            )}
          </div>

          {/* Tester load panel */}
          {testerLoad.size > 0 && (
            <div style={{ marginTop: SP[3], background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.sm, overflow: 'hidden' }}>
              <div style={{ padding: `${SP[2]} ${SP[4]}`, background: C.bgNested, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: SP[3] }}>
                <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📊 עומס בודקים</span>
                {cycleDays > 0 && <span style={{ ...TEXT.xs, color: C.textMuted }}>קיבולת: {cycleDays} ימי עבודה לבודק</span>}
                {overloadCount > 0 && (
                  <span style={{ ...TEXT.xs, background: C.dangerBg, color: C.danger, padding: `2px ${SP[2]}`, borderRadius: RADIUS.full, fontWeight: WEIGHT.semibold, border: `1px solid ${C.danger}33` }}>
                    ⚠ {overloadCount} חורג{overloadCount > 1 ? 'ים' : ''}
                  </span>
                )}
              </div>
              <div style={{ padding: SP[3], display: 'flex', flexWrap: 'wrap', gap: SP[2] }}>
                {Array.from(testerLoad.entries())
                  .sort((a, b) => b[1].totalDays - a[1].totalDays)
                  .map(([userId, { fullName, totalDays }]) => {
                    const over = cycleDays > 0 && totalDays > cycleDays;
                    return (
                      <div key={userId} style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, background: over ? C.dangerBg : C.bgNested, border: `1px solid ${over ? C.danger + '44' : C.border}`, minWidth: 200, flex: '1 1 200px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: over ? C.danger : C.textPrimary }}>
                            {over && '⚠ '}{fullName}
                          </span>
                          {over && (
                            <span style={{ ...TEXT.xs, background: C.dangerBg, color: C.danger, padding: `1px 6px`, borderRadius: RADIUS.full, fontWeight: WEIGHT.bold, border: `1px solid ${C.danger}33` }}>
                              +{(totalDays - cycleDays).toFixed(1)}י'
                            </span>
                          )}
                        </div>
                        <LoadBar used={totalDays} capacity={cycleDays || totalDays} />
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      </>}

      <ConfirmDialog config={confirmDialog} onClose={() => setConfirmDialog(null)} />
    </div>
  );
}

// ── Scoring picker ─────────────────────────────────────────────────────────────

function ScoringPickerContent({
  result, allTesters, currentUserId, onAssign,
}: {
  result:        ScoringResult;
  allTesters:    CrRec['testers'];
  currentUserId?: string;
  onAssign:      (userId: string, score: number) => void;
}) {
  const [showManual, setShowManual] = useState(false);
  const [navIdx, setNavIdx]         = useState(-1);
  const manualListRef = useRef<HTMLDivElement>(null);
  const isManual = result.status === 'MANUAL_INTERVENTION';
  const sortedAll = [...allTesters].sort((a, b) => a.fullName.localeCompare(b.fullName, 'he'));
  const recommendedIds = new Set(result.recommendations.map(r => r.userId));

  // Combined flat list for keyboard nav: recommendations then manual (deduped)
  const navItems = React.useMemo(() => {
    const recs = result.recommendations.map(t => ({ userId: t.userId, fullName: t.fullName, score: t.totalScore }));
    const manualOnly = sortedAll.filter(t => !recommendedIds.has(t.userId)).map(t => ({ userId: t.userId, fullName: t.fullName, score: 0 }));
    return [...recs, ...manualOnly];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.recommendations, sortedAll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Enter') return;
      e.preventDefault();
      if (e.key === 'ArrowDown') {
        setNavIdx(i => {
          const next = Math.min(i + 1, navItems.length - 1);
          if (next >= result.recommendations.length) setShowManual(true);
          return next;
        });
      } else if (e.key === 'ArrowUp') {
        setNavIdx(i => Math.max(i - 1, 0));
      } else if (e.key === 'Enter' && navIdx >= 0 && navIdx < navItems.length) {
        onAssign(navItems[navIdx].userId, navItems[navIdx].score);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [navIdx, navItems, onAssign, result.recommendations.length]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (navIdx < result.recommendations.length) return;
    const manualIdx = navIdx - result.recommendations.length;
    const el = manualListRef.current?.children[manualIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [navIdx, result.recommendations.length]);

  return (
    <div>
      <div style={{ padding: `${SP[2]} ${SP[3]}`, borderBottom: `1px solid ${C.border}`, marginBottom: SP[2] }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>שיבוץ מונחה AI</span>
          {isManual ? (
            <span style={{ background: C.dangerBg, color: C.danger, padding: `2px 8px`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.bold }}>⚠ שיבוץ ידני נדרש</span>
          ) : (
            <span style={{ background: C.successBg, color: C.success, padding: `2px 8px`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>✓ {result.recommendations.length} מומלצים</span>
          )}
        </div>
        {result.requiredSkillName && (
          <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: '3px' }}>
            סקיל נדרש: <strong>{result.requiredSkillName}</strong> רמה {result.requiredMinLevel}+
            {result.qaEffortDays > 0 && ` · מאמץ: ${result.qaEffortDays} ימים`}
          </div>
        )}
      </div>
      {isManual && result.blockReasons.map((r, i) => (
        <div key={i} style={{ margin: `${SP[1]} ${SP[2]}`, padding: SP[2], background: C.dangerBg, border: `1px solid ${C.danger}33`, borderRadius: RADIUS.md, ...TEXT.xs, color: C.danger, lineHeight: '1.5' }}>{r}</div>
      ))}
      {result.recommendations.map((t, idx) => (
        <ScoredTesterRow key={t.userId} tester={t} rank={idx + 1} isCurrentlyAssigned={currentUserId === t.userId} onAssign={() => onAssign(t.userId, t.totalScore)} />
      ))}
      {(result.filteredByLeave.length > 0 || result.filteredBySkill.length > 0) && (
        <FilteredSection filteredByLeave={result.filteredByLeave} filteredBySkill={result.filteredBySkill} requiredSkillName={result.requiredSkillName} requiredMinLevel={result.requiredMinLevel} />
      )}

      {/* Manual override section */}
      <div style={{ borderTop: `1px solid ${C.border}`, marginTop: SP[2], paddingTop: SP[1] }}>
        <button
          onClick={() => setShowManual(s => !s)}
          style={{ width: '100%', padding: `${SP[1]} ${SP[2]}`, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'right', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: SP[1], ...TEXT.xs, color: C.textMuted }}
        >
          <span style={{ transform: showManual ? 'rotate(90deg)' : 'none', transition: EASE.fast, display: 'inline-block' }}>▶</span>
          <span>בחירה ידנית — כל הבודקים ({sortedAll.length})</span>
        </button>
        {showManual && (
          <div ref={manualListRef} style={{ maxHeight: 200, overflowY: 'auto', padding: `0 ${SP[1]} ${SP[1]}` }}>
            {sortedAll.map((t, mi) => {
              const isCurrent     = t.userId === currentUserId;
              const isRecommended = recommendedIds.has(t.userId);
              const globalIdx     = result.recommendations.length + mi;
              const isNavSelected = navIdx === globalIdx;
              return (
                <div
                  key={t.userId}
                  onClick={() => onAssign(t.userId, 0)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: SP[2],
                    padding: `${SP[1]} ${SP[2]}`, borderRadius: RADIUS.sm,
                    background: isCurrent ? BLUE_BG : isNavSelected ? C.bgHover : 'transparent',
                    border: isCurrent ? `1px solid ${BLUE}33` : isNavSelected ? `1px solid ${C.border}` : '1px solid transparent',
                    cursor: 'pointer', transition: EASE.fast,
                  }}
                  onMouseEnter={e => { if (!isCurrent && !isNavSelected) (e.currentTarget as HTMLDivElement).style.background = C.bgHover; }}
                  onMouseLeave={e => { if (!isCurrent && !isNavSelected) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                >
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: isCurrent ? BLUE_BG : C.bgNested, color: isCurrent ? BLUE : C.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: WEIGHT.bold, fontSize: '10px', flexShrink: 0, border: `1px solid ${isCurrent ? BLUE + '44' : C.border}` }}>
                    {t.fullName.charAt(0).toUpperCase()}
                  </div>
                  <span style={{ ...TEXT.xs, color: isCurrent ? BLUE : C.textPrimary, fontWeight: isCurrent ? WEIGHT.semibold : WEIGHT.normal, flex: 1 }}>
                    {t.fullName}
                  </span>
                  {isCurrent && <span style={{ ...TEXT.xs, color: BLUE, fontWeight: WEIGHT.bold }}>✓ משובץ</span>}
                  {isRecommended && !isCurrent && <span style={{ ...TEXT.xs, color: C.textMuted }}>⭐ מומלץ</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ScoredTesterRow({ tester, rank, isCurrentlyAssigned, onAssign }: {
  tester: ScoredTester; rank: number; isCurrentlyAssigned: boolean; onAssign: () => void;
}) {
  const { breakdown: bd } = tester;
  const st = scoreStyle(tester.totalScore);
  return (
    <div
      onClick={onAssign}
      style={{ padding: SP[3], marginBottom: '2px', borderRadius: RADIUS.md, cursor: 'pointer', background: isCurrentlyAssigned ? BLUE_BG : 'transparent', border: isCurrentlyAssigned ? `1px solid ${BLUE}33` : '1px solid transparent', transition: EASE.fast }}
      onMouseEnter={e => { if (!isCurrentlyAssigned) (e.currentTarget as HTMLDivElement).style.background = C.bgHover; }}
      onMouseLeave={e => { if (!isCurrentlyAssigned) (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: SP[2], marginBottom: SP[2] }}>
        <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : '#CD7F32', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: WEIGHT.bold, fontSize: '10px' }}>
          #{rank}
        </div>
        <div style={{ flex: 1 }}>
          <span style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{tester.fullName}</span>
          {isCurrentlyAssigned && <span style={{ ...TEXT.xs, color: BLUE, marginRight: SP[1] }}>✓ משובץ</span>}
        </div>
        <div style={{ background: st.bg, color: st.color, padding: `2px 8px`, borderRadius: RADIUS.full, ...TEXT.sm, fontWeight: WEIGHT.bold, flexShrink: 0 }}>
          {tester.totalScore}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
        <BreakdownBar label="עומס (50%)" weighted={bd.load.weightedScore} raw={bd.load.rawScore} color={BLUE} detail={bd.load.currentHours > 0 ? `${bd.load.currentHours} ימים משובצים` : 'פנוי לחלוטין'} />
        <BreakdownBar label="מיומנות (35%)" weighted={bd.skill.weightedScore} raw={bd.skill.rawScore} color={C.success} detail={bd.skill.level !== null ? `רמה ${bd.skill.level} / נדרש ${bd.skill.requiredLevel}${bd.skill.rawScore === 70 ? ' (overkill)' : ''}` : 'אין מיומנות ספציפית'} />
        <BreakdownBar label="המשכיות (15%)" weighted={bd.continuity.weightedScore} raw={bd.continuity.rawScore} color='#9C6ADE' detail={bd.continuity.hasHistory ? '✓ בדק מערכת זו ב-3 חודשים האחרונים' : 'ללא היסטוריה אחרונה'} />
      </div>
    </div>
  );
}

function BreakdownBar({ label, weighted, raw, color, detail }: { label: string; weighted: number; raw: number; color: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SP[2] }}>
      <span style={{ ...TEXT.xs, color: C.textMuted, minWidth: 95, flexShrink: 0 }}>{label}</span>
      <ScoreBar value={raw} color={color} width={70} />
      <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color, minWidth: 20, textAlign: 'center' }}>{weighted}</span>
      <span style={{ ...TEXT.xs, color: C.textDisabled, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{detail}</span>
    </div>
  );
}

function FilteredSection({ filteredByLeave, filteredBySkill, requiredSkillName, requiredMinLevel }: {
  filteredByLeave: string[]; filteredBySkill: string[]; requiredSkillName: string | null; requiredMinLevel: number;
}) {
  const [open, setOpen] = useState(false);
  const total = filteredByLeave.length + filteredBySkill.length;
  return (
    <div style={{ borderTop: `1px solid ${C.border}`, marginTop: SP[2], paddingTop: SP[2] }}>
      <button onClick={() => setOpen(!open)} style={{ width: '100%', padding: `${SP[1]} ${SP[2]}`, background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'right', fontFamily: FONT, display: 'flex', alignItems: 'center', gap: SP[1], ...TEXT.xs, color: C.textMuted }}>
        <span style={{ transform: open ? 'rotate(90deg)' : 'none', transition: EASE.fast, display: 'inline-block' }}>▶</span>
        <span>{total} בודק{total > 1 ? 'ים' : ''} סוננ{total > 1 ? 'ו' : ''} (לא עומד{total > 1 ? 'ים' : ''} בתנאי הסף)</span>
      </button>
      {open && (
        <div style={{ padding: `0 ${SP[2]} ${SP[2]}` }}>
          {filteredByLeave.length > 0 && <FilterGroup icon="🏖" title="חופשה מאושרת בתאריכי הגרסה" names={filteredByLeave} color={C.warning} />}
          {filteredBySkill.length > 0 && <FilterGroup icon="🔴" title={`חסר סקיל ${requiredSkillName} ברמה ${requiredMinLevel}+`} names={filteredBySkill} color={C.danger} />}
        </div>
      )}
    </div>
  );
}

function FilterGroup({ icon, title, names, color }: { icon: string; title: string; names: string[]; color: string }) {
  return (
    <div style={{ marginBottom: SP[2], padding: SP[2], background: color + '11', borderRadius: RADIUS.md }}>
      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color, marginBottom: '3px' }}>{icon} {title}</div>
      <div style={{ ...TEXT.xs, color: C.textMuted }}>{names.join(', ')}</div>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const st = scoreStyle(score);
  return <span style={{ background: st.bg, color: st.color, padding: `2px 8px`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.bold }}>{score}</span>;
}

function EmptyState({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <div style={{ textAlign: 'center', padding: SP[10], color: C.textMuted, background: C.bgCard, borderRadius: RADIUS.lg, border: `1px dashed ${C.border}` }}>
      <div style={{ fontSize: '40px', marginBottom: SP[3] }}>{icon}</div>
      <div style={{ ...TEXT.md, fontWeight: WEIGHT.semibold, color: C.textPrimary }}>{title}</div>
      {sub && <div style={{ ...TEXT.sm, marginTop: SP[1] }}>{sub}</div>}
    </div>
  );
}

function StatPill({ value, label, color, bg }: { value: number; label: string; color: string; bg: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: SP[1], padding: `3px ${SP[3]}`, background: bg, borderRadius: RADIUS.full, ...TEXT.sm }}>
      <span style={{ fontWeight: WEIGHT.bold, color }}>{value}</span>
      <span style={{ color, opacity: 0.8 }}>{label}</span>
    </div>
  );
}
