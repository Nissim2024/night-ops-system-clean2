import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, VersionStatus } from '@prisma/client';
import { EmailService } from '../email/email.service';
import { EventsGateway } from '../events/events.gateway';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class VersionsService {
  constructor(
    private readonly emailService: EmailService,
    private readonly events: EventsGateway,
  ) {}

  async findAll() {
    const [versions, taskCounts] = await Promise.all([
      prisma.version.findMany({
        include: {
          creator: { select: { id: true, fullName: true } },
          approver: { select: { id: true, fullName: true } },
          _count: { select: { phases: true } },
          nightSummary:     { select: { sentAt: true, forceApprovedBy: true } },
          rehearsalSummary: { select: { sentAt: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.task.groupBy({
        by: ['versionId'],
        _count: { id: true },
        where: { versionId: { not: null } },
      }),
    ]);

    const countMap: Record<string, number> = {};
    for (const tc of taskCounts) {
      if (tc.versionId) countMap[tc.versionId] = tc._count.id;
    }

    return versions.map(v => ({ ...v, taskCount: countMap[v.id] ?? 0 }));
  }

  async findOne(id: string) {
    const version = await prisma.version.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, fullName: true } },
        approver: { select: { id: true, fullName: true } },
        phases: {
          orderBy: { orderIndex: 'asc' },
          include: {
            subPhases: {
              orderBy: { orderIndex: 'asc' },
              include: {
                tasks: {
                  orderBy: { orderIndex: 'asc' },
                  include: {
                    assignedTeam: { select: { id: true, name: true } },
                    dependencies: {
                      include: { dependsOn: { select: { id: true, title: true, status: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        submissions: {
          include: {
            team: { select: { id: true, name: true } },
            submitter: { select: { id: true, fullName: true } },
          },
        },
        rehearsalSummary: { select: { sentAt: true } },
        nightSummary:     { select: { sentAt: true, forceApprovedBy: true } },
      },
    });
    if (!version) throw new NotFoundException('Version not found');

    const involvedPlans = await (prisma.crPlan as any).findMany({
      where: { versionId: id },
      distinct: ['teamId'],
      select: { teamId: true },
    });
    return { ...version, involvedTeamIds: involvedPlans.map((p: any) => p.teamId) };
  }

  async create(data: {
    name: string;
    description?: string;
    plannedStart?: string;
    plannedEnd?: string;
    integrationStart?: string;
    integrationEnd?: string;
    qaStart?: string;
    qaEnd?: string;
    plannedRehearsalStart?: string;
    plannedRehearsalEnd?: string;
    importedFileName?: string;
    collectionDeadline?: string;
    reviewMeetingTime?: string;
    workPlanMeetingTime?: string;
    qcReleaseId?: string;
    createdBy: string;
  }) {
    const existing = await prisma.version.findFirst({ where: { name: data.name } });
    if (existing) throw new BadRequestException(`גרסה עם שם "${data.name}" כבר קיימת`);

    const version = await prisma.version.create({
      data: {
        name: data.name,
        description: data.description,
        plannedStart: data.plannedStart ? new Date(data.plannedStart) : undefined,
        plannedEnd: data.plannedEnd ? new Date(data.plannedEnd) : undefined,
        integrationStart: data.integrationStart ? new Date(data.integrationStart) : undefined,
        integrationEnd: data.integrationEnd ? new Date(data.integrationEnd) : undefined,
        qaStart: data.qaStart ? new Date(data.qaStart) : undefined,
        qaEnd: data.qaEnd ? new Date(data.qaEnd) : undefined,
        plannedRehearsalStart: data.plannedRehearsalStart ? new Date(data.plannedRehearsalStart) : undefined,
        plannedRehearsalEnd: data.plannedRehearsalEnd ? new Date(data.plannedRehearsalEnd) : undefined,
        importedFileName: data.importedFileName || undefined,
        collectionDeadline: data.collectionDeadline ? new Date(data.collectionDeadline) : undefined,
        reviewMeetingTime: data.reviewMeetingTime ? new Date(data.reviewMeetingTime) : undefined,
        workPlanMeetingTime: data.workPlanMeetingTime ? new Date(data.workPlanMeetingTime) : undefined,
        qcReleaseId: data.qcReleaseId || undefined,
        createdBy: data.createdBy,
        status: VersionStatus.DRAFT,
        // Every version created from here on has its downstream dates
        // (integration/QA/rehearsal/go-live) locked to the QA work plan once
        // one exists — see qa-workplan.service.ts. Existing versions default
        // to false and are never migrated, per explicit product decision.
        datesLockedToWorkPlan: true,
      },
    } as any);

    // יצירת submissions לכל הצוותים
    const teams = await prisma.team.findMany({ where: { active: true } });
    await prisma.teamSubmission.createMany({
      data: teams.map(team => ({
        versionId: version.id,
        teamId: team.id,
      })),
    });

    return version;
  }

  async addPhase(versionId: string, data: {
    name: string;
    orderIndex: number;
    environment?: string;
    teamId?: string;
  }) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    return prisma.phase.create({
      data: {
        versionId,
        name: data.name,
        orderIndex: data.orderIndex,
        environment: (data.environment as any) || 'BOTH',
        teamId: data.teamId,
      },
    });
  }

  async updatePhase(phaseId: string, data: { name?: string; isGoNoGo?: boolean }) {
    const phase = await prisma.phase.findUnique({ where: { id: phaseId } });
    if (!phase) throw new NotFoundException('Phase not found');

    if (data.isGoNoGo) {
      // Only one phase per version may be the goNogo gate — clear others first
      await prisma.phase.updateMany({
        where: { versionId: phase.versionId },
        data: { isGoNoGo: false },
      });
    }

    return prisma.phase.update({ where: { id: phaseId }, data });
  }

  async deletePhase(phaseId: string) {
    const phase = await prisma.phase.findUnique({
      where: { id: phaseId },
      include: { subPhases: { include: { tasks: { select: { id: true } } } } },
    });
    if (!phase) throw new NotFoundException('Phase not found');

    const taskCount = phase.subPhases.reduce((sum, sp) => sum + sp.tasks.length, 0);
    if (taskCount > 0) {
      throw new BadRequestException(`לא ניתן למחוק שלב עם ${taskCount} משימות`);
    }

    // Delete subPhases first, then the phase
    await prisma.subPhase.deleteMany({ where: { phaseId } });
    await prisma.phase.delete({ where: { id: phaseId } });
    return { deleted: true };
  }

  async addSubPhase(phaseId: string, data: { name: string; orderIndex: number }) {
    return prisma.subPhase.create({
      data: { phaseId, name: data.name, orderIndex: data.orderIndex },
    });
  }

async addTask(subPhaseId: string, data: {
    title: string;
    notes?: string;
    dependencyNote?: string;
    duration?: string;
    crNumber?: string;
    application?: string;
    environment?: string;
    assignedTeamId?: string;
    assignedUserName?: string;
    orderIndex?: number;
    isCritical?: boolean;
    plannedStart?: string;
    plannedEnd?: string;
    createdBy: string;
    versionId?: string;
  }) {
    if (data.versionId) {
      const ver = await prisma.version.findUnique({ where: { id: data.versionId }, select: { status: true } });
      if (['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(ver?.status as string)) {
        throw new ForbiddenException('גרסה פעילה — לא ניתן להוסיף משימות');
      }
    }

    data.title = (data.title ?? '').replace(/<[^>]*>/g, '').trim();
    if (!data.title) throw new BadRequestException('שדה "כותרת" הוא חובה');

    const lastTask = await prisma.task.findFirst({
      where: { subPhaseId },
      orderBy: { orderIndex: 'desc' },
      select: { orderIndex: true },
    });
    const nextOrderIndex = data.orderIndex !== undefined ? data.orderIndex : (lastTask?.orderIndex ?? -1) + 1;

    return prisma.task.create({
      data: {
        subPhaseId,
        versionId: data.versionId,
        title: data.title,
        notes: data.notes,
        dependencyNote: data.dependencyNote,
        duration: data.duration,
        crNumber: data.crNumber,
        application: data.application,
        environment: (data.environment as any) || 'BOTH',
        assignedTeamId: data.assignedTeamId,
        assignedUserName: data.assignedUserName,
        orderIndex: nextOrderIndex,
        isCritical: data.isCritical || false,
        plannedStart: data.plannedStart ? new Date(data.plannedStart) : undefined,
        plannedEnd: data.plannedEnd ? new Date(data.plannedEnd) : undefined,
        status: 'WAITING',
        createdBy: data.createdBy,
        createdByTeamLead: data.createdBy,
      },
    });
  }

  async reassignTasks(versionId: string, fromUserName: string | null, toUserId: string, phaseId?: string, fromTeamId?: string) {
    const [version, toUser] = await Promise.all([
      prisma.version.findUnique({ where: { id: versionId } }),
      prisma.user.findUnique({
        where: { id: toUserId },
        include: { teamMemberships: { select: { teamId: true } } },
      }),
    ]);
    if (!version) throw new NotFoundException('Version not found');
    if (!toUser) throw new NotFoundException('User not found');

    const toTeamId = toUser.teamMemberships.length === 1
      ? toUser.teamMemberships[0].teamId
      : undefined;

    const where: any = { versionId };
    if (fromUserName === null) {
      where.assignedUserName = null;
      if (fromTeamId) where.assignedTeamId = fromTeamId;
    } else {
      where.assignedUserName = fromUserName;
    }
    if (phaseId) where.subPhase = { phaseId };

    const result = await prisma.task.updateMany({
      where,
      data: {
        assignedUserId: toUser.id,
        assignedUserName: toUser.fullName,
        ...(toTeamId ? { assignedTeamId: toTeamId } : {}),
      },
    });

    return { updated: result.count, toUserName: toUser.fullName };
  }

  async seedTemplate(versionId: string, createdBy: string) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    const TEMPLATE_PHASES = [
      {
        name: 'פעילות בוקר גרסה', orderIndex: 1, environment: 'BOTH',
        subPhases: [
          'פתיחת קבוצת WhatsApp + מוכנות QA', 'הפצת גרסה',
          'משימות לפיתוחים בגרסה', 'עצירה/הזזה של תהליכים',
          'מוכנות פיתוח', 'הגדרות סטאפ',
        ],
      },
      {
        name: 'פעילות לילה — HOTNET', orderIndex: 2, environment: 'HOTNET',
        subPhases: [
          'טרום הורדת מערכות', 'הורדת מערכות', 'הטמעת קוד',
          'העלאת מערכות', 'בקרות העלאת מערכות', 'סינכרון מערכות',
          'בדיקות QA + GO/NO GO',
        ],
      },
      {
        name: 'פעילות לילה — HOT', orderIndex: 3, environment: 'HOT', isGoNoGo: true,
        subPhases: [
          'טרום הורדת מערכות', 'הורדת מערכות', 'הטמעת קוד',
          'העלאת מערכות', 'בקרות העלאת מערכות', 'שחרור מערכות',
          'בדיקות QA + GO/NO GO',
        ],
      },
      {
        name: 'פעילויות בוקר לאחר גרסה', orderIndex: 4, environment: 'BOTH', isGoNoGo: false,
        subPhases: ['החזרת תהליכים', 'הטמעות קוד יום אחרי', 'בקרות ומעקב ממשקים', 'בדיקות', 'הוספה או הזזה של תהליכים'],
      },
    ];

    let taskCount = 0;
    for (const phaseData of TEMPLATE_PHASES) {
      const phase = await prisma.phase.create({
        data: { versionId, name: phaseData.name, orderIndex: phaseData.orderIndex, environment: phaseData.environment as any, isGoNoGo: (phaseData as any).isGoNoGo ?? false },
      });
      for (let si = 0; si < phaseData.subPhases.length; si++) {
        const sub = await prisma.subPhase.create({
          data: { phaseId: phase.id, name: phaseData.subPhases[si], orderIndex: si + 1 },
        });
        for (let ti = 1; ti <= 5; ti++) {
          await prisma.task.create({
            data: {
              subPhaseId: sub.id,
              versionId,
              title: `משימה ${ti}`,
              orderIndex: ti,
              status: 'WAITING',
              environment: phaseData.environment as any,
              createdBy,
              createdByTeamLead: createdBy,
            },
          });
          taskCount++;
        }
      }
    }
    return { message: 'תבנית נוצרה בהצלחה', taskCount };
  }

  async endRehearsal(id: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== VersionStatus.REHEARSAL) {
      throw new BadRequestException('הגרסה אינה במצב חזרה גנרלית');
    }

    const tasks = await prisma.task.findMany({
      where: { versionId: id },
      include: { assignedTeam: { select: { id: true, name: true } } },
      orderBy: { orderIndex: 'asc' },
    });

    await prisma.task.updateMany({
      where: { versionId: id },
      data: {
        status: 'WAITING',
        actualStart: null,
        actualFinish: null,
        startedAt: null,
        completedAt: null,
        blockedReason: null,
        delayReason: null,
        followupNotes: null,
        morningFollowup: false,
        // Rehearsal-specific schedule is only meaningful while a rehearsal is live —
        // clearing it here means delay/overdue checks fall back to the production
        // plannedStart/End for the real night, already preserved in lastRehearsalSnapshot.
        rehearsalPlannedStart: null,
        rehearsalPlannedEnd: null,
      },
    });

    return prisma.version.update({
      where: { id },
      data: {
        status: VersionStatus.APPROVED,
        actualStart: null,
        lastRehearsalSnapshot: tasks as any,
        lastRehearsalAt: new Date(),
      },
    });
  }

  async cancelRehearsal(id: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== VersionStatus.REHEARSAL) {
      throw new BadRequestException('הגרסה אינה במצב חזרה גנרלית');
    }

    // Block if any task has already started
    const startedCount = await prisma.task.count({
      where: { versionId: id, actualStart: { not: null } },
    });
    if (startedCount > 0) {
      throw new BadRequestException(
        `לא ניתן לבטל — ${startedCount} משימות כבר החלו לרוץ`
      );
    }

    // Reset all tasks to WAITING
    await prisma.task.updateMany({
      where: { versionId: id },
      data: { status: 'WAITING', actualStart: null, actualFinish: null, blockedReason: null, rehearsalPlannedStart: null, rehearsalPlannedEnd: null },
    });

    return prisma.version.update({
      where: { id },
      data: { status: VersionStatus.APPROVED, actualStart: null },
    });
  }

  async setNotRequiredForApproval(versionId: string, teamId: string, notRequiredForApproval: boolean) {
    return prisma.teamSubmission.upsert({
      where: { versionId_teamId: { versionId, teamId } },
      update: { notRequiredForApproval },
      create: { versionId, teamId, notRequiredForApproval },
    });
  }

  // Stage-1 scope approval: stamps scopeApprovedAt/scopeApprovedBy and clears any
  // pending needsAttention flags. Does NOT itself move the status machine — the
  // COLLECTING→CR_REVIEW gate in updateStatus() requires this to have run first.
  // Callable again later (e.g. after a post-approval scope change) to re-confirm.
  async approveScope(id: string, userId: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('גרסה לא נמצאה');
    if (!version.integrationStart) {
      throw new BadRequestException('יש להזין תאריך תחילת בדיקות אינטגרציה לפני אישור התכולה');
    }
    // Effort-estimate / SA-classification validation happens downstream at the
    // QA assignment stage, not here — scope approval only needs dates + a synced CR list.
    await prisma.versionCrAssignment.updateMany({
      where: { versionId: id },
      data: { needsAttention: false },
    });
    return prisma.version.update({
      where: { id },
      data: { scopeApprovedAt: new Date(), scopeApprovedBy: userId },
    });
  }

  async updateStatus(id: string, status: VersionStatus, userId: string, userRole: string, force = false) {
    const MANAGER_ROLES = ['RELEASE_MANAGER', 'ADMIN'];
    if (force && !MANAGER_ROLES.includes(userRole)) {
      throw new ForbiddenException('רק מנהל לילה רשאי לדחוף שינוי סטטוס בכוח');
    }
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');

    // State machine: enforce allowed transitions
    // New order: DRAFT → COLLECTING → CR_REVIEW → REFINING → REVIEW → APPROVED
    const ALLOWED: Partial<Record<VersionStatus, VersionStatus[]>> = {
      [VersionStatus.DRAFT]:         [VersionStatus.COLLECTING, VersionStatus.CR_REVIEW, VersionStatus.APPROVED],
      [VersionStatus.COLLECTING]:    [VersionStatus.CR_REVIEW, VersionStatus.DRAFT],
      [VersionStatus.CR_REVIEW]:     [VersionStatus.REFINING, VersionStatus.COLLECTING, VersionStatus.DRAFT],
      [VersionStatus.REFINING]:      [VersionStatus.REVIEW, VersionStatus.CR_REVIEW],
      [VersionStatus.REVIEW]:        [VersionStatus.APPROVED, VersionStatus.REFINING],
      [VersionStatus.APPROVED]:      [VersionStatus.REHEARSAL, VersionStatus.ACTIVE, VersionStatus.DRAFT],
      [VersionStatus.ACTIVE]:        [VersionStatus.MORNING_AFTER, VersionStatus.ROLLED_BACK],
      [VersionStatus.MORNING_AFTER]: [VersionStatus.COMPLETED, VersionStatus.ROLLED_BACK],
      [VersionStatus.COMPLETED]:     [],
      [VersionStatus.ROLLED_BACK]:   [],
      // REHEARSAL exits only via endRehearsal() — no direct status changes allowed
      [VersionStatus.REHEARSAL]:     [],
    };
    const allowed = ALLOWED[version.status as VersionStatus] ?? [];
    if (!allowed.includes(status)) {
      throw new BadRequestException(
        `מעבר סטטוס לא חוקי: "${version.status}" → "${status}"`
      );
    }

    // COLLECTING → CR_REVIEW: integration-test start date must be set, and scope
    // must have been formally approved via approveScope() first. Effort-estimate
    // and SA/integrative classification are validated downstream at the QA
    // assignment stage, not gated here.
    if (version.status === VersionStatus.COLLECTING && status === VersionStatus.CR_REVIEW && !force) {
      if (!version.integrationStart) {
        throw new BadRequestException('יש להזין תאריך תחילת בדיקות אינטגרציה לפני המעבר לסקירת CR');
      }
      if (!version.scopeApprovedAt) {
        throw new BadRequestException('יש לאשר את תכולת הגרסה לפני המעבר לסקירת CR');
      }
    }

    // CR_REVIEW → REFINING: involved teams must have submitted and CrPlans must be approved
    // force=true lets a manager override this check
    if (version.status === VersionStatus.CR_REVIEW && status === VersionStatus.REFINING && !force) {
      const involvedPlans = await (prisma.crPlan as any).findMany({
        where: { versionId: id },
        distinct: ['teamId'],
        select: { teamId: true },
      });
      const allInvolvedTeamIds = involvedPlans.map((p: any) => p.teamId);
      let involvedTeamIds: string[] = allInvolvedTeamIds;
      if (allInvolvedTeamIds.length > 0) {
        const requiredTeams = await prisma.team.findMany({
          where: { id: { in: allInvolvedTeamIds }, requiresPlan: true },
          select: { id: true },
        });
        involvedTeamIds = requiredTeams.map(t => t.id);
      }
      if (involvedTeamIds.length > 0) {
        const notSubmitted = await prisma.teamSubmission.findMany({
          where: {
            versionId: id,
            teamId: { in: involvedTeamIds },
            status: { not: 'SUBMITTED' },
            notRequiredForApproval: false,
          },
          include: { team: { select: { name: true } } },
        });
        if (notSubmitted.length > 0) {
          const teamNames = notSubmitted.map((s: any) => s.team.name).join(', ');
          throw new BadRequestException(`הצוותים הבאים טרם הגישו: ${teamNames}`);
        }
      }

      // All CrPlans must be approved — only for CRs that still have an active assignment
      const activeAssignments = await prisma.versionCrAssignment.findMany({
        where: { versionId: id },
        select: { crNumber: true },
      });
      const activeCrNumbers = new Set(activeAssignments.map((a: any) => a.crNumber));
      const unapprovedPlans = await prisma.crPlan.findMany({
        where: { versionId: id, planApproved: false, notNeededForPlan: false },
        distinct: ['crNumber'] as any,
        select: { crNumber: true },
      });
      const blockingPlans = unapprovedPlans.filter((p: any) => activeCrNumbers.has(p.crNumber));
      if (blockingPlans.length > 0) {
        const crNums = blockingPlans.map((p: any) => p.crNumber).join(', ');
        throw new BadRequestException(`לא ניתן לעבור לשלב הבא — יש ${blockingPlans.length} CR שטרם אושרו: ${crNums}`);
      }
    }

    // REFINING → REVIEW: all active CRs must be approved by CR Manager
    if (version.status === VersionStatus.REFINING && status === VersionStatus.REVIEW && !force) {
      const unapproved = await (prisma.crPlan as any).findFirst({
        where: { versionId: id, crManagerApproved: false, notNeededForPlan: false },
        select: { crNumber: true },
      });
      if (unapproved) {
        const pending = await (prisma.crPlan as any).findMany({
          where: { versionId: id, crManagerApproved: false, notNeededForPlan: false },
          distinct: ['crNumber'],
          select: { crNumber: true },
        });
        const crNums = pending.map((p: any) => p.crNumber).join(', ');
        throw new BadRequestException(`לא ניתן לעבור לסקירה — יש ${pending.length} CR שטרם אושרו ע"י מנהל CR: ${crNums}`);
      }
    }

    // Only one active/rehearsal/morning-after version at a time
    if (
      status === VersionStatus.ACTIVE ||
      status === VersionStatus.REHEARSAL ||
      status === VersionStatus.MORNING_AFTER
    ) {
      const busyCount = await prisma.version.count({
        where: {
          status: { in: [VersionStatus.ACTIVE, VersionStatus.REHEARSAL, VersionStatus.MORNING_AFTER] },
          id: { not: id },
        },
      });
      if (busyCount > 0) {
        throw new BadRequestException('כבר קיימת גרסה פעילה — לא ניתן להפעיל גרסה נוספת');
      }
    }

    const parseMins = (dur: string | null): number | null => {
      if (!dur) return null;
      const hM = dur.match(/(\d+)ש/); const mM = dur.match(/(\d+)ד/);
      if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
      const n = parseInt(dur); return isNaN(n) ? null : n;
    };

    // ACTIVE → MORNING_AFTER: save night snapshot
    if (status === VersionStatus.MORNING_AFTER) {
      // Guard: at least one night task must have been started (actualStart or actualFinish set)
      // to prevent transitioning immediately after starting the night without running anything.
      const startedCount = await prisma.task.count({
        where: {
          versionId: id,
          OR: [
            { actualStart:  { not: null } },
            { actualFinish: { not: null } },
            { status: { in: ['IN_PROGRESS', 'DONE', 'FAILED', 'ROLLED_BACK', 'BLOCKED'] as any } },
          ],
        },
      });
      if (startedCount === 0) {
        throw new BadRequestException(
          'לא ניתן לסיים פעילות — אף משימת לילה לא התחילה. ודא שפעילות הלילה אכן הורצה.',
        );
      }

      const tasks = await prisma.task.findMany({
        where: { versionId: id },
        include: { assignedTeam: { select: { id: true, name: true } } },
        orderBy: { orderIndex: 'asc' },
      });
      const data: any = {
        status,
        lastNightSnapshot: tasks,
        lastNightAt: new Date(),
      };

      // If summary was already approved and all activated tasks are terminal,
      // skip MORNING_AFTER and go straight to COMPLETED.
      const existingSummary = await prisma.nightSummary.findUnique({ where: { versionId: id } });
      if (existingSummary?.sentAt) {
        const openCount = await prisma.task.count({
          where: { versionId: id, status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK', 'WAITING'] as any } },
        });
        if (openCount === 0) {
          data.status = VersionStatus.COMPLETED;
        }
      }

      return prisma.version.update({ where: { id }, data });
    }

    if (status === VersionStatus.COMPLETED) {
      const isPostNight =
        version.status === VersionStatus.ACTIVE ||
        version.status === VersionStatus.MORNING_AFTER;

      if (isPostNight) {
        // Check 1: all tasks must be terminal (skippable with force for MANAGER/ADMIN)
        const pendingCount = await prisma.task.count({
          where: {
            versionId: id,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
          },
        });
        if (pendingCount > 0 && !force) {
          throw new BadRequestException(
            `לא ניתן לסיים פעילות: ${pendingCount} משימות עדיין לא הושלמו`
          );
        }

        // Check 2: all delayed tasks must have a delay reason
        const completedTasks = await prisma.task.findMany({
          where: { versionId: id, status: { in: ['DONE', 'FAILED', 'ROLLED_BACK'] as any }, delayReason: null },
          select: { title: true, actualStart: true, actualFinish: true, plannedStart: true, plannedEnd: true, duration: true },
        });
        const needsReason = completedTasks.filter(t => {
          const actualM = t.actualStart && t.actualFinish
            ? Math.round((new Date(t.actualFinish as any).getTime() - new Date(t.actualStart as any).getTime()) / 60000)
            : null;
          const plannedM = parseMins(t.duration) ||
            (t.plannedStart && t.plannedEnd
              ? Math.round((new Date(t.plannedEnd as any).getTime() - new Date(t.plannedStart as any).getTime()) / 60000)
              : null);
          return !!(actualM && plannedM && actualM >= plannedM * 2);
        });
        if (needsReason.length > 0) {
          throw new BadRequestException(
            `לא ניתן לסיים פעילות: ${needsReason.length} משימות עם עיכוב ללא סיבה`
          );
        }

        // Check 3: night summary must be approved
        const summary = await prisma.nightSummary.findUnique({ where: { versionId: id } });
        if (!summary?.sentAt) {
          throw new BadRequestException('לא ניתן לסיים פעילות — יש לאשר את דוח הסיכום קודם');
        }
      }
    }

    const data: any = { status };
    if (status === VersionStatus.ACTIVE || status === VersionStatus.REHEARSAL) data.actualStart = new Date();
    if (status === VersionStatus.COMPLETED) data.completedAt = new Date();
    if (status === VersionStatus.APPROVED) {
      data.approvedBy = userId;
      data.approvedAt = new Date();
    }

    return prisma.version.update({ where: { id }, data });
  }

  // integrationStart/End, qaStart/End and plannedRehearsalStart/End are owned by
  // the QA work plan (qa-workplan.service.ts's syncVersionDatesFromWorkPlan)
  // once one exists for a datesLockedToWorkPlan version — see schema comment.
  // Keyed here so updateFields can reject direct edits instead of silently
  // fighting the QA sync for whichever write happens to run last.
  private static readonly QA_SYNCED_DATE_FIELDS: Record<string, string> = {
    integrationStart: 'תחילת אינטגרציה', integrationEnd: 'סיום אינטגרציה',
    qaStart: 'תחילת QA', qaEnd: 'סיום QA',
    plannedRehearsalStart: 'תחילת חזרה', plannedRehearsalEnd: 'סיום חזרה',
  };

  async updateFields(id: string, data: {
    plannedStart?: string | null; plannedEnd?: string | null; reviewMeetingTime?: string | null; workPlanMeetingTime?: string | null;
    integrationStart?: string | null; integrationEnd?: string | null; qaStart?: string | null; qaEnd?: string | null;
    plannedRehearsalStart?: string | null; plannedRehearsalEnd?: string | null;
    submissionDeadline?: string | null; approvalDeadline?: string | null;
    name?: string; description?: string; homeNotice?: string | null;
  }) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    if (['COMPLETED', 'ROLLED_BACK'].includes(version.status)) {
      throw new BadRequestException('גרסה סגורה (COMPLETED / ROLLED_BACK) נעולה לעריכה');
    }

    if ((version as any).datesLockedToWorkPlan) {
      const hasWorkPlan = await prisma.qaWorkPlan.findUnique({ where: { versionId: id }, select: { id: true } });
      if (hasWorkPlan) {
        const blocked = Object.keys(VersionsService.QA_SYNCED_DATE_FIELDS).filter(f => f in data);
        if (blocked.length > 0) {
          const labels = blocked.map(f => VersionsService.QA_SYNCED_DATE_FIELDS[f]).join(', ');
          throw new BadRequestException(`${labels} מנוהלים אוטומטית על ידי תוכנית העבודה של QA ואינם ניתנים לעריכה ישירה`);
        }
      }
      if ('plannedStart' in data && data.plannedStart === null && version.plannedStart) {
        throw new BadRequestException('לא ניתן לאפס את תאריך העלייה לאוויר לאחר שנקבע');
      }
    }

    const update: any = {};
    if ('plannedStart'          in data) update.plannedStart          = data.plannedStart          ? new Date(data.plannedStart)          : null;
    if ('plannedEnd'            in data) update.plannedEnd            = data.plannedEnd            ? new Date(data.plannedEnd)            : null;
    if ('reviewMeetingTime'     in data) update.reviewMeetingTime     = data.reviewMeetingTime     ? new Date(data.reviewMeetingTime)     : null;
    if ('workPlanMeetingTime'   in data) update.workPlanMeetingTime   = data.workPlanMeetingTime   ? new Date(data.workPlanMeetingTime)   : null;
    if ('integrationStart'    in data) update.integrationStart    = data.integrationStart    ? new Date(data.integrationStart)    : null;
    if ('integrationEnd'      in data) update.integrationEnd      = data.integrationEnd      ? new Date(data.integrationEnd)      : null;
    if ('qaStart'             in data) update.qaStart             = data.qaStart             ? new Date(data.qaStart)             : null;
    if ('qaEnd'               in data) update.qaEnd               = data.qaEnd               ? new Date(data.qaEnd)               : null;
    if ('plannedRehearsalStart' in data) update.plannedRehearsalStart = data.plannedRehearsalStart ? new Date(data.plannedRehearsalStart) : null;
    if ('plannedRehearsalEnd'   in data) update.plannedRehearsalEnd   = data.plannedRehearsalEnd   ? new Date(data.plannedRehearsalEnd)   : null;
    if ('submissionDeadline'  in data) update.submissionDeadline  = data.submissionDeadline  ? new Date(data.submissionDeadline)  : null;
    if ('approvalDeadline'    in data) update.approvalDeadline    = data.approvalDeadline    ? new Date(data.approvalDeadline)    : null;
    if ('name'        in data && data.name)        update.name        = data.name;
    if ('description' in data)                     update.description = data.description ?? null;
    if ('homeNotice'  in data) {
      update.homeNotice = data.homeNotice?.trim() || null;
      update.homeNoticeUpdatedAt = update.homeNotice ? new Date() : null;
    }
    return prisma.version.update({ where: { id }, data: update });
  }

  async updatePlannedEnd(id: string, plannedEnd: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    return (prisma.version.update as any)({
      where: { id },
      data: { plannedEnd: new Date(plannedEnd) },
    });
  }

  async updateReviewMeetingTime(id: string, reviewMeetingTime: string | null) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    return (prisma.version.update as any)({
      where: { id },
      data: { reviewMeetingTime: reviewMeetingTime ? new Date(reviewMeetingTime) : null },
    });
  }

  async archiveVersion(id: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    if (!(['COMPLETED', 'ROLLED_BACK'] as string[]).includes(version.status)) {
      throw new BadRequestException('ניתן לארכב רק גרסאות סגורות (COMPLETED / ROLLED_BACK)');
    }
    return (prisma.version.update as any)({
      where: { id },
      data: { isArchived: true, archivedAt: new Date() },
    });
  }

  async restore(id: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    if (version.status !== VersionStatus.COMPLETED && version.status !== VersionStatus.ROLLED_BACK) {
      throw new BadRequestException('רק גרסאות מהארכיון ניתן לשחזר');
    }
    return prisma.version.update({ where: { id }, data: { status: VersionStatus.APPROVED, isArchived: false, archivedAt: null } });
  }

  async submitTeamTasks(versionId: string, teamId: string, userId: string, userRole: string) {
    // TEAM_LEAD may only submit their own team; managers may submit any team
    const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];
    if (!MANAGERS.includes(userRole)) {
      // Accept either isLead=true OR TEAM_LEAD role with any membership in the team
      const membership = await prisma.teamMember.findFirst({
        where: { userId, teamId },
      });
      if (!membership) {
        throw new ForbiddenException('ניתן להגיש רק עבור הצוות שאתה מוביל');
      }
    }

    const taskCount = await prisma.task.count({
      where: { versionId, assignedTeamId: teamId },
    });

    // Validate submission against the exception-first CR-plan model (matches the
    // frontend's isCrDone check): every CR is done once its plan says "no special
    // impact", or its plan has itself been confirmed/submitted. Task-proposals are
    // secondary bookkeeping now — they're never a submission blocker on their own.
    const crPlans = await prisma.crPlan.findMany({
      where: { versionId, teamId, removedByTeam: false },
      select: { crNumber: true, notNeededForPlan: true, submissionStatus: true },
    });

    const pending = crPlans.filter((cp: any) =>
      !cp.notNeededForPlan && cp.submissionStatus !== 'SUBMITTED' && cp.submissionStatus !== 'APPROVED',
    );
    if (pending.length > 0) {
      // TARGET CRs are approved via TargetCrReview.approved, entirely separate from
      // CrPlan.submissionStatus — a CR handled through that flow never flips its own
      // CrPlan to SUBMITTED/APPROVED, so it would otherwise block submission forever
      // even once genuinely approved (matches the frontend's isCrDone check).
      const approvedTargetCrs = await prisma.targetCrReview.findMany({
        where: { versionId, teamId, crNumber: { in: pending.map((p: any) => p.crNumber) }, approved: true },
        select: { crNumber: true },
      });
      const approvedSet = new Set(approvedTargetCrs.map(r => r.crNumber));
      const stillPending = pending.filter((p: any) => !approvedSet.has(p.crNumber));
      if (stillPending.length > 0) {
        throw new BadRequestException(`לא ניתן להגיש — יש CR-ים שטרם טופלו: ${stillPending.map((p: any) => p.crNumber).join(', ')}. יש לענות על שאלת השער ולאשר את התוכנית עבור כל CR.`);
      }
    }

    // Idempotent: if already submitted, return current record without updating submittedAt
    const existing = await prisma.teamSubmission.findUnique({
      where: { versionId_teamId: { versionId, teamId } },
    });
    if (existing?.status === 'SUBMITTED') return existing;

    const result = await prisma.teamSubmission.update({
      where: { versionId_teamId: { versionId, teamId } },
      data: {
        status: 'SUBMITTED',
        submittedBy: userId,
        submittedAt: new Date(),
        taskCount,
      },
      include: { team: { select: { name: true } } },
    });

    // Notify managers via WebSocket
    const [submittedCount, totalTeams] = await Promise.all([
      prisma.teamSubmission.count({ where: { versionId, status: 'SUBMITTED' } }),
      prisma.teamSubmission.count({ where: { versionId } }),
    ]);
    this.events.emitTeamSubmitted({ versionId, teamName: (result as any).team?.name ?? teamId, submittedCount, totalTeams });
    if (submittedCount === totalTeams && totalTeams > 0) {
      this.events.emitAllTeamsSubmitted({ versionId, totalTeams });
    }

    return result;
  }

  async getSubmissionStatus(versionId: string) {
    return prisma.teamSubmission.findMany({
      where: { versionId },
      include: {
        team: { select: { id: true, name: true } },
        submitter: { select: { id: true, fullName: true } },
      },
    });
  }

  async delete(id: string) {
    const tasks = await prisma.task.findMany({ where: { versionId: id }, select: { id: true } });
    const taskIds = tasks.map(t => t.id);

    if (taskIds.length) {
      await prisma.taskDependency.deleteMany({
        where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] },
      });
      await prisma.auditLog.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
    }

    const phases = await prisma.phase.findMany({ where: { versionId: id }, select: { id: true } });
    const phaseIds = phases.map(p => p.id);
    if (phaseIds.length) {
      await prisma.subPhase.deleteMany({ where: { phaseId: { in: phaseIds } } });
      await prisma.phase.deleteMany({ where: { id: { in: phaseIds } } });
    }

    await prisma.teamSubmission.deleteMany({ where: { versionId: id } });
    await prisma.nightSummary.deleteMany({ where: { versionId: id } });
    await (prisma as any).rehearsalSummary.deleteMany({ where: { versionId: id } });
    await prisma.taskProposal.deleteMany({ where: { versionId: id } });
    // CrDependency cascades automatically (onDelete: Cascade on crPlanId FK)
    await prisma.crPlan.deleteMany({ where: { versionId: id } });
    await prisma.versionCrAssignment.deleteMany({ where: { versionId: id } });
    await prisma.version.delete({ where: { id } });

    return { message: 'הגרסה נמחקה בהצלחה' };
  }

  async applySchedule(
    updates: { taskId: string; plannedStart: string; plannedEnd: string; duration?: string }[],
    phases: { phaseId: string; startTime?: string; endTime?: string }[],
  ) {
    console.log('[applySchedule] updates:', updates.length, 'phases:', phases.length);
    if (updates.length > 0) console.log('[applySchedule] sample update:', JSON.stringify(updates[0]));

    // Find tasks in rescheduled phases that were skipped by the engine (no duration).
    // Their plannedStart/plannedEnd may be stale (from a prior schedule with a different date),
    // which causes false 240h+ overrun anomalies and incorrect phase span display.
    const updatedTaskIds = new Set(updates.map(u => u.taskId));
    const phaseIds = phases.map(p => p.phaseId);
    const staleTaskIds: string[] = phaseIds.length
      ? (await prisma.task.findMany({
          where: {
            subPhase: { phaseId: { in: phaseIds } },
            id: { notIn: Array.from(updatedTaskIds) },
            status: { notIn: ['DONE', 'ROLLED_BACK', 'IN_PROGRESS', 'FAILED', 'BLOCKED'] as any },
            OR: [{ plannedStart: { not: null } }, { plannedEnd: { not: null } }],
          },
          select: { id: true },
        })).map(t => t.id)
      : [];

    await prisma.$transaction([
      ...updates.map(u =>
        prisma.task.update({
          where: { id: u.taskId },
          data: {
            plannedStart: new Date(u.plannedStart),
            plannedEnd: new Date(u.plannedEnd),
            ...(u.duration !== undefined && { duration: u.duration }),
          },
        }),
      ),
      ...phases.map(p =>
        prisma.phase.update({
          where: { id: p.phaseId },
          data: {
            ...(p.startTime && { plannedStart: new Date(p.startTime) }),
            // Only overwrite plannedEnd if an endTime was explicitly provided.
            ...(p.endTime !== undefined && { plannedEnd: p.endTime ? new Date(p.endTime) : null }),
          },
        }),
      ),
      ...staleTaskIds.map(id =>
        prisma.task.update({
          where: { id },
          data: { plannedStart: null, plannedEnd: null },
        }),
      ),
    ]);

    console.log('[applySchedule] done, applied:', updates.length, 'stale cleared:', staleTaskIds.length);
    return { applied: updates.length, cleared: staleTaskIds.length };
  }

  async promoteTaskToSubPhase(taskId: string) {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      include: {
        subPhase: {
          include: { phase: { include: { subPhases: { orderBy: { orderIndex: 'asc' } } } } },
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    if (!task.subPhase) throw new BadRequestException('משימה לא שייכת לתת-שלב');

    const currentSubPhase = (task as any).subPhase;
    const phase = currentSubPhase.phase;

    await prisma.subPhase.updateMany({
      where: { phaseId: phase.id, orderIndex: { gt: currentSubPhase.orderIndex } },
      data: { orderIndex: { increment: 1 } },
    });

    const newSubPhase = await prisma.subPhase.create({
      data: { phaseId: phase.id, name: task.title, orderIndex: currentSubPhase.orderIndex + 1 },
    });

    await prisma.taskDependency.deleteMany({
      where: { OR: [{ taskId }, { dependsOnTaskId: taskId }] },
    });
    await prisma.auditLog.deleteMany({ where: { taskId } });
    await prisma.task.delete({ where: { id: taskId } });

    return newSubPhase;
  }

  private parseMinsShared(dur: string | null): number | null {
    if (!dur) return null;
    const hM = dur.match(/(\d+)ש/); const mM = dur.match(/(\d+)ד/);
    if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
    const colonM = dur.match(/^(\d+):(\d{2})$/);
    if (colonM) return +colonM[1] * 60 + +colonM[2];
    const n = parseFloat(dur); return isNaN(n) ? null : Math.round(n);
  }

  // Check if `fromId` transitively depends on `toId` (cycle detection).
  private async dependsTransitively(fromId: string, toId: string, visited = new Set<string>()): Promise<boolean> {
    if (fromId === toId) return true;
    if (visited.has(fromId)) return false;
    visited.add(fromId);
    const deps = await prisma.taskDependency.findMany({ where: { taskId: fromId }, select: { dependsOnTaskId: true } });
    for (const d of deps) {
      if (await this.dependsTransitively(d.dependsOnTaskId, toId, visited)) return true;
    }
    return false;
  }

  // After a task's plannedEnd changes, push every task that directly or transitively depends on it.
  private async cascadeDependencyTimes(changedTaskId: string, visited = new Set<string>()): Promise<void> {
    if (visited.has(changedTaskId)) return;
    visited.add(changedTaskId);

    // Find all tasks that depend directly on the changed task
    const directDependents = await prisma.taskDependency.findMany({
      where: { dependsOnTaskId: changedTaskId },
      select: { taskId: true },
    });

    for (const { taskId } of directDependents) {
      // Fetch the dependent task and all its dependencies to find the latest end
      const task = await prisma.task.findUnique({
        where: { id: taskId },
        include: { dependencies: { include: { dependsOn: { select: { id: true, plannedEnd: true } } } } },
      });
      if (!task) continue;

      // Start of this task = max(plannedEnd) across all its dependencies
      let latestDepEnd: Date | null = null;
      for (const dep of (task as any).dependencies) {
        if (dep.dependsOn?.plannedEnd) {
          const d = new Date(dep.dependsOn.plannedEnd);
          if (!latestDepEnd || d > latestDepEnd) latestDepEnd = d;
        }
      }
      if (!latestDepEnd) continue;

      const mins = this.parseMinsShared(task.duration);
      const newEnd = mins && mins > 0 ? new Date(latestDepEnd.getTime() + mins * 60000) : null;

      await prisma.task.update({
        where: { id: taskId },
        data: {
          plannedStart: latestDepEnd,
          ...(newEnd ? { plannedEnd: newEnd } : {}),
        },
      });

      // Recurse: this task's end may have changed, cascade further
      await this.cascadeDependencyTimes(taskId, visited);
    }
  }

  async resolveAllDependencies(versionId: string) {
    const allDeps = await prisma.taskDependency.findMany({
      where: { task: { versionId } },
      select: { taskId: true, dependsOnTaskId: true },
    });

    if (!allDeps.length) return { resolved: 0 };

    const allDependentIds = new Set(allDeps.map(d => d.taskId));

    // Root prerequisites = tasks that are prerequisites for others but depend on nothing themselves.
    // Cascading from roots guarantees correct topological order.
    const rootPrereqIds = [...new Set(allDeps.map(d => d.dependsOnTaskId))].filter(id => !allDependentIds.has(id));

    for (const prereqId of rootPrereqIds) {
      await this.cascadeDependencyTimes(prereqId, new Set());
    }

    return { resolved: rootPrereqIds.length };
  }

  // Snapshot plannedEnd for every task in a version (used for diff after cascade).
  private async snapshotEnds(versionId: string): Promise<Map<string, number>> {
    const tasks = await prisma.task.findMany({
      where: { versionId, plannedEnd: { not: null } },
      select: { id: true, plannedEnd: true },
    });
    return new Map(tasks.map(t => [t.id, new Date(t.plannedEnd as any).getTime()]));
  }

  // Compare current task times against a before-snapshot and return the most affected sub-phases.
  private async diffEnds(
    versionId: string,
    before: Map<string, number>,
  ): Promise<{ subPhaseName: string; phaseName: string; deltaMinutes: number }[]> {
    if (before.size === 0) return [];
    const after = await prisma.task.findMany({
      where: { id: { in: [...before.keys()] } },
      select: {
        id: true, plannedEnd: true, subPhaseId: true,
        subPhase: { select: { name: true, phase: { select: { name: true } } } },
      },
    });
    const subPhaseMap = new Map<string, { subPhaseName: string; phaseName: string; deltaMinutes: number }>();
    for (const t of after) {
      if (!t.subPhaseId || !t.plannedEnd) continue;
      const beforeMs = before.get(t.id);
      if (beforeMs === undefined) continue;
      const delta = Math.round((new Date(t.plannedEnd as any).getTime() - beforeMs) / 60000);
      if (delta === 0) continue;
      const existing = subPhaseMap.get(t.subPhaseId);
      if (!existing || Math.abs(delta) > Math.abs(existing.deltaMinutes)) {
        subPhaseMap.set(t.subPhaseId, {
          subPhaseName: (t as any).subPhase?.name ?? '',
          phaseName: (t as any).subPhase?.phase?.name ?? '',
          deltaMinutes: delta,
        });
      }
    }
    return Array.from(subPhaseMap.values())
      .filter(v => v.deltaMinutes !== 0)
      .sort((a, b) => Math.abs(b.deltaMinutes) - Math.abs(a.deltaMinutes))
      .slice(0, 4);
  }

  // After removing a dependency, recalculate the task's start time.
  // • Remaining deps exist → start = max(remaining deps' ends)
  // • No deps left         → start = sub-phase baseline (min plannedStart of sibling tasks)
  private async recalculateAfterDepRemoval(taskId: string): Promise<void> {
    const [task, remainingDeps] = await Promise.all([
      prisma.task.findUnique({ where: { id: taskId }, select: { duration: true, subPhaseId: true } }),
      prisma.taskDependency.findMany({
        where: { taskId },
        include: { dependsOn: { select: { plannedEnd: true } } },
      }),
    ]);
    if (!task) return;

    let newStart: Date | null = null;

    if (remainingDeps.length > 0) {
      // Use max end of remaining deps
      for (const dep of remainingDeps) {
        const end = (dep as any).dependsOn?.plannedEnd;
        if (end) { const d = new Date(end); if (!newStart || d > newStart) newStart = d; }
      }
    } else if (task.subPhaseId) {
      // No deps left — go back to sub-phase baseline: min plannedStart of sibling tasks
      const sibling = await prisma.task.findFirst({
        where: { subPhaseId: task.subPhaseId, id: { not: taskId }, plannedStart: { not: null } },
        orderBy: { plannedStart: 'asc' },
        select: { plannedStart: true },
      });
      if (sibling?.plannedStart) {
        newStart = new Date(sibling.plannedStart as any);
      } else {
        // No siblings with times — use phase plannedStart if available
        const sub = await (prisma.subPhase as any).findUnique({
          where: { id: task.subPhaseId },
          select: { phase: { select: { plannedStart: true } } },
        });
        if (sub?.phase?.plannedStart) newStart = new Date(sub.phase.plannedStart);
      }
    }

    if (!newStart) return;

    const mins = this.parseMinsShared(task.duration);
    const newEnd = mins && mins > 0 ? new Date(newStart.getTime() + mins * 60000) : null;
    await prisma.task.update({
      where: { id: taskId },
      data: { plannedStart: newStart, ...(newEnd ? { plannedEnd: newEnd } : {}) },
    });
  }

  async addDependency(taskId: string, dependsOnTaskId: string) {
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException('משימה לא יכולה להיות תלויה בעצמה');
    }
    if (await this.dependsTransitively(dependsOnTaskId, taskId)) {
      throw new BadRequestException('לא ניתן להוסיף תלות — תיווצר תלות מעגלית');
    }

    // Idempotent: if dependency already exists return it without cascading again
    const existing = await prisma.taskDependency.findUnique({
      where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
    });
    if (existing) return { dep: existing, affected: [] };

    const dep = await prisma.taskDependency.create({ data: { taskId, dependsOnTaskId } });

    const root = await prisma.task.findUnique({ where: { id: dependsOnTaskId }, select: { versionId: true } });
    const before = root?.versionId ? await this.snapshotEnds(root.versionId) : new Map<string, number>();
    await this.cascadeDependencyTimes(dependsOnTaskId);
    const affected = root?.versionId ? await this.diffEnds(root.versionId, before) : [];

    return { dep, affected };
  }

  async removeDependency(taskId: string, dependsOnTaskId: string) {
    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { versionId: true } });
    const before = task?.versionId ? await this.snapshotEnds(task.versionId) : new Map<string, number>();

    await prisma.taskDependency.delete({ where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } } });
    await this.recalculateAfterDepRemoval(taskId);
    await this.cascadeDependencyTimes(taskId);

    const affected = task?.versionId ? await this.diffEnds(task.versionId, before) : [];
    return { affected };
  }

  async deleteCrossPhaseUserDeps(versionId: string) {
    // Remove dependencies where the two tasks belong to different phases.
    // These are the erroneous deps created by the first (unfixed) autoDepsByUser run.
    const allDeps = await prisma.taskDependency.findMany({
      where: { task: { versionId } },
      select: {
        taskId: true,
        dependsOnTaskId: true,
        task: { select: { subPhase: { select: { phaseId: true } } } },
        dependsOn: { select: { subPhase: { select: { phaseId: true } } } },
      },
    });

    const crossPhaseIds: { taskId: string; dependsOnTaskId: string }[] = [];
    for (const d of allDeps) {
      const phaseA = (d as any).task?.subPhase?.phaseId;
      const phaseB = (d as any).dependsOn?.subPhase?.phaseId;
      if (phaseA && phaseB && phaseA !== phaseB) {
        crossPhaseIds.push({ taskId: d.taskId, dependsOnTaskId: d.dependsOnTaskId });
      }
    }

    for (const { taskId, dependsOnTaskId } of crossPhaseIds) {
      await prisma.taskDependency.delete({
        where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
      });
    }

    return { deleted: crossPhaseIds.length };
  }

  async autoDepsByUser(versionId: string) {
    // Fetch all tasks for this version that have an assigned user name.
    // Include phaseId via subPhase so we group by (user, phase) — not across phases.
    // Sort by orderIndex to preserve the original Excel row order within each sub-phase.
    const tasks = await prisma.task.findMany({
      where: { versionId, assignedUserName: { not: null } },
      select: {
        id: true,
        assignedUserName: true,
        orderIndex: true,
        subPhase: { select: { phaseId: true, orderIndex: true } },
      },
      orderBy: [{ subPhase: { orderIndex: 'asc' } }, { orderIndex: 'asc' }],
    });

    // Group by (userName, phaseId) — dependencies only within the same phase per user
    const byUserPhase = new Map<string, typeof tasks>();
    for (const t of tasks) {
      const phaseId = (t as any).subPhase?.phaseId ?? '__no_phase__';
      const userName = (t.assignedUserName ?? '').trim().toLowerCase();
      if (!userName) continue;
      const key = `${userName}||${phaseId}`;
      if (!byUserPhase.has(key)) byUserPhase.set(key, []);
      byUserPhase.get(key)!.push(t);
    }
    const byUser = byUserPhase;

    // Load existing dependencies to avoid duplicates
    const existing = await prisma.taskDependency.findMany({
      where: { task: { versionId } },
      select: { taskId: true, dependsOnTaskId: true },
    });
    const existingSet = new Set(existing.map(d => `${d.taskId}|${d.dependsOnTaskId}`));

    let created = 0;
    let skipped = 0;
    const createdPairs: { taskId: string; dependsOnTaskId: string }[] = [];

    for (const [, userTasks] of byUser) {
      if (userTasks.length < 2) continue;
      // Sorted by (subPhase.orderIndex, task.orderIndex) — preserves original Excel row order
      for (let i = 0; i < userTasks.length - 1; i++) {
        const prereq = userTasks[i];
        const dependent = userTasks[i + 1];
        const key = `${dependent.id}|${prereq.id}`;
        if (existingSet.has(key)) { skipped++; continue; }
        // Circular check
        if (await this.dependsTransitively(prereq.id, dependent.id)) { skipped++; continue; }
        await prisma.taskDependency.create({ data: { taskId: dependent.id, dependsOnTaskId: prereq.id } });
        existingSet.add(key);
        createdPairs.push({ taskId: dependent.id, dependsOnTaskId: prereq.id });
        created++;
      }
    }

    // Update planned times so that each worker's tasks run sequentially (not in parallel).
    // Display order is governed by orderIndex (not plannedStart) so it stays unchanged.
    if (created > 0) await this.resolveAllDependencies(versionId);

    return { created, skipped, createdPairs };
  }

  async deleteDepPairs(pairs: { taskId: string; dependsOnTaskId: string }[]) {
    if (pairs.length === 0) return { deleted: 0 };
    let deleted = 0;
    for (const p of pairs) {
      const result = await prisma.taskDependency.deleteMany({
        where: { taskId: p.taskId, dependsOnTaskId: p.dependsOnTaskId },
      });
      deleted += result.count;
    }
    return { deleted };
  }

  async reorderSubPhaseTasks(subPhaseId: string, taskIds: string[]) {
    await prisma.$transaction(
      taskIds.map((id, idx) =>
        prisma.task.update({ where: { id }, data: { orderIndex: idx + 1 } }),
      ),
    );
    return { reordered: taskIds.length };
  }

  async reschedule(
    versionId: string,
    phases: { phaseId: string; startTime: string; endTime?: string }[],
    preview: boolean,
    respectDeps = false,
    taskOverrides: { taskId: string; plannedStart: string }[] = [],
    target: 'production' | 'rehearsal' = 'production',
  ) {
    // Rehearsal scheduling writes to Task.rehearsalPlannedStart/End instead of the
    // production plannedStart/End, so timing a rehearsal never overwrites the real
    // night's schedule (and vice versa) — they're separate reference frames.
    const startField = target === 'rehearsal' ? 'rehearsalPlannedStart' : 'plannedStart';
    const endField   = target === 'rehearsal' ? 'rehearsalPlannedEnd'   : 'plannedEnd';
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: {
        phases: {
          orderBy: { orderIndex: 'asc' },
          include: {
            subPhases: {
              orderBy: { orderIndex: 'asc' },
              include: {
                tasks: {
                  orderBy: [{ orderIndex: 'asc' }],
                  include: { dependencies: true },
                },
              },
            },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Version not found');

    const parseMins = (dur: string | null): number | null => {
      if (!dur) return null;
      const hM = dur.match(/(\d+)ש/); const mM = dur.match(/(\d+)ד/);
      if (hM || mM) return (hM ? +hM[1] * 60 : 0) + (mM ? +mM[1] : 0);
      const colonM = dur.match(/^(\d+):(\d{2})$/);
      if (colonM) return +colonM[1] * 60 + +colonM[2];
      const n = parseFloat(dur); return isNaN(n) ? null : Math.round(n);
    };

    const phaseStartMap = new Map(phases.map(p => [p.phaseId, new Date(p.startTime)]));
    const overrideMap = new Map(taskOverrides.map(o => [o.taskId, new Date(o.plannedStart)]));
    const updates: { taskId: string; title: string; phaseId: string; phaseName: string; duration: string | null; plannedStart: Date; plannedEnd: Date }[] = [];

    // Maps taskId → scheduled plannedEnd (built as we schedule, for dep resolution)
    const scheduledEndMap = new Map<string, Date>();

    // Track the end of the last scheduled phase to enforce sequential ordering.
    let prevPhaseComputedEnd: Date | null = null;
    const phaseAdjustments: string[] = [];
    // Store the actual start used for each phase (may differ from input if auto-corrected).
    const adjustedPhaseStarts = new Map<string, Date>();

    for (const phase of (version as any).phases) {
      let phaseStart = phaseStartMap.get(phase.id);
      if (!phaseStart) {
        // Phase not being rescheduled — still use its stored end to block later phases.
        if (phase.plannedEnd) {
          const storedEnd = new Date(phase.plannedEnd);
          if (!prevPhaseComputedEnd || storedEnd.getTime() > prevPhaseComputedEnd.getTime())
            prevPhaseComputedEnd = storedEnd;
        }
        continue;
      }

      // A phase cannot start before the previous scheduled phase has finished.
      if (prevPhaseComputedEnd && phaseStart.getTime() < prevPhaseComputedEnd.getTime()) {
        const overlapMins = Math.round((prevPhaseComputedEnd.getTime() - phaseStart.getTime()) / 60000);
        phaseAdjustments.push(`שלב "${phase.name}" הוזז קדימה ב-${overlapMins} דק' כדי לא לחפוף עם השלב הקודם`);
        phaseStart = new Date(prevPhaseComputedEnd);
      }
      adjustedPhaseStarts.set(phase.id, phaseStart);

      // Sub-phases are sequential: each starts when the previous one ends (max task end).
      let subPhaseStart = new Date(phaseStart);

      for (const sub of phase.subPhases) {
        const sortedTasks = [...sub.tasks].sort(
          (a: any, b: any) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0),
        );

        let subPhaseMaxEnd = new Date(subPhaseStart);

        for (const task of sortedTasks) {
          // Done/in-progress tasks are not rescheduled, but their existing planned end
          // still occupies time and must push the sub-phase end forward.
          if (task.status === 'IN_PROGRESS' || task.status === 'DONE') {
            const existingEnd = (task as any)[endField];
            if (existingEnd) {
              const taskEnd = new Date(existingEnd);
              if (taskEnd.getTime() > subPhaseMaxEnd.getTime()) subPhaseMaxEnd = new Date(taskEnd);
            }
            continue;
          }
          const mins = parseMins(task.duration);
          if (!mins || mins <= 0) continue;

          // Within a sub-phase tasks are parallel: each starts at sub-phase start.
          // A saved override anchors the task to its recorded position.
          // Task-level dependencies (respectDeps) push the task later if needed.
          let start = new Date(subPhaseStart);

          const override = overrideMap.get(task.id);
          if (override && override.getTime() > start.getTime()) start = new Date(override);

          if (respectDeps && task.dependencies?.length) {
            for (const dep of task.dependencies) {
              const depEnd = scheduledEndMap.get(dep.dependsOnTaskId);
              if (depEnd && depEnd.getTime() > start.getTime()) start = new Date(depEnd);
            }
          }

          const end = new Date(start.getTime() + mins * 60000);
          scheduledEndMap.set(task.id, end);
          updates.push({ taskId: task.id, title: task.title, phaseId: phase.id, phaseName: phase.name, duration: task.duration, plannedStart: start, plannedEnd: end });

          // Track the latest end in this sub-phase — it becomes the next sub-phase's start.
          if (end.getTime() > subPhaseMaxEnd.getTime()) subPhaseMaxEnd = new Date(end);
        }

        subPhaseStart = new Date(subPhaseMaxEnd);
      }

      // After all sub-phases, subPhaseStart holds the phase's computed end.
      prevPhaseComputedEnd = new Date(subPhaseStart);
    }

    if (preview) {
      return {
        preview: true,
        updates: updates.map(u => ({
          taskId: u.taskId,
          title: u.title,
          phaseId: u.phaseId,
          phaseName: u.phaseName,
          duration: u.duration,
          plannedStart: u.plannedStart.toISOString(),
          plannedEnd: u.plannedEnd.toISOString(),
        })),
        // Return the engine-corrected phase starts so the frontend can persist them accurately.
        adjustedPhaseStartsIso: Object.fromEntries(
          Array.from(adjustedPhaseStarts.entries()).map(([id, d]) => [id, d.toISOString()]),
        ),
        ...(phaseAdjustments.length && { phaseAdjustments }),
      };
    }

    // undefined = not provided (keep existing DB value), null = explicitly cleared
    const phaseEndMap = new Map(phases.map(p => [p.phaseId, p.endTime !== undefined ? new Date(p.endTime) : undefined]));
    const scheduledPhaseIds = phases.map(p => p.phaseId);
    const updatedTaskIdSet = new Set(updates.map(u => u.taskId));

    const staleTaskIds: string[] = scheduledPhaseIds.length
      ? (await prisma.task.findMany({
          where: {
            subPhase: { phaseId: { in: scheduledPhaseIds } },
            id: { notIn: Array.from(updatedTaskIdSet) },
            status: { notIn: ['DONE', 'ROLLED_BACK', 'IN_PROGRESS', 'FAILED', 'BLOCKED'] as any },
            OR: [{ [startField]: { not: null } }, { [endField]: { not: null } }],
          },
          select: { id: true },
        })).map(t => t.id)
      : [];

    await prisma.$transaction([
      ...updates.map(u =>
        prisma.task.update({
          where: { id: u.taskId },
          data: {
            [startField]: u.plannedStart,
            [endField]: u.plannedEnd,
            ...(u.duration !== undefined && { duration: u.duration }),
          },
        }),
      ),
      // Phase-level plannedStart/End always reflects the production schedule —
      // rehearsal scheduling doesn't have its own phase timeline, only task-level.
      ...(target === 'production' ? phases.map(p => {
        const plannedEnd = phaseEndMap.get(p.phaseId);
        return prisma.phase.update({
          where: { id: p.phaseId },
          data: {
            plannedStart: adjustedPhaseStarts.get(p.phaseId) ?? new Date(p.startTime),
            // Only overwrite plannedEnd if an endTime was explicitly provided.
            ...(plannedEnd !== undefined && { plannedEnd }),
          },
        });
      }) : []),
      ...staleTaskIds.map(id =>
        prisma.task.update({
          where: { id },
          data: { [startField]: null, [endField]: null },
        }),
      ),
    ]);

    return { preview: false, updated: updates.length, cleared: staleTaskIds.length, ...(phaseAdjustments.length && { phaseAdjustments }) };
  }

  async getSubPhases(versionId: string) {
    const phases = await prisma.phase.findMany({
      where: { versionId },
      include: { subPhases: { orderBy: { orderIndex: 'asc' }, select: { id: true, name: true, orderIndex: true } } },
      orderBy: { orderIndex: 'asc' },
    });
    return phases.map(p => ({
      id: p.id, name: p.name, orderIndex: p.orderIndex,
      environment: p.environment,
      subPhases: p.subPhases,
    }));
  }

  async getCrReview(versionId: string) {
    // Primary source: CrPlan (submitted by team leads)
    // Fallback enrichment: VersionCrAssignment for crLabel
    const allPlans = await prisma.crPlan.findMany({
      where: { versionId },
      select: { crNumber: true, crLabel: true },
    });

    const vcaMap = new Map<string, string | null>();
    const vcas = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { crNumber: true, crLabel: true, teamId: true },
    });
    for (const v of vcas) {
      if (!vcaMap.has(v.crNumber)) vcaMap.set(v.crNumber, v.crLabel ?? null);
    }
    // Teams exempt from plan submission (Team.requiresPlan=false) must never be
    // injected as "missing" below — otherwise they show up as "אין התייחסות"
    // and block CR approval for something they were never required to do.
    const exemptRows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM "Team" WHERE "requiresPlan" = false`);
    const exemptTeamIds = new Set(exemptRows.map((r: any) => String(r.id)));
    const assignedTeamIdsByCr = new Map<string, Set<string>>();
    for (const v of vcas) {
      if (exemptTeamIds.has(v.teamId)) continue;
      if (!assignedTeamIdsByCr.has(v.crNumber)) assignedTeamIdsByCr.set(v.crNumber, new Set());
      assignedTeamIdsByCr.get(v.crNumber)!.add(v.teamId);
    }

    const crMap = new Map<string, string | null>();
    for (const p of allPlans) {
      if (!crMap.has(p.crNumber)) {
        crMap.set(p.crNumber, p.crLabel ?? vcaMap.get(p.crNumber) ?? null);
      }
    }
    // Also include CRs that are in VCA but not in CrPlan
    for (const [crNum, crLabel] of vcaMap) {
      if (!crMap.has(crNum)) crMap.set(crNum, crLabel);
    }

    // Sort by crNumber
    const sortedEntries = Array.from(crMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));

    const result: any[] = [];

    for (const [crNumber, crLabel] of sortedEntries) {
      const crPlans = await prisma.crPlan.findMany({
        where: { versionId, crNumber },
        include: {
          team: {
            select: {
              id: true,
              name: true,
              members: {
                where: { isLead: true },
                include: { user: { select: { id: true, fullName: true } } },
              },
            },
          },
          _count: { select: { monitoringPoints: true } },
        },
      });

      // Task proposals grouped by phase — ordered by phase then submission time so
      // merged multi-team tasks read as an actual chronological sequence within
      // each phase, not arbitrary DB row order. reviewStatus/reviewNote/actionType
      // were missing from the select, which meant the review UI always rendered
      // every proposal as "ממתין" (pending) regardless of its real approval state.
      const proposals = await prisma.taskProposal.findMany({
        where: { versionId, crNumber },
        select: {
          id: true, teamId: true, title: true, app: true, actionType: true,
          estimatedMins: true, phase: true, notes: true,
          assignedUserName: true, status: true, reviewStatus: true, reviewNote: true,
          createdAt: true,
        },
        orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
      });

      // Enrich proposals with team names
      const teamNameMap: Record<string, string> = {};
      for (const plan of crPlans) {
        if (plan.team) teamNameMap[plan.teamId] = plan.team.name;
      }
      // Fill in any team IDs from proposals that are not in crPlans
      const missingIds = [...new Set(proposals.map(p => p.teamId).filter(id => !teamNameMap[id]))];
      if (missingIds.length > 0) {
        const extraTeams = await prisma.team.findMany({ where: { id: { in: missingIds } }, select: { id: true, name: true } });
        for (const t of extraTeams) teamNameMap[t.id] = t.name;
      }

      const proposalsByPhase: Record<number, any[]> = { 1: [], 2: [], 3: [], 4: [] };
      for (const p of proposals) {
        const phase = p.phase ?? 1;
        if (!proposalsByPhase[phase]) proposalsByPhase[phase] = [];
        proposalsByPhase[phase].push({ ...p, teamName: teamNameMap[p.teamId] ?? p.teamId });
      }

      const teams = crPlans.map((plan: any) => ({
        teamId: plan.teamId,
        teamName: plan.team?.name ?? '',
        teamLead: plan.team?.members?.[0]?.user?.fullName ?? null,
        crPlan: {
          crManager: plan.crManager ?? null,
          crDescription: plan.crDescription ?? null,
          crType: plan.crType ?? null,
          riskLevel: plan.riskLevel ?? null,
          systems: plan.systems ?? [],
          workPlan: plan.workPlan ?? null,
          scripts: plan.scripts ?? null,
          runTimes: plan.runTimes ?? null,
          nightTestingNotes: plan.nightTestingNotes ?? null,
          gradualRollout: plan.gradualRollout,
          gradualDetails: plan.gradualDetails ?? null,
          activationDate: plan.activationDate ?? null,
          rollbackPlan: plan.rollbackPlan ?? null,
          rollbackType: plan.rollbackType ?? null,
          morningMonitoring: plan.morningMonitoring ?? null,
          notNeededForPlan: plan.notNeededForPlan,
          submissionStatus: plan.submissionStatus,
          planApproved: plan.planApproved,
          monitoringPointsCount: plan._count?.monitoringPoints ?? 0,
        },
      }));

      // Teams assigned to this CR (via VersionCrAssignment) that never opened
      // a CrPlan at all — without these, "all teams involved have responded"
      // silently reads true the moment one engaged team finishes.
      const assignedTeamIds = assignedTeamIdsByCr.get(crNumber) ?? new Set<string>();
      const planTeamIds = new Set(teams.map((t: any) => t.teamId));
      const missingTeamIds = [...assignedTeamIds].filter(id => !planTeamIds.has(id));
      if (missingTeamIds.length > 0) {
        const missingTeams = await prisma.team.findMany({ where: { id: { in: missingTeamIds } }, select: { id: true, name: true } });
        for (const t of missingTeams) {
          teams.push({
            teamId: t.id, teamName: t.name, teamLead: null,
            crPlan: {
              crManager: null, crDescription: null, crType: null, riskLevel: null, systems: [],
              workPlan: null, scripts: null, runTimes: null, nightTestingNotes: null,
              gradualRollout: false, gradualDetails: null, activationDate: null, rollbackPlan: null, rollbackType: null,
              morningMonitoring: null, notNeededForPlan: false,
              submissionStatus: 'NOT_STARTED', planApproved: false, monitoringPointsCount: 0,
            },
          });
        }
      }

      const managers = [...new Set(
        teams.map((t: any) => t.teamLead).filter(Boolean) as string[]
      )];

      const crApproved = crPlans.length > 0 && crPlans.every((p: any) => p.planApproved);
      const planApprovedAt = crPlans.find((p: any) => p.planApprovedAt)?.planApprovedAt ?? null;
      const monitoringPointsTotal = teams.reduce((sum: number, t: any) => sum + (t.crPlan.monitoringPointsCount ?? 0), 0);

      result.push({
        crNumber,
        crLabel: crLabel ?? crNumber,
        managers,
        hasGradualRollout: teams.some((t: any) => t.crPlan.gradualRollout),
        crApproved,
        planApprovedAt,
        teams,
        proposalsByPhase,
        totalProposals: proposals.length,
        monitoringPointsTotal,
      });
    }

    return result;
  }

  async summarizeCrPlan(versionId: string, crNumber: string): Promise<{ summary: string }> {
    const [plans, crAssign] = await Promise.all([
      prisma.crPlan.findMany({
        where: { versionId, crNumber },
        include: { team: { select: { name: true } } },
      }),
      prisma.versionCrAssignment.findFirst({
        where: { versionId, crNumber },
        select: { crLabel: true, crDescription: true },
      }),
    ]);
    if (!plans.length) return { summary: '' };

    const crTitle = crAssign?.crLabel && crAssign.crLabel !== crNumber ? crAssign.crLabel : crNumber;
    const crDesc  = crAssign?.crDescription ?? plans.find((p: any) => p.crDescription)?.crDescription ?? '';

    const FIELD_LABELS: Record<string, string> = {
      workPlan: 'תוכנית עבודה',
      scripts: 'סקריפטים',
      runTimes: 'זמני הרצה',
      nightTestingNotes: 'המלצות בדיקות ליל גרסה',
      morningMonitoring: 'המלצות בקרות בוקר',
      rollbackPlan: 'תוכנית Rollback',
      gradualDetails: 'עלייה מדורגת',
    };

    const sections: string[] = [];
    for (const plan of plans) {
      const teamName = (plan as any).team?.name ?? 'צוות לא ידוע';
      const parts: string[] = [];
      for (const [field, label] of Object.entries(FIELD_LABELS)) {
        const val = (plan as any)[field];
        if (val && String(val).trim()) {
          parts.push(`${label}:\n${String(val).trim()}`);
        }
      }
      if (parts.length) sections.push(`--- ${teamName} ---\n${parts.join('\n\n')}`);
    }

    if (!sections.length) return { summary: '' };

    const apiKeyParam = await prisma.systemParam.findUnique({ where: { key: 'ANTHROPIC_API_KEY' } });
    const apiKey = apiKeyParam?.value?.trim() || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new Error('מפתח ANTHROPIC_API_KEY לא מוגדר בפרמטרי המערכת');

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey });

    const prompt = `אתה מנהל פרויקטים טכני בכיר בחברת תוכנה. אתה מכין תוכנית עבודה מאוחדת לישיבת מעבר (CR Review) לפני לילה גרסה.

CR מספר: ${crNumber}
כותרת: ${crTitle}${crDesc ? `\nרקע ותיאור: ${crDesc}` : ''}

קיבלת תוכניות שהוגשו על ידי מספר צוותי פיתוח. המשימה שלך: אחד אותן לתוכנית מקצועית אחת.

הנחיות:
- כתוב בעברית תקנית ומקצועית
- אחד מידע כפול — אל תחזור על אותו מידע פעמיים
- שמור על כל הפרטים הטכניים (שמות סקריפטים, זמנים, מערכות, שמות שדות)
- כתוב כאילו כל הצוותים פועלים בתיאום מלא כגוף אחד
- אם צוות אחד כתב "אין מה לבדוק/לבקר" — ציין זאת בתמציתיות
- אם שדה מכיל תוכן שנראה כנתון בדיקה (אותיות אקראיות, חסר משמעות) — הוסף הערה ⚠️ לצד הסעיף
- חלק לסעיפים (רק אם יש תוכן רלוונטי):
  📋 תוכנית עבודה — סדר הפעולות לביצוע
  ⚙️ סקריפטים / קבצים — מה להריץ ומתי
  ⏱️ זמני הרצה — משך כל פעולה
  💡 בדיקות ליל גרסה — מה לבדוק אחרי ההטמעה
  🌅 ניטור בוקר שלאחר גרסה — מה לבדוק למחרת
  📈 עלייה מדורגת — אם רלוונטי
  🛡️ תוכנית Rollback — צעדי החזרה לאחור אם נדרש

תוכניות הצוותים:
${sections.join('\n\n')}`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });

    const summary = (message.content[0] as any).text ?? '';
    return { summary };
  }

  async fixTaskOrder(versionId: string) {
    const phases = await prisma.phase.findMany({
      where: { versionId },
      include: {
        subPhases: {
          include: {
            tasks: { orderBy: { createdAt: 'asc' } },
          },
        },
      },
    });

    let fixed = 0;
    await prisma.$transaction(
      phases.flatMap(phase =>
        phase.subPhases.flatMap(sub =>
          sub.tasks.map((task, idx) =>
            prisma.task.update({
              where: { id: task.id },
              data: { orderIndex: idx + 1 },
            }),
          ),
        ),
      ),
    );

    for (const phase of phases)
      for (const sub of phase.subPhases)
        fixed += sub.tasks.length;

    return { fixed };
  }

  async seedDefaultPhases(versionId: string, createdBy: string) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    const phases = [
      {
        name: 'פעילות בוקר גרסה', orderIndex: 1, environment: 'BOTH',
        subPhases: [
          { name: 'פתיחת קבוצת WhatsApp + מוכנות QA', orderIndex: 1 },
          { name: 'הפצת גרסה', orderIndex: 2 },
          { name: 'משימות לפיתוחים בגרסה', orderIndex: 3 },
          { name: 'עצירה/הזזה של תהליכים', orderIndex: 4 },
          { name: 'מוכנות פיתוח', orderIndex: 5 },
          { name: 'הגדרות סטאפ', orderIndex: 6 },
        ],
      },
      {
        name: 'פעילות לילה — HOTNET', orderIndex: 2, environment: 'HOTNET',
        subPhases: [
          { name: 'טרום הורדת מערכות', orderIndex: 1 },
          { name: 'הורדת מערכות', orderIndex: 2 },
          { name: 'הטמעת קוד', orderIndex: 3 },
          { name: 'העלאת מערכות', orderIndex: 4 },
          { name: 'בקרות העלאת מערכות', orderIndex: 5 },
          { name: 'סינכרון מערכות', orderIndex: 6 },
          { name: 'בדיקות QA + GO/NO GO', orderIndex: 7 },
        ],
      },
      {
        name: 'פעילות לילה — HOT', orderIndex: 3, environment: 'HOT', isGoNoGo: true,
        subPhases: [
          { name: 'טרום הורדת מערכות', orderIndex: 1 },
          { name: 'הורדת מערכות', orderIndex: 2 },
          { name: 'הטמעת קוד', orderIndex: 3 },
          { name: 'העלאת מערכות', orderIndex: 4 },
          { name: 'בקרות העלאת מערכות', orderIndex: 5 },
          { name: 'שחרור מערכות', orderIndex: 6 },
          { name: 'בדיקות QA + GO/NO GO', orderIndex: 7 },
        ],
      },
      {
        name: 'פעילויות בוקר לאחר גרסה', orderIndex: 4, environment: 'BOTH', isGoNoGo: false,
        subPhases: [
          { name: 'החזרת תהליכים', orderIndex: 1 },
          { name: 'הטמעות קוד יום אחרי', orderIndex: 2 },
          { name: 'בקרות ומעקב ממשקים', orderIndex: 3 },
          { name: 'בדיקות', orderIndex: 4 },
          { name: 'הוספה או הזזה של תהליכים', orderIndex: 5 },
        ],
      },
    ];

    const createdPhases: any[] = [];
    for (const phase of phases) {
      const createdPhase = await prisma.phase.create({
        data: {
          versionId,
          name: phase.name,
          orderIndex: phase.orderIndex,
          environment: phase.environment as any,
          isGoNoGo: (phase as any).isGoNoGo ?? false,
        },
      });

      for (const sub of phase.subPhases) {
        await prisma.subPhase.create({
          data: {
            phaseId: createdPhase.id,
            name: sub.name,
            orderIndex: sub.orderIndex,
          },
        });
      }
      createdPhases.push(createdPhase);
    }

    return { message: 'שלבים ברירת מחדל נוצרו', phases: createdPhases };
  }

  async updateWizardState(versionId: string, state: Record<string, string | null>) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');
    return prisma.version.update({ where: { id: versionId }, data: { wizardState: state } });
  }

  async detectAnomalies(versionId: string) {
    const phases = await prisma.phase.findMany({
      where: { versionId },
      include: {
        subPhases: {
          orderBy: { orderIndex: 'asc' },
          include: {
            tasks: {
              orderBy: { orderIndex: 'asc' },
              include: {
                dependencies: {
                  include: { dependsOn: { select: { id: true, title: true } } },
                },
              },
            },
          },
        },
      },
      orderBy: { orderIndex: 'asc' },
    });

    const anomalies: {
      type: string;
      phaseId: string;
      phaseName: string;
      phaseEnd: string;
      taskId: string;
      taskTitle: string;
      taskEnd: string;
      overrunMins: number;
      duration: string | null;
      assignedUserName: string | null;
      dependencies: { taskId: string; taskTitle: string }[];
    }[] = [];

    for (const phase of phases) {
      if (!phase.plannedEnd) continue;
      const phaseEnd = new Date(phase.plannedEnd);

      for (const sub of phase.subPhases) {
        for (const task of sub.tasks) {
          if (!task.plannedEnd) continue;
          const taskEnd = new Date(task.plannedEnd as any);
          if (taskEnd.getTime() > phaseEnd.getTime()) {
            anomalies.push({
              type: 'PHASE_OVERRUN',
              phaseId: phase.id,
              phaseName: phase.name,
              phaseEnd: phase.plannedEnd.toISOString(),
              taskId: task.id,
              taskTitle: task.title,
              taskEnd: (task.plannedEnd as any).toISOString(),
              overrunMins: Math.round((taskEnd.getTime() - phaseEnd.getTime()) / 60000),
              duration: task.duration,
              assignedUserName: task.assignedUserName,
              dependencies: (task as any).dependencies.map((d: any) => ({
                taskId: d.dependsOnTaskId,
                taskTitle: d.dependsOn?.title ?? d.dependsOnTaskId,
              })),
            });
          }
        }
      }
    }

    return { anomalies, count: anomalies.length };
  }

  async sortByPlannedStart(versionId: string) {
    const phases = await prisma.phase.findMany({
      where: { versionId },
      include: {
        subPhases: {
          include: {
            tasks: { orderBy: { orderIndex: 'asc' } },
          },
        },
      },
    });

    const ops: any[] = [];
    let reordered = 0;

    for (const phase of phases) {
      for (const sub of phase.subPhases) {
        const withTime = sub.tasks
          .filter((t: any) => t.plannedStart)
          .sort((a: any, b: any) => new Date(a.plannedStart).getTime() - new Date(b.plannedStart).getTime());
        const withoutTime = sub.tasks.filter((t: any) => !t.plannedStart);
        const sorted = [...withTime, ...withoutTime];

        sorted.forEach((task: any, idx: number) => {
          if (task.orderIndex !== idx + 1) {
            ops.push(prisma.task.update({ where: { id: task.id }, data: { orderIndex: idx + 1 } }));
            reordered++;
          }
        });
      }
    }

    if (ops.length > 0) await prisma.$transaction(ops);
    return { reordered };
  }

  async sendCollectingReminder(versionId: string): Promise<{ sent: number; skipped: number; teams: string[] }> {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    // Find submissions that are NOT yet submitted — excluding teams exempt from
    // plan submission entirely (Team.requiresPlan=false) or explicitly marked
    // not-required-for-approval for this version, so they never get nagged for
    // something they were never supposed to submit.
    const pendingSubmissions = await prisma.teamSubmission.findMany({
      where: { versionId, status: { not: 'SUBMITTED' }, notRequiredForApproval: false, team: { requiresPlan: true } },
      include: { team: { include: { members: { where: { isLead: true }, include: { user: { select: { id: true, fullName: true, email: true } } } } } } },
    });

    if (pendingSubmissions.length === 0) return { sent: 0, skipped: 0, teams: [] };

    const meetingLine = version.reviewMeetingTime
      ? `ישיבת המעבר מתוכננת ל: ${new Date(version.reviewMeetingTime).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`
      : 'מועד ישיבת המעבר טרם נקבע';

    const subject = `תזכורת: הגשת פיתוחים לגרסה ${version.name}`;
    let sent = 0;
    let skipped = 0;
    const teamNames: string[] = [];

    for (const sub of pendingSubmissions) {
      const leads = sub.team.members.map((m: any) => m.user).filter((u: any) => u?.email);
      if (leads.length === 0) { skipped++; continue; }

      const teamName = sub.team.name;
      teamNames.push(teamName);
      const body =
        `שלום,\n\n` +
        `צוות ${teamName} עדיין לא השלים את הגשת ה-CR לגרסה ${version.name}.\n\n` +
        `${meetingLine}\n\n` +
        `אנא היכנסו למערכת Night Ops והשלימו את הגשת הפיתוחים בהקדם האפשרי.\n\n` +
        `בברכה,\nמנהל הלילה`;

      await this.emailService.sendEmail(subject, body, leads.map((u: any) => u.email));
      sent++;
    }

    return { sent, skipped, teams: teamNames };
  }
}