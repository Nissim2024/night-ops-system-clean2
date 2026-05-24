import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient, VersionStatus } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class VersionsService {

  async findAll() {
    const [versions, taskCounts] = await Promise.all([
      prisma.version.findMany({
        include: {
          creator: { select: { id: true, fullName: true } },
          approver: { select: { id: true, fullName: true } },
          _count: { select: { phases: true } },
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
      },
    });
    if (!version) throw new NotFoundException('Version not found');
    return version;
  }

  async create(data: {
    name: string;
    description?: string;
    plannedStart?: string;
    plannedEnd?: string;
    importedFileName?: string;
    collectionDeadline?: string;
    reviewMeetingTime?: string;
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
        importedFileName: data.importedFileName || undefined,
        collectionDeadline: data.collectionDeadline ? new Date(data.collectionDeadline) : undefined,
        reviewMeetingTime: data.reviewMeetingTime ? new Date(data.reviewMeetingTime) : undefined,
        qcReleaseId: data.qcReleaseId || undefined,
        createdBy: data.createdBy,
        status: VersionStatus.DRAFT,
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
        orderIndex: data.orderIndex || 0,
        isCritical: data.isCritical || false,
        plannedStart: data.plannedStart ? new Date(data.plannedStart) : undefined,
        plannedEnd: data.plannedEnd ? new Date(data.plannedEnd) : undefined,
        status: 'WAITING',
        createdBy: data.createdBy,
        createdByTeamLead: data.createdBy,
      },
    });
  }

  async reassignTasks(versionId: string, fromUserName: string, toUserId: string, phaseId?: string) {
    const [version, toUser] = await Promise.all([
      prisma.version.findUnique({ where: { id: versionId } }),
      prisma.user.findUnique({
        where: { id: toUserId },
        include: { teamMemberships: { select: { teamId: true } } },
      }),
    ]);
    if (!version) throw new NotFoundException('Version not found');
    if (!toUser) throw new NotFoundException('User not found');

    const teamId = toUser.teamMemberships.length === 1
      ? toUser.teamMemberships[0].teamId
      : undefined;

    const where: any = { versionId, assignedUserName: fromUserName };
    if (phaseId) where.subPhase = { phaseId };

    const result = await prisma.task.updateMany({
      where,
      data: {
        assignedUserId: toUser.id,
        assignedUserName: toUser.fullName,
        ...(teamId ? { assignedTeamId: teamId } : {}),
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
        name: 'פעילות לילה — HOT', orderIndex: 3, environment: 'HOT',
        subPhases: [
          'טרום הורדת מערכות', 'הורדת מערכות', 'הטמעת קוד',
          'העלאת מערכות', 'בקרות העלאת מערכות', 'שחרור מערכות',
          'בדיקות QA + GO/NO GO',
        ],
      },
      {
        name: 'פעילויות בוקר לאחר גרסה', orderIndex: 4, environment: 'BOTH',
        subPhases: ['החזרת תהליכים', 'הטמעות קוד יום אחרי', 'בקרות ומעקב ממשקים'],
      },
    ];

    let taskCount = 0;
    for (const phaseData of TEMPLATE_PHASES) {
      const phase = await prisma.phase.create({
        data: { versionId, name: phaseData.name, orderIndex: phaseData.orderIndex, environment: phaseData.environment as any },
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

  async updateStatus(id: string, status: VersionStatus, userId: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');

    // State machine: enforce allowed transitions
    const ALLOWED: Partial<Record<VersionStatus, VersionStatus[]>> = {
      [VersionStatus.DRAFT]:         [VersionStatus.COLLECTING, VersionStatus.APPROVED],
      [VersionStatus.COLLECTING]:    [VersionStatus.REFINING, VersionStatus.APPROVED, VersionStatus.DRAFT],
      [VersionStatus.REFINING]:      [VersionStatus.REVIEW, VersionStatus.COLLECTING],
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

    // ACTIVE → MORNING_AFTER: save night snapshot, no full-task validation required
    if (status === VersionStatus.MORNING_AFTER) {
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
      return prisma.version.update({ where: { id }, data });
    }

    if (status === VersionStatus.COMPLETED) {
      const isPostNight =
        version.status === VersionStatus.ACTIVE ||
        version.status === VersionStatus.MORNING_AFTER;

      if (isPostNight) {
        // Check 1: all tasks must be terminal
        const pendingCount = await prisma.task.count({
          where: {
            versionId: id,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
          },
        });
        if (pendingCount > 0) {
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

  async updatePlannedEnd(id: string, plannedEnd: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');
    return (prisma.version.update as any)({
      where: { id },
      data: { plannedEnd: new Date(plannedEnd) },
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
    return prisma.version.update({ where: { id }, data: { status: VersionStatus.APPROVED } });
  }

  async submitTeamTasks(versionId: string, teamId: string, userId: string) {
    const taskCount = await prisma.task.count({
      where: { versionId, assignedTeamId: teamId },
    });

    return prisma.teamSubmission.update({
      where: { versionId_teamId: { versionId, teamId } },
      data: {
        status: 'SUBMITTED',
        submittedBy: userId,
        submittedAt: new Date(),
        taskCount,
      },
    });
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

  async addDependency(taskId: string, dependsOnTaskId: string) {
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException('משימה לא יכולה להיות תלויה בעצמה');
    }
    // Circular dependency check: would `dependsOnTaskId` end up depending on `taskId`?
    if (await this.dependsTransitively(dependsOnTaskId, taskId)) {
      throw new BadRequestException('לא ניתן להוסיף תלות — תיווצר תלות מעגלית');
    }

    const dep = await prisma.taskDependency.create({
      data: { taskId, dependsOnTaskId },
    });

    // Cascade: push taskId (and its dependents) based on the new dependency's end time
    await this.cascadeDependencyTimes(dependsOnTaskId);

    return dep;
  }

  async removeDependency(taskId: string, dependsOnTaskId: string) {
    return prisma.taskDependency.delete({
      where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
    });
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
  ) {
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
          // Done/in-progress tasks are not rescheduled, but their existing plannedEnd
          // still occupies time and must push the sub-phase end forward.
          if (task.status === 'IN_PROGRESS' || task.status === 'DONE') {
            if (task.plannedEnd) {
              const taskEnd = new Date(task.plannedEnd);
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
            plannedStart: u.plannedStart,
            plannedEnd: u.plannedEnd,
            ...(u.duration !== undefined && { duration: u.duration }),
          },
        }),
      ),
      ...phases.map(p => {
        const plannedEnd = phaseEndMap.get(p.phaseId);
        return prisma.phase.update({
          where: { id: p.phaseId },
          data: {
            plannedStart: adjustedPhaseStarts.get(p.phaseId) ?? new Date(p.startTime),
            // Only overwrite plannedEnd if an endTime was explicitly provided.
            ...(plannedEnd !== undefined && { plannedEnd }),
          },
        });
      }),
      ...staleTaskIds.map(id =>
        prisma.task.update({
          where: { id },
          data: { plannedStart: null, plannedEnd: null },
        }),
      ),
    ]);

    return { preview: false, updated: updates.length, cleared: staleTaskIds.length, ...(phaseAdjustments.length && { phaseAdjustments }) };
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
        name: 'פעילות לילה — HOT', orderIndex: 3, environment: 'HOT',
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
        name: 'פעילויות בוקר לאחר גרסה', orderIndex: 4, environment: 'BOTH',
        subPhases: [
          { name: 'החזרת תהליכים', orderIndex: 1 },
          { name: 'הטמעות קוד יום אחרי', orderIndex: 2 },
          { name: 'בקרות ומעקב ממשקים', orderIndex: 3 },
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
}