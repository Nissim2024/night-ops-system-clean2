/**
 * QA Work Plan Scheduler
 * Israeli work week: Sunday (0) – Thursday (4) = work days
 *                   Friday (5) + Saturday (6)  = off
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type CycleType =
  | 'CYCLE_1' | 'CYCLE_2' | 'CYCLE_3'
  | 'STAND_ALONE' | 'UAT' | 'REHEARSAL' | 'GO_LIVE';

export const CYCLE_EFFORT_RATIO: Partial<Record<CycleType, number>> = {
  CYCLE_1:     1.0,
  CYCLE_2:     0.5,
  CYCLE_3:     0.30,
  STAND_ALONE: 1.0,
};

export const CYCLE_LABEL: Record<CycleType, string> = {
  CYCLE_1:     'סבב 1',
  CYCLE_2:     'סבב 2',
  CYCLE_3:     'סבב 3',
  STAND_ALONE: 'Stand Alone',
  UAT:         'UAT',
  REHEARSAL:   'חזרה גנרלית',
  GO_LIVE:     'עליה לאוויר',
};

export interface CrInput {
  crNumber:            string;
  crLabel:             string;
  qaEffortDays:        number;   // effective effort in days
  cycles:              string[]; // which cycle types this CR appears in
  primaryTesterId:     string | null;
  secondaryTesterId:   string | null;
  primarySkillLevel:   number;   // kept for callers/reporting; no longer used for effort split
  secondarySkillLevel: number;
  // % of total effort the secondary tester carries; primary gets the rest.
  // Defaults to 50 (even split) when a secondary tester is set but no % given.
  secondaryParticipationPct?: number | null;
  // Optional early deadline for a Stand Alone CR — pulls it ahead of a
  // tester's other SA work (SA is otherwise allowed to run past testingEnd).
  standAloneDueDate?:  Date | null;
}

export interface PlannedTask {
  crNumber:     string;
  crLabel:      string;
  taskType:     'CR' | 'STAND_ALONE' | 'REGRESSION';
  userId:       string;
  effortDays:   number;
  plannedStart: Date;
  plannedEnd:   Date;
  sortOrder:    number;
  isPrimary:    boolean;
  // Stand Alone tasks only — present when the CR had a standAloneDueDate.
  dueDate?:        Date | null;
  missedDueDate?:  boolean;
}

export interface PlannedCycle {
  cycleType:    CycleType;
  plannedStart: Date;
  plannedEnd:   Date;
  tasks:        PlannedTask[];
}

// ── Work-day helpers ──────────────────────────────────────────────────────────
// All accept an optional per-tester `leaveDays` set (yyyy-mm-dd keys, see
// `dateKey`) so a specific tester's approved leave is skipped like a weekend
// when computing THEIR OWN task dates — without affecting any other caller
// that doesn't pass one (weekend-only behavior stays the default everywhere).

export function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Split a CR's effort between primary/secondary tester by the secondary's participation % (defaults to an even 50/50). */
export function splitEffort(totalDays: number, secondaryPct?: number | null): { primary: number; secondary: number } {
  const pct = secondaryPct ?? 50;
  return {
    primary:   Math.max(1, Math.round(totalDays * (100 - pct) / 100)),
    secondary: Math.max(1, Math.round(totalDays * pct / 100)),
  };
}

export function isWorkDay(d: Date, leaveDays?: Set<string>): boolean {
  const dow = d.getDay();
  if (dow === 5 || dow === 6) return false;
  if (leaveDays && leaveDays.has(dateKey(d))) return false;
  return true;
}

export function getFirstWorkDay(date: Date, leaveDays?: Set<string>): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  while (!isWorkDay(d, leaveDays)) d.setDate(d.getDate() + 1);
  return d;
}

export function nextWorkDay(date: Date, leaveDays?: Set<string>): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (!isWorkDay(d, leaveDays)) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Advance date by N work days. 0 = same day.
 * addWorkDays(Mon, 2) = Wed (Mon→Tue→Wed)
 */
export function addWorkDays(date: Date, days: number, leaveDays?: Set<string>): Date {
  if (days <= 0) return new Date(date);
  const d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkDay(d, leaveDays)) remaining--;
  }
  return d;
}

/** Step backward N work days. 0 = same day. */
export function subtractWorkDays(date: Date, days: number, leaveDays?: Set<string>): Date {
  if (days <= 0) return new Date(date);
  const d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() - 1);
    if (isWorkDay(d, leaveDays)) remaining--;
  }
  return d;
}

/** Count work days in [start, end] inclusive. */
export function countWorkDays(start: Date, end: Date, leaveDays?: Set<string>): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    if (isWorkDay(d, leaveDays)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Merge a global set of holiday date-keys into every tester's own leave-day
 * set, so downstream per-tester scheduling (which only ever consults
 * `leaveDaysByTester.get(userId)`) treats holidays exactly like that
 * tester's approved leave — without touching `isWorkDay` or any other
 * function's signature. Testers with no existing leave entry still get the
 * holiday set (they're collected from the CR list itself, not just the map's
 * existing keys), so a holiday isn't silently skipped for someone who simply
 * has no approved leave on record.
 */
function mergeHolidaysIntoTesterMap(
  leaveDaysByTester: Map<string, Set<string>>,
  holidayDays:       Set<string>,
  crs:               CrInput[],
): Map<string, Set<string>> {
  if (holidayDays.size === 0) return leaveDaysByTester;
  const testerIds = new Set<string>();
  for (const cr of crs) {
    if (cr.primaryTesterId)   testerIds.add(cr.primaryTesterId);
    if (cr.secondaryTesterId) testerIds.add(cr.secondaryTesterId);
  }
  for (const uid of leaveDaysByTester.keys()) testerIds.add(uid);

  const merged = new Map<string, Set<string>>();
  for (const uid of testerIds) {
    const own = leaveDaysByTester.get(uid);
    merged.set(uid, own ? new Set([...own, ...holidayDays]) : new Set(holidayDays));
  }
  return merged;
}

export function buildWorkPlan(
  crs:               CrInput[],
  cycle1Start:       Date,
  // Per-tester approved-leave day keys (see dateKey) — skipped like a weekend
  // when computing THAT tester's own task dates, so a task doesn't silently
  // run straight through their vacation.
  leaveDaysByTester: Map<string, Set<string>> = new Map(),
  // Fixed capacity parameters (work days) — each cycle independently editable
  // on screen. Cycle 2/3 default to round(cycle1*0.5) / round(cycle1*0.3)
  // when not explicitly set, but can be overridden. Cycle boundaries are
  // FIXED from these and do NOT stretch to whoever finishes last — an
  // overloaded tester's tasks still get real dates that may run past their
  // cycle's boundary (for tracking/flagging), but the next cycle starts on
  // schedule for everyone.
  cycle1LengthDays:  number = 12,
  cycle2LengthDays?: number,
  cycle3LengthDays?: number,
  // Global non-work dates (approved-season holidays — see dateKey) applied
  // for everyone alike, unlike leaveDaysByTester which is per-tester.
  holidayDays:       Set<string> = new Set(),
): PlannedCycle[] {
  const start    = getFirstWorkDay(cycle1Start, holidayDays);
  const planned: PlannedCycle[] = [];
  const effLeaveDaysByTester = mergeHolidaysIntoTesterMap(leaveDaysByTester, holidayDays, crs);

  const effCycle1Length = Math.max(1, cycle1LengthDays);
  const effCycle2Length = Math.max(1, cycle2LengthDays ?? Math.round(effCycle1Length * (CYCLE_EFFORT_RATIO.CYCLE_2! / CYCLE_EFFORT_RATIO.CYCLE_1!)));
  const effCycle3Length = Math.max(1, cycle3LengthDays ?? Math.round(effCycle1Length * (CYCLE_EFFORT_RATIO.CYCLE_3! / CYCLE_EFFORT_RATIO.CYCLE_1!)));

  const cycle1End    = addWorkDays(start, effCycle1Length - 1, holidayDays);
  const cycle2Start  = nextWorkDay(cycle1End, holidayDays);
  const cycle2End    = addWorkDays(cycle2Start, effCycle2Length - 1, holidayDays);
  const cycle3Start  = nextWorkDay(cycle2End, holidayDays);
  const cycle3End    = addWorkDays(cycle3Start, effCycle3Length - 1, holidayDays);

  const fixedBoundaries: Record<'CYCLE_1' | 'CYCLE_2' | 'CYCLE_3', { start: Date; end: Date }> = {
    CYCLE_1: { start, end: cycle1End },
    CYCLE_2: { start: cycle2Start, end: cycle2End },
    CYCLE_3: { start: cycle3Start, end: cycle3End },
  };

  let corePointer  = start;
  // Per-tester actual finish time, carried from cycle to cycle — an overloaded
  // tester's next cycle starts wherever they really left off (never before the
  // cycle's own fixed start), instead of double-booking them at the fixed date.
  let carryOverEnd = new Map<string, Date>();

  // Cycles 1–3 are sequential; each CR participates only in cycles listed in cr.cycles
  for (const ct of ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'] as CycleType[]) {
    const ratio    = CYCLE_EFFORT_RATIO[ct]!;
    const cycleCrs = crs.filter(c => c.cycles.includes(ct));
    const b        = fixedBoundaries[ct as 'CYCLE_1' | 'CYCLE_2' | 'CYCLE_3'];
    const cycle    = scheduleSingleCycle(ct, b.start, b.end, cycleCrs, ratio, effLeaveDaysByTester, carryOverEnd);
    planned.push(cycle);
    corePointer = nextWorkDay(cycle.plannedEnd, holidayDays);

    carryOverEnd = new Map();
    cycle.tasks.forEach(t => {
      const cur = carryOverEnd.get(t.userId);
      if (!cur || t.plannedEnd > cur) carryOverEnd.set(t.userId, t.plannedEnd);
    });
  }

  // Stand Alone: scheduled into each tester's own free time, avoiding conflicts
  // with their core-cycle CR tasks (a tester can't work two tasks on the same
  // day). No REGRESSION_FILL exists yet at this point (see below) — SA is
  // scheduled purely around real CR commitments.
  const busyByTester = new Map<string, { start: Date; end: Date; taskType: string }[]>();
  for (const pc of planned) {
    for (const t of pc.tasks) {
      const list = busyByTester.get(t.userId) ?? [];
      list.push({ start: t.plannedStart, end: t.plannedEnd, taskType: t.taskType });
      busyByTester.set(t.userId, list);
    }
  }
  busyByTester.forEach(list => list.sort((a, b) => a.start.getTime() - b.start.getTime()));

  // SA tasks are fully independent of this version's release train — they can
  // go to production in an earlier/separate version, or mid-way through this
  // one, so their earliest possible start is "today" (real-world), not
  // cycle1Start. Any gap between today and cycle1Start has no core busy
  // blocks yet (this version's core work hasn't started), so SA is free to
  // use it.
  const saEarliestStart = getFirstWorkDay(new Date(), holidayDays);
  const saCrs = crs.filter(c => c.cycles.includes('STAND_ALONE'));
  const saCycle = scheduleStandAlone(saCrs, busyByTester, saEarliestStart, effLeaveDaysByTester);
  planned.push(saCycle);

  // Regression-fill — computed LAST, after both core CR work and SA work are
  // placed, and only into whatever's genuinely still free. A tester with SA
  // work pending does not get regression busywork ahead of it: CR commitments
  // > SA commitments > regression-fill, in that order.
  const allBusyByTester = new Map<string, { start: Date; end: Date }[]>();
  for (const pc of planned) {
    for (const t of pc.tasks) {
      const list = allBusyByTester.get(t.userId) ?? [];
      list.push({ start: t.plannedStart, end: t.plannedEnd });
      allBusyByTester.set(t.userId, list);
    }
  }

  for (const ct of ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'] as CycleType[]) {
    const cycle = planned.find(p => p.cycleType === ct)!;
    if (cycle.tasks.length === 0) continue;
    const b = fixedBoundaries[ct as 'CYCLE_1' | 'CYCLE_2' | 'CYCLE_3'];
    // Regression-fill only applies to testers who actually had CR work in
    // this specific cycle — matching the original intent (fill THEIR idle
    // time), not "assign busywork to anyone free during this window."
    const testersInCycle = new Set(cycle.tasks.filter(t => t.taskType === 'CR').map(t => t.userId));
    let order = cycle.tasks.length;

    for (const userId of testersInCycle) {
      const leaveDays = effLeaveDaysByTester.get(userId);
      const busy      = allBusyByTester.get(userId) ?? [];
      const idleSegments = computeIdleSegments(b.start, b.end, busy, leaveDays);
      for (const seg of idleSegments) {
        const fillDays = countWorkDays(seg.start, seg.end, leaveDays);
        if (fillDays <= 0) continue;
        cycle.tasks.push({
          crNumber:     'REGRESSION_FILL',
          crLabel:      'בדיקות רגרסיה',
          taskType:     'REGRESSION',
          userId,
          effortDays:   fillDays,
          plannedStart: seg.start,
          plannedEnd:   seg.end,
          sortOrder:    order++,
          isPrimary:    true,
        });
      }
    }
  }

  // UAT — real tasks for CRs tagged with the UAT cycle, but positioned in
  // PARALLEL with cycle 1's last few work days (not sequentially after core +
  // SA), since business users run UAT while cycle 1 is still wrapping up. The
  // QA tester only supports (≈4h/0.5 day per CR) — a business user drives it,
  // so this doesn't gate the rest of the plan and isn't conflict-checked
  // against the tester's other work.
  const UAT_WINDOW_DAYS = 3;
  const uatStart = subtractWorkDays(cycle1End, UAT_WINDOW_DAYS - 1, holidayDays) < start ? start : subtractWorkDays(cycle1End, UAT_WINDOW_DAYS - 1, holidayDays);
  const uatCrs   = crs.filter(c => c.cycles.includes('UAT'));
  const uatTasks: PlannedTask[] = [];
  let uatOrder = 0;
  for (const cr of uatCrs) {
    if (cr.primaryTesterId) {
      uatTasks.push({
        crNumber: cr.crNumber, crLabel: cr.crLabel, taskType: 'CR',
        userId: cr.primaryTesterId, effortDays: 0.5,
        plannedStart: uatStart, plannedEnd: cycle1End,
        sortOrder: uatOrder++, isPrimary: true,
      });
    }
    if (cr.secondaryTesterId) {
      uatTasks.push({
        crNumber: cr.crNumber, crLabel: cr.crLabel, taskType: 'CR',
        userId: cr.secondaryTesterId, effortDays: 0.5,
        plannedStart: uatStart, plannedEnd: cycle1End,
        sortOrder: uatOrder++, isPrimary: false,
      });
    }
  }
  planned.push({ cycleType: 'UAT', plannedStart: uatStart, plannedEnd: cycle1End, tasks: uatTasks });

  // Rehearsal + Go-Live: no tasks generated — team lead fills content
  const rehearsalStart = nextWorkDay(corePointer, holidayDays);
  const goLiveStart    = nextWorkDay(rehearsalStart, holidayDays);

  planned.push({ cycleType: 'REHEARSAL', plannedStart: rehearsalStart, plannedEnd: rehearsalStart, tasks: [] });
  planned.push({ cycleType: 'GO_LIVE',   plannedStart: goLiveStart,    plannedEnd: goLiveStart,    tasks: [] });

  return planned;
}

// ── Stand Alone scheduler (conflict-aware) ─────────────────────────────────────
// SA tasks are lower priority than core-cycle work by default and may run past
// testingEnd freely. A CR with an explicit standAloneDueDate is pulled to the
// front of that tester's SA queue (earliest due date first) so it gets the
// earliest available free slot — but it still can't overlap the tester's own
// core-cycle tasks, since a tester only works one thing at a time.

/** Find the earliest workday run of `workDaysNeeded` days at/after `from` that doesn't overlap any interval in `busy`. */
function findFreeSlot(
  from:            Date,
  workDaysNeeded:  number,
  busy:            { start: Date; end: Date }[],
  leaveDays?:      Set<string>,
): { taskStart: Date; taskEnd: Date } {
  let candidate = getFirstWorkDay(from, leaveDays);
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const taskEnd  = addWorkDays(candidate, workDaysNeeded - 1, leaveDays);
    const conflict = busy.find(b => candidate.getTime() <= b.end.getTime() && taskEnd.getTime() >= b.start.getTime());
    if (!conflict) return { taskStart: candidate, taskEnd };
    candidate = getFirstWorkDay(nextWorkDay(conflict.end, leaveDays), leaveDays);
  }
}

/** Find every free-workday run within [windowStart, windowEnd] not covered by `busy` (used for regression-fill, computed after CR + SA are both placed). */
function computeIdleSegments(
  windowStart: Date,
  windowEnd:   Date,
  busy:        { start: Date; end: Date }[],
  leaveDays?:  Set<string>,
): { start: Date; end: Date }[] {
  const isBusy = (d: Date) => busy.some(b => d.getTime() >= b.start.getTime() && d.getTime() <= b.end.getTime());
  const segments: { start: Date; end: Date }[] = [];
  let segStart: Date | null = null;
  let lastFree: Date | null = null;

  const d   = new Date(windowStart); d.setHours(0, 0, 0, 0);
  const end = new Date(windowEnd);   end.setHours(0, 0, 0, 0);
  while (d.getTime() <= end.getTime()) {
    if (!isWorkDay(d, leaveDays)) { d.setDate(d.getDate() + 1); continue; } // weekends/leave don't break a segment
    if (!isBusy(d)) {
      if (!segStart) segStart = new Date(d);
      lastFree = new Date(d);
    } else if (segStart && lastFree) {
      segments.push({ start: segStart, end: lastFree });
      segStart = null;
      lastFree = null;
    }
    d.setDate(d.getDate() + 1);
  }
  if (segStart && lastFree) segments.push({ start: segStart, end: lastFree });
  return segments;
}

function scheduleStandAlone(
  crs:              CrInput[],
  busyByTester:     Map<string, { start: Date; end: Date; taskType: string }[]>,
  earliestStart:    Date,
  leaveDaysByTester: Map<string, Set<string>>,
): PlannedCycle {
  const tasks: PlannedTask[] = [];
  let maxEnd = new Date(earliestStart);
  let order  = 0;

  const primaryQueues   = new Map<string, CrInput[]>();
  const secondaryQueues = new Map<string, CrInput[]>();
  for (const cr of crs) {
    if (cr.primaryTesterId) {
      const q = primaryQueues.get(cr.primaryTesterId) ?? [];
      q.push(cr);
      primaryQueues.set(cr.primaryTesterId, q);
    }
    if (cr.secondaryTesterId) {
      const q = secondaryQueues.get(cr.secondaryTesterId) ?? [];
      q.push(cr);
      secondaryQueues.set(cr.secondaryTesterId, q);
    }
  }

  // Due-dated tasks first (earliest due date first), then the rest in original order.
  const prioritize = (list: CrInput[]): CrInput[] => {
    const withDue    = list.filter(c => c.standAloneDueDate).sort((a, b) => a.standAloneDueDate!.getTime() - b.standAloneDueDate!.getTime());
    const withoutDue = list.filter(c => !c.standAloneDueDate);
    return [...withDue, ...withoutDue];
  };

  const scheduleQueue = (queues: Map<string, CrInput[]>, isPrimary: boolean) => {
    for (const [userId, list] of queues) {
      // Shared, mutable per-tester busy list — newly placed SA tasks are pushed
      // back in immediately, so a tester acting as primary on one SA CR and
      // secondary on another can't get double-booked for the same days.
      if (!busyByTester.has(userId)) busyByTester.set(userId, []);
      const busy      = busyByTester.get(userId)!;
      const leaveDays = leaveDaysByTester.get(userId);
      let   cursor    = new Date(earliestStart);

      for (const cr of prioritize(list)) {
        const fullEffort = Math.max(1, Math.round(cr.qaEffortDays));
        const effortDays = isPrimary
          ? (cr.secondaryTesterId ? splitEffort(fullEffort, cr.secondaryParticipationPct).primary : fullEffort)
          // A second tester carries their participation % of the effort.
          : splitEffort(fullEffort, cr.secondaryParticipationPct).secondary;

        // No REGRESSION_FILL exists yet at this point (see buildWorkPlan) —
        // SA only has to avoid real CR commitments, whether due-dated or not.
        const { taskStart, taskEnd } = findFreeSlot(cursor, effortDays, busy, leaveDays);

        tasks.push({
          crNumber: cr.crNumber, crLabel: cr.crLabel, taskType: 'STAND_ALONE',
          userId, effortDays, plannedStart: taskStart, plannedEnd: taskEnd,
          sortOrder: order++, isPrimary,
          dueDate:       cr.standAloneDueDate ?? null,
          missedDueDate: cr.standAloneDueDate ? taskEnd.getTime() > cr.standAloneDueDate.getTime() : false,
        });

        busy.push({ start: taskStart, end: taskEnd, taskType: 'STAND_ALONE' });
        busy.sort((a, b) => a.start.getTime() - b.start.getTime());
        cursor = nextWorkDay(taskEnd, leaveDays);
        if (taskEnd > maxEnd) maxEnd = taskEnd;
      }
    }
  };

  scheduleQueue(primaryQueues, true);
  scheduleQueue(secondaryQueues, false);

  return {
    cycleType:    'STAND_ALONE',
    plannedStart: earliestStart,
    plannedEnd:   tasks.length > 0 ? maxEnd : earliestStart,
    tasks,
  };
}

// ── Single-cycle scheduler ────────────────────────────────────────────────────

function scheduleSingleCycle(
  cycleType:         CycleType,
  cycleStart:        Date,
  // Fixed capacity boundary (from the cycle-length parameter) — this is what
  // gets reported as the cycle's plannedEnd and drives the NEXT cycle's start
  // for everyone, regardless of whether the slowest tester finished by then.
  // An overloaded tester's own tasks may still run past it (real dates, for
  // tracking/flagging) — see carryOverStart below for how that's handled
  // without silently double-booking them into the next cycle.
  fixedEnd:          Date,
  crs:               CrInput[],
  effortRatio:       number,
  leaveDaysByTester: Map<string, Set<string>> = new Map(),
  // Per-tester actual finish time carried over from the PREVIOUS cycle, when
  // it ran past that cycle's own fixed boundary — their tasks here start from
  // wherever they really left off, not from the fixed cycleStart, so they
  // never get double-booked across the cycle boundary.
  carryOverStart:    Map<string, Date> = new Map(),
): PlannedCycle {
  // Group CRs by primary tester (preserving input order)
  const primaryQueues   = new Map<string, CrInput[]>();
  const secondaryQueues = new Map<string, CrInput[]>();

  for (const cr of crs) {
    if (cr.primaryTesterId) {
      const q = primaryQueues.get(cr.primaryTesterId) ?? [];
      q.push(cr);
      primaryQueues.set(cr.primaryTesterId, q);
    }
    if (cr.secondaryTesterId) {
      const q = secondaryQueues.get(cr.secondaryTesterId) ?? [];
      q.push(cr);
      secondaryQueues.set(cr.secondaryTesterId, q);
    }
  }

  const tasks: PlannedTask[] = [];
  const testerLastEnd = new Map<string, Date>();
  let order  = 0;

  const personalStart = (userId: string, leaveDays?: Set<string>): Date => {
    const carry = carryOverStart.get(userId);
    const base  = carry && carry.getTime() > cycleStart.getTime() ? nextWorkDay(carry, leaveDays) : cycleStart;
    return getFirstWorkDay(base, leaveDays);
  };

  // Schedule primary tasks first
  for (const [userId, queue] of primaryQueues) {
    const leaveDays = leaveDaysByTester.get(userId);
    let pointer = personalStart(userId, leaveDays);

    for (const cr of queue) {
      const baseEffort = Math.max(1, Math.round(cr.qaEffortDays * effortRatio));
      // A second tester carries their participation % of the effort — the rest stays with primary.
      const effortDays = cr.secondaryTesterId ? splitEffort(baseEffort, cr.secondaryParticipationPct).primary : baseEffort;
      const taskStart  = getFirstWorkDay(pointer, leaveDays);
      const taskEnd    = addWorkDays(taskStart, effortDays - 1, leaveDays);

      tasks.push({
        crNumber:     cr.crNumber,
        crLabel:      cr.crLabel,
        taskType:     cycleType === 'STAND_ALONE' ? 'STAND_ALONE' : 'CR',
        userId,
        effortDays,
        plannedStart: taskStart,
        plannedEnd:   taskEnd,
        sortOrder:    order++,
        isPrimary:    true,
      });

      testerLastEnd.set(userId, taskEnd);
      pointer = nextWorkDay(taskEnd, leaveDays);
    }
  }

  // Schedule secondary tasks (parallel with primary's start date)
  for (const [userId, queue] of secondaryQueues) {
    const leaveDays = leaveDaysByTester.get(userId);
    const primaryTasks = new Map(tasks.map(t => [t.crNumber, t]));
    let pointer = testerLastEnd.get(userId) ?? personalStart(userId, leaveDays);

    for (const cr of queue) {
      const primaryTask = primaryTasks.get(cr.crNumber);
      const crStart = getFirstWorkDay(primaryTask?.plannedStart ?? pointer, leaveDays);

      // Carries their participation % of the effort (see primary loop above).
      const baseEffort = Math.max(1, Math.round(cr.qaEffortDays * effortRatio));
      const effortDays = splitEffort(baseEffort, cr.secondaryParticipationPct).secondary;

      const taskStart = new Date(crStart);
      const taskEnd   = addWorkDays(taskStart, effortDays - 1, leaveDays);

      tasks.push({
        crNumber:     cr.crNumber,
        crLabel:      cr.crLabel,
        taskType:     cycleType === 'STAND_ALONE' ? 'STAND_ALONE' : 'CR',
        userId,
        effortDays,
        plannedStart: taskStart,
        plannedEnd:   taskEnd,
        sortOrder:    order++,
        isPrimary:    false,
      });

      testerLastEnd.set(userId, taskEnd);
    }
  }

  // Regression-fill is NOT computed here — see buildWorkPlan, which does it
  // after both core CR work and SA work are placed for every cycle, so a
  // tester with pending SA work doesn't get regression busywork ahead of it.

  return {
    cycleType,
    plannedStart: cycleStart,
    plannedEnd:   fixedEnd,
    tasks,
  };
}
