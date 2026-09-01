import React, { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from 'react';
import axios from 'axios';
const QaWorkPlanView    = lazy(() => import('./QaWorkPlanView'));
const QaActivityPlanView = lazy(() => import('./QaActivityPlanView'));
import { C, FONT, TEXT, WEIGHT, SP, RADIUS, SHADOW, EASE } from '../../theme';
import { ConfirmDialog, DialogConfig } from '../ConfirmDialog';
import { useDialog } from '../../context/DialogContext';
import { DateField } from '../DatePicker';
import { formatDate as fmtDateShared, formatDateTime as fmtDateTimeShared } from '../../utils/dateFormat';

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

// Same effort-split ratio the real scheduler (buildWorkPlan / CYCLE_EFFORT_RATIO
// in qa.scheduler.ts) applies per cycle a CR participates in — a CR with
// 1+2+3 selected doesn't repeat its full effort in every cycle; later cycles
// get a shrinking share (regression-style retesting), so the "load per cycle"
// preview below matches what generating a work plan will actually produce.
const LOAD_VIEW_CYCLES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE'] as const;
type LoadViewCycle = typeof LOAD_VIEW_CYCLES[number];
const CYCLE_EFFORT_RATIO: Record<LoadViewCycle, number> = {
  CYCLE_1: 1.0, CYCLE_2: 0.5, CYCLE_3: 0.30, STAND_ALONE: 1.0,
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
  isCore:       boolean;
  priorityTestDate: string | null;
  notes:        string | null;
  urgent:       boolean;
  qaArrivalDate: string | null;
  qaReceived:    boolean;
  qaReceivedAt:  string | null;
  qaEffortDays: number | null;
  systems:      string[];
  riskLevel:    string | null;
  testers:      { userId: string; fullName: string; email: string; score: number; matchedSkills: { skillName: string; level: number }[] }[];
  isArchived:    boolean;
  archivedAt:    string | null;
  archivedReason: string | null;
}

interface CrArchiveHistoryEntry {
  id: string;
  action: string; // TASK_ARCHIVED | TASK_RESTORED
  userEmail: string | null;
  userName: string | null;
  cycleType: string | null;
  reason: string | null;
  createdAt: string;
  isCurrentlyArchived: boolean;
}

interface CrDetail {
  crNumber: string; crLabel: string; crDescription: string | null; crManager: string | null;
  application: string | null; estimateDays: number | null; notes: string | null;
  versionName: string; teams: string[]; status: string;
  archiveHistory: CrArchiveHistoryEntry[];
}

// Mirrors QaWorkPlanView.tsx's CYCLE_LABEL — used only for the CR-detail
// modal's archive-history section here.
const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};

interface SyncDiffItem { crNumber: string; crLabel: string | null; teamName?: string; }
interface SyncDiff { added: SyncDiffItem[]; removed: SyncDiffItem[]; unchanged: number; }

// Same shape as qa-workplan.service.ts's computeOverflowIssues — real,
// server-computed overflow from the actual generated plan (dates, holidays,
// carry-over), as opposed to the estimate below (cycle1LengthDays vs. raw
// effort totals, all that's available before a plan exists).
interface OverflowIssue {
  type: 'CORE_OVERFLOW' | 'CORE_TESTING_END_OVERFLOW' | 'SA_DUE_DATE_MISSED' | 'GO_LIVE_OVERFLOW' | 'SA_TESTING_END_OVERFLOW';
  message: string;
  crNumber?: string;
  userName?: string;
  userId?: string;
  cycleType?: string;
  daysOver: number;
  suggestions: string[];
}

// Full per-cycle task data from the generated work plan — used for the
// per-tester Gantt timeline (real dates) once a plan exists. Only the fields
// the timeline actually needs; see qa-workplan.service.ts's getWorkPlan for
// the full shape.
interface PlanTask {
  id: string; crNumber: string; crLabel: string | null;
  taskType: 'CR' | 'STAND_ALONE' | 'REGRESSION';
  userId: string; effortDays: number;
  plannedStart: string; plannedEnd: string; isActive: boolean; isPrimary: boolean;
}
interface PlanCycle { cycleType: string; plannedStart: string; plannedEnd: string; tasks: PlanTask[]; }

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
// `holidayDays` (yyyy-mm-dd keys, see dateKeyStr) mirrors backend/src/qa/qa.scheduler.ts's
// holiday handling — real-holiday dates (Season.forcesOff — NOT isActive,
// which only means "open for leave-request submissions" and is unrelated,
// see qa-workplan.service.ts's loadHolidayDays), fetched from GET
// /leaves/seasons, are skipped like a weekend everywhere the backend skips them.
//
// The backend encodes dates as e.g. "2026-01-31T22:00:00.000Z", meaning
// midnight Israel time (which lands on the *next* UTC calendar day in
// winter). Reading that with plain `new Date(iso)` + local getters/setters
// only gives the right calendar day when the browser's OWN system timezone
// happens to be Israel's — on any other timezone the weekday/date silently
// shifts (caught live 2026-07-30: cycle-length math was correct in this
// session's own Asia/Jerusalem test environment, wrong in the user's real
// browser). toIsraelDay() extracts the *intended* Israel calendar date
// explicitly, regardless of the runtime's own timezone, and returns it as a
// UTC-midnight Date — every helper below then uses ONLY UTC getters/setters,
// so results never depend on where the code happens to be running.

const ISRAEL_DATE_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' });

function toIsraelDay(input: string | Date): Date {
  const d = typeof input === 'string' ? new Date(input) : input;
  const parts = ISRAEL_DATE_FMT.formatToParts(d);
  const get = (type: string) => Number(parts.find(p => p.type === type)!.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

function dateKeyStr(d: Date): string { return d.toISOString().slice(0, 10); }

function isWorkDay(d: Date, holidayDays?: Set<string>): boolean {
  const dow = d.getUTCDay();
  if (dow === 5 || dow === 6) return false;
  if (holidayDays && holidayDays.has(dateKeyStr(d))) return false;
  return true;
}

function countWorkDays(start: string, end: string, holidayDays?: Set<string>): number {
  if (!start || !end) return 0;
  const s = toIsraelDay(start);
  const e = toIsraelDay(end);
  let count = 0;
  const d = new Date(s);
  while (d <= e) { if (isWorkDay(d, holidayDays)) count++; d.setUTCDate(d.getUTCDate() + 1); }
  return count;
}

// Mirrors backend/src/qa/qa.scheduler.ts exactly — kept in sync so the live
// preview of round boundaries here matches what generate-workplan actually
// produces server-side.
function getFirstWorkDay(date: Date | string, holidayDays?: Set<string>): Date {
  const d = toIsraelDay(date);
  while (!isWorkDay(d, holidayDays)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function nextWorkDay(date: Date, holidayDays?: Set<string>): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + 1);
  while (!isWorkDay(d, holidayDays)) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
function addWorkDays(date: Date, days: number, holidayDays?: Set<string>): Date {
  if (days <= 0) return new Date(date);
  const d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkDay(d, holidayDays)) remaining--;
  }
  return d;
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

// ── Per-tester timeline (Gantt when a plan exists, capacity bars otherwise) ──
// Only rendered when a specific tester is selected in the filter above. The
// goal in both modes is the same: let the user see, in one glance, everything
// this person has and where they run out of room — not just a per-CR row in
// a flat table.

const TIMELINE_COLORS = ['#2a78d6', '#008300', '#e87ba4', '#eda100', '#1baf7a', '#eb6834', '#4a3aa7', '#e34948'];

function TesterTimeline({
  filterTesterId, testerName, planExists, planCycles, assignments, crByNumber, effortMap,
  cycle1LengthDays, cycle2LengthDays, cycle3LengthDays, holidayDays, missingFromPlan,
}: {
  filterTesterId: string;
  testerName: string;
  planExists: boolean;
  planCycles: PlanCycle[];
  assignments: Assignment[];
  crByNumber: Map<string, CrRec>;
  effortMap: Map<string, number>;
  cycle1LengthDays: number; cycle2LengthDays: number; cycle3LengthDays: number;
  holidayDays: Set<string>;
  missingFromPlan: Assignment[];
}) {
  return (
    <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.sm, padding: SP[4], marginBottom: SP[4] }}>
      <div style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[3] }}>
        📊 ציר זמן — {testerName}
      </div>
      {planExists && missingFromPlan.length > 0 && (
        <div style={{ ...TEXT.xs, color: C.warning, background: C.warningBg, border: `1px solid ${C.warning}`, borderRadius: RADIUS.md, padding: SP[2], marginBottom: SP[3] }}>
          ⚠ {missingFromPlan.length} מתוך המשימות הנוכחיות של {testerName} ({missingFromPlan.map(a => a.crNumber).join(', ')}) אינ{missingFromPlan.length === 1 ? 'ה' : 'ן'} בתוכנית הזו — ציר הזמן למטה מציג את התוכנית הקיימת, לא בהכרח את השיבוץ העדכני. יש ליצור מחדש כדי לסנכרן.
        </div>
      )}
      {planExists
        ? <RealTesterGantt filterTesterId={filterTesterId} planCycles={planCycles} holidayDays={holidayDays} cycle1LengthDays={cycle1LengthDays} />
        : <PreplanCapacityBars
            filterTesterId={filterTesterId} assignments={assignments} crByNumber={crByNumber} effortMap={effortMap}
            cycle1LengthDays={cycle1LengthDays} cycle2LengthDays={cycle2LengthDays} cycle3LengthDays={cycle3LengthDays}
          />}
    </div>
  );
}

// ── Mode A: no plan yet — duration bars, not dates ───────────────────────────
// Top line = the cycle's configured length. Bottom line = this tester's CRs
// for that cycle, stacked in queue order, each sized by its (ratio-scaled)
// estimated effort — so overflow past the top line is visible before a real
// plan is ever generated. Stand Alone has no fixed length pre-plan, so it's
// shown as a plain segment list with no capacity line to compare against.
function PreplanCapacityBars({
  filterTesterId, assignments, crByNumber, effortMap, cycle1LengthDays, cycle2LengthDays, cycle3LengthDays,
}: {
  filterTesterId: string;
  assignments: Assignment[];
  crByNumber: Map<string, CrRec>;
  effortMap: Map<string, number>;
  cycle1LengthDays: number; cycle2LengthDays: number; cycle3LengthDays: number;
}) {
  const mine = assignments
    .filter(a => a.userId === filterTesterId || a.secondaryTesterId === filterTesterId)
    .sort((a, b) => (a.sortOrder ?? 999) - (b.sortOrder ?? 999));

  type Seg = { crNumber: string; crLabel: string | null; days: number; urgent: boolean };
  const segsForCycle = (cycleType: string): Seg[] => {
    const segs: Seg[] = [];
    for (const a of mine) {
      const crRec = crByNumber.get(a.crNumber);
      const effSA = a.isStandAlone !== null ? a.isStandAlone : (crRec?.isStandAlone ?? false);
      const cycles = a.cycles?.length > 0 ? a.cycles : (effSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);
      if (!cycles.includes(cycleType)) continue;
      const total = a.qaEffort != null ? a.qaEffort : (effortMap.get(a.crNumber) ?? 0);
      const ratio = CYCLE_EFFORT_RATIO[cycleType as LoadViewCycle] ?? 1;
      const scaled = Math.max(1, Math.round(total * ratio));
      const isSecondary = a.userId !== filterTesterId;
      const myShare = isSecondary
        ? Math.max(1, Math.round(scaled * (a.secondaryParticipationPct ?? 50) / 100))
        : (a.secondaryTesterId ? Math.max(1, Math.round(scaled * (100 - (a.secondaryParticipationPct ?? 50)) / 100)) : scaled);
      segs.push({ crNumber: a.crNumber, crLabel: a.crLabel, days: myShare, urgent: crRec?.urgent ?? false });
    }
    return segs;
  };

  const cycleRows: { label: string; capacity: number; segs: Seg[] }[] = [
    { label: 'סבב 1', capacity: cycle1LengthDays, segs: segsForCycle('CYCLE_1') },
    { label: 'סבב 2', capacity: cycle2LengthDays, segs: segsForCycle('CYCLE_2') },
    { label: 'סבב 3', capacity: cycle3LengthDays, segs: segsForCycle('CYCLE_3') },
  ];
  const saSegs = segsForCycle('STAND_ALONE');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[4] }}>
      {cycleRows.map(row => {
        if (row.segs.length === 0) return null;
        const totalDays = row.segs.reduce((s, x) => s + x.days, 0);
        const scaleBase = Math.max(row.capacity, totalDays);
        const pctOf = (d: number) => (d / scaleBase) * 100;
        const over = totalDays > row.capacity;
        return (
          <div key={row.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.xs, color: C.textMuted, marginBottom: 4 }}>
              <span style={{ fontWeight: WEIGHT.semibold, color: C.textSecondary }}>{row.label}</span>
              <span style={{ color: over ? C.danger : C.textMuted, fontWeight: over ? WEIGHT.bold : WEIGHT.normal }}>
                {totalDays} / {row.capacity} ימים{over ? ' ⚠ חריגה' : ''}
              </span>
            </div>
            {/* Capacity line */}
            <div style={{ position: 'relative', height: 8, background: C.bgNested, borderRadius: RADIUS.sm, marginBottom: 4 }}>
              <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${pctOf(row.capacity)}%`, background: C.border, borderRadius: RADIUS.sm }} />
            </div>
            {/* Load line — segmented by CR, in queue order */}
            <div style={{ display: 'flex', height: 22, borderRadius: RADIUS.sm, overflow: 'hidden', border: `1px solid ${C.border}` }}>
              {row.segs.map((seg, i) => (
                <div
                  key={seg.crNumber + i}
                  title={`${seg.crNumber} — ${seg.crLabel ?? seg.crNumber} (${seg.days} ימים)`}
                  style={{
                    width: `${pctOf(seg.days)}%`, background: TIMELINE_COLORS[i % TIMELINE_COLORS.length],
                    display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                    borderLeft: i > 0 ? `1px solid ${C.bgCard}` : 'none', position: 'relative',
                  }}
                >
                  {seg.urgent && <span style={{ position: 'absolute', right: 2, color: '#fff', fontWeight: WEIGHT.bold, fontSize: 10 }}>🔴</span>}
                  {pctOf(seg.days) > 6 && <span style={{ ...TEXT.xs, color: '#fff', fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>{seg.crNumber}</span>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {saSegs.length > 0 && (
        <div>
          <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.textSecondary, marginBottom: 4 }}>
            Stand Alone (ללא קיבולת קבועה)
          </div>
          <div style={{ display: 'flex', height: 22, borderRadius: RADIUS.sm, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            {saSegs.map((seg, i) => (
              <div
                key={seg.crNumber + i}
                title={`${seg.crNumber} — ${seg.crLabel ?? seg.crNumber} (${seg.days} ימים)`}
                style={{
                  flex: seg.days, background: TIMELINE_COLORS[i % TIMELINE_COLORS.length],
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  borderLeft: i > 0 ? `1px solid ${C.bgCard}` : 'none', position: 'relative', minWidth: 24,
                }}
              >
                {seg.urgent && <span style={{ position: 'absolute', right: 2, color: '#fff', fontWeight: WEIGHT.bold, fontSize: 10 }}>🔴</span>}
                <span style={{ ...TEXT.xs, color: '#fff', fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>{seg.crNumber}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {cycleRows.every(r => r.segs.length === 0) && saSegs.length === 0 && (
        <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[3] }}>אין עדיין משימות משובצות לבודק זה</div>
      )}
    </div>
  );
}

// ── Mode B: real plan exists — one combined line ─────────────────────────────
// Cycle 1's real length is the capacity reference (same visual language as
// Mode A's pre-plan bars, now with real numbers). This tester's Cycle 1 tasks
// AND their Stand Alone tasks are placed one after another on the SAME line,
// in real chronological order — the question this answers is "does
// everything this person has in Cycle 1 + SA actually fit inside Cycle 1's
// length." A CR that belongs to neither Cycle 1 nor Stand Alone (only
// Cycle 2/3/UAT/etc.) has no natural place on that line, so it's listed
// separately underneath instead of being silently missing.
function RealTesterGantt({ filterTesterId, planCycles, holidayDays, cycle1LengthDays }: {
  filterTesterId: string; planCycles: PlanCycle[]; holidayDays: Set<string>; cycle1LengthDays: number;
}) {
  const tasksOf = (cycleType: string) =>
    (planCycles.find(c => c.cycleType === cycleType)?.tasks ?? [])
      .filter(t => t.isActive && t.taskType !== 'REGRESSION' && t.userId === filterTesterId);

  // Capacity reference is the LIVE settings-field value (same prop
  // PreplanCapacityBars uses), not the actual persisted plan's own cycle
  // dates — otherwise editing "אורך סבב 1" without regenerating would leave
  // the capacity line stuck at whatever was last generated (reported live
  // 2026-07-30).
  const cycle1Tasks = tasksOf('CYCLE_1').map(t => ({ ...t, srcCycle: 'CYCLE_1' as const }));
  const saTasks     = tasksOf('STAND_ALONE').map(t => ({ ...t, srcCycle: 'STAND_ALONE' as const }));
  const mainTasks   = [...cycle1Tasks, ...saTasks].sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));

  // CRs that exist ONLY outside Cycle 1 / Stand Alone — flagged, not silently dropped.
  const mainCrNumbers = new Set(mainTasks.map(t => t.crNumber));
  const otherByCr = new Map<string, PlanTask & { cycleType: string }>();
  for (const c of planCycles) {
    if (c.cycleType === 'CYCLE_1' || c.cycleType === 'STAND_ALONE') continue;
    for (const t of c.tasks) {
      if (!t.isActive || t.taskType === 'REGRESSION' || t.userId !== filterTesterId) continue;
      if (mainCrNumbers.has(t.crNumber)) continue; // already shown via its Cycle 1/SA occurrence
      const cur = otherByCr.get(t.crNumber);
      if (!cur || t.plannedStart < cur.plannedStart) otherByCr.set(t.crNumber, { ...t, cycleType: c.cycleType });
    }
  }
  const otherShown = Array.from(otherByCr.values()).sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));

  if (mainTasks.length === 0 && otherShown.length === 0) {
    return <div style={{ ...TEXT.sm, color: C.textMuted, textAlign: 'center', padding: SP[3] }}>אין עדיין משימות בתוכנית העבודה לבודק זה</div>;
  }

  // Segment width/label comes from the task's own effortDays — the same
  // authoritative value the assignment table shows (asg.qaEffort ?? CR's
  // qaEffortDays) — not from re-deriving a day-count out of
  // plannedStart→plannedEnd. That span doesn't necessarily equal the task's
  // own effort (e.g. a queued task's window can be wider than its real
  // effort while it waits its turn), so recomputing from dates could show a
  // bigger number here than the table's real per-CR effort, and the two
  // would silently disagree — found live in production 2026-08-03 (Gantt
  // showed 7+7=14 for two tasks the table listed as 4+7=11).
  const segs = mainTasks.map(t => ({
    crNumber: t.crNumber, crLabel: t.crLabel, isSA: t.srcCycle === 'STAND_ALONE',
    days: Math.round(Math.max(0.5, t.effortDays) * 10) / 10,
  }));
  const totalDays  = Math.round(segs.reduce((s, x) => s + x.days, 0) * 10) / 10;
  const scaleBase  = Math.max(cycle1LengthDays, totalDays, 1);
  const pctOf      = (d: number) => (d / scaleBase) * 100;
  const over       = cycle1LengthDays > 0 && totalDays > cycle1LengthDays;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: SP[3] }}>
      {mainTasks.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', ...TEXT.xs, color: C.textMuted, marginBottom: 4 }}>
            <span style={{ fontWeight: WEIGHT.semibold, color: C.textSecondary }}>סבב 1 + Stand Alone</span>
            <span style={{ color: over ? C.danger : C.textMuted, fontWeight: over ? WEIGHT.bold : WEIGHT.normal }}>
              {totalDays} / {cycle1LengthDays} ימים{over ? ' ⚠ חריגה' : ''}
            </span>
          </div>
          {/* Capacity line — Cycle 1's real length */}
          <div style={{ position: 'relative', height: 8, background: C.bgNested, borderRadius: RADIUS.sm, marginBottom: 4 }}>
            <div style={{ position: 'absolute', top: 0, bottom: 0, right: 0, width: `${pctOf(cycle1LengthDays)}%`, background: C.border, borderRadius: RADIUS.sm }} />
          </div>
          {/* Load line — Cycle 1 + SA tasks, sequential, real durations */}
          <div style={{ display: 'flex', height: 24, borderRadius: RADIUS.sm, overflow: 'hidden', border: `1px solid ${C.border}` }}>
            {segs.map((seg, i) => (
              <div
                key={seg.crNumber + i}
                title={`${seg.crNumber} — ${seg.crLabel ?? seg.crNumber} (${seg.days} ימים)${seg.isSA ? ' — Stand Alone' : ''}`}
                style={{
                  width: `${pctOf(seg.days)}%`, background: TIMELINE_COLORS[i % TIMELINE_COLORS.length],
                  display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
                  borderLeft: i > 0 ? `1px solid ${C.bgCard}` : 'none',
                  backgroundImage: seg.isSA ? 'repeating-linear-gradient(45deg, rgba(255,255,255,0.25), rgba(255,255,255,0.25) 4px, transparent 4px, transparent 8px)' : undefined,
                  position: 'relative',
                }}
              >
                {pctOf(seg.days) > 6 && <span style={{ ...TEXT.xs, color: '#fff', fontWeight: WEIGHT.bold, whiteSpace: 'nowrap' }}>{seg.crNumber}</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {otherShown.length > 0 && (
        <div>
          <div style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.danger, marginBottom: 4 }}>
            ⚠ משימות נוספות שאינן בסבב 1 או ב-Stand Alone
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {otherShown.map(t => (
              <div key={t.crNumber} style={{ ...TEXT.xs, color: C.textSecondary, padding: `4px ${SP[2]}`, background: C.dangerBg, borderRadius: RADIUS.sm }}>
                CR {t.crNumber} — {t.crLabel ?? t.crNumber} · {CYCLE_LABEL[t.cycleType] ?? t.cycleType} · מתחיל {fmtDateIso(t.plannedStart)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function fmtDateIso(iso: string): string {
  return fmtDateShared(iso);
}

// ── CR detail modal field ───────────────────────────────────────────────────────

// CR description/notes come from the source Excel file as raw text and sometimes
// carry literal numeric HTML entities (e.g. "&#10;" for a line break) instead of
// real characters — decode them so the text reads normally instead of showing
// the escape codes. A <textarea> round-trip is the standard safe decode (we only
// ever read .value back, never insert as HTML), so this can't introduce XSS.
function decodeHtmlEntities(text: string | null | undefined): string {
  if (!text) return '';
  const el = document.createElement('textarea');
  el.innerHTML = text;
  return el.value;
}

function DetailField({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>{label}</div>
      <div style={{ ...TEXT.sm, color: value ? C.textPrimary : C.textDisabled }}>{value ?? '—'}</div>
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

// Shared by the cycles picker and the priority/QA-arrival picker — both used
// to be position:absolute inside their <td>, which the table's overflowX:auto
// wrapper implicitly clips vertically (per CSS spec, overflow-x != visible
// forces overflow-y to auto too). Anchoring via getBoundingClientRect + fixed
// positioning (like the score picker below) escapes that clipping entirely.
function computeAnchoredPos(crNumber: string, buttonEl: HTMLElement, width: number): PickerPos {
  const rect = buttonEl.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom - 8;
  const spaceAbove = rect.top - 8;
  const openBelow  = spaceBelow >= spaceAbove;
  const safeRight  = Math.min(window.innerWidth - rect.right, window.innerWidth - width - 8);
  return openBelow
    ? { crNumber, top:    rect.bottom + 4,                   right: safeRight, maxH: Math.max(spaceBelow, 160) }
    : { crNumber, bottom: window.innerHeight - rect.top + 4, right: safeRight, maxH: Math.max(spaceAbove, 160) };
}

export default function QaAssignmentView({ token, initialVersionId }: Props) {
  const dialog  = useDialog();
  const headers   = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const userRole  = useMemo(() => { try { return JSON.parse(atob(token.split('.')[1])).role as string; } catch { return ''; } }, [token]);
  const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);

  const [versions, setVersions]         = useState<Version[]>([]);
  // Approved-season holiday dates (yyyy-mm-dd) — mirrors the backend's
  // Season.isActive gate so cycle-date previews here match what
  // generate-workplan will actually produce.
  const [holidayDays, setHolidayDays]   = useState<Set<string>>(new Set());
  const [holidayLabels, setHolidayLabels] = useState<Map<string, string>>(new Map()); // yyyy-mm-dd → "ראש השנה" etc, for the short in-range note
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
  // Non-archived QaCycleTask ids per CR, from the same work-plan fetch already
  // done in loadVersion (plan.cycles[].tasks) — lets a REMOVED CR's row here
  // archive its work-plan task(s) directly, without needing the workplan tab.
  const [cycleTasksByCr, setCycleTasksByCr] = useState<Map<string, { id: string }[]>>(new Map());
  const [archivingCr, setArchivingCr] = useState<string | null>(null);
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
  const [planExists, setPlanExists]     = useState(false); // does a QaWorkPlan already exist for this version — gates "save" vs. "generate"
  const [planOverflowIssues, setPlanOverflowIssues] = useState<OverflowIssue[]>([]); // real overflow from the generated plan, once one exists
  const [planCycles, setPlanCycles] = useState<PlanCycle[]>([]); // full per-cycle task data, for the per-tester Gantt timeline
  const [savingSettings, setSavingSettings] = useState(false);

  const [openPicker, setOpenPicker]           = useState<PickerPos | null>(null);
  const [pickerMode, setPickerMode]           = useState<'primary' | 'secondary'>('primary');
  const [openCyclesPicker, setOpenCyclesPicker] = useState<PickerPos | null>(null);
  const [openPriorityPicker, setOpenPriorityPicker] = useState<PickerPos | null>(null);
  // Local draft for the priority/QA-arrival popover — fields only reach the
  // server when "שמור" is clicked, instead of saving piecemeal on every
  // keystroke/blur, so it's unambiguous whether what's on screen was saved.
  const [priorityDraft, setPriorityDraft] = useState<{
    priorityTestDate: string; notes: string; urgent: boolean;
    qaArrivalDate: string; qaReceived: boolean; qaReceivedAt: string;
  } | null>(null);
  const [savingPriority, setSavingPriority] = useState(false);
  const [scoring, setScoring]                 = useState<Record<string, ScoringResult>>({});
  const [scoringLoading, setScoringLoading]   = useState<string | null>(null);
  const [saving, setSaving]                   = useState<string | null>(null);
  const [bulkAssigning, setBulkAssigning]     = useState(false);
  const [overloadPanelCollapsed, setOverloadPanelCollapsed] = useState(false);
  const [estimatePanelCollapsed, setEstimatePanelCollapsed] = useState(false);
  const [structuralPanelCollapsed, setStructuralPanelCollapsed] = useState(false);
  const [loadViewCycle, setLoadViewCycle] = useState<LoadViewCycle>('CYCLE_1'); // which cycle the "עומס בודקים" panel currently shows
  const [crDetailFor, setCrDetailFor] = useState<string | null>(null); // crNumber whose detail modal is open
  const [crDetail, setCrDetail]       = useState<CrDetail | null>(null);
  const [crDetailLoading, setCrDetailLoading] = useState(false);
  const [editingEffort, setEditingEffort]     = useState<string | null>(null);  // crNumber being edited
  const [reorderingCr, setReorderingCr]       = useState<string | null>(null);  // crNumber currently being reordered
  const [search, setSearch]                   = useState('');
  const [filterTesterId, setFilterTesterId]   = useState('');
  const [confirmDialog, setConfirmDialog]     = useState<DialogConfig | null>(null);
  const [sortCol, setSortCol]                 = useState<'cr' | 'label' | 'effort' | 'tester' | 'score' | 'order'>('cr');
  const [sortDir, setSortDir]                 = useState<'asc' | 'desc'>('asc');
  const [hiddenCrs, setHiddenCrs]             = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden]           = useState(false);
  const [showArchived, setShowArchived]       = useState(false);
  const pickerRef      = useRef<HTMLDivElement>(null);
  const cyclesPickerRef = useRef<HTMLDivElement>(null);
  const priorityPickerRef = useRef<HTMLDivElement>(null);

  // Column widths as % of table width (sums to 100) — draggable via the resize
  // handle on each header cell. Percentage-based, not px, so the table always
  // fills exactly its container's width and never needs a horizontal
  // scrollbar, regardless of screen size. Index matches the column order below.
  const DEFAULT_COL_WIDTHS = [8, 9, 16, 8, 5, 9, 7, 3, 18, 6, 3, 8];
  const [colWidths, setColWidths] = useState<number[]>(DEFAULT_COL_WIDTHS);
  const resizingCol = useRef<{ index: number; startX: number; startWidth: number; tableWidth: number } | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const startColResize = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const tableWidth = tableRef.current?.clientWidth || 1000;
    resizingCol.current = { index, startX: e.clientX, startWidth: colWidths[index], tableWidth };
    const onMove = (ev: MouseEvent) => {
      if (!resizingCol.current) return;
      // RTL layout: dragging right (positive delta) narrows the column.
      const deltaPct = ((ev.clientX - resizingCol.current.startX) / resizingCol.current.tableWidth) * 100;
      const next = Math.max(3, resizingCol.current.startWidth - deltaPct);
      setColWidths(prev => prev.map((w, i) => i === resizingCol.current!.index ? next : w));
    };
    const onUp = () => {
      resizingCol.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colWidths]);

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

  useEffect(() => {
    if (!token) return;
    axios.get(`${API}/leaves/seasons`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => {
        const keys = new Set<string>();
        const labels = new Map<string, string>();
        (r.data as { forcesOff: boolean; dates: { date: string; label: string }[] }[])
          .filter(s => s.forcesOff)
          .forEach(s => s.dates.forEach(d => {
            const key = new Date(d.date).toISOString().slice(0, 10);
            keys.add(key);
            if (d.label) labels.set(key, d.label);
          }));
        setHolidayDays(keys);
        setHolidayLabels(labels);
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ── Load version data ───────────────────────────────────────────────────────

  const loadVersion = useCallback(async (vId: string) => {
    if (!vId) { setCrs([]); setAssignments([]); setScoring({}); setCrSyncStatuses({}); setSecondTesterSuggestions([]); setPlanExists(false); setPlanOverflowIssues([]); setPlanCycles([]); setCycleTasksByCr(new Map()); return; }
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
        axios.get(`${API}/version-cr-assignments/version/${vId}?includeExempt=true`, { headers }).catch(() => null),
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
      setPlanExists(!!plan?.cycle1Start);
      setPlanOverflowIssues(plan?.overflowIssues ?? []);
      setPlanCycles(plan?.cycles ?? []);
      const taskMap = new Map<string, { id: string }[]>();
      for (const cycle of plan?.cycles ?? []) {
        for (const t of cycle.tasks ?? []) {
          if (!taskMap.has(t.crNumber)) taskMap.set(t.crNumber, []);
          taskMap.get(t.crNumber)!.push({ id: t.id });
        }
      }
      setCycleTasksByCr(taskMap);
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
      if (priorityPickerRef.current && !priorityPickerRef.current.contains(e.target as Node)) { setOpenPriorityPicker(null); setPriorityDraft(null); }
    };
    // Fixed-position popovers don't track their anchor while the page/table
    // scrolls, so close them on scroll rather than let them visually drift.
    const closePicker = (e: Event) => {
      if (!(pickerRef.current && pickerRef.current.contains(e.target as Node))) setOpenPicker(null);
      if (!(cyclesPickerRef.current && cyclesPickerRef.current.contains(e.target as Node))) setOpenCyclesPicker(null);
      if (!(priorityPickerRef.current && priorityPickerRef.current.contains(e.target as Node))) { setOpenPriorityPicker(null); setPriorityDraft(null); }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpenPicker(null); setOpenCyclesPicker(null); setOpenPriorityPicker(null); setPriorityDraft(null); }
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
    // Was a hardcoded 0.5-day floor — silently blocked saving any sub-half-day
    // effort with no feedback, which broke editing once QA_EFFORT_THRESHOLD_DAYS
    // was lowered below 0.5 (e.g. to 0), since such CRs are now legitimately in scope.
    if (isNaN(parsed) || parsed <= 0) return;
    try {
      if (asgId) {
        const res = await axios.patch(`${API}/qa/assignments/${asgId}`, { qaEffort: parsed }, { headers });
        setAssignments(prev => [...prev.filter(a => a.crNumber !== crNumber), res.data]);
        // The server cascades this into the live work plan's task effort/dates
        // (qa.service.ts's cascadeEffortToWorkPlan) when a plan exists — a local
        // patch of `assignments` alone leaves planOverflowIssues/planCycles
        // stale, so the overflow warning panel keeps showing the pre-edit
        // numbers until the page is fully reloaded (reported live 2026-08-02).
        if (planExists && selectedVId) await loadVersion(selectedVId);
      } else {
        await axios.patch(`${API}/version-cr-assignments/cr/${selectedVId}/${crNumber}`, { qaEffortOverride: parsed }, { headers });
        setCrs(prev => prev.map(c => c.crNumber === crNumber ? { ...c, qaEffortDays: parsed } : c));
      }
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בשמירת ימי העבודה', 'שגיאה', 'danger');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, selectedVId, planExists]);

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

  // ── Reorder a tester's queue — feeds buildWorkPlan's manualSortOrder, not
  // just this screen's display order (see qa.scheduler.ts) ───────────────────

  const reorderAssignment = useCallback(async (asg: Assignment, newSortOrder: number) => {
    setReorderingCr(asg.crNumber);
    try {
      const res = await axios.patch(`${API}/qa/assignments/${asg.id}/reorder`, { newSortOrder }, { headers });
      setAssignments(res.data);
    } catch (e) {
      console.error('reorder failed', e);
    } finally {
      setReorderingCr(null);
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

  // ── Patch CR-level classification/priority fields (isCore / urgent / priorityTestDate / notes) ──
  const patchCrRecord = useCallback(async (
    crNumber: string,
    patch: {
      isCore?: boolean; urgent?: boolean; priorityTestDate?: string | null; notes?: string | null;
      qaArrivalDate?: string | null; qaReceived?: boolean; qaReceivedAt?: string | null;
    },
  ) => {
    setCrs(prev => prev.map(c => c.crNumber === crNumber ? { ...c, ...patch } : c));
    try {
      await axios.patch(`${API}/version-cr-assignments/cr/${selectedVId}/${crNumber}`, patch, { headers });
    } catch (e) { console.error('CR record patch failed', e); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, selectedVId]);

  const openCrDetail = useCallback(async (crNumber: string) => {
    setCrDetailFor(crNumber);
    setCrDetail(null);
    setCrDetailLoading(true);
    try {
      const res = await axios.get(`${API}/version-cr-assignments/version/${selectedVId}/cr/${crNumber}/detail`, { headers });
      setCrDetail(res.data);
    } catch {
      setCrDetail(null);
    } finally {
      setCrDetailLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, selectedVId]);

  const savePriorityDraft = useCallback(async (crNumber: string) => {
    if (!priorityDraft) return;
    setSavingPriority(true);
    try {
      await patchCrRecord(crNumber, {
        priorityTestDate: priorityDraft.priorityTestDate || null,
        notes:            priorityDraft.notes || null,
        urgent:           priorityDraft.urgent,
        qaArrivalDate:    priorityDraft.qaArrivalDate || null,
        qaReceived:       priorityDraft.qaReceived,
        qaReceivedAt:     priorityDraft.qaReceived ? (priorityDraft.qaReceivedAt || null) : null,
      });
      setOpenPriorityPicker(null);
      setPriorityDraft(null);
    } finally {
      setSavingPriority(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorityDraft, patchCrRecord]);

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

  // Archives this CR's whole QA footprint in one call — every work-plan task
  // (primary + secondary tester together) AND VersionCrAssignment.isArchived,
  // which is what actually drives row-visibility and tester-load calculations
  // on this screen. The recoverable counterpart to "מחק CR לצמיתות" above:
  // QaAssignment itself is kept as history, not deleted (see restoreCr).
  const archiveCrTasks = (crNumber: string) => {
    if (!selectedVId) return;
    const cr = crs.find(c => c.crNumber === crNumber);
    const label = cr?.crLabel ?? crNumber;
    setConfirmDialog({
      title: 'העברה לארכיון',
      message: `סיבת העברה לארכיון עבור "${label}":`,
      inputLabel: 'סיבה',
      inputPlaceholder: 'לדוגמה: הוסר מהיקף הגרסה',
      variant: 'warning',
      confirmLabel: 'העבר לארכיון',
      cancelLabel: 'ביטול',
      onConfirm: async (reason?: string) => {
        setArchivingCr(crNumber);
        try {
          await axios.patch(`${API}/qa/workplan/cr/${selectedVId}/${crNumber}/archive`, { reason: reason!.trim() }, { headers });
          await loadVersion(selectedVId);
        } catch (e: any) {
          dialog.alert(e?.response?.data?.message ?? 'שגיאה בהעברה לארכיון', 'שגיאה', 'danger');
        } finally {
          setArchivingCr(null);
        }
      },
      onCancel: () => {},
    });
  };

  // Restores a CR archived via archiveCrTasks — reverses both halves
  // (QaCycleTask restore + VersionCrAssignment.isArchived=false) in one call.
  // Named distinctly from restoreCr above (which un-hides a locally-hidden
  // CR — a client-only concept, unrelated to server-side archiving).
  const restoreArchivedCr = (crNumber: string) => {
    if (!selectedVId) return;
    const cr = crs.find(c => c.crNumber === crNumber);
    const label = cr?.crLabel ?? crNumber;
    setConfirmDialog({
      title: 'שחזור מהארכיון',
      message: `לשחזר את "${label}" מהארכיון בחזרה לתצוגה הפעילה?`,
      inputLabel: 'סיבה (אופציונלי)',
      inputPlaceholder: 'לדוגמה: חזר לתכולה',
      variant: 'warning',
      confirmLabel: 'שחזר',
      cancelLabel: 'ביטול',
      onConfirm: async (reason?: string) => {
        setArchivingCr(crNumber);
        try {
          await axios.patch(`${API}/qa/workplan/cr/${selectedVId}/${crNumber}/restore`, { reason: (reason ?? '').trim() || 'שוחזר מהארכיון' }, { headers });
          await loadVersion(selectedVId);
        } catch (e: any) {
          dialog.alert(e?.response?.data?.message ?? 'שגיאה בשחזור מהארכיון', 'שגיאה', 'danger');
        } finally {
          setArchivingCr(null);
        }
      },
      onCancel: () => {},
    });
  };

  // Deletes every QA assignment for this version — the granular counterpart
  // to the old whole-version delete. Doesn't touch the generated work plan
  // (that's a separate action, see QaWorkPlanView) or the CR scope itself.
  const [deletingAssignments, setDeletingAssignments] = useState(false);
  const deleteAllAssignments = () => {
    if (!selectedVId) return;
    setConfirmDialog({
      title: 'מחיקת שיבוץ',
      message: `למחוק את כל שיבוצי הבודקים לגרסה "${versions.find(v => v.id === selectedVId)?.name ?? ''}"?\nתוכנית העבודה (אם קיימת) לא תימחק, אבל תתייחס לשיבוצים שכבר לא קיימים. פעולה זו אינה הפיכה.`,
      confirmLabel: 'מחק שיבוץ',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        setDeletingAssignments(true);
        try {
          await axios.delete(`${API}/qa/assignments?versionId=${selectedVId}`, { headers });
          await loadVersion(selectedVId);
        } catch (e: any) {
          dialog.alert(e?.response?.data?.message ?? 'שגיאה במחיקת השיבוץ', 'שגיאה', 'danger');
        } finally { setDeletingAssignments(false); }
      },
      onCancel: () => {},
    });
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
      setPlanExists(true);
      // The generate call rebuilds the plan server-side, but this component's
      // own planCycles/assignments/planOverflowIssues state was never
      // refetched afterward — so every screen reading from it (the "missing
      // from plan" warning, the real overflow panel, the Gantt) kept showing
      // the plan from BEFORE this rebuild until a full page reload. Found
      // live in production 2026-08-03: "בנה מחדש מאפס" appeared to do
      // nothing because its own result was invisible without this.
      await loadVersion(selectedVId);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה ביצירת תוכנית העבודה', 'שגיאה', 'danger');
    } finally {
      setGenerating(false);
    }
  };

  // ── Save plan settings (dates / cycle lengths) without regenerating ────────
  // Unlike generateWorkPlan, this doesn't delete/rebuild the plan — it only
  // updates the stored dates and lengths. If cycle1Start moved, the backend
  // reflows CYCLE_1 (and cascades CYCLE_2/3/UAT/REHEARSAL/GO_LIVE) in place,
  // keeping any manual reassignments/effort overrides/approval status intact.
  const doSaveWorkPlanSettings = async () => {
    setSavingSettings(true);
    try {
      await axios.patch(
        `${API}/qa/workplan/settings`,
        { versionId: selectedVId, cycle1Start, testingEnd, cycle1LengthDays, cycle2LengthDays, cycle3LengthDays },
        { headers },
      );
      dialog.alert('השינויים נשמרו. שינוי בתאריך ההתחלה עדכן את מועדי הסבבים הקיימים; שינוי באורך סבב בלבד יילקח בחשבון רק ביצירת תוכנית מחדש.', 'נשמר', 'success');
      // Same staleness gap as doGenerateWorkPlan above — a cycle1Start move
      // reflows real task dates server-side, invisible here without a refetch.
      await loadVersion(selectedVId);
    } catch (e: any) {
      dialog.alert(e?.response?.data?.message ?? 'שגיאה בשמירת השינויים', 'שגיאה', 'danger');
    } finally {
      setSavingSettings(false);
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

  // Archived CRs are kept as QaAssignment history (not deleted) but must not
  // count toward tester load/capacity anywhere on this screen — every load
  // calculation below skips them.
  const archivedCrSet = useMemo(
    () => new Set(crs.filter(c => c.isArchived).map(c => c.crNumber)),
    [crs],
  );

  const crByNumber = useMemo(() => new Map(crs.map(c => [c.crNumber, c])), [crs]);

  // tester load: userId → { fullName, totalDays } — Cycle-1-relevant days
  // only. A CR that's Stand-Alone-only (cycles = ['STAND_ALONE']) never runs
  // in Cycle 1 at all, so its effort must not count toward Cycle 1 capacity
  // — same eligibility check as testerLoadForView below, just fixed to
  // CYCLE_1 instead of the view selector (found live 2026-08-02: SA-only CRs
  // were being lumped into the CYCLE_1 overload alert's total, flagging
  // testers whose actual Cycle 1 load was well within capacity).
  const testerLoad = useMemo(() => {
    const map = new Map<string, { fullName: string; totalDays: number }>();
    const bump = (userId: string, fullName: string, days: number) => {
      const cur = map.get(userId) ?? { fullName, totalDays: 0 };
      map.set(userId, { fullName: cur.fullName, totalDays: cur.totalDays + days });
    };
    assignments.forEach(a => {
      if (archivedCrSet.has(a.crNumber)) return;
      const crRec = crByNumber.get(a.crNumber);
      const effSA = a.isStandAlone !== null ? a.isStandAlone : (crRec?.isStandAlone ?? false);
      const cycles = a.cycles?.length > 0 ? a.cycles : (effSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);
      if (!cycles.includes('CYCLE_1')) return;
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
  }, [assignments, effortMap, archivedCrSet, crByNumber]);

  // Per-cycle tester load for the "עומס בודקים" panel below — unlike
  // testerLoad above (raw per-CR effort, fixed to CYCLE_1, used only for the
  // CYCLE_1 overload alert), this scales each CR's effort by
  // CYCLE_EFFORT_RATIO for the currently-selected cycle and only counts CRs
  // that actually participate in it, plus how many CRs ("פיתוחים") that is.
  const testerLoadForView = useMemo(() => {
    const map = new Map<string, { fullName: string; totalDays: number; crCount: number }>();
    const ratio = CYCLE_EFFORT_RATIO[loadViewCycle];
    const bump = (userId: string, fullName: string, days: number) => {
      const cur = map.get(userId) ?? { fullName, totalDays: 0, crCount: 0 };
      map.set(userId, { fullName: cur.fullName, totalDays: cur.totalDays + days, crCount: cur.crCount + 1 });
    };
    assignments.forEach(a => {
      if (archivedCrSet.has(a.crNumber)) return;
      const crRec = crByNumber.get(a.crNumber);
      const effSA = a.isStandAlone !== null ? a.isStandAlone : (crRec?.isStandAlone ?? false);
      const cycles = a.cycles?.length > 0 ? a.cycles : (effSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);
      if (!cycles.includes(loadViewCycle)) return;
      const total = a.qaEffort != null ? a.qaEffort : (effortMap.get(a.crNumber) ?? 0);
      // Whole-day rounding with a 1-day floor — matches qa.scheduler.ts's
      // scheduleSingleCycle/splitEffort exactly, so this preview doesn't show
      // e.g. "1.8 days" for a task that generation will actually create as a
      // full 2-day task (or "0.3 days" for one that gets floored up to 1).
      const scaled = Math.max(1, Math.round(total * ratio));
      if (a.secondaryUser) {
        const pct = a.secondaryParticipationPct ?? 50;
        bump(a.userId, a.user.fullName, Math.max(1, Math.round(scaled * (100 - pct) / 100)));
        bump(a.secondaryTesterId!, a.secondaryUser.fullName, Math.max(1, Math.round(scaled * pct / 100)));
      } else {
        bump(a.userId, a.user.fullName, scaled);
      }
    });
    return map;
  }, [assignments, effortMap, crByNumber, loadViewCycle, archivedCrSet]);

  // Capacity to compare against for the selected view — Stand Alone has no
  // shared length parameter (each CR has its own due date instead), so there's
  // no over-capacity coloring for that view.
  const capacityForView =
    loadViewCycle === 'CYCLE_1' ? cycle1LengthDays :
    loadViewCycle === 'CYCLE_2' ? cycle2LengthDays :
    loadViewCycle === 'CYCLE_3' ? cycle3LengthDays : 0;

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

  // crNumber → that tester's total queue length (for clamping the ▲▼ reorder buttons)
  const testerQueueLengthMap = useMemo(() => {
    const counts = new Map<string, number>();
    assignments.forEach(a => counts.set(a.userId, (counts.get(a.userId) ?? 0) + 1));
    const lengthMap = new Map<string, number>();
    assignments.forEach(a => lengthMap.set(a.crNumber, counts.get(a.userId) ?? 1));
    return lengthMap;
  }, [assignments]);

  const cycleDays     = countWorkDays(cycle1Start, testingEnd, holidayDays);
  const overloadCount = Array.from(testerLoad.values()).filter(l => cycle1LengthDays > 0 && l.totalDays > cycle1LengthDays).length;

  // Live preview of each round's actual start/end date, recomputed whenever the
  // start date or any round length changes — mirrors buildWorkPlan's boundary
  // math exactly so this matches what generate-workplan will actually produce.
  const cycleRanges = useMemo(() => {
    if (!cycle1Start) return null;
    const start      = getFirstWorkDay(new Date(cycle1Start), holidayDays);
    const cycle1End   = addWorkDays(start, Math.max(1, cycle1LengthDays) - 1, holidayDays);
    const cycle2Start = nextWorkDay(cycle1End, holidayDays);
    const cycle2End   = addWorkDays(cycle2Start, Math.max(1, cycle2LengthDays) - 1, holidayDays);
    const cycle3Start = nextWorkDay(cycle2End, holidayDays);
    const cycle3End   = addWorkDays(cycle3Start, Math.max(1, cycle3LengthDays) - 1, holidayDays);
    return {
      cycle1: { start, end: cycle1End },
      cycle2: { start: cycle2Start, end: cycle2End },
      cycle3: { start: cycle3Start, end: cycle3End },
    };
  }, [cycle1Start, cycle1LengthDays, cycle2LengthDays, cycle3LengthDays, holidayDays]);
  const fmtRange = (r: { start: Date; end: Date }) =>
    `${fmtDateShared(r.start)} – ${fmtDateShared(r.end)}`;
  // Short note under a cycle's date range when a real holiday fell inside it
  // and was skipped — e.g. "ראש השנה בטווח" — so the wider-than-expected
  // range isn't mistaken for a miscalculation.
  const holidayNoteFor = (r: { start: Date; end: Date }): string | null => {
    const names = new Set<string>();
    const d = new Date(r.start);
    while (d.getTime() <= r.end.getTime()) {
      const label = holidayLabels.get(dateKeyStr(d));
      if (label) names.add(label);
      d.setDate(d.getDate() + 1);
    }
    return names.size > 0 ? `${Array.from(names).join(', ')} בטווח` : null;
  };

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
      if (archivedCrSet.has(a.crNumber)) return;
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
  }, [testerLoad, cycle1LengthDays, assignments, effortMap, allTestersRoster, archivedCrSet]);

  // Real overflow from the generated plan (qa-workplan.service.ts's
  // computeOverflowIssues — same data the Work Plan screen's matrix uses),
  // grouped by tester. Once a plan exists this replaces the estimate above —
  // the two must never show conflicting numbers for the same person.
  // Live-recomputed CORE_OVERFLOW / CORE_TESTING_END_OVERFLOW — mirrors
  // qa-workplan.service.ts's computeOverflowIssues() exactly for these two
  // checks, computed client-side so it reacts immediately to whatever's in
  // planCycles (itself kept fresh by loadVersion's refetch after every
  // generate/save/toggle/etc.) instead of waiting for a server round-trip.
  //
  // Boundary source: each cycle's OWN real persisted plannedEnd — NOT a
  // theoretical recompute from the current cycle1Start/cycle1-3LengthDays
  // inputs. An earlier version of this used that theoretical boundary (to
  // react to an unsaved length edit before rebuilding), but a cycle's real
  // boundary after any task-level edit (toggle/reassign/effort/delete) is
  // "floating" — whoever's real tasks finish last — which routinely
  // disagrees with the fixed-length arithmetic once anything's been edited
  // since the last full rebuild. That mismatch produced false "overflow"
  // warnings here that the Work Plan screen (reading the same real data
  // directly) correctly did not show — found live in production 2026-08-03,
  // right after disabling tasks in a cycle. Using the real plannedEnd
  // guarantees this panel can never disagree with the server's own
  // computeOverflowIssues for the current saved state.
  const liveCoreIssues = useMemo(() => {
    const perTester = new Map<string, OverflowIssue[]>();
    const structural: OverflowIssue[] = [];

    const boundaries: { cycleType: string; label: string }[] = [
      { cycleType: 'CYCLE_1', label: 'סבב 1' },
      { cycleType: 'CYCLE_2', label: 'סבב 2' },
      { cycleType: 'CYCLE_3', label: 'סבב 3' },
    ];
    const testingEndDate = testingEnd ? new Date(testingEnd) : null;

    for (const { cycleType, label } of boundaries) {
      const cycle = planCycles.find(c => c.cycleType === cycleType);
      if (!cycle) continue;
      const start = new Date(cycle.plannedStart);
      const end = new Date(cycle.plannedEnd);

      const realTasksByTester = new Map<string, PlanTask[]>();
      cycle.tasks.forEach(t => {
        if (t.taskType !== 'CR') return;
        // A disabled task (cycle 2/3 toggle) keeps its last-scheduled dates
        // frozen — the backend skips rescheduling it rather than updating
        // it, since it no longer occupies real time. Counting it here
        // reintroduces exactly the stale commitment toggling it off was
        // meant to remove — same bug just fixed in computeOverflowIssues
        // (qa-workplan.service.ts), mirrored here since this is a parallel
        // client-side recomputation of the same check (2026-08-03).
        if (!t.isActive) return;
        if (!realTasksByTester.has(t.userId)) realTasksByTester.set(t.userId, []);
        realTasksByTester.get(t.userId)!.push(t);
      });

      realTasksByTester.forEach((tasks, userId) => {
        const lastEnd = tasks.reduce((max, t) => {
          const d = new Date(t.plannedEnd);
          return d.getTime() > max.getTime() ? d : max;
        }, new Date(tasks[0].plannedEnd));
        if (lastEnd.getTime() <= end.getTime()) return;

        const daysOver = countWorkDays(nextWorkDay(end, holidayDays).toISOString(), lastEnd.toISOString(), holidayDays);
        const fullName = allTestersRoster.get(userId) ?? userId;
        const biggest = [...tasks].sort((a, b) => b.effortDays - a.effortDays)[0];

        const issue: OverflowIssue = {
          type: 'CORE_OVERFLOW', userName: fullName, userId, cycleType,
          crNumber: biggest?.crNumber, daysOver,
          message: `${fullName} לא מספיק לסיים את ${label} עד ${fmtDateShared(end)} — חורג ב-${daysOver} ימי עבודה. ${biggest ? `CR ${biggest.crNumber} (${biggest.effortDays} ימים) הוא המשמעותי ביותר בעומס שלו.` : ''} הסבב הבא יתחיל במועד הקבוע לכל שאר הצוות; מי שחורג צריך פתרון — ידני, בודק שני, או הארכת הסבב.`,
          suggestions: [],
        };
        if (!perTester.has(userId)) perTester.set(userId, []);
        perTester.get(userId)!.push(issue);
      });

      if (testingEndDate && end.getTime() > testingEndDate.getTime()) {
        const daysOver = countWorkDays(nextWorkDay(testingEndDate, holidayDays).toISOString(), end.toISOString(), holidayDays);
        structural.push({
          type: 'CORE_TESTING_END_OVERFLOW', cycleType, daysOver,
          message: `🚨 ${label} (${fmtDateShared(start)} – ${fmtDateShared(end)}) חורג מתאריך סיום הבדיקות של הגרסה (${fmtDateShared(testingEndDate)}) ב-${daysOver} ימי עבודה — סבבי ליבה אינם אמורים להימשך מעבר לחלון הבדיקות שהוגדר.`,
          suggestions: [],
        });
      }
    }

    return { perTester, structural };
  }, [planCycles, holidayDays, allTestersRoster, testingEnd]);

  const planIssuesByTester = useMemo(() => {
    const map = new Map<string, { fullName: string; issues: OverflowIssue[] }>();
    liveCoreIssues.perTester.forEach((issues, userId) => {
      map.set(userId, { fullName: issues[0]?.userName ?? userId, issues: [...issues] });
    });
    // GO_LIVE_OVERFLOW / SA_* still come from the last-generated snapshot —
    // CORE_OVERFLOW is dropped here since the live version above supersedes it.
    planOverflowIssues.forEach(issue => {
      if (!issue.userId || issue.type === 'CORE_OVERFLOW') return;
      const cur = map.get(issue.userId) ?? { fullName: issue.userName ?? issue.userId, issues: [] };
      cur.issues.push(issue);
      map.set(issue.userId, cur);
    });
    return Array.from(map.entries()).map(([userId, v]) => ({ userId, ...v }));
  }, [planOverflowIssues, liveCoreIssues]);

  // Structural issues that aren't about any one tester (currently just
  // CORE_TESTING_END_OVERFLOW — a whole core cycle's own boundary sits past
  // the version's testing-end date). These have no userId, so they're
  // invisible to planIssuesByTester's per-tester grouping above; surfaced
  // separately here instead of being silently dropped. CORE_TESTING_END_OVERFLOW
  // itself now comes from liveCoreIssues (see above) instead of the snapshot.
  const planStructuralIssues = useMemo(
    () => [...liveCoreIssues.structural, ...planOverflowIssues.filter(i => !i.userId && i.type !== 'CORE_TESTING_END_OVERFLOW')],
    [planOverflowIssues, liveCoreIssues],
  );

  // CRs currently assigned but absent from the generated plan — the plan is
  // a separate persisted snapshot that doesn't update itself when
  // assignments change afterward (reassignment, sync, etc.), so the two can
  // legitimately show different CR sets for the same tester until the plan
  // is regenerated. Same check as QaWorkPlanView.tsx's missingFromPlan.
  const planCrNumbers = useMemo(
    () => new Set(planCycles.flatMap(c => c.tasks.map(t => t.crNumber))),
    [planCycles],
  );
  const missingFromPlan = useMemo(
    () => (planExists ? assignments.filter(a => a.userId && !planCrNumbers.has(a.crNumber)) : []),
    [assignments, planCrNumbers, planExists],
  );
  // buildCrInputs (qa-workplan.service.ts) silently skips any CR whose
  // resolved QA effort isn't a positive number, on every generation — so for
  // those, "missing from plan" isn't a staleness problem a rebuild can fix.
  const missingFromPlanNoEffort = useMemo(
    () => missingFromPlan.filter(a => !((effortMap.get(a.crNumber) ?? 0) > 0)),
    [missingFromPlan, effortMap],
  );
  const missingFromPlanRebuildable = useMemo(
    () => missingFromPlan.filter(a => (effortMap.get(a.crNumber) ?? 0) > 0),
    [missingFromPlan, effortMap],
  );

  // Per-tester precision the general check above can't give: a CR can exist
  // SOMEWHERE in the plan (so it passes missingFromPlan) but be assigned to a
  // DIFFERENT tester there than in the current live assignment — e.g. a CR
  // got reassigned after the plan was generated, without regenerating. That
  // tester's live table row shows the CR; their Gantt (built from the plan)
  // won't, since the plan still has it under the old assignee. This is
  // exactly "the Gantt shows different CR numbers than the table" reported
  // live on 2026-07-30.
  const planCrsByTester = useMemo(() => {
    const map = new Map<string, Set<string>>(); // userId → crNumbers they have a real task for in the plan
    planCycles.forEach(c => c.tasks.forEach(t => {
      if (t.taskType === 'REGRESSION') return;
      if (!map.has(t.userId)) map.set(t.userId, new Set());
      map.get(t.userId)!.add(t.crNumber);
    }));
    return map;
  }, [planCycles]);
  const missingForFilterTester = useMemo(() => {
    if (!planExists || !filterTesterId) return [];
    const theirPlanCrs = planCrsByTester.get(filterTesterId);
    return assignments.filter(a =>
      (a.userId === filterTesterId || a.secondaryTesterId === filterTesterId) &&
      !(theirPlanCrs?.has(a.crNumber)),
    );
  }, [assignments, planCrsByTester, planExists, filterTesterId]);

  const visibleCrs = crs.filter(cr => !hiddenCrs.has(cr.crNumber) && !cr.isArchived && (crSyncStatuses[cr.crNumber] ?? 'ACTIVE') !== 'REMOVED');
  const assigned   = visibleCrs.filter(cr => assignmentMap.has(cr.crNumber)).length;
  const unassigned = visibleCrs.length - assigned;
  const handleSort = (col: typeof sortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };

  const filtered = crs
    .filter(cr =>
      !hiddenCrs.has(cr.crNumber) &&
      !cr.isArchived &&
      (!search ||
        cr.crNumber.includes(search) ||
        (cr.crLabel || '').toLowerCase().includes(search.toLowerCase())) &&
      (!filterTesterId || (() => {
        const asg = assignmentMap.get(cr.crNumber);
        return asg?.userId === filterTesterId || asg?.secondaryTesterId === filterTesterId;
      })()),
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

        {cycleRanges && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>תאריכי סבב 1</span>
            <div style={{ padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'right' }}>
              {fmtRange(cycleRanges.cycle1)}
            </div>
            {holidayNoteFor(cycleRanges.cycle1) && (
              <span style={{ ...TEXT.xs, color: C.textMuted }}>{holidayNoteFor(cycleRanges.cycle1)}</span>
            )}
          </div>
        )}

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

        {cycleRanges && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>תאריכי סבב 2</span>
            <div style={{ padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'right' }}>
              {fmtRange(cycleRanges.cycle2)}
            </div>
            {holidayNoteFor(cycleRanges.cycle2) && (
              <span style={{ ...TEXT.xs, color: C.textMuted }}>{holidayNoteFor(cycleRanges.cycle2)}</span>
            )}
          </div>
        )}

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

        {cycleRanges && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: '0 0 auto' }}>
            <span style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>תאריכי סבב 3</span>
            <div style={{ padding: `${SP[2]} ${SP[3]}`, background: C.bgNested, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, color: C.textSecondary, fontWeight: WEIGHT.semibold, whiteSpace: 'nowrap', direction: 'ltr', textAlign: 'right' }}>
              {fmtRange(cycleRanges.cycle3)}
            </div>
            {holidayNoteFor(cycleRanges.cycle3) && (
              <span style={{ ...TEXT.xs, color: C.textMuted }}>{holidayNoteFor(cycleRanges.cycle3)}</span>
            )}
          </div>
        )}

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
              {fmtDateShared(selectedVersion.plannedStart)}
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
            {planExists && (
              <button
                disabled={savingSettings || !cycle1Start || !testingEnd}
                onClick={doSaveWorkPlanSettings}
                title="שומר תאריכים/אורכי סבב על התוכנית הקיימת — לא מוחק שיבוצים, דריסות מאמץ, או אישור שכבר ניתן"
                style={{
                  padding: `${SP[2]} ${SP[4]}`, background: C.bgNested, color: C.textPrimary,
                  border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold,
                  cursor: (savingSettings || !cycle1Start || !testingEnd) ? 'not-allowed' : 'pointer',
                  opacity: (savingSettings || !cycle1Start || !testingEnd) ? 0.5 : 1,
                  fontFamily: FONT, transition: EASE.fast, whiteSpace: 'nowrap',
                }}
              >
                {savingSettings ? '⏳ שומר...' : '💾 שמור שינויים'}
              </button>
            )}
            <button
              disabled={generating || !cycle1Start || !testingEnd}
              onClick={generateWorkPlan}
              title={planExists ? 'מוחק את התוכנית הקיימת ובונה אותה מחדש מאפס — כולל שיבוצים ידניים ואישור' : undefined}
              style={{
                padding: `${SP[2]} ${SP[4]}`, background: BLUE, color: '#fff',
                border: 'none', borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold,
                cursor: (generating || !cycle1Start || !testingEnd) ? 'not-allowed' : 'pointer',
                opacity: (generating || !cycle1Start || !testingEnd) ? 0.5 : 1,
                fontFamily: FONT, transition: EASE.fast, whiteSpace: 'nowrap',
              }}
            >
              {generating ? '⏳ מחשב...' : planExists ? '🔁 בנה מחדש מאפס' : '📋 צור תוכנית עבודה'}
            </button>
          </div>
        )}
      </div>

      {isManager && assignments.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: SP[3] }}>
          <button
            disabled={deletingAssignments}
            onClick={deleteAllAssignments}
            title="מוחק את כל שיבוצי הבודקים לגרסה זו — לא נוגע בתוכנית העבודה או בתכולת ה-CRים"
            style={{ padding: `4px ${SP[3]}`, background: 'transparent', color: C.danger, border: `1px solid ${C.danger}55`, borderRadius: RADIUS.sm, ...TEXT.xs, cursor: deletingAssignments ? 'not-allowed' : 'pointer', fontFamily: FONT, opacity: deletingAssignments ? 0.6 : 1 }}
          >
            {deletingAssignments ? '⏳ מוחק...' : '🗑 מחק שיבוץ'}
          </button>
        </div>
      )}

      {/* ── Plan out of date — assigned CRs missing from the generated plan ──
           Two distinct causes, previously shown as one indistinguishable
           message that told everyone to "just rebuild" — for a no-effort CR
           that's actively wrong, since buildCrInputs (qa-workplan.service.ts)
           silently skips any CR with no positive QA effort on every single
           generation, so rebuilding can never make it appear (found live in
           production 2026-08-03: CR 13219 stuck in this state). Split so the
           message actually tells the user what will fix it. ── */}
      {missingFromPlan.length > 0 && (
        <div style={{ border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, padding: SP[4], borderRight: `4px solid ${C.warning}`, backgroundColor: C.warningBg, marginBottom: SP[4] }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
            {missingFromPlanRebuildable.length > 0 && (
              <div style={{ display: 'flex', gap: SP[2], alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <strong style={{ color: C.warning, ...TEXT.sm, whiteSpace: 'nowrap' }}>
                  ⚠ תוכנית העבודה לא מעודכנת:
                </strong>
                <span style={{ ...TEXT.sm, color: C.textSecondary }}>
                  {missingFromPlanRebuildable.length} {missingFromPlanRebuildable.length === 1 ? 'CR משובץ' : 'CRים משובצים'} שאינ{missingFromPlanRebuildable.length === 1 ? 'ו' : 'ם'} בתוכנית הקיימת ({missingFromPlanRebuildable.map(a => a.crNumber).join(', ')}) — ציר הזמן ומסך תוכנית העבודה עדיין מציגים את התוכנית הישנה. יש ליצור מחדש (🔁 בנה מחדש מאפס למעלה) כדי לראות נתונים עדכניים.
                </span>
              </div>
            )}
            {missingFromPlanNoEffort.length > 0 && (
              <div style={{ display: 'flex', gap: SP[2], alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <strong style={{ color: C.danger, ...TEXT.sm, whiteSpace: 'nowrap' }}>
                  ⚠ ללא מאמץ QA:
                </strong>
                <span style={{ ...TEXT.sm, color: C.textSecondary }}>
                  {missingFromPlanNoEffort.length} {missingFromPlanNoEffort.length === 1 ? 'CR משובץ' : 'CRים משובצים'} ({missingFromPlanNoEffort.map(a => a.crNumber).join(', ')}) ל{missingFromPlanNoEffort.length === 1 ? 'א' : 'לא'} נכלל{missingFromPlanNoEffort.length === 1 ? '' : 'ים'} בתוכנית — לבנייה מחדש לא תהיה השפעה: אין ל{missingFromPlanNoEffort.length === 1 ? 'ו' : 'הם'} מאמץ QA מוגדר (0 או ריק), ומשימה כזו לא נכנסת לתוכנית עבודה בשום בנייה. יש להגדיר מאמץ QA בטבלה למעלה ואז לבנות מחדש.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Structural alert: a whole core cycle runs past testing-end ──────────
           Not about any one tester — everyone in that cycle is equally affected —
           so it's shown once per affected cycle instead of per person. Core
           cycles are expected to never slip past the version's testing window
           (unlike Stand Alone, which is allowed to and only warns); this is
           surfaced prominently but doesn't block saving/generating the plan. ── */}
      {planExists && planStructuralIssues.length > 0 && (
        <div style={{
          marginBottom: SP[4], borderRadius: RADIUS.lg, border: `2px solid ${C.danger}`,
          background: C.dangerBg, overflow: 'hidden',
        }}>
          <div
            onClick={() => setStructuralPanelCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${SP[3]} ${SP[4]}`, cursor: 'pointer' }}
          >
            <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.danger }}>
              🚨 {planStructuralIssues.length} סבבי ליבה חורגים מתאריך סיום הבדיקות
            </span>
            <span style={{ ...TEXT.sm, color: C.danger }}>{structuralPanelCollapsed ? '▸ הצג' : '▾ הסתר'}</span>
          </div>
          {!structuralPanelCollapsed && (
            <div style={{ padding: `0 ${SP[4]} ${SP[4]}`, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
              {planStructuralIssues.map((issue, i) => (
                <div key={i} style={{ padding: SP[3], background: C.bgCard, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, ...TEXT.sm, color: C.textPrimary }}>
                  {issue.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Overload alert: real plan data once one exists ── */}
      {planExists && planIssuesByTester.length > 0 && (
        <div style={{
          marginBottom: SP[4], borderRadius: RADIUS.lg, border: `1px solid ${C.danger}`,
          background: C.dangerBg, overflow: 'hidden',
        }}>
          <div
            onClick={() => setOverloadPanelCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${SP[3]} ${SP[4]}`, cursor: 'pointer' }}
          >
            <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.danger }}>
              ⚠️ {planIssuesByTester.length} בודקים עם חריגה בתוכנית העבודה בפועל
            </span>
            <span style={{ ...TEXT.sm, color: C.danger }}>{overloadPanelCollapsed ? '▸ הצג' : '▾ הסתר'}</span>
          </div>
          {!overloadPanelCollapsed && (
            <div style={{ padding: `0 ${SP[4]} ${SP[4]}`, display: 'flex', flexDirection: 'column', gap: SP[2] }}>
              {planIssuesByTester.map(t => (
                <div key={t.userId} style={{ padding: SP[3], background: C.bgCard, borderRadius: RADIUS.md, border: `1px solid ${C.border}`, ...TEXT.sm, color: C.textPrimary }}>
                  <b>{t.fullName}</b>
                  {t.issues.map((issue, i) => (
                    <div key={i} style={{ marginTop: SP[1], ...TEXT.xs, color: C.textSecondary }}>⚠ {issue.message}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Overload alert: live estimate against the current (possibly unsaved)
           cycle-1 length / assignment inputs. Shown whether or not a plan exists,
           so cycle-length/reassignment changes get immediate feedback instead of
           requiring a full "בנה מחדש מאפס" round-trip to find out if they helped.
           Kept visually distinct (amber, not red) from the panel above — that one
           reflects what's actually saved; this one is a forecast that only takes
           effect once the plan is (re)built. ── */}
      {overloadIssues.length > 0 && (
        <div style={{
          marginBottom: SP[4], borderRadius: RADIUS.lg, border: `1px solid ${C.warning}`,
          background: C.warningBg, overflow: 'hidden',
        }}>
          <div
            onClick={() => setEstimatePanelCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: `${SP[3]} ${SP[4]}`, cursor: 'pointer' }}
          >
            <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.warning }}>
              ⚠️ {overloadIssues.length} בודקים חורגים מאורך סבב 1 ({cycle1LengthDays} ימי עבודה) — הערכה לפי ההגדרות הנוכחיות{planExists ? ', תיכנס לתוקף רק לאחר בנייה מחדש' : ', לפני יצירת תוכנית עבודה'}
            </span>
            <span style={{ ...TEXT.sm, color: C.warning }}>{estimatePanelCollapsed ? '▸ הצג' : '▾ הסתר'}</span>
          </div>
          {!estimatePanelCollapsed && (
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
              {archivedCrSet.size > 0 && (
                <button
                  onClick={() => setShowArchived(v => !v)}
                  style={{ padding: `2px ${SP[3]}`, background: showArchived ? C.bgNested : C.bgNested, color: showArchived ? C.textPrimary : C.textMuted, border: `1px solid ${showArchived ? C.borderEm : C.border}`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
                >
                  📦 בארכיון ({archivedCrSet.size})
                </button>
              )}
            </div>
            <input
              type="text" placeholder="חיפוש CR / תיאור..."
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ padding: `6px ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontFamily: FONT, background: C.bgNested, color: C.textPrimary, outline: 'none', width: 200 }}
            />
            <select
              value={filterTesterId} onChange={e => setFilterTesterId(e.target.value)}
              style={{ padding: `6px ${SP[3]}`, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontFamily: FONT, background: C.bgNested, color: C.textPrimary, outline: 'none' }}
            >
              <option value="">כל הבודקים</option>
              {Array.from(allTestersRoster.entries())
                .sort((a, b) => a[1].localeCompare(b[1], 'he'))
                .map(([userId, fullName]) => <option key={userId} value={userId}>{fullName}</option>)}
            </select>
          </div>

          {/* Per-tester timeline — only when a specific tester is selected */}
          {filterTesterId && (
            <TesterTimeline
              filterTesterId={filterTesterId}
              testerName={allTestersRoster.get(filterTesterId) ?? ''}
              planExists={planExists}
              planCycles={planCycles}
              assignments={assignments}
              crByNumber={crByNumber}
              effortMap={effortMap}
              cycle1LengthDays={cycle1LengthDays}
              cycle2LengthDays={cycle2LengthDays}
              cycle3LengthDays={cycle3LengthDays}
              holidayDays={holidayDays}
              missingFromPlan={missingForFilterTester}
            />
          )}

          {/* Table */}
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, overflow: 'visible', boxShadow: SHADOW.sm }}>
            <div style={{ overflowX: 'auto' }}>
              <table ref={tableRef} style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  {colWidths.map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}
                </colgroup>
                <thead>
                  <tr style={{ background: C.bgNested }}>
                    {([
                      { key: null,     label: 'פרוייקט' },
                      { key: 'cr',     label: 'CR'    },
                      { key: 'label',  label: 'תיאור' },
                      { key: 'effort', label: 'ימי עבודה' },
                      { key: null,     label: 'סוג'   },
                      { key: null,     label: 'עדיפות' },
                      { key: null,     label: 'סבבים' },
                      { key: 'order',  label: 'סדר'   },
                      { key: 'tester', label: 'בודק'  },
                      { key: null,     label: 'ימי בדיקות (פיצול)' },
                      { key: 'score',  label: 'ציון'  },
                      { key: null,     label: ''      },
                    ] as { key: typeof sortCol | null; label: string }[]).map(({ key, label }, i) => (
                      <th
                        key={label || '__actions'}
                        onClick={key ? () => handleSort(key) : undefined}
                        style={{
                          position: 'relative',
                          padding: `${SP[2]} ${SP[3]}`, textAlign: 'right', ...TEXT.xs,
                          fontWeight: WEIGHT.bold, color: key && sortCol === key ? BLUE : C.textMuted,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                          borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap',
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          cursor: key ? 'pointer' : 'default',
                          userSelect: 'none',
                        }}
                      >
                        {label}
                        {key && sortCol === key && (
                          <span style={{ marginRight: 4, fontSize: 10 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>
                        )}
                        <span
                          title="גרור כדי לשנות רוחב עמודה"
                          onMouseDown={e => startColResize(i, e)}
                          onClick={e => e.stopPropagation()}
                          style={{ position: 'absolute', top: 0, bottom: 0, left: -3, width: 6, cursor: 'col-resize', zIndex: 1 }}
                        />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((cr, i) => {
                    const asg        = assignmentMap.get(cr.crNumber);
                    const isSaving   = saving === cr.crNumber;
                    const isOpenCyc  = openCyclesPicker?.crNumber === cr.crNumber;
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
                        <td style={{ padding: `${SP[2]} ${SP[3]}` }}>
                          {cr.project
                            ? <span style={{ ...TEXT.xs, color: C.textSecondary, whiteSpace: 'normal', wordBreak: 'break-word', display: 'block' }} title={cr.project}>{cr.project}</span>
                            : <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>}
                        </td>

                        {/* CR number */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap' }}>
                          <span
                            onClick={() => openCrDetail(cr.crNumber)}
                            title="לחץ לפרטי ה-CR"
                            style={{ background: BLUE_BG, color: BLUE, padding: `2px ${SP[2]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold, cursor: 'pointer', textDecoration: 'underline dotted' }}
                          >
                            {cr.crNumber}
                          </span>
                        </td>

                        {/* Label */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, maxWidth: 220 }}>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                            <div style={{ ...TEXT.sm, color: syncStatus === 'REMOVED' ? C.textMuted : C.textPrimary, whiteSpace: 'normal', wordBreak: 'break-word', textDecoration: syncStatus === 'REMOVED' ? 'line-through' : 'none' }} title={cr.crLabel ?? ''}>
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

                        {/* QA Effort — always editable; original CR_LIST value kept visible when overridden */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, whiteSpace: 'nowrap', textAlign: 'center' }}>
                          {(() => {
                            const wasOverridden = asg?.qaEffort != null && cr.qaEffortDays != null && asg.qaEffort !== cr.qaEffortDays;
                            return isEditingEff ? (
                              <input
                                autoFocus
                                type="number" min="0.1" step="0.1"
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
                                title={wasOverridden ? `לחץ לעריכה — ערך מקורי מ-CR_LIST: ${cr.qaEffortDays}י'` : 'לחץ לעריכה'}
                                onClick={() => setEditingEffort(cr.crNumber)}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', cursor: 'pointer', userSelect: 'none' }}
                              >
                                <span style={{ background: BLUE_BG, color: BLUE, padding: `2px 8px`, borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.bold }}>
                                  {effortDays != null ? `${effortDays}י'` : '—'}
                                </span>
                                {wasOverridden && (
                                  <span style={{ ...TEXT.xs, color: C.textDisabled, textDecoration: 'line-through' }}>
                                    {cr.qaEffortDays}י'
                                  </span>
                                )}
                              </span>
                            );
                          })()}
                        </td>

                        {/* סוג: integrative / SA toggle + ליבה (core) toggle — always interactive */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}` }}>
                          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
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
                            <button
                              title={cr.isCore ? 'לחץ להסיר סימון ליבה' : 'לחץ לסמן כליבה'}
                              onClick={() => patchCrRecord(cr.crNumber, { isCore: !cr.isCore })}
                              style={{
                                padding: '2px 8px',
                                background: cr.isCore ? 'rgba(220,38,38,0.10)' : C.bgNested,
                                color:      cr.isCore ? '#dc2626'              : C.textMuted,
                                border:     `1px solid ${cr.isCore ? '#dc262644' : C.border}`,
                                borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold,
                                cursor: 'pointer', fontFamily: FONT, transition: EASE.fast,
                              }}
                            >
                              ליבה
                            </button>
                          </div>
                        </td>

                        {/* עדיפות: urgent flag + go-live date + QA-arrival tracking + notes — popover */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, position: 'relative', whiteSpace: 'nowrap' }}>
                          {(() => {
                            const qaOverdue = !!cr.qaArrivalDate && !cr.qaReceived && new Date(cr.qaArrivalDate) < new Date();
                            const tooltipParts: string[] = [];
                            if (cr.urgent) tooltipParts.push('דחוף');
                            if (cr.priorityTestDate) tooltipParts.push(`תאריך עליה לאוויר: ${fmtDateShared(cr.priorityTestDate)}`);
                            if (cr.qaArrivalDate) tooltipParts.push(`הגעה ל-QA: ${fmtDateShared(cr.qaArrivalDate)}${cr.qaReceived ? ' ✓ התקבל' : qaOverdue ? ' ⚠ טרם התקבל' : ''}`);
                            if (cr.notes) tooltipParts.push(`הערה: ${cr.notes}`);
                            const title = tooltipParts.length > 0 ? `${tooltipParts.join(' | ')} — לחץ לפרטים` : 'עדיפות בדיקה / דחיפות / הערות / הגעה ל-QA';

                            return (
                              <button
                                title={title}
                                onClick={e => {
                                  if (openPriorityPicker?.crNumber === cr.crNumber) {
                                    setOpenPriorityPicker(null);
                                    setPriorityDraft(null);
                                  } else {
                                    setOpenPriorityPicker(computeAnchoredPos(cr.crNumber, e.currentTarget, 640));
                                    setPriorityDraft({
                                      priorityTestDate: cr.priorityTestDate ? cr.priorityTestDate.slice(0, 10) : '',
                                      notes: cr.notes ?? '',
                                      urgent: cr.urgent,
                                      qaArrivalDate: cr.qaArrivalDate ? cr.qaArrivalDate.slice(0, 10) : '',
                                      qaReceived: cr.qaReceived,
                                      qaReceivedAt: cr.qaReceivedAt ? cr.qaReceivedAt.slice(0, 10) : '',
                                    });
                                  }
                                }}
                                style={{
                                  padding: '2px 8px',
                                  background: cr.urgent ? C.dangerBg : qaOverdue ? C.dangerBg : cr.priorityTestDate ? '#fff7e6' : cr.notes ? C.bgNested : 'transparent',
                                  color:      cr.urgent ? C.danger   : qaOverdue ? C.danger   : cr.priorityTestDate ? '#b76b00' : C.textMuted,
                                  border:     `1px solid ${cr.urgent ? C.danger + '44' : qaOverdue ? C.danger + '44' : cr.priorityTestDate ? '#b76b0044' : C.border}`,
                                  borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold,
                                  cursor: 'pointer', fontFamily: FONT, transition: EASE.fast,
                                }}
                              >
                                {/* Closed state stays a compact glyph — full detail only on click, in the popover below */}
                                {cr.urgent ? '🔴 דחוף' : cr.priorityTestDate ? '📅' : cr.notes ? '📝' : '—'}
                                {qaOverdue && ' 📥'}
                              </button>
                            );
                          })()}
                        </td>

                        {/* סבבים: cycles multiselect */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, position: 'relative', whiteSpace: 'nowrap' }}>
                          {asg ? (
                            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', cursor: 'pointer' }}
                              onClick={e => {
                                setOpenPicker(p => p?.crNumber === cr.crNumber ? null : p);
                                setOpenCyclesPicker(isOpenCyc ? null : computeAnchoredPos(cr.crNumber, e.currentTarget, 210));
                              }}
                            >
                              {effectiveCycles.map(ct => <CycleChip key={ct} cycleType={ct} />)}
                            </div>
                          ) : (
                            <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', opacity: 0.45 }}>
                              {(cr.isStandAlone ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']).map(ct => <CycleChip key={ct} cycleType={ct} />)}
                            </div>
                          )}
                        </td>

                        {/* סדר: queue position per tester — also feeds buildWorkPlan's manualSortOrder */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}`, textAlign: 'center', whiteSpace: 'nowrap' }}>
                          {orderNum != null && asg ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                              <span style={{ background: C.bgNested, border: `1px solid ${C.border}`, color: C.textSecondary, padding: '2px 7px', borderRadius: RADIUS.full, ...TEXT.xs, fontWeight: WEIGHT.bold }}>
                                {orderNum}
                              </span>
                              {reorderingCr === cr.crNumber ? (
                                <span style={{ ...TEXT.xs, color: C.textMuted }}>⟳</span>
                              ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                                  <button
                                    title="הזז למעלה בתור הבודק"
                                    disabled={orderNum === 1}
                                    onClick={() => reorderAssignment(asg, orderNum - 1)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', lineHeight: 1, fontSize: 9, color: C.textMuted, opacity: orderNum === 1 ? 0.2 : 0.6 }}
                                  >▲</button>
                                  <button
                                    title="הזז למטה בתור הבודק"
                                    disabled={orderNum === testerQueueLengthMap.get(cr.crNumber)}
                                    onClick={() => reorderAssignment(asg, orderNum + 1)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 1px', lineHeight: 1, fontSize: 9, color: C.textMuted, opacity: orderNum === testerQueueLengthMap.get(cr.crNumber) ? 0.2 : 0.6 }}
                                  >▼</button>
                                </div>
                              )}
                            </div>
                          ) : (
                            <span style={{ ...TEXT.xs, color: C.textDisabled }}>—</span>
                          )}
                        </td>

                        {/* Assigned tester */}
                        <td style={{ padding: `${SP[2]} ${SP[3]}` }}>
                          {asg ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: SP[1], flexWrap: 'wrap' }}>
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: SP[1], flexWrap: 'wrap' }}>
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
                        <td style={{ padding: `${SP[2]} ${SP[3]}` }}>
                          <div style={{ display: 'flex', gap: SP[1], alignItems: 'center', flexWrap: 'wrap' }}>
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
                                disabled={archivingCr === cr.crNumber}
                                title="העבר את ה-CR הזה לארכיון — יוסתר מהתצוגה הפעילה ולא ייספר בעומס הבודקים, ניתן לשחזור"
                                onClick={() => archiveCrTasks(cr.crNumber)}
                                style={{ padding: '5px 7px', background: C.bgNested, color: C.textSecondary, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.xs, cursor: archivingCr === cr.crNumber ? 'not-allowed' : 'pointer', fontFamily: FONT, lineHeight: 1, fontWeight: WEIGHT.semibold, opacity: archivingCr === cr.crNumber ? 0.5 : 1 }}
                              >📦 ארכיון</button>
                            )}
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

          {showArchived && archivedCrSet.size > 0 && (
            <div style={{ marginTop: SP[3], background: C.bgHover, border: `1px solid ${C.borderEm}`, borderRadius: RADIUS.lg, padding: SP[3] }}>
              <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textPrimary, marginBottom: SP[2] }}>
                📦 CRים בארכיון — {archivedCrSet.size}, מוסתרים מהתצוגה הפעילה ולא נספרים בעומס הבודקים
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: SP[2] }}>
                {crs.filter(cr => cr.isArchived).map(cr => (
                  <div key={cr.crNumber} style={{ display: 'flex', alignItems: 'center', gap: SP[1], background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, padding: `4px ${SP[2]}` }}>
                    <span style={{ background: BLUE_BG, color: BLUE, padding: `1px ${SP[1]}`, borderRadius: RADIUS.sm, ...TEXT.xs, fontWeight: WEIGHT.bold }}>{cr.crNumber}</span>
                    {cr.crLabel && <span style={{ ...TEXT.xs, color: C.textSecondary, maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={cr.archivedReason ?? ''}>{cr.crLabel.replace(/^\d+\s*-\s*/, '')}</span>}
                    <button
                      disabled={archivingCr === cr.crNumber}
                      onClick={() => restoreArchivedCr(cr.crNumber)}
                      title="שחזר מהארכיון לתצוגה הפעילה"
                      style={{ padding: '2px 6px', background: 'transparent', color: C.brand, border: `1px solid ${C.brand}`, borderRadius: RADIUS.sm, ...TEXT.xs, cursor: archivingCr === cr.crNumber ? 'not-allowed' : 'pointer', fontFamily: FONT, fontWeight: WEIGHT.semibold, opacity: archivingCr === cr.crNumber ? 0.5 : 1 }}
                    >♻ שחזר</button>
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

          {/* Cycles picker — fixed-position, mirrors the score picker above */}
          {openCyclesPicker && (() => {
            const cr  = crs.find(c => c.crNumber === openCyclesPicker.crNumber);
            const asg = cr ? assignmentMap.get(cr.crNumber) : undefined;
            if (!cr || !asg) return null;
            const effectiveSA = asg.isStandAlone !== null ? asg.isStandAlone : cr.isStandAlone;
            const effectiveCycles = asg.cycles?.length > 0 ? asg.cycles : (effectiveSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);
            return (
              <div
                ref={cyclesPickerRef}
                style={{
                  position: 'fixed',
                  ...(openCyclesPicker.top    !== undefined ? { top:    openCyclesPicker.top    } : {}),
                  ...(openCyclesPicker.bottom !== undefined ? { bottom: openCyclesPicker.bottom } : {}),
                  right: openCyclesPicker.right,
                  background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.lg,
                  width: 210, maxHeight: openCyclesPicker.maxH ?? 400, overflowY: 'auto',
                  zIndex: 1000, padding: SP[2],
                }}
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
            );
          })()}

          {/* Priority / go-live / QA-arrival picker — fixed-position, mirrors the score picker above */}
          {openPriorityPicker && priorityDraft && (() => {
            const cr = crs.find(c => c.crNumber === openPriorityPicker.crNumber);
            if (!cr) return null;
            return (
              <div
                ref={priorityPickerRef}
                style={{
                  position: 'fixed',
                  ...(openPriorityPicker.top    !== undefined ? { top:    openPriorityPicker.top    } : {}),
                  ...(openPriorityPicker.bottom !== undefined ? { bottom: openPriorityPicker.bottom } : {}),
                  right: openPriorityPicker.right,
                  background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.lg,
                  width: 640, maxHeight: openPriorityPicker.maxH ?? 600, overflowY: 'auto',
                  zIndex: 1000, padding: SP[4], display: 'flex', flexDirection: 'column', gap: SP[3],
                }}
                onClick={e => e.stopPropagation()}
              >
                <label style={{ display: 'flex', alignItems: 'center', gap: SP[2], cursor: 'pointer', ...TEXT.sm, color: C.textPrimary }}>
                  <input
                    type="checkbox"
                    checked={priorityDraft.urgent}
                    onChange={e => setPriorityDraft(d => d && { ...d, urgent: e.target.checked })}
                  />
                  🔴 דחוף — תזכורת להמשך טיפול
                </label>

                <div>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '4px' }}>🚀 תאריך עליה לאוויר</div>
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '6px' }}>
                    עולה לייצור לפני הגרסה / מחוץ למסגרתה — יש לבדוק ראשון
                  </div>
                  <input
                    type="date"
                    value={priorityDraft.priorityTestDate}
                    onChange={e => setPriorityDraft(d => d && { ...d, priorityTestDate: e.target.value })}
                    style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT, boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: SP[3] }}>
                  <div style={{ ...TEXT.sm, fontWeight: WEIGHT.semibold, color: C.textPrimary, marginBottom: '6px' }}>📥 הגעה ל-QA</div>
                  <div style={{ display: 'flex', gap: SP[3], flexWrap: 'wrap', alignItems: 'flex-end' }}>
                    <div style={{ flex: '1 1 180px' }}>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>תאריך הגעה צפוי</div>
                      <input
                        type="date"
                        value={priorityDraft.qaArrivalDate}
                        onChange={e => setPriorityDraft(d => d && { ...d, qaArrivalDate: e.target.value })}
                        style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT, boxSizing: 'border-box' }}
                      />
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: SP[2], cursor: 'pointer', ...TEXT.sm, color: C.textPrimary, flex: '0 0 auto', paddingBottom: '6px' }}>
                      <input
                        type="checkbox"
                        checked={priorityDraft.qaReceived}
                        onChange={e => setPriorityDraft(d => d && {
                          ...d, qaReceived: e.target.checked,
                          qaReceivedAt: e.target.checked && !d.qaReceivedAt ? new Date().toISOString().slice(0, 10) : d.qaReceivedAt,
                        })}
                      />
                      ✓ התקבל
                    </label>
                    {priorityDraft.qaReceived && (
                      <div style={{ flex: '1 1 180px' }}>
                        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>תאריך קבלה בפועל</div>
                        <input
                          type="date"
                          value={priorityDraft.qaReceivedAt}
                          onChange={e => setPriorityDraft(d => d && { ...d, qaReceivedAt: e.target.value })}
                          style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT, boxSizing: 'border-box' }}
                        />
                        {priorityDraft.qaArrivalDate && priorityDraft.qaReceivedAt > priorityDraft.qaArrivalDate && (
                          <div style={{ ...TEXT.xs, color: C.danger, marginTop: '4px' }}>⚠ התקבל באיחור</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div>
                  <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>הערות</div>
                  <textarea
                    value={priorityDraft.notes}
                    onChange={e => setPriorityDraft(d => d && { ...d, notes: e.target.value })}
                    rows={2}
                    style={{ width: '100%', padding: '5px 8px', border: `1px solid ${C.border}`, borderRadius: RADIUS.sm, ...TEXT.sm, fontFamily: FONT, resize: 'vertical', boxSizing: 'border-box' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: SP[2], justifyContent: 'flex-start', borderTop: `1px solid ${C.border}`, paddingTop: SP[3] }}>
                  <button
                    disabled={savingPriority}
                    onClick={() => savePriorityDraft(cr.crNumber)}
                    style={{ padding: `6px ${SP[4]}`, background: BLUE, color: '#fff', border: 'none', borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: savingPriority ? 'not-allowed' : 'pointer', opacity: savingPriority ? 0.6 : 1, fontFamily: FONT }}
                  >
                    {savingPriority ? '⏳ שומר...' : '💾 שמור'}
                  </button>
                  <button
                    onClick={() => { setOpenPriorityPicker(null); setPriorityDraft(null); }}
                    style={{ padding: `6px ${SP[4]}`, background: 'transparent', color: C.textMuted, border: `1px solid ${C.border}`, borderRadius: RADIUS.md, ...TEXT.sm, fontWeight: WEIGHT.semibold, cursor: 'pointer', fontFamily: FONT }}
                  >
                    ביטול
                  </button>
                </div>
              </div>
            );
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

          {/* Tester load panel — switchable per-cycle view */}
          {testerLoad.size > 0 && (
            <div style={{ marginTop: SP[3], background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.lg, boxShadow: SHADOW.sm, overflow: 'hidden' }}>
              <div style={{ padding: `${SP[2]} ${SP[4]}`, background: C.bgNested, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', gap: SP[3], flexWrap: 'wrap' }}>
                <span style={{ ...TEXT.sm, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📊 עומס בודקים</span>

                {/* Cycle view selector */}
                <div style={{ display: 'flex', gap: '4px', background: C.bgCard, padding: '3px', borderRadius: RADIUS.md, border: `1px solid ${C.border}` }}>
                  {LOAD_VIEW_CYCLES.map(ct => {
                    const info = CYCLE_INFO[ct];
                    const active = loadViewCycle === ct;
                    return (
                      <button key={ct} onClick={() => setLoadViewCycle(ct)}
                        style={{
                          padding: '4px 10px', borderRadius: RADIUS.sm, border: 'none', cursor: 'pointer',
                          background: active ? info.bg : 'transparent',
                          color: active ? info.color : C.textMuted,
                          ...TEXT.xs, fontWeight: active ? WEIGHT.bold : WEIGHT.normal, fontFamily: FONT, transition: EASE.fast,
                        }}>
                        {info.fullLabel}
                      </button>
                    );
                  })}
                </div>

                {capacityForView > 0 && (
                  <span style={{ ...TEXT.xs, color: C.textMuted }}>קיבולת: {capacityForView} ימי עבודה לבודק (אורך {CYCLE_INFO[loadViewCycle].fullLabel})</span>
                )}
                {loadViewCycle === 'CYCLE_1' && overloadCount > 0 && (
                  <span style={{ ...TEXT.xs, background: C.dangerBg, color: C.danger, padding: `2px ${SP[2]}`, borderRadius: RADIUS.full, fontWeight: WEIGHT.semibold, border: `1px solid ${C.danger}33` }}>
                    ⚠ {overloadCount} חורג{overloadCount > 1 ? 'ים' : ''}
                  </span>
                )}
              </div>
              <div style={{ padding: SP[3], display: 'flex', flexWrap: 'wrap', gap: SP[2] }}>
                {testerLoadForView.size === 0 && (
                  <div style={{ ...TEXT.sm, color: C.textMuted, padding: SP[2] }}>אין CR-ים בסבב זה</div>
                )}
                {Array.from(testerLoadForView.entries())
                  .sort((a, b) => b[1].totalDays - a[1].totalDays)
                  .map(([userId, { fullName, totalDays, crCount }]) => {
                    const over = capacityForView > 0 && totalDays > capacityForView;
                    return (
                      <div key={userId} style={{ padding: `${SP[2]} ${SP[3]}`, borderRadius: RADIUS.md, background: over ? C.dangerBg : C.bgNested, border: `1px solid ${over ? C.danger + '44' : C.border}`, minWidth: 200, flex: '1 1 200px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '5px' }}>
                          <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: over ? C.danger : C.textPrimary }}>
                            {over && '⚠ '}{fullName}
                          </span>
                          {over && (
                            <span style={{ ...TEXT.xs, background: C.dangerBg, color: C.danger, padding: `1px 6px`, borderRadius: RADIUS.full, fontWeight: WEIGHT.bold, border: `1px solid ${C.danger}33` }}>
                              +{(totalDays - capacityForView).toFixed(1)}י'
                            </span>
                          )}
                        </div>
                        <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '5px' }}>
                          {crCount} פיתוח{crCount !== 1 ? 'ים' : ''}
                        </div>
                        <LoadBar used={totalDays} capacity={capacityForView || totalDays} />
                      </div>
                    );
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      </>}

      {/* ── CR detail modal ── */}
      {crDetailFor && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: SP[4] }}
          onClick={() => { setCrDetailFor(null); setCrDetail(null); }}>
          <div style={{ background: C.bgCard, border: `1px solid ${C.border}`, borderRadius: RADIUS.xl, boxShadow: SHADOW.xl, width: '100%', maxWidth: 1010, maxHeight: '85vh', display: 'flex', flexDirection: 'column', direction: 'rtl' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ padding: `${SP[4]} ${SP[5]}`, borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: SP[3] }}>
                <span style={{ ...TEXT.lg, fontWeight: WEIGHT.bold, color: C.textPrimary }}>📄 פרטי CR {crDetailFor}</span>
                {crDetail?.versionName && (
                  <span style={{ ...TEXT.xs, fontWeight: WEIGHT.semibold, color: C.brand, background: C.brandDim, padding: `2px ${SP[3]}`, borderRadius: RADIUS.full }}>
                    {crDetail.versionName}
                  </span>
                )}
              </div>
              <button onClick={() => { setCrDetailFor(null); setCrDetail(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, fontSize: 18, fontFamily: FONT }}>✕</button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: SP[5], display: 'flex', flexDirection: 'column', gap: SP[4] }}>
              {crDetailLoading ? (
                <div style={{ textAlign: 'center', padding: SP[6], color: C.textMuted, ...TEXT.sm }}>⏳ טוען...</div>
              ) : !crDetail ? (
                <div style={{ textAlign: 'center', padding: SP[6], color: C.textMuted, ...TEXT.sm }}>שגיאה בטעינת פרטי ה-CR</div>
              ) : (
                <>
                  <div>
                    <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>כותרת</div>
                    <div style={{ ...TEXT.md, color: C.textPrimary, fontWeight: WEIGHT.semibold }}>{crDetail.crLabel}</div>
                  </div>
                  {crDetail.crDescription && (
                    <div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>תיאור</div>
                      <div style={{ ...TEXT.sm, color: C.textSecondary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{decodeHtmlEntities(crDetail.crDescription)}</div>
                    </div>
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: SP[4], padding: SP[4], background: C.bgNested, borderRadius: RADIUS.lg }}>
                    <DetailField label="מנהל CR" value={crDetail.crManager} />
                    <DetailField label="מאפיין" value={crDetail.application} />
                    <DetailField label="סך כל הערכות" value={crDetail.estimateDays != null ? `${crDetail.estimateDays} ימים` : null} />
                    <DetailField label="סטטוס" value={crDetail.status} />
                    <DetailField label="צוותים מעורבים" value={crDetail.teams.length > 0 ? crDetail.teams.join(', ') : null} />
                  </div>
                  {crDetail.notes && (
                    <div>
                      <div style={{ ...TEXT.xs, color: C.textMuted, marginBottom: '4px' }}>הערות</div>
                      <div style={{ ...TEXT.sm, color: C.textSecondary, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{decodeHtmlEntities(crDetail.notes)}</div>
                    </div>
                  )}
                  {crDetail.archiveHistory.length > 0 && (
                    <div>
                      <div style={{ ...TEXT.xs, fontWeight: WEIGHT.bold, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: SP[2] }}>
                        📦 היסטוריית ארכיון
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: SP[2] }}>
                        {crDetail.archiveHistory.map(entry => (
                          <div key={entry.id} style={{ background: C.bgNested, borderRadius: RADIUS.md, padding: `${SP[2]} ${SP[3]}`, ...TEXT.sm }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: SP[2] }}>
                              <span style={{ fontWeight: WEIGHT.medium, color: entry.action === 'TASK_ARCHIVED' ? C.danger : C.success }}>
                                {entry.action === 'TASK_ARCHIVED' ? '📦 הועבר לארכיון' : '↺ שוחזר מהארכיון'}
                                {entry.cycleType ? ` — ${CYCLE_LABEL[entry.cycleType] ?? entry.cycleType}` : ''}
                              </span>
                              <span style={{ ...TEXT.xs, color: C.textMuted, whiteSpace: 'nowrap' }}>
                                {fmtDateTimeShared(entry.createdAt)}
                              </span>
                            </div>
                            {entry.reason && (
                              <div style={{ ...TEXT.xs, color: C.textSecondary, marginTop: 2 }}>סיבה: {entry.reason}</div>
                            )}
                            {entry.userEmail && (
                              <div style={{ ...TEXT.xs, color: C.textMuted, marginTop: 2 }}>ע"י {entry.userEmail}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
