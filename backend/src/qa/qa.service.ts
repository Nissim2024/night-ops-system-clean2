import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { scoreForCr, ScoringResult } from './qa.engine';
import { addWorkDays, nextWorkDay, getFirstWorkDay } from './qa.scheduler';

const prisma = new PrismaClient();

@Injectable()
export class QaService {

  // ── Skills ──────────────────────────────────────────────────────────────────

  async getSkills() {
    return prisma.skill.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  }

  async createSkill(name: string, type: string, weight?: number) {
    const valid = ['Professional', 'Applications', 'Tools', 'Personal', 'Business'];
    if (!valid.includes(type)) throw new BadRequestException(`type חייב להיות אחד מ: ${valid.join(', ')}`);
    try {
      return await prisma.skill.create({ data: { name: name.trim(), type: type as any, ...(weight ? { weight } : {}) } });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException(`סקיל "${name}" כבר קיים`);
      throw e;
    }
  }

  async deleteSkill(skillId: string) {
    await prisma.skill.delete({ where: { id: skillId } }).catch(() => {
      throw new NotFoundException('סקיל לא נמצא');
    });
  }

  // ── Tester Profiles ─────────────────────────────────────────────────────────

  async getTesters() {
    const profiles = await prisma.testerProfile.findMany({
      where: { isActive: true },
      include: {
        user: { select: { id: true, fullName: true, email: true, role: true } },
        testerSkills: { include: { skill: true } },
      },
      orderBy: { user: { fullName: 'asc' } },
    });
    return profiles.map(p => ({
      userId:   p.userId,
      fullName: p.user.fullName,
      email:    p.user.email,
      role:     p.user.role,
      skills:   p.testerSkills.map(ts => ({
        skillId:   ts.skillId,
        skillName: ts.skill.name,
        skillType: ts.skill.type,
        level:     ts.level,
      })),
    }));
  }

  async addTester(userId: string) {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('משתמש לא נמצא');
    try {
      return await prisma.testerProfile.create({ data: { userId } });
    } catch (e: any) {
      if (e.code === 'P2002') throw new ConflictException('משתמש זה כבר רשום כבודק');
      throw e;
    }
  }

  async removeTester(userId: string) {
    await prisma.testerProfile.update({
      where: { userId },
      data: { isActive: false },
    }).catch(() => { throw new NotFoundException('בודק לא נמצא'); });
  }

  // ── Matrix ──────────────────────────────────────────────────────────────────

  async getMatrix() {
    const [testers, skills] = await Promise.all([
      this.getTesters(),
      this.getSkills(),
    ]);
    return { testers, skills };
  }

  async setSkillLevel(userId: string, skillId: string, level: number) {
    if (!Number.isInteger(level) || (level !== -1 && (level < 1 || level > 5))) {
      throw new BadRequestException('רמה חייבת להיות בין 1 ל-5, או -1 (לא רלוונטי)');
    }
    const [tester, skill] = await Promise.all([
      prisma.testerProfile.findUnique({ where: { userId } }),
      prisma.skill.findUnique({ where: { id: skillId } }),
    ]);
    if (!tester) throw new NotFoundException('בודק לא נמצא');
    if (!skill)  throw new NotFoundException('סקיל לא נמצא');

    return prisma.testerSkill.upsert({
      where:  { userId_skillId: { userId, skillId } },
      create: { userId, skillId, level },
      update: { level },
    });
  }

  async removeSkillLevel(userId: string, skillId: string) {
    await prisma.testerSkill.delete({
      where: { userId_skillId: { userId, skillId } },
    }).catch(() => { throw new NotFoundException('רשומה לא נמצאה'); });
  }

  // ── Assignments ──────────────────────────────────────────────────────────────

  private readonly APP_SKILL_NAMES = [
    'Wizard', 'CRM', 'ZOO', 'Provisioning', 'TOP', 'OSB', 'WEB', 'DWH', 'Remedy', 'IVR', 'ERP',
  ];

  private extractSystemHints(application: string | null, systems: string[], label: string): string[] {
    const hints = new Set<string>();
    if (application && application !== 'null') hints.add(application);
    systems.filter(Boolean).forEach(s => hints.add(s));
    const lbl = label.toLowerCase();
    this.APP_SKILL_NAMES.forEach(app => {
      if (lbl.includes(app.toLowerCase())) hints.add(app);
    });
    return [...hints];
  }

  private scoreTester(tester: Awaited<ReturnType<QaService['getTesters']>>[number], hints: string[]) {
    const appSkills = tester.skills.filter(s => s.skillType === 'Applications');
    const matching = appSkills.filter(s =>
      hints.some(hint =>
        s.skillName.toLowerCase().includes(hint.toLowerCase()) ||
        hint.toLowerCase().includes(s.skillName.toLowerCase()),
      ),
    );
    return { score: matching.reduce((sum, s) => sum + s.level, 0), matchedSkills: matching };
  }

  async getAssignments(versionId: string) {
    return prisma.qaAssignment.findMany({
      where: { versionId },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
      orderBy: { crNumber: 'asc' },
    });
  }

  async recommendTesters(versionId: string) {
    const [vcaRows, plans, testers] = await Promise.all([
      prisma.versionCrAssignment.findMany({ where: { versionId } }),
      prisma.crPlan.findMany({ where: { versionId }, select: { crNumber: true, systems: true, riskLevel: true } }),
      this.getTesters(),
    ]);

    // Deduplicate CRs — keep first occurrence for label/application/project
    const crMap = new Map<string, any>();
    vcaRows.forEach(c => { if (!crMap.has(c.crNumber)) crMap.set(c.crNumber, c); });
    const planMap = new Map(plans.map(p => [p.crNumber, p]));

    // qaEffortDays: prefer the QA Team row (the only one that has qaEffort set)
    const qaTeam = await prisma.team.findFirst({ where: { name: 'QA Team' } });
    const qaEffortMap  = new Map<string, number>(); // crNumber → days (when set)
    const qaTeamCrSet  = new Set<string>();          // crNumbers that have ANY QA Team row
    if (qaTeam) {
      vcaRows
        .filter(v => v.teamId === qaTeam.id)
        .forEach(v => {
          qaTeamCrSet.add(v.crNumber);
          const effort = (v as any).qaEffortOverride ?? (v as any).qaEffort;
          if (effort != null) qaEffortMap.set(v.crNumber, effort);
        });
    }

    // Show CRs that have a QA Team VCA row — even if qaEffort is null (data gap from old import)
    return [...crMap.values()]
      .filter(cr => qaTeamCrSet.has(cr.crNumber))
      .map(cr => {
        const plan = planMap.get(cr.crNumber);
        const hints = this.extractSystemHints(cr.application, plan?.systems ?? [], cr.crLabel ?? '');
        const scored = testers
          .map(t => ({ ...t, ...this.scoreTester(t, hints) }))
          .sort((a, b) => b.score - a.score);

        return {
          crNumber:     cr.crNumber,
          crLabel:      cr.crLabel,
          application:  cr.application,
          project:      cr.project ?? null,
          isStandAlone: (cr as any).isStandAlone ?? false,
          qaEffortDays: qaEffortMap.get(cr.crNumber) ?? null,
          systems:      hints,
          riskLevel:    plan?.riskLevel ?? null,
          testers:      scored,
        };
      });
  }

  async upsertAssignment(
    versionId:   string,
    crNumber:    string,
    crLabel:     string | null,
    userId:      string,
    notes?:      string,
    assignedBy?: string,
    autoScore?:  number,
    isStandAlone?: boolean | null,
    cycles?:     string[],
    sortOrder?:  number,
  ) {
    const vca = await prisma.versionCrAssignment.findFirst({
      where:  { versionId, crNumber },
      select: { application: true, qaEffort: true, isStandAlone: true },
    });
    const application = vca?.application ?? null;
    const qaEffort    = (vca as any)?.qaEffort ?? null;

    // Default cycles from VCA.isStandAlone when not explicitly provided
    const vcaSA         = (vca as any)?.isStandAlone ?? false;
    const finalCycles   = cycles ?? (vcaSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);

    // Auto sortOrder on CREATE: max for this tester + 1
    let nextSortOrder = sortOrder;
    const existing = await prisma.qaAssignment.findUnique({
      where: { versionId_crNumber: { versionId, crNumber } },
    });
    if (!existing && nextSortOrder === undefined) {
      const agg = await (prisma.qaAssignment as any).aggregate({
        where: { versionId, userId },
        _max:  { sortOrder: true },
      });
      nextSortOrder = ((agg._max?.sortOrder ?? 0) as number) + 1;
    }

    return prisma.qaAssignment.upsert({
      where:  { versionId_crNumber: { versionId, crNumber } },
      create: {
        versionId, crNumber, crLabel, userId, notes, assignedBy, application, qaEffort,
        autoScore: autoScore ?? null,
        isStandAlone: isStandAlone ?? null,
        cycles:      finalCycles,
        sortOrder:   nextSortOrder ?? 1,
      } as any,
      update: {
        userId, crLabel, notes, assignedBy, application,
        autoScore: autoScore ?? null,
        // qaEffort intentionally excluded — manual overrides via patchAssignment must not be overwritten on re-assign
        ...(isStandAlone !== undefined && { isStandAlone: isStandAlone ?? null }),
        ...(cycles       !== undefined && { cycles: finalCycles }),
        ...(sortOrder    !== undefined && { sortOrder }),
      } as any,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });
  }

  async patchAssignment(id: string, patch: {
    isStandAlone?: boolean | null;
    cycles?:       string[];
    sortOrder?:    number;
    qaEffort?:     number | null;
  }) {
    const result = await prisma.qaAssignment.update({
      where:   { id },
      data:    patch as any,
      include: { user: { select: { id: true, fullName: true, email: true } } },
    });

    if (patch.qaEffort != null) {
      await this.cascadeEffortToWorkPlan(
        (result as any).versionId,
        (result as any).crNumber,
        patch.qaEffort,
      );
    }

    return result;
  }

  private async cascadeEffortToWorkPlan(
    versionId: string,
    crNumber:  string,
    qaEffort:  number,
  ) {
    const plan = await (prisma as any).qaWorkPlan.findUnique({ where: { versionId } });
    if (!plan) return;

    const RATIO: Record<string, number> = {
      CYCLE_1: 1.0, CYCLE_2: 0.5, CYCLE_3: 0.30, STAND_ALONE: 1.0,
    };

    // Ordered core types (determine chained start dates); Stand Alone is parallel to core
    const CORE_ORDER = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'] as const;

    const allCycles = await (prisma as any).qaCycle.findMany({
      where:   { workPlanId: plan.id },
      include: { tasks: { where: { taskType: { not: 'REGRESSION' } }, orderBy: { sortOrder: 'asc' } } },
    });

    const cycleByType = new Map<string, any>(allCycles.map((c: any) => [c.cycleType, c]));

    // Reschedule a single cycle: recalculate all task dates per tester, return new maxEnd
    const reschedule = async (cycle: any, cycleStart: Date, ratio: number): Promise<Date> => {
      const newEffortForCr = Math.max(0.5, Math.round(qaEffort * ratio * 2) / 2);

      // Group tasks by tester, preserve sortOrder
      const testerMap = new Map<string, any[]>();
      for (const t of cycle.tasks) {
        const arr = testerMap.get(t.userId) ?? [];
        arr.push(t);
        testerMap.set(t.userId, arr);
      }

      let maxEnd = new Date(cycleStart);

      for (const [, testerTasks] of testerMap) {
        let pointer = new Date(cycleStart);

        for (const task of testerTasks) {
          const effortDays = task.crNumber === crNumber
            ? Math.max(1, Math.round(newEffortForCr))
            : task.effortDays;

          const taskStart = new Date(pointer);
          const taskEnd   = addWorkDays(taskStart, effortDays - 1);

          await (prisma as any).qaCycleTask.update({
            where: { id: task.id },
            data:  { effortDays, plannedStart: taskStart, plannedEnd: taskEnd },
          });

          pointer = nextWorkDay(taskEnd);
          if (taskEnd > maxEnd) maxEnd = taskEnd;
        }
      }

      // Rebuild regression-fill tasks: delete old ones, insert new ones
      await (prisma as any).qaCycleTask.deleteMany({
        where: { cycleId: cycle.id, taskType: 'REGRESSION' },
      });
      for (const [userId, testerTasks] of testerMap) {
        const lastTask = testerTasks[testerTasks.length - 1];
        if (!lastTask) continue;
        // Re-fetch updated plannedEnd for this tester's last task
        const updated = await (prisma as any).qaCycleTask.findUnique({ where: { id: lastTask.id } });
        const testerEnd = new Date(updated.plannedEnd);
        if (testerEnd < maxEnd) {
          const fillStart = nextWorkDay(testerEnd);
          let days = 0;
          const d = new Date(fillStart);
          d.setHours(0, 0, 0, 0);
          const e = new Date(maxEnd); e.setHours(0, 0, 0, 0);
          const tmp = new Date(d);
          while (tmp <= e) {
            const dow = tmp.getDay();
            if (dow !== 5 && dow !== 6) days++;
            tmp.setDate(tmp.getDate() + 1);
          }
          if (days > 0) {
            await (prisma as any).qaCycleTask.create({
              data: {
                cycleId:      cycle.id,
                crNumber:     'REGRESSION_FILL',
                crLabel:      'בדיקות רגרסיה',
                taskType:     'REGRESSION',
                userId,
                effortDays:   days,
                plannedStart: fillStart,
                plannedEnd:   maxEnd,
                isActive:     true,
                isPrimary:    true,
                sortOrder:    9999,
              },
            });
          }
        }
      }

      await (prisma as any).qaCycle.update({
        where: { id: cycle.id },
        data:  { plannedStart: cycleStart, plannedEnd: maxEnd },
      });

      return maxEnd;
    };

    // 1. Reschedule core cycles (CYCLE_1 → CYCLE_2 → CYCLE_3) in order
    let corePointer: Date | null = null;
    for (const ct of CORE_ORDER) {
      const cycle = cycleByType.get(ct);
      if (!cycle || RATIO[ct] == null) continue;

      const cycleStart = corePointer
        ? nextWorkDay(corePointer)
        : getFirstWorkDay(new Date(cycle.plannedStart));

      corePointer = await reschedule(cycle, cycleStart, RATIO[ct]!);
    }

    // 2. Stand Alone always starts at cycle1Start (parallel to core)
    const saCycle = cycleByType.get('STAND_ALONE');
    if (saCycle) {
      const cycle1 = cycleByType.get('CYCLE_1');
      const saStart = getFirstWorkDay(cycle1 ? new Date(cycle1.plannedStart) : new Date(plan.cycle1Start));
      await reschedule(saCycle, saStart, RATIO['STAND_ALONE']!);
    }

    // 3. Chain UAT → Rehearsal → Go-Live after core cycles
    if (corePointer) {
      const uatCycle = cycleByType.get('UAT');
      if (uatCycle) {
        const uatStart = nextWorkDay(corePointer);
        await (prisma as any).qaCycle.update({
          where: { id: uatCycle.id },
          data:  { plannedStart: uatStart, plannedEnd: uatStart },
        });

        const rehearsalCycle = cycleByType.get('REHEARSAL');
        if (rehearsalCycle) {
          const rStart = nextWorkDay(uatStart);
          await (prisma as any).qaCycle.update({
            where: { id: rehearsalCycle.id },
            data:  { plannedStart: rStart, plannedEnd: rStart },
          });

          const goLiveCycle = cycleByType.get('GO_LIVE');
          if (goLiveCycle) {
            const glStart = nextWorkDay(rStart);
            await (prisma as any).qaCycle.update({
              where: { id: goLiveCycle.id },
              data:  { plannedStart: glStart, plannedEnd: glStart },
            });
          }
        }
      }
    }
  }

  async deleteAssignment(id: string) {
    await prisma.qaAssignment
      .delete({ where: { id } })
      .catch(() => { throw new NotFoundException('שיבוץ לא נמצא'); });
  }

  // ── Scoring engine wrapper ────────────────────────────────────────────────────

  async scoreForCr(crNumber: string, versionId: string): Promise<ScoringResult> {
    return scoreForCr(crNumber, versionId);
  }

  async autoAssign(crNumber: string, versionId: string) {
    const result = await scoreForCr(crNumber, versionId);
    if (result.status === 'MANUAL_INTERVENTION') return result;

    const top = result.recommendations[0];
    const vca = await prisma.versionCrAssignment.findFirst({
      where:  { versionId, crNumber },
      select: { crLabel: true, isStandAlone: true },
    });
    await this.upsertAssignment(
      versionId, crNumber, vca?.crLabel ?? null,
      top.userId, undefined, 'auto-engine', top.totalScore,
      null, // isStandAlone = null → inherit from VCA; cycles auto-set in upsertAssignment
    );
    return { ...result, assigned: top };
  }

  // ── Available users (not yet testers) ───────────────────────────────────────

  async getAvailableUsers(teamId?: string) {
    const existingTesterIds = (await prisma.testerProfile.findMany({
      where: { isActive: true },
      select: { userId: true },
    })).map(p => p.userId);

    const teamFilter = teamId
      ? { teamMemberships: { some: { teamId } } }
      : {};

    return prisma.user.findMany({
      where: {
        active: true,
        id: { notIn: existingTesterIds },
        ...teamFilter,
      },
      select: { id: true, fullName: true, email: true, role: true },
      orderBy: { fullName: 'asc' },
    });
  }
}
