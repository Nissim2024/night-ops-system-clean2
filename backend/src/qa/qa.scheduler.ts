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
  primarySkillLevel:   number;   // kept for callers/reporting; no longer used for effort split (now a flat 50/50)
  secondarySkillLevel: number;
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
}

export interface PlannedCycle {
  cycleType:    CycleType;
  plannedStart: Date;
  plannedEnd:   Date;
  tasks:        PlannedTask[];
}

// ── Work-day helpers ──────────────────────────────────────────────────────────

export function isWorkDay(d: Date): boolean {
  const dow = d.getDay();
  return dow !== 5 && dow !== 6;
}

export function getFirstWorkDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  while (!isWorkDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

export function nextWorkDay(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + 1);
  while (!isWorkDay(d)) d.setDate(d.getDate() + 1);
  return d;
}

/**
 * Advance date by N work days. 0 = same day.
 * addWorkDays(Mon, 2) = Wed (Mon→Tue→Wed)
 */
export function addWorkDays(date: Date, days: number): Date {
  if (days <= 0) return new Date(date);
  const d = new Date(date);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkDay(d)) remaining--;
  }
  return d;
}

/** Count work days in [start, end] inclusive. */
export function countWorkDays(start: Date, end: Date): number {
  let count = 0;
  const d = new Date(start);
  d.setHours(0, 0, 0, 0);
  const e = new Date(end);
  e.setHours(0, 0, 0, 0);
  while (d <= e) {
    if (isWorkDay(d)) count++;
    d.setDate(d.getDate() + 1);
  }
  return count;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export function buildWorkPlan(crs: CrInput[], cycle1Start: Date): PlannedCycle[] {
  const start    = getFirstWorkDay(cycle1Start);
  const planned: PlannedCycle[] = [];
  let corePointer = start;

  // Cycles 1–3 are sequential; each CR participates only in cycles listed in cr.cycles
  for (const ct of ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'] as CycleType[]) {
    const ratio    = CYCLE_EFFORT_RATIO[ct]!;
    const cycleCrs = crs.filter(c => c.cycles.includes(ct));
    const cycle    = scheduleSingleCycle(ct, corePointer, cycleCrs, ratio);
    planned.push(cycle);
    corePointer = nextWorkDay(cycle.plannedEnd);
  }

  // Stand Alone runs in parallel from cycle1 start (always present, may be empty)
  const saCrs = crs.filter(c => c.cycles.includes('STAND_ALONE'));
  planned.push(scheduleSingleCycle('STAND_ALONE', start, saCrs, 1.0));

  // UAT — no QA tasks generated; team lead fills dates/content
  const uatStart = nextWorkDay(corePointer);
  planned.push({ cycleType: 'UAT', plannedStart: uatStart, plannedEnd: uatStart, tasks: [] });
  corePointer = uatStart;

  // Rehearsal + Go-Live: no tasks generated — team lead fills content
  const rehearsalStart = nextWorkDay(corePointer);
  const goLiveStart    = nextWorkDay(rehearsalStart);

  planned.push({ cycleType: 'REHEARSAL', plannedStart: rehearsalStart, plannedEnd: rehearsalStart, tasks: [] });
  planned.push({ cycleType: 'GO_LIVE',   plannedStart: goLiveStart,    plannedEnd: goLiveStart,    tasks: [] });

  return planned;
}

// ── Single-cycle scheduler ────────────────────────────────────────────────────

function scheduleSingleCycle(
  cycleType:   CycleType,
  cycleStart:  Date,
  crs:         CrInput[],
  effortRatio: number,
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
  let maxEnd = new Date(cycleStart);
  let order  = 0;

  const allTesterIds = new Set([...primaryQueues.keys(), ...secondaryQueues.keys()]);
  allTesterIds.forEach(id => testerLastEnd.set(id, new Date(cycleStart)));

  // Schedule primary tasks first
  for (const [userId, queue] of primaryQueues) {
    let pointer = new Date(cycleStart);

    for (const cr of queue) {
      const baseEffort = Math.max(1, Math.round(cr.qaEffortDays * effortRatio));
      // A second tester splits the total effort in half — not extra time on top.
      const effortDays = cr.secondaryTesterId ? Math.max(1, Math.round(baseEffort / 2)) : baseEffort;
      const taskStart  = new Date(pointer);
      const taskEnd    = addWorkDays(taskStart, effortDays - 1);

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
      pointer = nextWorkDay(taskEnd);
    }

    if (testerLastEnd.get(userId)! > maxEnd) maxEnd = testerLastEnd.get(userId)!;
  }

  // Schedule secondary tasks (parallel with primary's start date)
  for (const [userId, queue] of secondaryQueues) {
    const primaryTasks = new Map(tasks.map(t => [t.crNumber, t]));
    let pointer = testerLastEnd.get(userId) ?? new Date(cycleStart);

    for (const cr of queue) {
      const primaryTask = primaryTasks.get(cr.crNumber);
      const crStart = primaryTask?.plannedStart ?? pointer;

      // Splits the total effort in half with the primary tester (see primary loop above).
      const baseEffort = Math.max(1, Math.round(cr.qaEffortDays * effortRatio));
      const effortDays = Math.max(1, Math.round(baseEffort / 2));

      const taskStart = new Date(crStart);
      const taskEnd   = addWorkDays(taskStart, effortDays - 1);

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
      if (taskEnd > maxEnd) maxEnd = taskEnd;
    }
  }

  // Fill remaining time for testers finishing early with REGRESSION tasks (core cycles only)
  if (cycleType !== 'STAND_ALONE' && tasks.length > 0) {
    for (const [userId, lastEnd] of testerLastEnd) {
      if (lastEnd < maxEnd) {
        const fillStart = nextWorkDay(lastEnd);
        const fillDays  = countWorkDays(fillStart, maxEnd);
        if (fillDays > 0) {
          tasks.push({
            crNumber:     'REGRESSION_FILL',
            crLabel:      'בדיקות רגרסיה',
            taskType:     'REGRESSION',
            userId,
            effortDays:   fillDays,
            plannedStart: fillStart,
            plannedEnd:   maxEnd,
            sortOrder:    order++,
            isPrimary:    true,
          });
        }
      }
    }
  }

  return {
    cycleType,
    plannedStart: cycleStart,
    plannedEnd:   tasks.length > 0 ? maxEnd : cycleStart,
    tasks,
  };
}
