import { Injectable, BadRequestException, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { scoreForCr, resolveSkillName, ScoringResult } from './qa.engine';
import { addWorkDays, nextWorkDay, getFirstWorkDay } from './qa.scheduler';
import { VersionCrAssignmentsService } from '../version-cr-assignments/version-cr-assignments.service';

const prisma = new PrismaClient();
const vcaService = new VersionCrAssignmentsService();

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

  // ── Matrix Excel import ───────────────────────────────────────────────────────
  // Expected layout: row 1 = header (col A "אימייל" / "Email", remaining columns = skill
  // names matching existing Skill.name). Data rows: col A = tester email, each skill column
  // = level 1-5, "N/R" (not relevant), or blank (leave untouched).

  async importMatrixFromBuffer(buffer: Buffer): Promise<{
    success: boolean;
    stats: { testersCreated: number; cellsUpdated: number; rowsSkipped: number };
    warnings: string[];
  }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (rows.length < 2) throw new BadRequestException('הקובץ ריק או חסר שורת כותרות');

    const header = rows[0].map(h => String(h ?? '').trim());
    if (!header[0] || !/email|אימייל/i.test(header[0])) {
      throw new BadRequestException('העמודה הראשונה חייבת להיות "אימייל"');
    }
    const skillColumns = header.slice(1).map((name, i) => ({ name: name.trim(), col: i + 1 }))
      .filter(c => c.name);

    const [allSkills, allUsers] = await Promise.all([
      prisma.skill.findMany(),
      prisma.user.findMany({ where: { active: true }, select: { id: true, email: true } }),
    ]);
    const skillByName = new Map(allSkills.map(s => [s.name.trim().toLowerCase(), s]));
    const userByEmail = new Map(allUsers.map(u => [u.email.trim().toLowerCase(), u]));

    const warnings: string[] = [];
    const unknownSkills = skillColumns.filter(c => !skillByName.has(c.name.toLowerCase()));
    unknownSkills.forEach(c => warnings.push(`עמודה "${c.name}" — סקיל לא קיים במערכת, דולגה`));
    const knownColumns = skillColumns.filter(c => skillByName.has(c.name.toLowerCase()));

    let testersCreated = 0;
    let cellsUpdated = 0;
    let rowsSkipped = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const email = String(row[0] ?? '').trim().toLowerCase();
      if (!email) continue;
      const excelRowNum = r + 1;
      const user = userByEmail.get(email);
      if (!user) {
        warnings.push(`שורה ${excelRowNum}: משתמש עם אימייל "${email}" לא נמצא — דולגה`);
        rowsSkipped++;
        continue;
      }

      let tester = await prisma.testerProfile.findUnique({ where: { userId: user.id } });
      if (!tester) {
        tester = await prisma.testerProfile.create({ data: { userId: user.id } });
        testersCreated++;
      } else if (!tester.isActive) {
        tester = await prisma.testerProfile.update({ where: { userId: user.id }, data: { isActive: true } });
      }

      for (const col of knownColumns) {
        const raw = row[col.col];
        if (raw === '' || raw === undefined || raw === null) continue; // blank = leave untouched
        const skill = skillByName.get(col.name.toLowerCase())!;
        let level: number;
        if (typeof raw === 'string' && /^n\/?r$/i.test(raw.trim())) {
          level = -1;
        } else {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1 || n > 5) {
            warnings.push(`שורה ${excelRowNum}, עמודה "${col.name}": ערך "${raw}" לא חוקי (1-5 או N/R) — דולג`);
            continue;
          }
          level = n;
        }
        await prisma.testerSkill.upsert({
          where:  { userId_skillId: { userId: user.id, skillId: skill.id } },
          create: { userId: user.id, skillId: skill.id, level },
          update: { level },
        });
        cellsUpdated++;
      }
    }

    return { success: true, stats: { testersCreated, cellsUpdated, rowsSkipped }, warnings };
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
        user:          { select: { id: true, fullName: true, email: true } },
        secondaryUser: { select: { id: true, fullName: true, email: true } },
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
          isCore:       (cr as any).isCore ?? false,
          priorityTestDate: (cr as any).priorityTestDate ?? null,
          notes:        (cr as any).notes ?? null,
          urgent:       (cr as any).urgent ?? false,
          qaArrivalDate: (cr as any).qaArrivalDate ?? null,
          qaReceived:    (cr as any).qaReceived ?? false,
          qaReceivedAt:  (cr as any).qaReceivedAt ?? null,
          qaEffortDays: qaEffortMap.get(cr.crNumber) ?? null,
          systems:      hints,
          riskLevel:    plan?.riskLevel ?? null,
          testers:      scored,
          isArchived:     (cr as any).isArchived ?? false,
          archivedAt:     (cr as any).archivedAt ?? null,
          archivedReason: (cr as any).archivedReason ?? null,
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
    // A CR can have a VersionCrAssignment row per team — only the QA Team's row
    // carries a reliable qaEffort (see CR_LIST import). Prefer it explicitly so
    // we don't silently pick up another team's row with a null effort.
    const qaTeam = await prisma.team.findFirst({ where: { name: 'QA Team' } });
    const vcaSelect = { application: true, qaEffort: true, qaEffortOverride: true, isStandAlone: true, urgent: true, priorityTestDate: true };
    const vca = (qaTeam && await prisma.versionCrAssignment.findFirst({
      where:  { versionId, crNumber, teamId: qaTeam.id },
      select: vcaSelect,
    })) ?? await prisma.versionCrAssignment.findFirst({
      where:  { versionId, crNumber },
      select: vcaSelect,
    });
    const application = vca?.application ?? null;
    const qaEffort    = (vca as any)?.qaEffortOverride ?? (vca as any)?.qaEffort ?? null;

    // Default cycles from VCA.isStandAlone when not explicitly provided
    const vcaSA         = (vca as any)?.isStandAlone ?? false;
    const finalCycles   = cycles ?? (vcaSA ? ['STAND_ALONE'] : ['CYCLE_1', 'CYCLE_2', 'CYCLE_3']);

    // Auto sortOrder on CREATE: max for this tester + 1 — except a CR flagged
    // urgent, or one that must go live before/outside this version (priorityTestDate
    // set), which jumps to the front of that tester's queue instead (min - 1).
    let nextSortOrder = sortOrder;
    const existing = await prisma.qaAssignment.findUnique({
      where: { versionId_crNumber: { versionId, crNumber } },
    });
    const isPriority = !!((vca as any)?.urgent || (vca as any)?.priorityTestDate);
    if (!existing && nextSortOrder === undefined) {
      const agg = await (prisma.qaAssignment as any).aggregate({
        where: { versionId, userId },
        _max:  { sortOrder: true },
        _min:  { sortOrder: true },
      });
      nextSortOrder = isPriority
        ? ((agg._min?.sortOrder ?? 1) as number) - 1
        : ((agg._max?.sortOrder ?? 0) as number) + 1;
    }

    const result = await prisma.qaAssignment.upsert({
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
        // Backfill qaEffort only when it was never set — a non-null value may be
        // a manual override via patchAssignment and must not be clobbered here.
        ...(existing?.qaEffort == null && qaEffort != null && { qaEffort }),
        ...(isStandAlone !== undefined && { isStandAlone: isStandAlone ?? null }),
        ...(cycles       !== undefined && { cycles: finalCycles }),
        ...(sortOrder    !== undefined && { sortOrder }),
      } as any,
      include: {
        user:          { select: { id: true, fullName: true, email: true } },
        secondaryUser: { select: { id: true, fullName: true, email: true } },
      },
    });

    // Stamp the assigned tester's skill-matrix entry as "recently used" for
    // this application, so the next scoring run's continuity check (qa.engine.ts)
    // reflects genuine recent engagement with this specific system rather than
    // any assignment anywhere.
    const skillName = resolveSkillName(application);
    if (skillName) {
      const skill = await prisma.skill.findFirst({ where: { name: skillName } });
      if (skill) {
        await prisma.testerSkill.updateMany({
          where: { userId, skillId: skill.id },
          data:  { lastUsedAt: new Date() },
        });
      }
    }

    return result;
  }

  async patchAssignment(id: string, patch: {
    isStandAlone?:        boolean | null;
    cycles?:              string[];
    sortOrder?:           number;
    qaEffort?:            number | null;
    secondaryTesterId?:   string | null;
    secondarySkillLevel?: number | null;
    secondaryParticipationPct?: number | null;
    standAloneDueDate?:   Date | null;
  }) {
    const result = await prisma.qaAssignment.update({
      where:   { id },
      data:    patch as any,
      include: {
        user:          { select: { id: true, fullName: true, email: true } },
        secondaryUser: { select: { id: true, fullName: true, email: true } },
      },
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

  // ── Reorder a tester's assignment queue ──────────────────────────────────────
  // This drives buildWorkPlan's manualSortOrder (see qa.scheduler.ts) — moving a
  // CR here changes where it lands the next time the work plan is generated for
  // this tester, not just the display order on this screen.
  async reorderAssignment(id: string, newSortOrder: number) {
    const asg = await prisma.qaAssignment.findUnique({ where: { id } });
    if (!asg) throw new NotFoundException('שיבוץ לא נמצא');

    const { versionId, userId } = asg;
    const queue = await prisma.qaAssignment.findMany({
      where:   { versionId, userId },
      orderBy: { sortOrder: 'asc' },
    });

    const others = queue.filter(a => a.id !== id);
    const clamp  = Math.max(1, Math.min(newSortOrder, queue.length));
    others.splice(clamp - 1, 0, asg);

    await prisma.$transaction(
      others.map((a, i) => prisma.qaAssignment.update({ where: { id: a.id }, data: { sortOrder: i + 1 } })),
    );

    return prisma.qaAssignment.findMany({
      where: { versionId },
      include: {
        user:          { select: { id: true, fullName: true, email: true } },
        secondaryUser: { select: { id: true, fullName: true, email: true } },
      },
    });
  }

  // ── Secondary tester suggestion ──────────────────────────────────────────────

  async suggestSecondaryTesters(versionId: string, crNumber: string) {
    const primaryAsg = await prisma.qaAssignment.findUnique({
      where: { versionId_crNumber: { versionId, crNumber } },
    });
    const primaryId          = primaryAsg?.userId ?? null;
    const currentSecondaryId = (primaryAsg as any)?.secondaryTesterId ?? null;

    // Learn the CR's real effort first (cheap probe, maxResults=1) so we can
    // score candidates against what a SECOND tester would actually carry.
    const probe             = await scoreForCr(crNumber, versionId, 1);
    const qaEffortDays      = primaryAsg?.qaEffort ?? probe.qaEffortDays ?? 0;
    // A second tester splits the total effort in half — not a skill-weighted ratio.
    const estimatedSecondaryEffort = Math.max(1, Math.round(qaEffortDays / 2));
    const estimatedPrimaryEffort   = Math.max(1, Math.round(qaEffortDays / 2));

    // Score against the halved effort — otherwise a large CR clamps every
    // candidate's load score to 0 and "best pick" degenerates to arbitrary order.
    const fullResult = await scoreForCr(crNumber, versionId, 20, estimatedSecondaryEffort);

    const candidates = fullResult.recommendations
      .filter((r: any) => r.userId !== primaryId)
      .map((r: any) => {
        const secLevel = r.breakdown.skill.level ?? 3;
        const adjSec   = secLevel < 0 ? 1 : secLevel;

        return {
          ...r,
          isCurrentSecondary:       r.userId === currentSecondaryId,
          estimatedSecondaryEffort,
          estimatedPrimaryEffort,
          timeSavingDays:           Math.max(0, qaEffortDays - estimatedPrimaryEffort),
          secondarySkillLevel:      adjSec,
        };
      });

    return {
      crNumber,
      crLabel:         fullResult.crLabel,
      qaEffortDays,
      primaryTesterId: primaryId,
      currentSecondaryId,
      candidates,
    };
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

  // Deletes every QaAssignment for this version — the granular counterpart to
  // Version.delete() (which used to be the only way to clear this data, by
  // deleting the whole version). Doesn't touch the generated work plan
  // (QaWorkPlan/QaCycleTask) — see deleteWorkPlan on QaWorkPlanService for that.
  async deleteAllAssignments(versionId: string) {
    const { count } = await prisma.qaAssignment.deleteMany({ where: { versionId } });
    return { deleted: count };
  }

  // ── Scoring engine wrapper ────────────────────────────────────────────────────

  async scoreForCr(crNumber: string, versionId: string): Promise<ScoringResult> {
    return scoreForCr(crNumber, versionId);
  }

  async getCrChangeDetail(versionId: string, crNumber: string) {
    const qaTeam = await prisma.team.findFirst({ where: { name: 'QA Team' } });
    if (!qaTeam) throw new BadRequestException('צוות QA לא נמצא');
    return vcaService.getChangeDetail(versionId, crNumber, qaTeam.id);
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

  // Cycle 1's length is driven by whichever tester's CR takes longest (they're
  // scheduled back-to-back per tester — see scheduleSingleCycle in qa.scheduler.ts).
  // A CR without a secondary tester whose effort alone exceeds the configured
  // threshold is flagged here, reusing the existing (previously frontend-unused)
  // suggestSecondaryTesters() scoring/estimate logic for the actual candidate —
  // surfaced for the user to approve, not applied automatically.
  async getSecondTesterSuggestions(versionId: string) {
    const thresholdParam = await prisma.systemParam.findUnique({ where: { key: 'QA_SECOND_TESTER_THRESHOLD_DAYS' } });
    const threshold = Number(thresholdParam?.value) || 12;

    const assignments = await prisma.qaAssignment.findMany({
      where: {
        versionId,
        secondaryTesterId: null,
        cycles: { has: 'CYCLE_1' },
      },
    });
    const overloaded = assignments.filter(a => (a.qaEffort ?? 0) > threshold);

    const suggestions: any[] = [];
    for (const a of overloaded) {
      const detail = await this.suggestSecondaryTesters(versionId, a.crNumber);
      const top = detail.candidates[0];
      if (!top) continue;
      suggestions.push({
        assignmentId:        a.id,
        crNumber:             a.crNumber,
        crLabel:              detail.crLabel,
        qaEffortDays:         detail.qaEffortDays,
        thresholdDays:        threshold,
        primaryTesterId:      detail.primaryTesterId,
        suggestedTesterId:    top.userId,
        suggestedTesterName:  top.fullName,
        suggestedScore:       top.totalScore,
        timeSavingDays:       top.timeSavingDays,
      });
    }
    return suggestions;
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
