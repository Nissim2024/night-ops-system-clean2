import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildWorkPlan,
  CrInput,
  PlannedCycle,
  CYCLE_LABEL,
  CycleType,
  countWorkDays,
  addWorkDays,
  nextWorkDay,
  dateKey,
} from './qa.scheduler';

const prisma = new PrismaClient();

const CYCLE_ORDER: CycleType[] = [
  'CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE', 'UAT', 'REHEARSAL', 'GO_LIVE',
];

@Injectable()
export class QaWorkPlanService {

  // ── Build the CrInput list the scheduler needs (shared by generate + preview) ──

  private async buildCrInputs(versionId: string): Promise<{ crInputs: CrInput[]; unassigned: string[] }> {
    // 2. Load all CR assignments
    const vcas = await prisma.versionCrAssignment.findMany({ where: { versionId } });
    // Deduplicated metadata (first occurrence wins for label, application, etc.)
    const crMap = new Map<string, typeof vcas[0]>();
    vcas.forEach(v => { if (!crMap.has(v.crNumber)) crMap.set(v.crNumber, v); });
    // qaEffort comes specifically from QA Team rows (the only rows that have it populated)
    const qaTeam = await prisma.team.findFirst({ where: { name: 'QA Team' } });
    const qaEffortMap = new Map<string, number>(); // crNumber → days from QA Team row
    if (qaTeam) {
      vcas.filter(v => v.teamId === qaTeam.id && (v as any).qaEffort != null)
        .forEach(v => {
          const effort = (v as any).qaEffortOverride ?? (v as any).qaEffort;
          if (effort != null) qaEffortMap.set(v.crNumber, effort);
        });
    }

    // 3. Load primary tester assignments
    const qaAssignments = await prisma.qaAssignment.findMany({ where: { versionId } });
    const assignMap = new Map<string, string>(); // crNumber → userId
    qaAssignments.forEach(a => assignMap.set(a.crNumber, a.userId));

    // 4. Load tester skill levels for effort splitting
    const assignedUserIds = [...new Set(qaAssignments.map(a => a.userId))];
    const testerSkills = await prisma.testerSkill.findMany({
      where: { userId: { in: assignedUserIds } },
      include: { skill: true },
    });
    const skillMap = new Map<string, Map<string, number>>(); // userId → skillName → level
    testerSkills.forEach(ts => {
      if (!skillMap.has(ts.userId)) skillMap.set(ts.userId, new Map());
      skillMap.get(ts.userId)!.set(ts.skill.name, ts.level);
    });

    // 5. Build CrInput list
    const unassigned: string[] = [];
    const crInputs: CrInput[] = [];

    // Cycles a CR belongs to: assignment.cycles override, else VCA/assignment
    // stand-alone flag, else the default full split across the three core cycles.
    const effectiveCyclesFor = (asg: typeof qaAssignments[0] | undefined, vca: typeof vcas[0]): string[] => {
      const asgCycles       = ((asg as any)?.cycles as string[]) ?? [];
      const vcaIsStandAlone = (vca as any).isStandAlone ?? false;
      const asgIsStandAlone = (asg as any)?.isStandAlone as boolean | null ?? null;
      const effectiveSA     = asgIsStandAlone !== null ? asgIsStandAlone : vcaIsStandAlone;
      return asgCycles.length > 0
        ? asgCycles
        : (effectiveSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);
    };

    // CRs whose title/label mentions "TARGET" are shared defect-handling duty —
    // every active tester gets their own copy of the task (full effort each,
    // not split), rather than requiring one single assigned tester.
    const ALL_TESTERS_PATTERN = /target/i;
    let activeTesters: { id: string }[] | null = null;

    for (const [crNumber, vca] of crMap) {
      const asg = qaAssignments.find(a => a.crNumber === crNumber);

      // Effort priority: assignment.qaEffort (team lead override) > VCA QA Team row > original VCA
      const asgEffort = (asg as any)?.qaEffort as number | null;
      const qaEffortDays = asgEffort ?? qaEffortMap.get(crNumber) ?? (vca as any).qaEffortOverride ?? (vca as any).qaEffort ?? null;

      // Skip CRs with no QA effort — they have no testing work and must not appear in unassigned warning
      if (!qaEffortDays || qaEffortDays <= 0) continue;

      if (ALL_TESTERS_PATTERN.test(vca.crLabel ?? '')) {
        if (!activeTesters) {
          const profiles = await prisma.testerProfile.findMany({ where: { isActive: true }, select: { userId: true } });
          activeTesters = profiles.map(p => ({ id: p.userId }));
        }
        const cycles = effectiveCyclesFor(asg, vca);
        for (const tester of activeTesters) {
          crInputs.push({
            crNumber,
            crLabel:             vca.crLabel ?? crNumber,
            qaEffortDays,
            cycles,
            primaryTesterId:     tester.id,
            secondaryTesterId:   null,
            primarySkillLevel:   3,
            secondarySkillLevel: 0,
          });
        }
        continue;
      }

      const primaryId = asg?.userId ?? null;
      if (!primaryId) {
        unassigned.push(crNumber);
        continue;
      }
      const appName      = vca.application ?? null;
      const rawPrimary   = appName ? (skillMap.get(primaryId)?.get(appName) ?? 3) : 3;
      const primaryLevel = rawPrimary < 0 ? 1 : rawPrimary; // -1 (N/R) treated as 1 for effort-split ratio

      // Secondary tester from assignment
      const secondaryId    = (asg as any).secondaryTesterId as string | null ?? null;
      const rawSecondary   = secondaryId && appName ? (skillMap.get(secondaryId)?.get(appName) ?? (asg as any).secondarySkillLevel ?? 3) : ((asg as any).secondarySkillLevel ?? 3);
      const secondaryLevel = rawSecondary < 0 ? 1 : rawSecondary;

      const effectiveCycles = effectiveCyclesFor(asg, vca);

      crInputs.push({
        crNumber,
        crLabel:             vca.crLabel ?? crNumber,
        qaEffortDays,
        cycles:              effectiveCycles,
        primaryTesterId:     primaryId,
        secondaryTesterId:   secondaryId,
        primarySkillLevel:   primaryLevel,
        secondarySkillLevel: secondaryId ? secondaryLevel : 0,
        secondaryParticipationPct: (asg as any)?.secondaryParticipationPct ?? 50,
        standAloneDueDate:   (asg as any)?.standAloneDueDate ?? null,
      });
    }

    return { crInputs, unassigned };
  }

  // ── Approved leave days per tester (for schedule-aware day-skipping) ───────

  private async loadLeaveDays(crInputs: CrInput[], from: Date): Promise<Map<string, Set<string>>> {
    const userIds = new Set<string>();
    crInputs.forEach(c => {
      if (c.primaryTesterId)   userIds.add(c.primaryTesterId);
      if (c.secondaryTesterId) userIds.add(c.secondaryTesterId);
    });
    if (userIds.size === 0) return new Map();

    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        kind:   'leave',
        userId: { in: [...userIds] },
        date:   { gte: from },
      },
      select: { userId: true, date: true },
    });

    const map = new Map<string, Set<string>>();
    for (const l of leaves) {
      if (!map.has(l.userId)) map.set(l.userId, new Set());
      map.get(l.userId)!.add(dateKey(l.date));
    }
    return map;
  }

  // ── Generate / regenerate work plan ────────────────────────────────────────

  async generateWorkPlan(
    versionId: string,
    cycle1Start: Date,
    testingEnd: Date,
    createdBy?: string,
    cycle1LengthDays?: number,
    cycle2LengthDays?: number,
    cycle3LengthDays?: number,
  ) {
    // 1. Validate version exists
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('גרסה לא נמצאה');

    const { crInputs, unassigned } = await this.buildCrInputs(versionId);

    // Approved leave days per tester — the scheduler skips these like a
    // weekend for that specific person, instead of silently running a task
    // straight through their vacation.
    const leaveDaysByTester = await this.loadLeaveDays(crInputs, cycle1Start);
    const effectiveCycle1Length = cycle1LengthDays && cycle1LengthDays > 0 ? cycle1LengthDays : 12;
    const effectiveCycle2Length = cycle2LengthDays && cycle2LengthDays > 0 ? cycle2LengthDays : undefined;
    const effectiveCycle3Length = cycle3LengthDays && cycle3LengthDays > 0 ? cycle3LengthDays : undefined;

    // 6. Run scheduler
    const plannedCycles: PlannedCycle[] = buildWorkPlan(
      crInputs, cycle1Start, leaveDaysByTester,
      effectiveCycle1Length, effectiveCycle2Length, effectiveCycle3Length,
    );

    // Persist the actual applied lengths (including derived ones, when the
    // caller didn't explicitly override cycle 2/3) so they round-trip correctly.
    const appliedCycle2Length = countWorkDays(
      plannedCycles.find(c => c.cycleType === 'CYCLE_2')!.plannedStart,
      plannedCycles.find(c => c.cycleType === 'CYCLE_2')!.plannedEnd,
    );
    const appliedCycle3Length = countWorkDays(
      plannedCycles.find(c => c.cycleType === 'CYCLE_3')!.plannedStart,
      plannedCycles.find(c => c.cycleType === 'CYCLE_3')!.plannedEnd,
    );

    // 7. Persist — delete existing plan for this version first
    await prisma.$transaction(async tx => {
      await tx.qaWorkPlan.deleteMany({ where: { versionId } });

      const plan = await tx.qaWorkPlan.create({
        data: {
          versionId,
          status:     'DRAFT',
          cycle1Start,
          testingEnd,
          cycle1LengthDays: effectiveCycle1Length,
          cycle2LengthDays: appliedCycle2Length,
          cycle3LengthDays: appliedCycle3Length,
          createdBy:  createdBy ?? null,
        } as any,
      });

      for (let ci = 0; ci < plannedCycles.length; ci++) {
        const pc = plannedCycles[ci];
        const cycle = await tx.qaCycle.create({
          data: {
            workPlanId:   plan.id,
            cycleType:    pc.cycleType,
            plannedStart: pc.plannedStart,
            plannedEnd:   pc.plannedEnd,
          },
        });

        if (pc.tasks.length > 0) {
          await tx.qaCycleTask.createMany({
            data: pc.tasks.map(t => ({
              cycleId:      cycle.id,
              crNumber:     t.crNumber,
              crLabel:      t.crLabel,
              taskType:     t.taskType,
              userId:       t.userId,
              effortDays:   t.effortDays,
              plannedStart: t.plannedStart,
              plannedEnd:   t.plannedEnd,
              isActive:     true,
              isPrimary:    t.isPrimary,
              sortOrder:    t.sortOrder,
            })),
          });
        }
      }
    });

    const result = await this.getWorkPlan(versionId);
    return { workPlan: result, unassignedCrs: unassigned };
  }

  // ── Get work plan for a version ─────────────────────────────────────────────

  async getWorkPlan(versionId: string) {
    const plan = await prisma.qaWorkPlan.findUnique({
      where: { versionId },
      include: {
        cycles: {
          orderBy: { cycleType: 'asc' },
          include: {
            tasks: {
              orderBy: [{ sortOrder: 'asc' }],
              include: {
                user: { select: { id: true, fullName: true, email: true } },
              },
            },
          },
        },
      },
    });

    if (!plan) return null;

    // Sort cycles in logical order
    const sorted = [...plan.cycles].sort(
      (a, b) => CYCLE_ORDER.indexOf(a.cycleType as CycleType) - CYCLE_ORDER.indexOf(b.cycleType as CycleType),
    );

    const overflowIssues = await this.computeOverflowIssues(versionId, { ...plan, cycles: sorted });

    return { ...plan, cycles: sorted, overflowIssues };
  }

  // ── Overflow / conflict detection ───────────────────────────────────────────
  // Surfaces plan problems in plain language instead of silently persisting
  // dates that run past the agreed testing window, so the user can decide how
  // to resolve them (add a second tester, revisit the effort estimate, or
  // extend the window) rather than discovering it by eyeballing the dates.

  private async computeOverflowIssues(versionId: string, plan: { cycle1Start: Date; testingEnd: Date; cycles: any[] }) {
    const issues: {
      type: 'CORE_OVERFLOW' | 'SA_DUE_DATE_MISSED' | 'GO_LIVE_OVERFLOW';
      message: string;
      crNumber?: string;
      userName?: string;
      daysOver: number;
      suggestions: string[];
    }[] = [];

    const coreCycles = plan.cycles.filter((c: any) => ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'].includes(c.cycleType));
    const saCycle     = plan.cycles.find((c: any) => c.cycleType === 'STAND_ALONE');

    // Cycle boundaries are now a fixed parameter (see buildWorkPlan) — check
    // each cycle independently for testers whose own real (non-filler) work
    // runs past THAT cycle's fixed end, instead of comparing a combined
    // multi-cycle total against the whole testing window. This directly
    // answers "who doesn't fit in the cycle, and why" per cycle.
    for (const cycle of coreCycles) {
      const realTasksByTester = new Map<string, any[]>();
      for (const task of cycle.tasks) {
        if (task.taskType !== 'CR') continue; // regression-fill is padding, not a commitment
        const list = realTasksByTester.get(task.userId) ?? [];
        list.push(task);
        realTasksByTester.set(task.userId, list);
      }

      for (const [userId, tasks] of realTasksByTester) {
        const lastEnd = tasks.reduce((max: Date, t: any) => t.plannedEnd > max ? t.plannedEnd : max, tasks[0].plannedEnd);
        if (lastEnd.getTime() <= cycle.plannedEnd.getTime()) continue;

        const daysOver = countWorkDays(nextWorkDay(cycle.plannedEnd), lastEnd);
        const userName = tasks[0]?.user?.fullName ?? userId;
        const biggest  = [...tasks].sort((a: any, b: any) => b.effortDays - a.effortDays)[0];
        const cycleLabel = CYCLE_LABEL[cycle.cycleType as CycleType];

        issues.push({
          type:        'CORE_OVERFLOW',
          userName,
          crNumber:    biggest?.crNumber,
          daysOver,
          message: `${userName} לא מספיק לסיים את ${cycleLabel} עד ${cycle.plannedEnd.toLocaleDateString('he-IL')} — חורג ב-${daysOver} ימי עבודה. ${biggest ? `CR ${biggest.crNumber} (${biggest.effortDays} ימים) הוא המשמעותי ביותר בעומס שלו.` : ''} הסבב הבא יתחיל במועד הקבוע לכל שאר הצוות; מי שחורג צריך פתרון — ידני, בודק שני, או הארכת הסבב.`,
          suggestions: [
            biggest ? `שקול לשבץ בודק שני ל-CR ${biggest.crNumber} כדי לפצל את המאמץ` : 'שקול לשבץ בודק שני לאחת מהמשימות הגדולות שלו',
            biggest ? `בדוק שוב את הערכת המאמץ (${biggest.effortDays} ימים) עבור CR ${biggest.crNumber} — ייתכן שהיא לא מדויקת` : 'בדוק שוב את הערכות המאמץ של המשימות שלו',
            `לחלופין, שקול להאריך את אורך ${cycleLabel}`,
          ],
        });
      }
    }

    // ── Hard constraint: core tasks must never run past go-live ──────────────
    // Go-live is set at version creation (Version.plannedStart) — it's the one
    // date that truly cannot move for QA reasons, unlike cycle boundaries.
    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { plannedStart: true } });
    const goLiveDate = version?.plannedStart ?? null;
    const lastCoreCycle = coreCycles[coreCycles.length - 1];

    if (goLiveDate && lastCoreCycle) {
      const realTasksByTester = new Map<string, any[]>();
      for (const task of lastCoreCycle.tasks) {
        if (task.taskType !== 'CR') continue;
        const list = realTasksByTester.get(task.userId) ?? [];
        list.push(task);
        realTasksByTester.set(task.userId, list);
      }
      for (const [userId, tasks] of realTasksByTester) {
        const lastEnd = tasks.reduce((max: Date, t: any) => t.plannedEnd > max ? t.plannedEnd : max, tasks[0].plannedEnd);
        if (lastEnd.getTime() <= goLiveDate.getTime()) continue;

        const daysOver  = countWorkDays(nextWorkDay(goLiveDate), lastEnd);
        const userName  = tasks[0]?.user?.fullName ?? userId;
        const biggest   = [...tasks].sort((a: any, b: any) => b.effortDays - a.effortDays)[0];

        issues.push({
          type:     'GO_LIVE_OVERFLOW',
          userName,
          crNumber: biggest?.crNumber,
          daysOver,
          message: `🚨 ${userName} עדיין בודק/ת אחרי מועד העלייה לאוויר (${goLiveDate.toLocaleDateString('he-IL')}) — חורג ב-${daysOver} ימי עבודה. ${biggest ? `CR ${biggest.crNumber} (${biggest.effortDays} ימים) הוא המשמעותי ביותר.` : ''} משימות ליבה לא יכולות להימשך מעבר לעלייה לאוויר — נדרש פתרון לפני המועד.`,
          suggestions: [
            biggest ? `שקול לשבץ בודק שני ל-CR ${biggest.crNumber} כדי לפצל את המאמץ` : 'שקול לשבץ בודק שני לאחת מהמשימות הגדולות שלו',
            biggest ? `בדוק שוב את הערכת המאמץ (${biggest.effortDays} ימים) עבור CR ${biggest.crNumber} — ייתכן שהיא לא מדויקת` : 'בדוק שוב את הערכות המאמץ של המשימות שלו',
            'שקול לקצר סבבים אחרים או להתחיל את סבב 1 מוקדם יותר',
          ],
        });
      }
    }

    // ── Stand Alone due-date misses ──────────────────────────────────────────
    if (saCycle) {
      const dueDates = await prisma.qaAssignment.findMany({
        where: { versionId, standAloneDueDate: { not: null } },
        select: { crNumber: true, standAloneDueDate: true },
      });
      const dueMap = new Map(dueDates.map(d => [d.crNumber, d.standAloneDueDate!]));

      for (const task of saCycle.tasks) {
        const due = dueMap.get(task.crNumber);
        if (!due || task.plannedEnd.getTime() <= due.getTime()) continue;
        const daysOver = countWorkDays(nextWorkDay(due), task.plannedEnd);
        issues.push({
          type:     'SA_DUE_DATE_MISSED',
          userName: task.user?.fullName ?? task.userId,
          crNumber: task.crNumber,
          daysOver,
          message: `CR ${task.crNumber} (Stand Alone) לא יעמוד במועד היעד שנקבע (${due.toLocaleDateString('he-IL')}) — צפוי להסתיים ${daysOver} ימי עבודה אחרי כן, כי ${task.user?.fullName ?? ''} עמוס במשימות ליבה קודמות.`,
          suggestions: [
            'שקול לשבץ בודק שני למשימת ה-Stand Alone הזו',
            'שקול להקדים משימות ליבה אחרות של הבודק כדי לפנות לו זמן',
            'בדוק אם ניתן לדחות את מועד היעד',
          ],
        });
      }
    }

    return issues;
  }

  // ── Approve work plan ───────────────────────────────────────────────────────

  async approveWorkPlan(versionId: string, approvedBy: string) {
    const plan = await prisma.qaWorkPlan.findUnique({ where: { versionId } });
    if (!plan) throw new NotFoundException('תוכנית עבודה לא נמצאה');

    return prisma.qaWorkPlan.update({
      where: { versionId },
      data:  { status: 'APPROVED', approvedBy, approvedAt: new Date() },
    });
  }

  // ── Toggle task active/inactive ─────────────────────────────────────────────

  // Deactivating a task frees up its slot in the tester's queue — the schedule
  // must be recomputed (and cascaded to CYCLE_2/3 + UAT/REHEARSAL/GO_LIVE)
  // rather than just leaving a dead gap where the disabled task used to sit.
  async toggleTask(taskId: string, isActive: boolean) {
    const task = await prisma.qaCycleTask.findUnique({
      where: { id: taskId },
      include: { cycle: true },
    });
    if (!task) throw new NotFoundException('משימה לא נמצאה');

    const editableCycles: CycleType[] = ['CYCLE_2', 'CYCLE_3', 'UAT', 'REHEARSAL', 'GO_LIVE'];
    if (!editableCycles.includes(task.cycle.cycleType as CycleType)) {
      throw new BadRequestException('ניתן להשבית משימות רק בסבב 2 ו-3');
    }

    await prisma.qaCycleTask.update({ where: { id: taskId }, data: { isActive } });

    const newCycleEnd = await this.rescheduleFullCycle(task.cycleId, new Date(task.cycle.plannedStart));
    await this.cascadeFromCycle(task.cycle.workPlanId, task.cycle.cycleType, newCycleEnd);

    const workPlan = await prisma.qaWorkPlan.findUnique({ where: { id: task.cycle.workPlanId }, select: { versionId: true } });
    return this.getWorkPlan(workPlan?.versionId ?? '');
  }

  // ── Update task effort (team lead manual override) ──────────────────────────
  // A duration change shifts everyone queued after this task, and may push the
  // cycle boundary itself — so it cascades exactly like reorderTask does.

  async updateTaskEffort(taskId: string, effortDays: number, userEmail?: string) {
    if (effortDays < 0.5) throw new BadRequestException('מאמץ מינימלי הוא 0.5 ימים');
    const task = await prisma.qaCycleTask.findUnique({
      where: { id: taskId },
      include: { cycle: { include: { workPlan: true } } },
    });
    if (!task) throw new NotFoundException('משימה לא נמצאה');

    if (task.cycle.workPlan.status === 'APPROVED') {
      await prisma.qaWorkPlanChangeLog.create({
        data: {
          workPlanId: task.cycle.workPlanId, qaCycleTaskId: task.id, crNumber: task.crNumber,
          action: 'EFFORT_CHANGED', userEmail,
          beforeData: { effortDays: task.effortDays },
          afterData: { effortDays },
        },
      });
    }

    await prisma.qaCycleTask.update({ where: { id: taskId }, data: { effortDays } });

    const newCycleEnd = await this.rescheduleFullCycle(task.cycleId, new Date(task.cycle.plannedStart));
    await this.cascadeFromCycle(task.cycle.workPlanId, task.cycle.cycleType, newCycleEnd);

    const workPlan = await prisma.qaWorkPlan.findUnique({ where: { id: task.cycle.workPlanId }, select: { versionId: true } });
    return this.getWorkPlan(workPlan?.versionId ?? '');
  }

  // ── Delete a task from the plan (corrective action — allowed even after
  // approval, unlike most other edits, per explicit product decision) ────────
  async deleteTask(taskId: string, userEmail?: string) {
    const task = await prisma.qaCycleTask.findUnique({
      where: { id: taskId },
      include: { cycle: { include: { workPlan: true } } },
    });
    if (!task) throw new NotFoundException('משימה לא נמצאה');

    if (task.cycle.workPlan.status === 'APPROVED') {
      await prisma.qaWorkPlanChangeLog.create({
        data: {
          workPlanId: task.cycle.workPlanId, qaCycleTaskId: null, crNumber: task.crNumber,
          action: 'TASK_DELETED', userEmail,
          beforeData: {
            crNumber: task.crNumber, crLabel: task.crLabel, userId: task.userId,
            effortDays: task.effortDays, taskType: task.taskType,
            plannedStart: task.plannedStart, plannedEnd: task.plannedEnd,
          },
        },
      });
    }

    const cycleId = task.cycleId;
    const workPlanId = task.cycle.workPlanId;
    const cycleType = task.cycle.cycleType as CycleType;
    await prisma.qaCycleTask.delete({ where: { id: taskId } });

    const newCycleEnd = await this.rescheduleFullCycle(cycleId, new Date(task.cycle.plannedStart));
    await this.cascadeFromCycle(workPlanId, cycleType, newCycleEnd);

    const workPlan = await prisma.qaWorkPlan.findUnique({ where: { id: workPlanId }, select: { versionId: true } });
    return this.getWorkPlan(workPlan?.versionId ?? '');
  }

  // ── Change log — only ever contains entries written post-approval ─────────
  async getChangeLog(versionId: string) {
    const workPlan = await prisma.qaWorkPlan.findUnique({ where: { versionId }, select: { id: true } });
    if (!workPlan) return [];
    return prisma.qaWorkPlanChangeLog.findMany({
      where: { workPlanId: workPlan.id },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ── Reassign a task's tester (swap) ──────────────────────────────────────────
  // Moves the task to the end of the new tester's queue in this cycle, keeps
  // the underlying QaAssignment (the assignment board) in sync so both screens
  // agree on who owns the CR, and cascades the schedule exactly like a reorder.
  async reassignTester(taskId: string, newUserId: string) {
    const task = await prisma.qaCycleTask.findUnique({ where: { id: taskId }, include: { cycle: true } });
    if (!task) throw new NotFoundException('משימה לא נמצאה');
    if (task.taskType === 'REGRESSION') throw new BadRequestException('לא ניתן להחליף בודק במשימת רגרסיה');

    const newUser = await prisma.user.findUnique({ where: { id: newUserId }, select: { id: true } });
    if (!newUser) throw new BadRequestException('משתמש לא נמצא');

    const newTesterTaskCount = await prisma.qaCycleTask.count({
      where: { cycleId: task.cycleId, userId: newUserId, taskType: { not: 'REGRESSION' } },
    });

    await prisma.qaCycleTask.update({
      where: { id: taskId },
      data:  { userId: newUserId, sortOrder: newTesterTaskCount + 1 },
    });

    const workPlan = await prisma.qaWorkPlan.findUnique({ where: { id: task.cycle.workPlanId }, select: { versionId: true } });
    if (workPlan) {
      await prisma.qaAssignment.updateMany({
        where: { versionId: workPlan.versionId, crNumber: task.crNumber },
        data:  task.isPrimary ? { userId: newUserId } : { secondaryTesterId: newUserId },
      });
    }

    const newCycleEnd = await this.rescheduleFullCycle(task.cycleId, new Date(task.cycle.plannedStart));
    await this.cascadeFromCycle(task.cycle.workPlanId, task.cycle.cycleType, newCycleEnd);

    return this.getWorkPlan(workPlan?.versionId ?? '');
  }

  // ── Update cycle dates (after team lead adjusts) ────────────────────────────

  async updateCycleDates(cycleId: string, plannedStart: Date, plannedEnd: Date) {
    return prisma.qaCycle.update({
      where: { id: cycleId },
      data:  { plannedStart, plannedEnd },
    });
  }

  // ── Update cycle notes (for Rehearsal / Go-Live content) ───────────────────

  async updateCycleNotes(cycleId: string, notes: string) {
    return prisma.qaCycle.update({ where: { id: cycleId }, data: { notes } });
  }

  // ── Reorder task within tester queue + cascade ───────────────────────────────

  async reorderTask(taskId: string, newSortOrder: number) {
    const task = await (prisma as any).qaCycleTask.findUnique({
      where: { id: taskId },
      include: { cycle: true },
    });
    if (!task) throw new NotFoundException('משימה לא נמצאה');

    const { cycleId, userId } = task;

    // All non-regression tasks for this user in this cycle
    const userTasks: any[] = await (prisma as any).qaCycleTask.findMany({
      where: { cycleId, userId, taskType: { not: 'REGRESSION' } },
      orderBy: { sortOrder: 'asc' },
    });

    // Re-insert the moved task at the new position
    const others = userTasks.filter((t: any) => t.id !== taskId);
    const clamp  = Math.max(1, Math.min(newSortOrder, userTasks.length));
    others.splice(clamp - 1, 0, task);

    // Persist new sortOrders
    await prisma.$transaction(
      others.map((t: any, i: number) =>
        (prisma as any).qaCycleTask.update({ where: { id: t.id }, data: { sortOrder: i + 1 } }),
      ),
    );

    // Recalculate dates for the full cycle (all testers, preserving their orders)
    const cycleStart = new Date(task.cycle.plannedStart);
    const newCycleEnd = await this.rescheduleFullCycle(cycleId, cycleStart);

    // Cascade to subsequent core cycles
    await this.cascadeFromCycle(task.cycle.workPlanId, task.cycle.cycleType, newCycleEnd);

    // Resolve versionId from workPlanId
    const workPlan = await (prisma as any).qaWorkPlan.findUnique({
      where:  { id: task.cycle.workPlanId },
      select: { versionId: true },
    });
    return this.getWorkPlan(workPlan?.versionId ?? '');
  }

  private async rescheduleFullCycle(cycleId: string, cycleStart: Date): Promise<Date> {
    const allTasks: any[] = await (prisma as any).qaCycleTask.findMany({
      where:   { cycleId, taskType: { not: 'REGRESSION' } },
      orderBy: [{ userId: 'asc' }, { sortOrder: 'asc' }],
    });

    const testerMap = new Map<string, any[]>();
    allTasks.forEach((t: any) => {
      if (!testerMap.has(t.userId)) testerMap.set(t.userId, []);
      testerMap.get(t.userId)!.push(t);
    });

    let maxEnd = new Date(cycleStart);

    for (const [, tasks] of testerMap) {
      let pointer = new Date(cycleStart);
      for (const task of tasks) {
        // Deactivated tasks don't occupy schedule time — skip them so the
        // tester's remaining active tasks close the gap instead of leaving
        // a dead slot where the disabled task used to sit.
        if (!task.isActive) continue;
        const start = new Date(pointer);
        const end   = addWorkDays(start, Math.max(1, task.effortDays) - 1);
        await (prisma as any).qaCycleTask.update({
          where: { id: task.id },
          data:  { plannedStart: start, plannedEnd: end },
        });
        pointer = nextWorkDay(end);
        if (end > maxEnd) maxEnd = end;
      }
    }

    // Rebuild regression fills
    await (prisma as any).qaCycleTask.deleteMany({ where: { cycleId, taskType: 'REGRESSION' } });
    for (const [userId, tasks] of testerMap) {
      const lastTask = tasks[tasks.length - 1];
      if (!lastTask) continue;
      const updated: any = await (prisma as any).qaCycleTask.findUnique({ where: { id: lastTask.id } });
      const testerEnd = new Date(updated.plannedEnd);
      if (testerEnd < maxEnd) {
        const fillStart = nextWorkDay(testerEnd);
        const fillDays  = countWorkDays(fillStart, maxEnd);
        if (fillDays > 0) {
          await (prisma as any).qaCycleTask.create({
            data: {
              cycleId, crNumber: 'REGRESSION_FILL', crLabel: 'בדיקות רגרסיה',
              taskType: 'REGRESSION', userId,
              effortDays: fillDays, plannedStart: fillStart, plannedEnd: maxEnd,
              isActive: true, isPrimary: true, sortOrder: 9999,
            },
          });
        }
      }
    }

    await (prisma as any).qaCycle.update({
      where: { id: cycleId },
      data:  { plannedStart: cycleStart, plannedEnd: maxEnd },
    });

    return maxEnd;
  }

  private async cascadeFromCycle(workPlanId: string, fromCycleType: string, fromCycleEnd: Date) {
    const CORE_ORDER = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'];
    const fromIdx = CORE_ORDER.indexOf(fromCycleType);
    if (fromIdx === -1) return;

    const allCycles: any[] = await (prisma as any).qaCycle.findMany({ where: { workPlanId } });
    const cycleMap = new Map<string, any>(allCycles.map((c: any) => [c.cycleType, c]));

    let pointer = fromCycleEnd;

    for (let i = fromIdx + 1; i < CORE_ORDER.length; i++) {
      const ct    = CORE_ORDER[i];
      const cycle = cycleMap.get(ct);
      if (!cycle) continue;
      const cycleStart = nextWorkDay(pointer);
      pointer = await this.rescheduleFullCycle(cycle.id, cycleStart);
    }

    // Chain UAT → Rehearsal → GoLive
    const uatCycle = cycleMap.get('UAT');
    if (uatCycle) {
      const uatStart = nextWorkDay(pointer);
      await (prisma as any).qaCycle.update({ where: { id: uatCycle.id }, data: { plannedStart: uatStart, plannedEnd: uatStart } });
      pointer = uatStart;
      const rehCycle = cycleMap.get('REHEARSAL');
      if (rehCycle) {
        const rStart = nextWorkDay(pointer);
        await (prisma as any).qaCycle.update({ where: { id: rehCycle.id }, data: { plannedStart: rStart, plannedEnd: rStart } });
        pointer = rStart;
        const glCycle = cycleMap.get('GO_LIVE');
        if (glCycle) {
          const glStart = nextWorkDay(pointer);
          await (prisma as any).qaCycle.update({ where: { id: glCycle.id }, data: { plannedStart: glStart, plannedEnd: glStart } });
        }
      }
    }
  }

  // ── Export to Excel ─────────────────────────────────────────────────────────

  async exportToExcel(versionId: string): Promise<{ buffer: Buffer; filename: string }> {
    const plan = await this.getWorkPlan(versionId);
    if (!plan) throw new NotFoundException('תוכנית עבודה לא נמצאה');

    const version = await prisma.version.findUnique({
      where: { id: versionId },
      select: { name: true },
    });

    // ── Load VCA data: crManager, crDescription, team assignments per CR ─────
    const vcas = await prisma.versionCrAssignment.findMany({
      where:   { versionId },
      include: { team: { select: { name: true } } },
    });
    const vcaFirstMap = new Map<string, typeof vcas[0]>();  // crNumber → first VCA
    const crTeamsMap  = new Map<string, Set<string>>();     // crNumber → team names
    const crTeamEstimateMap = new Map<string, Map<string, number>>(); // crNumber → team name → investment estimate (days)
    for (const vca of vcas) {
      if (!vcaFirstMap.has(vca.crNumber)) vcaFirstMap.set(vca.crNumber, vca);
      if (!crTeamsMap.has(vca.crNumber)) crTeamsMap.set(vca.crNumber, new Set());
      crTeamsMap.get(vca.crNumber)!.add(vca.team.name);
      // teamEstimateDays is this team's own column from CR_LIST; estimateDays (CR total)
      // is the fallback used elsewhere in the app when the per-team sync value is missing.
      const days = vca.teamEstimateDays ?? vca.estimateDays ?? null;
      if (days != null) {
        if (!crTeamEstimateMap.has(vca.crNumber)) crTeamEstimateMap.set(vca.crNumber, new Map());
        crTeamEstimateMap.get(vca.crNumber)!.set(vca.team.name, days);
      }
    }

    // System column (AP→BR) — which DB team names activate a 'Y' flag
    const SYSTEM_TEAMS: string[][] = [
      [],                          // AP  A&A
      ['CRM Dev Team'],            // AQ  CRM
      ['NETC Team'],               // AR  WIZ
      ['NC Team'],                 // AS  NC
      ['EAI Team'],                // AT  EAI
      ['Web Dev Team'],            // AU  WEB
      ['OSS Team'],                // AV  OSS
      ['Provisioning Team'],       // AW  PROV
      ['IVR Team'],                // AX  IVR
      ['ETL Team'],                // AY  ETL
      ['Setup Team'],              // AZ  SETUP
      ['TV Team'],                 // BA  TV
      ['BI Team'],                 // BB  BI
      ['ERP Team'],                // BC  ERP
      ['Cyber Security Team'],     // BD  אבט"מ
      ['DBA Team'],                // BE  DBA
      ['NETCOL Team'],             // BF  NETCOL
      [],                          // BG  TOP
      [],                          // BH  JACADA
      ['CAWA Team'],               // BI  CAWA
      ['PrintBoss Team'],          // BJ  PRINTBOS
      [],                          // BK  MAILIT
      [],                          // BL  REMEDY
      ['Cyber Security Team'],     // BM  CYBER
      [],                          // BN  SYSTEM UNIX
      [],                          // BO  SYSTEM
      [],                          // BP  CM
      [],                          // BQ  תקשורת
      [],                          // BR  Release Stability
    ];

    // Returns this team's investment-estimate days for the CR (matching CR_LIST's own
    // per-team columns), falling back to 'Y' only when the CR is assigned to the team
    // but no estimate number was synced yet.
    const sysFlag = (crNumber: string, teams: string[]): string | number => {
      if (!teams.length) return '';
      const crTeams = crTeamsMap.get(crNumber);
      if (!crTeams || !teams.some(t => crTeams.has(t))) return '';
      const estimates = crTeamEstimateMap.get(crNumber);
      const matchedTeam = teams.find(t => estimates?.has(t));
      return matchedTeam ? estimates!.get(matchedTeam)! : 'Y';
    };

    // ── Build per-CR flat map ─────────────────────────────────────────────────
    type TaskRef = { start: string; end: string; tester: string; effort: number };
    type CrRow = {
      crNumber:            string;
      crLabel:             string;
      application:         string;
      sortOrder:           number;
      primaryTester:       string;
      primaryEffortDays:   number;
      secondaryTester:     string;
      secondaryEffortDays: number;
      cycles:              Partial<Record<CycleType, TaskRef>>;
    };

    // Keyed by crNumber for normal CRs (one primary + optional secondary tester),
    // but by `crNumber::userId` for "all testers" CRs (e.g. TARGET defect-handling)
    // where multiple distinct primary testers share the same crNumber — each gets
    // its own row rather than the later one silently overwriting the earlier ones.
    const crMap = new Map<string, CrRow>();
    const primaryKeyByCr = new Map<string, string>(); // crNumber → the row key holding its (single) secondary tester slot

    for (const cycle of plan.cycles) {
      const ct = cycle.cycleType as CycleType;
      for (const task of cycle.tasks) {
        if (task.taskType === 'REGRESSION') continue;
        if (!task.isActive) continue;

        const rowKey = task.isPrimary ? `${task.crNumber}::${task.userId}` : (primaryKeyByCr.get(task.crNumber) ?? task.crNumber);
        if (task.isPrimary) primaryKeyByCr.set(task.crNumber, rowKey);

        if (!crMap.has(rowKey)) {
          crMap.set(rowKey, {
            crNumber:            task.crNumber,
            crLabel:             (task as any).crLabel ?? task.crNumber,
            application:         (task as any).application ?? '',
            sortOrder:           task.sortOrder,
            primaryTester:       '',
            primaryEffortDays:   0,
            secondaryTester:     '',
            secondaryEffortDays: 0,
            cycles:              {},
          });
        }

        const row = crMap.get(rowKey)!;
        if (!row.cycles[ct]) {
          row.cycles[ct] = {
            start:  formatDate(task.plannedStart),
            end:    formatDate(task.plannedEnd),
            tester: task.user.fullName,
            effort: task.effortDays,
          };
        }

        if (task.isPrimary) {
          row.primaryTester     = task.user.fullName;
          row.primaryEffortDays = task.effortDays;
          row.sortOrder         = task.sortOrder;
        } else if (!row.secondaryTester) {
          row.secondaryTester     = task.user.fullName;
          row.secondaryEffortDays = task.effortDays;
        }
      }
    }

    const sortedCrs = Array.from(crMap.values())
      .sort((a, b) => a.sortOrder - b.sortOrder);

    // ── Headers — exact ALM column names, A through BR (70 columns) ──────────
    const headers = [
      'CR - RQ_USER_02',                          // A
      'Project (Folder - 3)',                      // B
      'CR Name - RQ_REQ_NAME',                     // C
      'Description - RE_REQ_COMMENT',              // D
      'CR Type - RQ_USER_04',                      // E
      'Task Order',                                // F
      'Asign To - RQ_USER_05',                     // G
      'QA effort',                                 // H
      'rq_user_27 Secondary Tester',               // I
      'QA effort 2',                               // J
      'QA BI',                                     // K
      'QA BI_Efforts',                             // L
      'Cycle 0',                                   // M
      'UAT',                                       // N
      'Cycle 1',                                   // O
      'Start Date rq_user_21',                     // P
      'Target Date rq_user_08',                    // Q
      'Cycle 2',                                   // R
      'Start Date rq_user_21 Cycle 2',             // S
      'Target Date rq_user_08 Cycle 2',            // T
      'Cycle 3',                                   // U
      'Start Date rq_user_21 Cycle 3',             // V
      'Target Date rq_user_08 Cycle 3',            // W
      'Stand Alone Items',                         // X
      'Start Date rq_user_21 Stand Alone Items',   // Y
      'Target Date rq_user_08 Stand Alone Items',  // Z
      'Dress Rehearsal',                           // AA
      'Go Live',                                   // AB
      'Go Live Date rq_user_12',                   // AC
      'Release (Folder - 2)',                      // AD
      'QA_Manager rq_user_28',                     // AE
      'Setup',                                     // AF
      'אפיון הסתיים',                              // AG
      'Complexity rq_user_25',                     // AH
      'מנהל CR',                                   // AI
      'שם מאפיין',                                 // AJ
      'מנהל פרויקט',                               // AK
      'Scoping_Date rq_user_03',                   // AL
      'Comments - RQ_DEV_COMMENTS',                // AM
      'Priority',                                  // AN
      'Responsibility',                            // AO
      'A&A',                                       // AP
      'CRM',                                       // AQ
      'WIZ',                                       // AR
      'NC',                                        // AS
      'EAI',                                       // AT
      'WEB',                                       // AU
      'OSS',                                       // AV
      'PROV',                                      // AW
      'IVR',                                       // AX
      'ETL',                                       // AY
      'SETUP',                                     // AZ
      'TV',                                        // BA
      'BI',                                        // BB
      'ERP',                                       // BC
      'אבט"מ',                                     // BD
      'DBA',                                       // BE
      'NETCOL',                                    // BF
      'TOP',                                       // BG
      'JACADA',                                    // BH
      'CAWA',                                      // BI
      'PRINTBOS',                                  // BJ
      'MAILIT',                                    // BK
      'REMEDY',                                    // BL
      'CYBER',                                     // BM
      'SYSTEM UNIX',                               // BN
      'SYSTEM',                                    // BO
      'CM',                                        // BP
      'תקשורת',                                    // BQ
      'Release Stability',                         // BR
    ];

    // ── Data rows (row 2 onwards) ─────────────────────────────────────────────
    const dataRows: any[][] = sortedCrs.map((cr, idx) => {
      const c1  = cr.cycles['CYCLE_1'];
      const c2  = cr.cycles['CYCLE_2'];
      const c3  = cr.cycles['CYCLE_3'];
      const sa  = cr.cycles['STAND_ALONE'];
      const uat = cr.cycles['UAT'];
      const reh = cr.cycles['REHEARSAL'];
      const gl  = cr.cycles['GO_LIVE'];

      const vca        = vcaFirstMap.get(cr.crNumber);
      const crManager  = vca?.crManager  ?? '';
      const crDesc     = vca?.crDescription ?? '';
      const hasSetup   = crTeamsMap.get(cr.crNumber)?.has('Setup Team') ?? false;

      return [
        cr.crNumber,                                // A  CR - RQ_USER_02
        cr.application,                             // B  Project (Folder - 3)
        cr.crLabel,                                 // C  CR Name
        crDesc,                                     // D  Description - RE_REQ_COMMENT
        'Release Item',                             // E  CR Type
        idx + 1,                                    // F  Task Order
        cr.primaryTester,                           // G  Asign To
        cr.primaryEffortDays || '',                 // H  QA effort
        cr.secondaryTester,                         // I  rq_user_27 Secondary Tester
        cr.secondaryEffortDays || '',               // J  QA effort 2
        cr.primaryTester ? 'Y' : '',                // K  QA BI
        '',                                         // L  QA BI_Efforts
        '',                                         // M  Cycle 0
        uat ? 'Y' : '',                             // N  UAT
        c1  ? 'Y' : '',                             // O  Cycle 1
        c1  ? c1.start : '',                        // P  Start Date Cycle 1
        c1  ? c1.end   : '',                        // Q  Target Date Cycle 1
        c2  ? 'Y' : '',                             // R  Cycle 2
        c2  ? c2.start : '',                        // S  Start Date Cycle 2
        c2  ? c2.end   : '',                        // T  Target Date Cycle 2
        c3  ? 'Y' : '',                             // U  Cycle 3
        c3  ? c3.start : '',                        // V  Start Date Cycle 3
        c3  ? c3.end   : '',                        // W  Target Date Cycle 3
        sa  ? 'Y' : '',                             // X  Stand Alone Items
        sa  ? sa.start : '',                        // Y  Start Date Stand Alone
        sa  ? sa.end   : '',                        // Z  Target Date Stand Alone
        reh ? 'Y' : '',                             // AA Dress Rehearsal
        gl  ? 'Y' : '',                             // AB Go Live
        gl  ? gl.start : '',                        // AC Go Live Date
        '',                                         // AD Release (Folder - 2)
        '',                                         // AE QA_Manager
        hasSetup ? 'Y' : '',                        // AF Setup
        '',                                         // AG אפיון הסתיים
        '',                                         // AH Complexity
        crManager,                                  // AI מנהל CR
        cr.application,                             // AJ שם מאפיין
        '',                                         // AK מנהל פרויקט
        '',                                         // AL Scoping_Date
        crDesc,                                     // AM Comments - RQ_DEV_COMMENTS
        '',                                         // AN Priority
        '',                                         // AO Responsibility
        ...SYSTEM_TEAMS.map(teams => sysFlag(cr.crNumber, teams)), // AP-BR (29 system flags)
      ];
    });

    const wb = XLSX.utils.book_new();

    // ── Main flat sheet ───────────────────────────────────────────────────────
    const ws = XLSX.utils.aoa_to_sheet([headers, ...dataRows]);
    ws['!cols'] = [
      { wch: 10 }, { wch: 18 }, { wch: 35 }, { wch: 40 }, { wch: 14 }, { wch: 8  }, // A-F
      { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 6  }, { wch: 10 }, // G-L
      { wch: 7  }, { wch: 6  }, { wch: 7  }, { wch: 14 }, { wch: 14 }, { wch: 7  }, // M-R
      { wch: 14 }, { wch: 14 }, { wch: 7  }, { wch: 14 }, { wch: 14 }, { wch: 12 }, // S-X
      { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 8  }, { wch: 14 }, { wch: 16 }, // Y-AD
      { wch: 16 }, { wch: 8  }, { wch: 12 }, { wch: 16 }, { wch: 12 }, { wch: 12 }, // AE-AJ
      { wch: 12 }, { wch: 16 }, { wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 6  }, // AK-AP
      { wch: 6  }, { wch: 6  }, { wch: 6  }, { wch: 6  }, { wch: 6  }, { wch: 6  }, // AQ-AV
      { wch: 6  }, { wch: 6  }, { wch: 6  }, { wch: 6  }, { wch: 6  }, { wch: 6  }, // AW-BB
      { wch: 6  }, { wch: 8  }, { wch: 6  }, { wch: 8  }, { wch: 6  }, { wch: 8  }, // BC-BH
      { wch: 6  }, { wch: 9  }, { wch: 8  }, { wch: 8  }, { wch: 12 }, { wch: 8  }, // BI-BN
      { wch: 8  }, { wch: 6  }, { wch: 8  }, { wch: 14 },                            // BO-BR
    ];

    // Freeze header row
    ws['!freeze'] = { xSplit: 0, ySplit: 1 };

    XLSX.utils.book_append_sheet(wb, ws, 'תוכנית עבודה');

    // ── Summary sheet ─────────────────────────────────────────────────────────
    const summaryRows: any[][] = [
      [`תוכנית בדיקות — ${version?.name ?? versionId}`],
      [],
      ['סבב', 'התחלה', 'סיום', 'ימי עבודה', 'CRים פעילים'],
    ];
    for (const cycle of plan.cycles) {
      const label    = CYCLE_LABEL[cycle.cycleType as CycleType] ?? cycle.cycleType;
      const workDays = countWorkDays(new Date(cycle.plannedStart), new Date(cycle.plannedEnd));
      const tasks    = cycle.tasks.filter(t => t.isActive && t.taskType !== 'REGRESSION').length;
      summaryRows.push([label, formatDate(cycle.plannedStart), formatDate(cycle.plannedEnd), workDays, tasks]);
    }
    const ws0 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws0['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws0, 'סיכום');

    const buf = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));

    // ── Generate filename with timestamp ──────────────────────────────────────
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ts  = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}`;
    const safeName = (version?.name ?? versionId).replace(/[/\\?%*:|"<>]/g, '-');
    const filename = `qa-workplan_${safeName}_${ts}.xlsx`;

    // ── Save to configured path if QA_EXPORT_PATH param is set ───────────────
    const pathParam = await prisma.systemParam.findUnique({ where: { key: 'QA_EXPORT_PATH' } });
    if (pathParam?.value?.trim()) {
      try {
        const dir = pathParam.value.trim();
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, filename), buf);
      } catch { /* save failure should not block the download */ }
    }

    return { buffer: buf, filename };
  }
}

function formatDate(d: Date | string): string {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
