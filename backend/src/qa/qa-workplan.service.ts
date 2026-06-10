import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import {
  buildWorkPlan,
  CrInput,
  PlannedCycle,
  CYCLE_LABEL,
  CycleType,
  countWorkDays,
} from './qa.scheduler';

const prisma = new PrismaClient();

const CYCLE_ORDER: CycleType[] = [
  'CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'STAND_ALONE', 'UAT', 'REHEARSAL', 'GO_LIVE',
];

@Injectable()
export class QaWorkPlanService {

  // ── Generate / regenerate work plan ────────────────────────────────────────

  async generateWorkPlan(
    versionId: string,
    cycle1Start: Date,
    testingEnd: Date,
    createdBy?: string,
  ) {
    // 1. Validate version exists
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('גרסה לא נמצאה');

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

    for (const [crNumber, vca] of crMap) {
      const asg = qaAssignments.find(a => a.crNumber === crNumber);

      // Effort priority: assignment.qaEffort (team lead override) > VCA QA Team row > original VCA
      const asgEffort = (asg as any)?.qaEffort as number | null;
      const qaEffortDays = asgEffort ?? qaEffortMap.get(crNumber) ?? (vca as any).qaEffortOverride ?? (vca as any).qaEffort ?? null;

      // Skip CRs with no QA effort — they have no testing work and must not appear in unassigned warning
      if (!qaEffortDays || qaEffortDays <= 0) continue;

      const primaryId = asg?.userId ?? null;
      if (!primaryId) {
        unassigned.push(crNumber);
        continue;
      }
      const appName      = vca.application ?? null;
      const rawPrimary   = appName ? (skillMap.get(primaryId)?.get(appName) ?? 3) : 3;
      const primaryLevel = rawPrimary < 0 ? 1 : rawPrimary; // -1 (N/R) treated as 1 for effort-split ratio

      // Determine which cycles this CR belongs to:
      // 1. Use assignment.cycles if set
      // 2. Fall back to VCA.isStandAlone (or assignment.isStandAlone override)
      const asgCycles      = ((asg as any).cycles as string[]) ?? [];
      const vcaIsStandAlone = (vca as any).isStandAlone ?? false;
      const asgIsStandAlone = (asg as any).isStandAlone as boolean | null ?? null;
      const effectiveSA     = asgIsStandAlone !== null ? asgIsStandAlone : vcaIsStandAlone;
      const effectiveCycles = asgCycles.length > 0
        ? asgCycles
        : (effectiveSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);

      crInputs.push({
        crNumber,
        crLabel:             vca.crLabel ?? crNumber,
        qaEffortDays,
        cycles:              effectiveCycles,
        primaryTesterId:     primaryId,
        secondaryTesterId:   null,
        primarySkillLevel:   primaryLevel,
        secondarySkillLevel: 0,
      });
    }

    // 6. Run scheduler
    const plannedCycles: PlannedCycle[] = buildWorkPlan(crInputs, cycle1Start);

    // 7. Persist — delete existing plan for this version first
    await prisma.$transaction(async tx => {
      await tx.qaWorkPlan.deleteMany({ where: { versionId } });

      const plan = await tx.qaWorkPlan.create({
        data: {
          versionId,
          status:     'DRAFT',
          cycle1Start,
          testingEnd,
          createdBy:  createdBy ?? null,
        },
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

    return { ...plan, cycles: sorted };
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

    return prisma.qaCycleTask.update({
      where: { id: taskId },
      data:  { isActive },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
  }

  // ── Update task effort (team lead manual override) ──────────────────────────

  async updateTaskEffort(taskId: string, effortDays: number) {
    if (effortDays < 0.5) throw new BadRequestException('מאמץ מינימלי הוא 0.5 ימים');
    const task = await prisma.qaCycleTask.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('משימה לא נמצאה');
    return prisma.qaCycleTask.update({
      where: { id: taskId },
      data:  { effortDays },
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
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

  // ── Export to Excel ─────────────────────────────────────────────────────────

  async exportToExcel(versionId: string): Promise<Buffer> {
    const plan = await this.getWorkPlan(versionId);
    if (!plan) throw new NotFoundException('תוכנית עבודה לא נמצאה');

    const version = await prisma.version.findUnique({
      where: { id: versionId },
      select: { name: true },
    });

    const wb = XLSX.utils.book_new();

    for (const cycle of plan.cycles) {
      const label = CYCLE_LABEL[cycle.cycleType as CycleType] ?? cycle.cycleType;
      const sheetName = label.replace(/[\/\[\]\*\?:\\]/g, '').slice(0, 31);

      const header = ['מספר CR', 'תיאור', 'סוג', 'בודק', 'תאריך התחלה', 'תאריך סיום', 'ימים', 'פעיל'];

      const rows: any[][] = [header];

      const activeTasks = cycle.tasks
        .filter(t => t.taskType !== 'REGRESSION')
        .sort((a, b) => a.sortOrder - b.sortOrder);

      for (const task of activeTasks) {
        rows.push([
          task.crNumber,
          task.crLabel ?? '',
          task.taskType === 'STAND_ALONE' ? 'Stand Alone' : 'CR',
          task.user.fullName,
          formatDate(task.plannedStart),
          formatDate(task.plannedEnd),
          task.effortDays,
          task.isActive ? 'כן' : 'לא',
        ]);
      }

      if (cycle.notes) {
        rows.push([]);
        rows.push(['הערות:', cycle.notes]);
      }

      const ws = XLSX.utils.aoa_to_sheet(rows);

      // Column widths
      ws['!cols'] = [
        { wch: 12 }, { wch: 40 }, { wch: 12 }, { wch: 20 },
        { wch: 14 }, { wch: 14 }, { wch: 8  }, { wch: 6  },
      ];

      // RTL
      if (!ws['!opts']) ws['!opts'] = {};

      XLSX.utils.book_append_sheet(wb, ws, sheetName);
    }

    // Summary sheet
    const summaryRows: any[][] = [
      [`תוכנית בדיקות — ${version?.name ?? versionId}`],
      [],
      ['סבב', 'התחלה', 'סיום', 'ימים', 'משימות'],
    ];
    for (const cycle of plan.cycles) {
      const label    = CYCLE_LABEL[cycle.cycleType as CycleType] ?? cycle.cycleType;
      const workDays = countWorkDays(new Date(cycle.plannedStart), new Date(cycle.plannedEnd));
      const tasks    = cycle.tasks.filter(t => t.isActive && t.taskType !== 'REGRESSION').length;
      summaryRows.push([
        label,
        formatDate(cycle.plannedStart),
        formatDate(cycle.plannedEnd),
        workDays,
        tasks,
      ]);
    }
    const ws0 = XLSX.utils.aoa_to_sheet(summaryRows);
    ws0['!cols'] = [{ wch: 18 }, { wch: 14 }, { wch: 14 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws0, 'סיכום');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    return Buffer.from(buf);
  }
}

function formatDate(d: Date | string): string {
  const dt = new Date(d);
  const dd = String(dt.getDate()).padStart(2, '0');
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const yy = dt.getFullYear();
  return `${dd}/${mm}/${yy}`;
}
