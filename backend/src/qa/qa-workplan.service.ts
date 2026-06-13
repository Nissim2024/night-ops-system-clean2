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
    for (const vca of vcas) {
      if (!vcaFirstMap.has(vca.crNumber)) vcaFirstMap.set(vca.crNumber, vca);
      if (!crTeamsMap.has(vca.crNumber)) crTeamsMap.set(vca.crNumber, new Set());
      crTeamsMap.get(vca.crNumber)!.add(vca.team.name);
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

    const sysFlag = (crNumber: string, teams: string[]): string => {
      if (!teams.length) return '';
      const crTeams = crTeamsMap.get(crNumber);
      return crTeams && teams.some(t => crTeams.has(t)) ? 'Y' : '';
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

    const crMap = new Map<string, CrRow>();

    for (const cycle of plan.cycles) {
      const ct = cycle.cycleType as CycleType;
      for (const task of cycle.tasks) {
        if (task.taskType === 'REGRESSION') continue;
        if (!task.isActive) continue;

        if (!crMap.has(task.crNumber)) {
          crMap.set(task.crNumber, {
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

        const row = crMap.get(task.crNumber)!;
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
