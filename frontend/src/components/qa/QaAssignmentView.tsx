import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import axios from 'axios';
const QaWorkPlanView    = lazy(() => import('./QaWorkPlanView'));
const QaActivityPlanView = lazy(() => import('./QaActivityPlanView'));
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
import { ConfirmDialog, DialogConfig } from '../ConfirmDialog';
import { useDialog } from '../../context/DialogContext';
import { DateField } from '../DatePicker';

const API = process.env.REACT_APP_API_URL || `${window.location.protocol}//${window.location.hostname}:3000`;

const BLUE    = '#4573D2';
const BLUE_BG = 'rgba(69,115,210,0.10)';

// ── Cycle display config ───────────────────────────────────────────────────────

const ALL_CYCLES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE', 'UAT', 'REHEARSAL', 'GO_LIVE'] as const;

const CYCLE_INFO: Record<string, { label: string; fullLabel: string; color: string; bg: string }> = {
  CYCLE_1:     { label: 'ס1',  fullLabel: 'סבב 1',          color: '#1565c0', bg: 'rgba(21,101,192,0.13)'  },
  CYCLE_2:     { label: 'ס2',  fullLabel: 'סבב 2',          color: '#6a1b9a', bg: 'rgba(106,27,154,0.13)' },
  CYCLE_3:     { label: 'ס3',  fullLabel: 'סבב 3',          color: '#e65100', bg: 'rgba(230,81,0,0.13)'   },
  STAND_ALONE: { label: 'SA',  fullLabel: 'Stand Alone',    color: '#b76b00', bg: 'rgba(183,107,0,0.13)'  },
  UAT:         { label: 'UAT', fullLabel: 'UAT',            color: '#00695c', bg: 'rgba(0,105,92,0.13)'   },
  REHEARSAL:   { label: 'חגנ', fullLabel: 'חזרה גנרלית',   color: '#9C6ADE', bg: 'rgba(156,106,222,0.13)' },
  GO_LIVE:     { label: 'GL',  fullLabel: 'עליה לאוויר',   color: '#F06A6A', bg: 'rgba(240,106,106,0.10)' },
};

// ── Types ──────────────────────────────────────────────────────────────────────

interface Version {
  id: string;
  name: string;
  status: string;
  isArchived: boolean;
  plannedStart:     string | null;
  plannedEnd:       string | null;
  integrationStart: string | null;
  integrationEnd:   string | null;
  qaStart:          string | null;
  qaEnd:            string | null;
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

interface SyncDiffItem { crNumber: string; crLabel: string | null; teamName?: string; }
interface SyncDiff { added: SyncDiffItem[]; removed: SyncDiffItem[]; unchanged: number; }

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
  secondaryTesterId: string | null;
  secondaryUser:     { id: string; fullName: string; email: string } | null;
  secondaryParticipationPct: number | null;
  standAloneDueDate: string | null;
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

interface Props { token: string; initialVersionId?: string; }

interface PickerPos { crNumber: string; top?: number; bottom?: number; right: number; maxH?: number; }

export default function QaAssignmentView({ token, initialVersionId }: Props) {
  const dialog  = useDialog();
  const headers   = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const userRole  = useMemo(() => { try { return JSON.parse(atob(token.split('.')[1])).role as string; } catch { return ''; } }, [token]);
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);

  const [versions, setVersions]         = useState<Version[]>([]);
  // Deliberately NOT falling back to localStorage here — a version picked
  // manually below is meant to be a transient, in-session browse, not a
  // choice that outlives the session and silently diverges from whatever
  // the global header shows on the next visit.
  const [selectedVId, setSelectedVId]   = useState(() => initialVersionId ?? '');

  // When parent changes the target version (e.g. navigating from a specific deployment version), follow it
  useEffect(() => {
    if (initialVersionId) setSelectedVId(initialVersionId);
  }, [initialVersionId]);
  const [activeTab, setActiveTab]       = useState<'assignments' | 'workplan' | 'activity'>('assignments');
  const [crs, setCrs]                   = useState<CrRec[]>([]);
  const [assignments, setAssignments]   = useState<Assignment[]>([]);
  const [loading, setLoading]           = useState(false);
  const [generating, setGenerating]     = useState(false);
  const [syncing, setSyncing]           = useState(false);
  const [crSyncStatuses, setCrSyncStatuses] = useState<Record<string, 'ACTIVE' | 'NEW' | 'REMOVED'>>({});
  const [syncDiff, setSyncDiff]             = useState<SyncDiff | null>(null);
  const [excludedAddedCrs, setExcludedAddedCrs] = useState<Set<string>>(new Set());
  // syncDiff.added has one entry per (CR, team) pair — the same CR can span
  // several teams' Excel columns and legitimately produce multiple entries.
  // Group them into one row per CR so the preview doesn't show duplicates.
  const addedGrouped = useMemo(() => {
    if (!syncDiff) return [];
    const byCr = new Map<string, { crNumber: string; crLabel: string | null; teamNames: string[] }>();
    for (const item of syncDiff.added) {
      const existing = byCr.get(item.crNumber);
      if (existing) { if (item.teamName) existing.teamNames.push(item.teamName); }
      else byCr.set(item.crNumber, { crNumber: item.crNumber, crLabel: item.crLabel, teamNames: item.teamName ? [item.teamName] : [] });
    }
    return Array.from(byCr.values());
  }, [syncDiff]);
  const [secondTesterSuggestions, setSecondTesterSuggestions] = useState<{
    assignmentId: string; crNumber: string; crLabel: string | null;
    qaEffortDays: number; thresholdDays: number;
    suggestedTesterId: string; suggestedTesterName: string;
    suggestedScore: number; timeSavingDays: number;
  }[]>([]);
  const [applyingSuggestion, setApplyingSuggestion] = useState<string | null>(null);
  const [dismissedSuggestions, setDismissedSuggestions] = useState<Set<string>>(new Set());

  const selectedVersion = useMemo(
    () => versions.find(v => v.id === selectedVId) ?? null,
    [versions, selectedVId],
  );

  const [cycle1Start, setCycle1Start]   = useState('');
  const [testingEnd, setTestingEnd]     = useState('');
  const [cycle1LengthDays, setCycle1LengthDays] = useState(12);
  const [cycle2LengthDays, setCycle2LengthDays] = useState(6);
  const [cycle3LengthDays, setCycle3LengthDays] = useState(4);

  const [openPicker, setOpenPicker]           = useState<PickerPos | null>(null);
  const [pickerMode, setPickerMode]           = useState<'primary' | 'secondary'>('primary');
  const [openCyclesPicker, setOpenCyclesPicker] = useState<string | null>(null);
  const [scoring, setScoring]                 = useState<Record<string, ScoringResult>>({});
  const [scoringLoading, setScoringLoading]   = useState<string | null>(null);
  const [saving, setSaving]                   = useState<string | null>(null);
  const [bulkAssigning, setBulkAssigning]     = useState(false);
  const [overloadPanelCollapsed, setOverloadPanelCollapsed] = useState(false);
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
    if (!vId) { setCrs([]); setAssignments([]); setScoring({}); setCrSyncStatuses({}); setSecondTesterSuggestions([]); return; }
    setLoading(true);
    try {
      // Pick up CR_LIST changes automatically on load — without this, edits
      // to the Excel file never reach this screen until someone remembers
      // to open the manual "sync preview" modal.
      await axios.post(`${API}/version-cr-assignments/version/${vId}/sync`, {}, { headers }).catch(() => {});
      const [recRes, asgRes, planRes, vcaRes, suggRes] = await Promise.all([
        axios.get(`${API}/qa/assignments/recommend?versionId=${vId}`, { headers }),
        axios.get(`${API}/qa/assignments?versionId=${vId}`, { headers }),
        axios.get(`${API}/qa/workplan?versionId=${vId}`, { headers }).catch(() => null),
        axios.get(`${API}/version-cr-assignments/version/${vId}`, { headers }).catch(() => null),
        axios.get(`${API}/qa/assignments/second-tester-suggestions?versionId=${vId}`, { headers }).catch(() => null),
      ]);
      setCrs(recRes.data);
      setAssignments(asgRes.data);
      setScoring({});
      setDismissedSuggestions(new Set());
      if (suggRes) setSecondTesterSuggestions(suggRes.data);

      if (vcaRes) {
        const rows = vcaRes.data as { crNumber: string; syncStatus: string }[];
        const map: Record<string, 'ACTIVE' | 'NEW' | 'REMOVED'> = {};
        for (const row of rows) {
          const cur  = row.syncStatus as 'ACTIVE' | 'NEW' | 'REMOVED';
          const prev = map[row.crNumber];
          if (!prev || cur === 'REMOVED' || (cur === 'NEW' && prev === 'ACTIVE')) map[row.crNumber] = cur;
        }
        setCrSyncStatuses(map);
      }

      // Restore dates only if there is an existing (even DRAFT) work plan
      const plan = planRes?.data;
      if (plan?.cycle1Start) {
        setCycle1Start(toInputDate(plan.cycle1Start));
        setTestingEnd(toInputDate(plan.testingEnd));
        if (plan.cycle1LengthDays) setCycle1LengthDays(plan.cycle1LengthDays);
        if (plan.cycle2LengthDays) setCycle2LengthDays(plan.cycle2LengthDays);
        if (plan.cycle3LengthDays) setCycle3LengthDays(plan.cycle3LengthDays);
      }
    } catch {
      // 403 from QA-admin-only endpoints — silently leave state empty
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => { loadVersion(selectedVId); }, [selectedVId, loadVersion]);

  // ── Pre-fill dates from version when no plan exists ────────────────────────
  useEffect(() => {
    if (!selectedVersion) return;
    if (!cycle1Start && selectedVersion.qaStart) setCycle1Start(toInputDate(selectedVersion.qaStart));
    if (!testingEnd  && selectedVersion.qaEnd)   setTestingEnd(toInputDate(selectedVersion.qaEnd));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVersion?.id]);

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

  const openPickerFor = async (crNumber: string, buttonEl: HTMLElement, mode: 'primary' | 'secondary' = 'primary') => {
    if (openPicker?.crNumber === crNumber && pickerMode === mode) { setOpenPicker(null); return; }
    setPickerMode(mode);
    const rect = buttonEl.getBoundingClientRect();
    setOpenCyclesPicker(null);
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openBelow  = spaceBelow >= spaceAbove;
    const safeRight = Math.min(window.innerWidth - rect.right, window.innerWidth - 380 - 8);
    const pos: PickerPos = openBelow
      ? { crNumber, top:    rect.bottom + 4,                   right: safeRight, maxH: Math.max(spaceBelow, 180) }
      : { crNumber, bottom: window.innerHeight - rect.top + 4, right: safeRight, maxH: Math.max(spaceAbove, 180) };
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

  // ── Auto-assign all unassigned CRs ───────────────────────────────────────────

  const autoAssignAll = async () => {
    // Sort by CR number so the processing order is deterministic and matches
    // the default table order — the API's own return order isn't guaranteed
    // stable, and each assignment changes load for the ones that follow it.
    const targets = visibleCrs
      .filter(cr => !assignmentMap.has(cr.crNumber))
      .sort((a, b) => a.crNumber.localeCompare(b.crNumber));
    if (targets.length === 0) return;
    setBulkAssigning(true);
    try {
      const manualCrs: string[] = [];
      for (const cr of targets) {
        const res = await axios.post(
          `${API}/qa/assignments/auto-assign`,
          { versionId: selectedVId, crNumber: cr.crNumber },
          { headers },
        );
        if (res.data.status === 'MANUAL_INTERVENTION') manualCrs.push(cr.crNumber);
      }
      const asgRes = await axios.get(`${API}/qa/assignments?versionId=${selectedVId}`, { headers });
      setAssignments(asgRes.data);
      setScoring({});
      if (manualCrs.length > 0) {
        dialog.alert(
          `${manualCrs.length} CR-ים דורשים שיבוץ ידני ולא שובצו אוטומטית:\n\n${manualCrs.join(', ')}`,
          'שיבוץ ידני נדרש',
          'warning',
        );
      }
    } finally {
      setBulkAssigning(false);
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
    patch: { isStandAlone?: boolean | null; cycles?: string[]; sortOrder?: number; standAloneDueDate?: string | null; secondaryParticipationPct?: number | null },
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

  // ── Sync CR_LIST from Excel (preview → modal → apply) ────────────────────

  const openSyncPreview = async () => {
    if (!selectedVId) return;
    setSyncing(true);
    try {
      const r = await axios.post(`${API}/version-cr-assignments/version/${selectedVId}/sync/preview`, {}, { headers });
      setExcludedAddedCrs(new Set());
      setSyncDiff(r.data as SyncDiff);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בתצוגה מקדימה', 'שגיאה', 'danger');
    } finally {
      setSyncing(false);
    }
  };

  const applySyncConfirmed = async () => {
    if (!selectedVId) return;
    setSyncDiff(null);
    setSyncing(true);
    try {
      await axios.post(
        `${API}/version-cr-assignments/version/${selectedVId}/sync/apply`,
        { excludeCrNumbers: Array.from(excludedAddedCrs) },
        { headers },
      );
      await loadVersion(selectedVId);
      dialog.alert('הסנכרון הושלם — CRים חדשים סומנו בירוק, CRים שהוסרו סומנו באדום', 'סנכרון הצליח', 'success');
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בסנכרון', 'שגיאה', 'danger');
    } finally {
      setSyncing(false);
    }
  };

  const deleteCrRecord = async (crNumber: string) => {
    if (!selectedVId) return;
    try {
      await axios.delete(`${API}/version-cr-assignments/cr/${selectedVId}/${crNumber}`, { headers });
      setCrs(prev => prev.filter(c => c.crNumber !== crNumber));
      setCrSyncStatuses(prev => { const n = { ...prev }; delete n[crNumber]; return n; });
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה במחיקה', 'שגיאה', 'danger');
    }
  };

  const showCrChangeDetail = async (crNumber: string) => {
    if (!selectedVId) return;
    try {
      const res = await axios.get(
        `${API}/qa/assignments/change-detail?versionId=${selectedVId}&crNumber=${crNumber}`,
        { headers },
      );
      const d = res.data;
      const lines = [d.reason as string];
      if (d.detail?.movedToVersion)   lines.push(`גרסה חדשה: ${d.detail.movedToVersion}`);
      if (d.detail?.movedFromVersion) lines.push(`גרסה קודמת: ${d.detail.movedFromVersion}`);
      if (d.detail?.statusInSource)   lines.push(`סטטוס בקובץ: ${d.detail.statusInSource}`);
      if (d.detail?.prevDays !== undefined && d.detail?.currentDays !== undefined) {
        lines.push(`ימי פיתוח: ${d.detail.prevDays ?? '?'} ← ${d.detail.currentDays}`);
      }
      dialog.alert(lines.join('\n'), `${d.crNumber} — ${d.crLabel ?? ''}`, d.syncStatus === 'REMOVED' ? 'warning' : 'info');
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בטעינת פרטי השינוי', 'שגיאה', 'danger');
    }
  };

  const handleDeleteCr = (crNumber: string) => {
    const cr = crs.find(c => c.crNumber === crNumber);
    setConfirmDialog({
      title: 'מחיקת CR',
      message: `האם למחוק את CR ${crNumber}${cr?.crLabel ? ` — ${cr.crLabel.replace(/^\d+\s*-\s*/, '')}` : ''}?\nפעולה זו אינה הפיכה.`,
      variant: 'danger',
      confirmLabel: 'מחק',
      cancelLabel: 'ביטול',
      onConfirm: () => deleteCrRecord(crNumber),
      onCancel: () => {},
    });
  };

  // ── Second-tester suggestions ────────────────────────────────────────────────

  const applySecondTesterSuggestion = async (s: typeof secondTesterSuggestions[number]) => {
    setApplyingSuggestion(s.assignmentId);
    try {
      await axios.patch(
        `${API}/qa/assignments/${s.assignmentId}/secondary`,
        { secondaryTesterId: s.suggestedTesterId },
        { headers },
      );
      setSecondTesterSuggestions(prev => prev.filter(x => x.assignmentId !== s.assignmentId));
      await loadVersion(selectedVId);
    } catch {
      // leave the suggestion in place — user can retry
    } finally {
      setApplyingSuggestion(null);
    }
  };

  // ── Generate work plan ─────────────────────────────────────────────────────

  const doGenerateWorkPlan = async () => {
    setGenerating(true);
    try {
      const r = await axios.post(
        `${API}/qa/workplan/generate`,
        { versionId: selectedVId, cycle1Start, testingEnd, cycle1LengthDays, cycle2LengthDays, cycle3LengthDays },
        { headers },
      );
      const unassignedCrs: string[] = r.data.unassignedCrs ?? [];
      const msg = unassignedCrs.length > 0
        ? `⚠ ${unassignedCrs.length} CRים ללא שיבוץ לא נכללו:\n${unassignedCrs.slice(0,5).join(', ')}${unassignedCrs.length > 5 ? '...' : ''}`
        : 'כל ה-CRים המשובצים נכללו בתוכנית.';
      dialog.alert(msg, 'תוכנית עבודה נוצרה', unassignedCrs.length > 0 ? 'warning' : 'success');
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית העבודה', 'שגיאה', 'danger');
    } finally {
      setGenerating(false);
    }
  };

  const generateWorkPlan = () => {
    if (!cycle1Start || !testingEnd) { dialog.alert('יש להזין תאריך התחלה ותאריך סיום בדיקות', 'שדות חסרים', 'warning'); return; }

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
    const bump = (userId: string, fullName: string, days: number) => {
      const cur = map.get(userId) ?? { fullName, totalDays: 0 };
      map.set(userId, { fullName: cur.fullName, totalDays: cur.totalDays + days });
    };
    assignments.forEach(a => {
      const total = a.qaEffort != null ? a.qaEffort : (effortMap.get(a.crNumber) ?? 0);
      // A second tester carries their participation % of the effort — the
      // rest stays with primary, matching the actual scheduler split, so
      // adding help to an overloaded tester correctly reduces their load here too.
      if (a.secondaryUser) {
        const pct = a.secondaryParticipationPct ?? 50;
        bump(a.userId, a.user.fullName, Math.round(total * (100 - pct) / 100 * 10) / 10);
        bump(a.secondaryTesterId!, a.secondaryUser.fullName, Math.round(total * pct / 100 * 10) / 10);
      } else {
        bump(a.userId, a.user.fullName, total);
      }
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
  const overloadCount = Array.from(testerLoad.values()).filter(l => cycle1LengthDays > 0 && l.totalDays > cycle1LengthDays).length;

  // Full active-tester roster (any CR's scored list includes everyone, not
  // just the top matches) — used to find reassignment candidates who
  // currently have zero load and so don't even appear in testerLoad.
  const allTestersRoster = useMemo(() => {
    const m = new Map<string, string>(); // userId → fullName
    crs.forEach(cr => cr.testers.forEach(t => { if (!m.has(t.userId)) m.set(t.userId, t.fullName); }));
    return m;
  }, [crs]);

  // Who's over capacity and why — checked against the fixed cycle-1-length
  // parameter (the same one the work plan now uses for its fixed cycle
  // boundaries), not the whole testing-window "קיבולת לבודק" shown below —
  // surfaced here as a clear, explicit alert instead of only a colored bar,
  // with the specific CR driving each overload — plus a one-click
  // reassignment suggestion when a tester with enough spare capacity to
  // absorb the biggest CR actually exists.
  const overloadIssues = useMemo(() => {
    if (cycle1LengthDays <= 0) return [];
    const byTester = new Map<string, Assignment[]>();
    assignments.forEach(a => {
      const list = byTester.get(a.userId) ?? [];
      list.push(a);
      byTester.set(a.userId, list);
    });
    const issues: {
      userId: string; fullName: string; totalDays: number; daysOver: number;
      biggest?: Assignment; biggestDays: number;
      suggestion?: { userId: string; fullName: string; newTotal: number };
    }[] = [];
    testerLoad.forEach((load, userId) => {
      if (load.totalDays <= cycle1LengthDays) return;
      const list    = byTester.get(userId) ?? [];
      const biggest = [...list].sort((a, b) => (b.qaEffort ?? effortMap.get(b.crNumber) ?? 0) - (a.qaEffort ?? effortMap.get(a.crNumber) ?? 0))[0];
      const biggestDays = biggest ? (biggest.qaEffort ?? effortMap.get(biggest.crNumber) ?? 0) : 0;

      let suggestion: { userId: string; fullName: string; newTotal: number } | undefined;
      if (biggest && biggestDays > 0) {
        allTestersRoster.forEach((fullName, candId) => {
          if (candId === userId) return;
          const candTotal = testerLoad.get(candId)?.totalDays ?? 0;
          const newTotal  = candTotal + biggestDays;
          if (newTotal > cycle1LengthDays) return; // would overflow the candidate too — not a real fix
          if (!suggestion || newTotal < suggestion.newTotal) suggestion = { userId: candId, fullName, newTotal };
        });
      }

      issues.push({
        userId, fullName: load.fullName, totalDays: load.totalDays,
        daysOver: Math.round((load.totalDays - cycle1LengthDays) * 10) / 10,
        biggest, biggestDays, suggestion,
      });
    });
    return issues.sort((a, b) => b.daysOver - a.daysOver);
  }, [testerLoad, cycle1LengthDays, assignments, effortMap, allTestersRoster]);

  const visibleCrs = crs.filter(cr => !hiddenCrs.has(cr.crNumber) && (crSyncStatuses[cr.crNumber] ?? 'ACTIVE') !== 'REMOVED');
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
    <div style={{ padding: `${SP[4]} ${SP[5]}`, direction: 'rtl', fontFamily: FONT }}>

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
            <button key={tab} onClick={() => {
              // Coming back from the work-plan tab (e.g. after adding/removing a
              // secondary tester there) — refresh so this screen isn't stale,
              // without requiring a manual page reload.
              if (tab === 'assignments' && activeTab !== 'assignments') loadVersion(selectedVId);
              setActiveTab(tab);
            }} style={{
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
          <QaWorkPlanView
            token={token}
            initialVersionId={selectedVId}
            versionQaStart={selectedVersion?.qaStart}
            versionQaEnd={selectedVersion?.qaEnd}
          />
        </Suspense>
      )}

      {/* Activity board tab */}
      {activeTab === 'activity' && (
        <Suspense fallback={<div style={{ padding: SP[6], textAlign: 'center', color: C.textMuted }}>טוען...</div>}>
          <QaActivityPlanView
            token={token}
            versionId={selectedVId}
            versionIntegrationStart={selectedVersion?.integrationStart}
            versionIntegrationEnd={selectedVersion?.integrationEnd}
          />
        </Suspense>
      )}

      {activeTab === 'assignments' && <>

      {/* ── Second-tester suggestions — CR whose effort alone exceeds the
          configured threshold (default 12 days), no secondary tester set yet ── */}
      {secondTesterSuggestions.filter(s => !dismissedSuggestions.has(s.assignmentId)).length > 0 && (
        <div style={{
          background: C.bgInProgress, border: `1px solid ${C.statusInProgress}44`,
          borderRadius: RADIUS.lg, padding: SP[4], marginBottom: SP[4],
        }}>
          <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[2] }}>
            ⏱ הצעות לבודק שני — CR-ים שעלולים להאריך את סבב 1
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
            {secondTesterSuggestions.filter(s => !dismissedSuggestions.has(s.assignmentId)).map(s => (
              <div key={s.assignmentId} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: SP[3],
                background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`,
              }}>
                <div style={{ ...TEXT.sm, color: C.textSecondary }}>
                  <strong style={{ color: C.textPrimary }}>{s.crNumber}</strong>
                  {s.crLabel && ` — ${s.crLabel.replace(/^\d+\s*-\s*/, '')}`}
                  {' '}({s.qaEffortDays} ימים, סף {s.thresholdDays}) — מומלץ: <strong>{s.suggestedTesterName}</strong>
                  {s.timeSavingDays > 0 && ` · חוסך כ-${s.timeSavingDays} ימים`}
                </div>
                <div style={{ display: 'flex', gap: SP[2], flexShrink: 0 }}>
                  <button
                    onClick={() => applySecondTesterSuggestion(s)}
                    disabled={applyingSuggestion === s.assignmentId}
                    style={{ padding: '5px 14px', background: C.brand, color: 'white', border: 'none', borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs, fontWeight: WEIGHT.semibold }}
                  >
                    {applyingSuggestion === s.assignmentId ? 'מאשר...' : '✓ אשר'}
                  </button>
                  <button
                    onClick={() => setDismissedSuggestions(prev => new Set(prev).add(s.assignmentId))}
                    style={{ padding: '5px 12px', background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, cursor: 'pointer', ...TEXT.xs }}
                  >
                    התעלם
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
          <DateField value={cycle1Start} onChange={v => setCycle1Start(v)}
            style={{ padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>סיום בדיקות</span>
          <DateField value={testingEnd} onChange={v => setTestingEnd(v)}
            style={{ padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }} title="גבול קבוע לסבב 1. מי שלא מספיק מסומן כחורג, לא מותח את הסבב לכל הצוות">
            אורך סבב 1 (ימי עבודה)
          </span>
          <input
            type="number" min={1} value={cycle1LengthDays}
            onChange={e => setCycle1LengthDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{ width: 90, padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }} title="גבול קבוע לסבב 2, בלתי תלוי בסבב 1">
            אורך סבב 2 (ימי עבודה)
          </span>
          <input
            type="number" min={1} value={cycle2LengthDays}
            onChange={e => setCycle2LengthDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{ width: 90, padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }} title="גבול קבוע לסבב 3, בלתי תלוי בסבב 1/2">
            אורך סבב 3 (ימי עבודה)
          </span>
          <input
            type="number" min={1} value={cycle3LengthDays}
            onChange={e => setCycle3LengthDays(Math.max(1, parseInt(e.target.value, 10) || 1))}
            style={{ width: 90, padding: `${SP[2]} ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT }}
          />
        </label>

        {cycleDays > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>אורך כל התקופה</span>
            <div style={{ padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.semibold }}>
              {cycleDays} ימי עבודה
            </div>
          </div>
        )}

        {selectedVersion?.plannedStart && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }} title="נקבע בשלב יצירת הגרסה — משימות ליבה לא יכולות להימשך מעברו">
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>🚀 מועד עלייה לאוויר</span>
            <div style={{ padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.semibold }}>
              {new Date(selectedVersion.plannedStart).toLocaleDateString('he-IL')}
            </div>
          </div>
        )}

        <div style={{ flex: 1 }} />

        {selectedVId && (
          <div style={{ display: 'flex', gap: SP[2], alignSelf: 'flex-end' }}>
            <button
              disabled={syncing}
              onClick={openSyncPreview}
              title="בדוק שינויים ברשימת CRים מול קובץ ה-Excel"
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
              disabled={bulkAssigning || visibleCrs.filter(cr => !assignmentMap.has(cr.crNumber)).length === 0}
              onClick={autoAssignAll}
              title="שיבוץ אוטומטי לכל ה-CR-ים שטרם שובצו"
              style={{
                padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, color: C.textSecondary,
                border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold,
                cursor: (bulkAssigning || visibleCrs.filter(cr => !assignmentMap.has(cr.crNumber)).length === 0) ? 'not-allowed' : 'pointer',
                opacity: (bulkAssigning || visibleCrs.filter(cr => !assignmentMap.has(cr.crNumber)).length === 0) ? 0.5 : 1,
                fontFamily: FONT, transition: EASE.fast, whiteSpace: 'nowrap',
              }}
            >
              {bulkAssigning ? '⏳ משבץ...' : '⚡ שיבוץ אוטומטי לכולם'}
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

      {/* ── Overload alert — who exceeds cycle capacity and why ── */}
      {overloadIssues.length > 0 && (
        <div style={{
          marginBottom: SP[4], borderRadius: RADIUS.lg, border: `1px solid ${C.danger}`,
          background: C.dangerBg, overflow: 'hidden',
        }}>
          <div
            onClick={() => setOverloadPanelCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${SP[3]} ${SP[4]}`, cursor: 'pointer' }}
          >
            <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.danger }}>
              ⚠️ {overloadIssues.length} בודקים חורגים מאורך סבב 1 ({cycle1LengthDays} ימי עבודה)
            </span>
            <span style={{ ...TEXT.sm, color: C.danger }}>{overloadPanelCollapsed ? '▸ הצג' : '▾ הסתר'}</span>
          </div>
          {!overloadPanelCollapsed && (
            <div style={{ padding: `0 ${SP[4]} ${SP[4]}`, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
              {overloadIssues.map(issue => (
                <div key={issue.userId} style={{ padding: SP[3], background: C.bgCard, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, ...TEXT.sm, color: C.textPrimary }}>
                  <div>
                    <b>{issue.fullName}</b> — משובצים לו {issue.totalDays} ימי עבודה, מול אורך סבב 1 של {cycle1LengthDays} ימים (חריגה של {issue.daysOver} ימים).
                    {issue.biggest && (
                      <> ה-CR המשמעותי ביותר בעומס שלו: <b>{issue.biggest.crNumber}</b> ({issue.biggestDays} ימים).</>
                    )}
                  </div>
                  {issue.suggestion && issue.biggest && (
                    <button
                      disabled={saving === issue.biggest.crNumber}
                      onClick={() => {
                        const crRec = crs.find(c => c.crNumber === issue.biggest!.crNumber);
                        if (crRec) assign(crRec, issue.suggestion!.userId);
                      }}
                      style={{
                        marginTop: SP[2], padding: `4px ${SP[3]}`, background: C.success, color: '#fff',
                        border: 'none', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.semibold,
                        cursor: saving === issue.biggest.crNumber ? 'not-allowed' : 'pointer',
                        opacity: saving === issue.biggest.crNumber ? 0.6 : 1, fontFamily: FONT,
                      }}
                    >
                      🔧 העבר CR {issue.biggest.crNumber} ל-{issue.suggestion.fullName} (יישאר עם {issue.suggestion.newTotal}/{cycle1LengthDays} ימים) — לבצע?
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Sync diff modal ── */}
      {syncDiff && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP[4] }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, boxShadow: SHADOW.xl, width: '100%', maxWidth: 560, maxHeight: '80vh', display: 'flex', flexDirection: 'column', direction: 'rtl' }}>
            <div style={{ padding: `${SP[4]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>🔄 תצוגה מקדימה של סנכרון</span>
              <button onClick={() => setSyncDiff(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, fontFamily: FONT }}>✕</button>
            </div>
            <div style={{ padding: `${SP[3]} ${SP[5]}`, display: 'flex', gap: SP[3], borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
              <span style={{ background: C.successBg, color: C.success, padding: `3px ${SP[3]}`, borderRadius: RADIUS.full, ...TEXT.sm, fontWeight: WEIGHT.bold }}>+{addedGrouped.filter(g => !excludedAddedCrs.has(g.crNumber)).length} חדשים</span>
              <span style={{ background: C.dangerBg,  color: C.danger,  padding: `3px ${SP[3]}`, borderRadius: RADIUS.full, ...TEXT.sm, fontWeight: WEIGHT.bold }}>−{syncDiff.removed.length} הוסרו</span>
              <span style={{ background: C.bgNested,  color: C.textMuted, padding: `3px ${SP[3]}`, borderRadius: RADIUS.full, ...TEXT.sm, fontWeight: WEIGHT.medium }}>{syncDiff.unchanged} ללא שינוי</span>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: SP[4] }}>
              {addedGrouped.length > 0 && (
                <div style={{ marginBottom: SP[3] }}>
                  <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.success, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: SP[2] }}>CRים חדשים שיתווספו</div>
                  {addedGrouped.map(item => {
                    const excluded = excludedAddedCrs.has(item.crNumber);
                    return (
                      <div key={item.crNumber} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: `${SP[1]} ${SP[2]}`, borderRadius: RADIUS.sm, background: excluded ? C.bgNested : C.successBg, marginBottom: 4, opacity: excluded ? 0.5 : 1 }}>
                        <span style={{ background: C.success + '22', color: C.success, padding: `1px ${SP[2]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>{item.crNumber}</span>
                        <span style={{ ...TEXT.xs, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: excluded ? 'line-through' : 'none', flex: 1 }}>{item.crLabel?.replace(/^\d+\s*-\s*/, '') ?? '—'}</span>
                        <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>{item.teamNames.join(', ')}</span>
                        <button
                          onClick={() => setExcludedAddedCrs(prev => {
                            const n = new Set(prev);
                            excluded ? n.delete(item.crNumber) : n.add(item.crNumber);
                            return n;
                          })}
                          title={excluded ? 'בטל הסרה — הוסף בחזרה לשיבוץ' : 'הסר CR זה מהשיבוץ (כל הצוותים)'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: excluded ? C.success : C.textMuted, fontSize: 14, flexShrink: 0, fontFamily: FONT }}
                        >{excluded ? '↺' : '✕'}</button>
                      </div>
                    );
                  })}
                </div>
              )}
              {syncDiff.removed.length > 0 && (
                <div>
                  <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.danger, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: SP[2] }}>CRים שהוסרו מהתכולה</div>
                  {syncDiff.removed.map(item => (
                    <div key={`${item.crNumber}-${item.teamName}`} style={{ display: 'flex', alignItems: 'center', gap: SP[2], padding: `${SP[1]} ${SP[2]}`, borderRadius: RADIUS.sm, background: C.dangerBg, marginBottom: 4 }}>
                      <span style={{ background: C.danger + '22', color: C.danger, padding: `1px ${SP[2]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>{item.crNumber}</span>
                      <span style={{ ...TEXT.xs, color: C.textSecondary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: 'line-through', flex: 1 }}>{item.crLabel?.replace(/^\d+\s*-\s*/, '') ?? '—'}</span>
                      <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap', flexShrink: 0 }}>{item.teamName}</span>
                    </div>
                  ))}
                </div>
              )}
              {syncDiff.added.length === 0 && syncDiff.removed.length === 0 && (
                <div style={{ textAlign: 'center', padding: SP[4], ...TEXT.sm, color: C.textMuted }}>✅ אין שינויים — התכולה זהה לקובץ ה-Excel</div>
              )}
            </div>
            <div style={{ padding: `${SP[3]} ${SP[5]}`, borderTop: `1px solid ${C.border}`, display: 'flex', gap: SP[2], justifyContent: 'flex-start', flexShrink: 0 }}>
              {(() => {
                const nothingToApply = addedGrouped.every(g => excludedAddedCrs.has(g.crNumber)) && syncDiff.removed.length === 0;
                return (
                  <button
                    onClick={applySyncConfirmed}
                    disabled={nothingToApply}
                    style={{ padding: `${SP[2]} ${SP[4]}`, background: BLUE, color: '#fff', border: 'none', borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: nothingToApply ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: nothingToApply ? 0.5 : 1 }}
                  >אשר ובצע סנכרון</button>
                );
              })()}
              <button
                onClick={() => setSyncDiff(null)}
                style={{ padding: `${SP[2]} ${SP[4]}`, background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
              >ביטול</button>
            </div>
          </div>
        </div>
      )}

      {loading && <EmptyState icon="⏳" title="טוען CRים..." sub="" />}
      {!loading && !selectedVId && <EmptyState icon="🗂️" title="בחר גרסה להתחיל" sub="המנוע יסרוק את כל ה-CRים ויחשב ציוני התאמה לכל בודק" />}
      {!loading && selectedVId && crs.length === 0 && <EmptyState icon="📭" title="אין CRים בגרסה זו" sub="לא נמצאו CRים מיובאים. סנכרן CRים מה-Excel דרך דשבורד > גרסאות." />}

      {!loading && crs.length > 0 && (
        <div>
          {/* Stat bar + search */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP[3], gap: SP[3] }}>
            <div style={{ display: 'flex', gap: SP[2], flexWrap: 'wrap' }}>
              <StatPill value={visibleCrs.length} label="CRים"    color={BLUE}      bg={BLUE_BG}     />
              <StatPill value={assigned}     label="משובצים"    color={C.success} bg={C.successBg}  />
              {unassigned > 0 && <StatPill value={unassigned} label="ממתינים" color={C.warning} bg={C.warningBg} />}
              {Object.values(crSyncStatuses).filter(s => s === 'NEW').length > 0 && (
                <StatPill value={Object.values(crSyncStatuses).filter(s => s === 'NEW').length} label="חדשים" color={C.success} bg={C.successBg} />
              )}
              {Object.values(crSyncStatuses).filter(s => s === 'REMOVED').length > 0 && (
                <StatPill value={Object.values(crSyncStatuses).filter(s => s === 'REMOVED').length} label="הוסרו" color={C.danger} bg={C.dangerBg} />
              )}
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
                      { key: null,     label: 'ימי בדיקות (פיצול)' },
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
                    const testerOverload = asg && cycle1LengthDays > 0
                      ? (testerLoad.get(asg.userId)?.totalDays ?? 0) > cycle1LengthDays : false;
                    const orderNum = asg ? (testerOrderMap.get(cr.crNumber) ?? null) : null;

                    // Effective isStandAlone: assignment override or VCA default
                    const effectiveSA = asg
                      ? (asg.isStandAlone !== null ? asg.isStandAlone : cr.isStandAlone)
                      : cr.isStandAlone;

                    // Effective cycles for display
                    const effectiveCycles = asg && asg.cycles?.length > 0
                      ? asg.cycles
                      : (effectiveSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);

                    const syncStatus = crSyncStatuses[cr.crNumber] ?? 'ACTIVE';
                    const rowBg = syncStatus === 'NEW'
                      ? 'rgba(22,163,74,0.07)'
                      : syncStatus === 'REMOVED'
                        ? 'rgba(220,38,38,0.07)'
                        : (i % 2 === 0 ? 'transparent' : C.bgNested);

                    return (
                      <tr key={cr.crNumber} style={{ background: rowBg, borderBottom: `1px solid ${C.border}`, opacity: syncStatus === 'REMOVED' ? 0.75 : 1 }}>

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
                            <div style={{ ...TEXT.sm, color: syncStatus === 'REMOVED' ? C.textMuted : C.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: syncStatus === 'REMOVED' ? 'line-through' : 'none' }} title={cr.crLabel ?? ''}>
                              {cr.crLabel ? cr.crLabel.replace(/^\d+\s*-\s*/, '') : <span style={{ color: C.textDisabled }}>—</span>}
                            </div>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                              {syncStatus === 'NEW'     && <span onClick={() => showCrChangeDetail(cr.crNumber)} title="לחץ לפרטי השינוי" style={{ background: C.successBg, color: C.success, padding: '1px 5px', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, cursor: 'pointer', textDecoration: 'underline dotted' }}>חדש 🟢</span>}
                              {syncStatus === 'REMOVED' && <span onClick={() => showCrChangeDetail(cr.crNumber)} title="לחץ לפרטי השינוי" style={{ background: C.dangerBg,  color: C.danger,  padding: '1px 5px', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, cursor: 'pointer', textDecoration: 'underline dotted' }}>⚠ הוסר מהתכולה</span>}
                              {cr.riskLevel && (
                                <span style={{ background: risk.bg, color: risk.color, padding: '1px 5px', borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.semibold }}>
                                  {riskLabel(cr.riskLevel)}
                                </span>
                              )}
                            </div>
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
                              {effectiveCycles.includes('STAND_ALONE') && (
                                <div style={{ marginTop: SP[2], paddingTop: SP[2], borderTop: `1px solid ${C.border}` }}>
                                  <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, padding: `0 ${SP[2]}`, marginBottom: SP[1] }}>
                                    מועד יעד מוקדם ל-Stand Alone (אופציונלי)
                                  </div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: SP[1], padding: `0 ${SP[2]}` }}>
                                    <DateField
                                      value={asg.standAloneDueDate ? asg.standAloneDueDate.slice(0, 10) : ''}
                                      onChange={v => patchAssignment(asg.id, cr.crNumber, { standAloneDueDate: v || null })}
                                      style={{ padding: `4px ${SP[2]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.xs, background: C.bgNested, color: C.textPrimary, outline: 'none', fontFamily: FONT, flex: 1 }}
                                    />
                                    {asg.standAloneDueDate && (
                                      <button
                                        title="נקה תאריך יעד"
                                        onClick={() => patchAssignment(asg.id, cr.crNumber, { standAloneDueDate: null })}
                                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDisabled, ...TEXT.xs, padding: 2 }}
                                      >✕</button>
                                    )}
                                  </div>
                                </div>
                              )}
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
                              <div style={{ width: 24, height: 24, borderRadius: '50%', background: testerOverload ? C.dangerBg : BLUE_BG, color: testerOverload ? C.danger : BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: WEIGHT.bold, fontSize: '12px', flexShrink: 0, border: testerOverload ? `1px solid ${C.danger}44` : 'none' }}>
                                {asg.user.fullName.charAt(0).toUpperCase()}
                              </div>
                              <span style={{ ...TEXT.sm, fontWeight: WEIGHT.medium, color: testerOverload ? C.danger : C.textPrimary }}>{asg.user.fullName}</span>
                              {testerOverload && <span title="בודק זה חורג ממשך הסבב" style={{ cursor: 'help' }}>⚠️</span>}
                              {asg.secondaryUser && (
                                <span title="בודק שני" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...TEXT.xs, color: C.info, background: C.infoBg, padding: `1px ${SP[1]}`, borderRadius: RADIUS.sm, whiteSpace: 'nowrap' }}>
                                  + {asg.secondaryUser.fullName}
                                  <input
                                    type="number" min={1} max={99}
                                    defaultValue={asg.secondaryParticipationPct ?? 50}
                                    title="% השתתפות הבודק השני מתוך המאמץ הכולל"
                                    onBlur={async e => {
                                      const v = Math.min(99, Math.max(1, parseInt(e.target.value, 10) || 50));
                                      setSaving(cr.crNumber);
                                      try {
                                        await axios.patch(`${API}/qa/assignments/${asg.id}`, { secondaryParticipationPct: v }, { headers });
                                        await loadVersion(selectedVId);
                                      } finally {
                                        setSaving(null);
                                      }
                                    }}
                                    onClick={e => e.stopPropagation()}
                                    style={{ width: 40, padding: '0 3px', border: `1px solid ${C.info}55`, borderRadius: RADIUS.sm, ...TEXT.xs, background: C.bgCard, color: C.info, outline: 'none', fontFamily: FONT, textAlign: 'center', MozAppearance: 'textfield' }}
                                  />%
                                  <button
                                    disabled={isSaving}
                                    title="הסר בודק שני"
                                    onClick={async e => {
                                      e.stopPropagation();
                                      setSaving(cr.crNumber);
                                      try {
                                        await axios.patch(`${API}/qa/assignments/${asg.id}/secondary`, { secondaryTesterId: null }, { headers });
                                        await loadVersion(selectedVId);
                                      } finally {
                                        setSaving(null);
                                      }
                                    }}
                                    style={{ background: 'none', border: 'none', cursor: isSaving ? 'not-allowed' : 'pointer', color: C.info, padding: 0, fontSize: 11, lineHeight: 1 }}
                                  >✕</button>
                                </span>
                              )}
                              {!asg.secondaryUser && (
                                <button
                                  disabled={isSaving}
                                  onClick={e => { setOpenCyclesPicker(null); openPickerFor(cr.crNumber, e.currentTarget, 'secondary'); }}
                                  title="הוסף בודק שני"
                                  style={{ padding: `1px ${SP[1]}`, background: 'transparent', color: C.textMuted, border: `1px dashed ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.xs, cursor: isSaving ? 'not-allowed' : 'pointer', fontFamily: FONT, whiteSpace: 'nowrap' }}
                                >+ בודק שני</button>
                              )}
                              <button
                                disabled={isSaving}
                                onClick={() => unassign(asg.id, cr.crNumber)}
                                title="הסר שיבוץ"
                                style={{ width: 16, height: 16, borderRadius: '50%', border: `1px solid ${C.border}`, background: 'transparent', color: C.textDisabled, fontSize: '11px', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: FONT, transition: EASE.fast }}
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

                        {/* Computed testing-days split (primary/secondary) */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {asg?.secondaryUser && effortDays != null ? (() => {
                            const pct = asg.secondaryParticipationPct ?? 50;
                            const secondaryDays = Math.max(1, Math.round(effortDays * pct / 100 * 10) / 10);
                            const primaryDays   = Math.max(1, Math.round(effortDays * (100 - pct) / 100 * 10) / 10);
                            return (
                              <span title={`${asg.user.fullName}: ${primaryDays} ימים · ${asg.secondaryUser!.fullName}: ${secondaryDays} ימים`} style={{ ...TEXT.xs, color: C.textSecondary, fontWeight: WEIGHT.semibold }}>
                                {primaryDays} / {secondaryDays}
                              </span>
                            );
                          })() : (
                            <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>
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
                              onClick={async () => { const r = await autoAssign(cr.crNumber); if (r?.status === 'MANUAL_INTERVENTION') { dialog.alert('שיבוץ ידני נדרש:\n\n' + r.blockReasons.join('\n'), 'שיבוץ ידני נדרש', 'warning'); } }}
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
                            {syncStatus === 'REMOVED' && isManager && (
                              <button
                                title="מחק CR לצמיתות"
                                onClick={() => handleDeleteCr(cr.crNumber)}
                                style={{ padding: '5px 7px', background: C.dangerBg, color: C.danger, border: `1px solid ${C.danger}44`, borderRadius: RADIUS.md, ...TEXT.xs, cursor: 'pointer', fontFamily: FONT, lineHeight: 1, fontWeight: WEIGHT.semibold }}
                              >🗑 מחק</button>
                            )}
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
                  pickerMode === 'secondary' && asg ? (
                    <ScoringPickerContent
                      result={{ ...result, recommendations: result.recommendations.filter(r => r.userId !== asg.userId) }}
                      allTesters={cr.testers.filter(t => t.userId !== asg.userId)}
                      currentUserId={asg.secondaryTesterId ?? undefined}
                      title="בחירת בודק שני"
                      onAssign={async userId => {
                        setOpenPicker(null);
                        setSaving(cr.crNumber);
                        try {
                          await axios.patch(`${API}/qa/assignments/${asg.id}/secondary`, { secondaryTesterId: userId }, { headers });
                          await loadVersion(selectedVId);
                        } finally {
                          setSaving(null);
                        }
                      }}
                    />
                  ) : (
                    <ScoringPickerContent result={result} allTesters={cr.testers} currentUserId={asg?.userId} onAssign={(userId, score) => assign(cr, userId, score)} />
                  )
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
                {cycle1LengthDays > 0 && <span style={{ ...TEXT.xs, color: C.textMuted }}>קיבולת: {cycle1LengthDays} ימי עבודה לבודק (אורך סבב 1)</span>}
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
                    const over = cycle1LengthDays > 0 && totalDays > cycle1LengthDays;
                    return (
                      <div key={userId} style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, background: over ? C.dangerBg : C.bgNested, border: `1px solid ${over ? C.danger + '44' : C.border}`, minWidth: 200, flex: '1 1 200px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: over ? C.danger : C.textPrimary }}>
                            {over && '⚠ '}{fullName}
                          </span>
                          {over && (
                            <span style={{ ...TEXT.xs, background: C.dangerBg, color: C.danger, padding: `1px 6px`, borderRadius: RADIUS.full, fontWeight: WEIGHT.bold, border: `1px solid ${C.danger}33` }}>
                              +{(totalDays - cycle1LengthDays).toFixed(1)}י'
                            </span>
                          )}
                        </div>
                        <LoadBar used={totalDays} capacity={cycle1LengthDays || totalDays} />
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
  result, allTesters, currentUserId, onAssign, title,
}: {
  result:        ScoringResult;
  allTesters:    CrRec['testers'];
  currentUserId?: string;
  onAssign:      (userId: string, score: number) => void;
  title?:        string;
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
          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{title ?? 'שיבוץ מונחה AI'}</span>
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
                  <div style={{ width: 22, height: 22, borderRadius: '50%', background: isCurrent ? BLUE_BG : C.bgNested, color: isCurrent ? BLUE : C.textSecondary, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: WEIGHT.bold, fontSize: '12px', flexShrink: 0, border: `1px solid ${isCurrent ? BLUE + '44' : C.border}` }}>
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
        <div style={{ width: 24, height: 24, borderRadius: '50%', flexShrink: 0, background: rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : '#CD7F32', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: WEIGHT.bold, fontSize: '12px' }}>
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
