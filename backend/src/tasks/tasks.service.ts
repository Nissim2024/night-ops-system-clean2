import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { PrismaClient, TaskStatus, Priority } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class TasksService {
  constructor(private eventsGateway: EventsGateway) {}

  async findAll(
    filters?: { status?: TaskStatus; teamId?: string; versionId?: string },
    user?: { sub: string; role: string },
  ) {
    // EMPLOYEE sees only their own team's tasks
    let teamIdFilter = filters?.teamId;
    if (user?.role === 'EMPLOYEE') {
      const memberships = await prisma.teamMember.findMany({
        where: { userId: user.sub },
        select: { teamId: true },
      });
      const myTeamIds = memberships.map(m => m.teamId);
      // If caller also passed a specific teamId, intersect (only allow their own team)
      if (teamIdFilter && myTeamIds.includes(teamIdFilter)) {
        // keep the specific filter
      } else {
        teamIdFilter = myTeamIds.length === 1 ? myTeamIds[0] : undefined;
        if (myTeamIds.length > 1) {
          // multiple teams — use IN
          return prisma.task.findMany({
            where: {
              assignedTeamId: { in: myTeamIds },
              ...(filters?.status && { status: filters.status }),
              ...(filters?.versionId && {
                OR: [
                  { versionId: filters.versionId },
                  { subPhase: { phase: { versionId: filters.versionId } } },
                ],
              }),
            },
            include: {
              assignedTeam: true,
              assignedUser: { select: { id: true, fullName: true, email: true } },
              creator: { select: { id: true, fullName: true, email: true } },
              dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
            },
            orderBy: { createdAt: 'desc' },
          });
        }
      }
    }

    return prisma.task.findMany({
      where: {
        ...(filters?.status && { status: filters.status }),
        ...(teamIdFilter && { assignedTeamId: teamIdFilter }),
        // Match via the task's own versionId OR its subPhase's parent version —
        // a handful of tasks exist in the DB with subPhaseId set but versionId
        // left null/stale (denormalization drift from an older creation path),
        // which silently disappeared from every versionId-filtered query.
        ...(filters?.versionId && {
          OR: [
            { versionId: filters.versionId },
            { subPhase: { phase: { versionId: filters.versionId } } },
          ],
        }),
      },
      include: {
        assignedTeam: true,
        assignedUser: { select: { id: true, fullName: true, email: true } },
        creator: { select: { id: true, fullName: true, email: true } },
        dependencies: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const task = await prisma.task.findUnique({
      where: { id },
      include: {
        assignedTeam: true,
        assignedUser: { select: { id: true, fullName: true, email: true } },
        creator: { select: { id: true, fullName: true, email: true } },
        auditLogs: {
          include: { user: { select: { id: true, fullName: true } } },
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!task) throw new NotFoundException('Task not found');
    return task;
  }

  async create(data: {
    title: string;
    description?: string;
    crNumber?: string;
    application?: string;
    priority?: Priority;
    assignedTeamId?: string;
    assignedUserId?: string;
    dueDate?: string;
    subPhaseId?: string;
    versionId?: string;
    createdBy: string;
  }) {
    data.title = (data.title ?? '').replace(/<[^>]*>/g, '').trim();
    if (!data.title) throw new BadRequestException('שדה "כותרת" הוא חובה');

    // Every task must belong to a version — either given directly, or derived
    // from its sub-phase — otherwise it becomes an orphan: invisible in
    // version tracking/QA planning and never cleaned up on version deletion.
    let versionId = data.versionId || undefined;
    if (data.subPhaseId) {
      const subPhase = await prisma.subPhase.findUnique({ where: { id: data.subPhaseId }, include: { phase: true } });
      if (!subPhase) throw new BadRequestException('תת-שלב לא נמצא');
      versionId = subPhase.phase.versionId;
    }
    if (!versionId) throw new BadRequestException('לא ניתן ליצור משימה ללא שיוך לגרסה');

    const task = await prisma.task.create({
      data: {
        ...data,
        versionId,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
      },
      include: {
        assignedTeam: true,
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId: data.createdBy,
        taskId: task.id,
        action: 'TASK_CREATED',
        afterData: task as any,
      },
    });

    return task;
  }

  async updateStatus(
    id: string,
    status: TaskStatus,
    userId: string,
    ipAddress?: string,
    blockedReason?: string,
    failedReason?: string,
    blockedSeverity?: string,
  ) {
    const VALID_STATUSES: TaskStatus[] = ['OPEN', 'WAITING', 'IN_PROGRESS', 'DONE', 'FAILED', 'ROLLED_BACK', 'BLOCKED'];
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(`סטטוס לא חוקי: "${status}". ערכים מותרים: ${VALID_STATUSES.join(', ')}`);
    }
    const before = await prisma.task.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Task not found');

    // Phase-gate — blocks a task from actually starting (OPEN or straight to
    // IN_PROGRESS) while an earlier phase still has incomplete tasks. Applies
    // in both ACTIVE and REHEARSAL: a rehearsal exists specifically to drill
    // the real phase order, so skipping it there defeats the point. Only the
    // time-based early-unlock below (phaseStartArrived) is ACTIVE-only — a
    // rehearsal doesn't run against the real night's clock, so completion is
    // the only signal that makes sense for it.
    const isActivating =
      (status === 'OPEN' && before.status === 'WAITING') ||
      (status === 'IN_PROGRESS' && ['WAITING', 'OPEN'].includes(before.status));
    if (isActivating && before.subPhaseId) {
      const subPhase = await prisma.subPhase.findUnique({
        where: { id: before.subPhaseId },
        select: { phase: { select: { orderIndex: true, versionId: true, plannedStart: true } } },
      });
      if (subPhase) {
        const { orderIndex, versionId, plannedStart } = subPhase.phase;
        const version = await prisma.version.findUnique({ where: { id: versionId }, select: { status: true } });
        if (version?.status === 'ACTIVE' || version?.status === 'REHEARSAL') {
          const phaseStartArrived = version.status === 'ACTIVE' && plannedStart != null && new Date(plannedStart) <= new Date();
          if (!phaseStartArrived) {
            const prevPhases = await prisma.phase.findMany({
              where: { versionId, orderIndex: { lt: orderIndex } },
              select: { id: true, name: true, orderIndex: true },
            });
            if (prevPhases.length > 0) {
              const incomplete = await prisma.task.count({
                where: {
                  subPhase: { phaseId: { in: prevPhases.map(p => p.id) } },
                  status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] },
                },
              });
              if (incomplete > 0) {
                const lastPhase = prevPhases.sort((a, b) => b.orderIndex - a.orderIndex)[0];
                const verb = status === 'IN_PROGRESS' ? 'להתחיל' : 'לפתוח';
                throw new ForbiddenException(
                  `לא ניתן ${verb} משימה — ${incomplete} משימות בשלב "${lastPhase.name}" טרם הסתיימו`,
                );
              }
            }
          }
        }
      }
    }

    const statusData: any = { status };
    if (status === 'IN_PROGRESS' && !before.actualStart) {
      statusData.actualStart = new Date();
    }
    if (status === 'DONE' || status === 'FAILED') {
      statusData.actualFinish = new Date();
      if (!before.actualStart) {
        statusData.actualStart = statusData.actualFinish;
      }
    }
    if (status === 'BLOCKED' && blockedReason !== undefined) {
      statusData.blockedReason = blockedReason;
      statusData.blockedSeverity = blockedSeverity ?? null;
    }
    if (status !== 'BLOCKED' && before.status === 'BLOCKED') {
      statusData.blockedSeverity = null;
    }

    // ── Failure reason validation ──
    // When marking FAILED: require a reason from the FailureReason catalogue.
    // If no catalogue entries exist yet, we skip the requirement (graceful degradation).
    let failureReasonRecord: { id: string; requiresRollback: boolean } | null = null;
    if (status === 'FAILED') {
      const catalogueCount = await (prisma as any).failureReason.count({ where: { isActive: true } });
      if (catalogueCount > 0) {
        if (!failedReason?.trim()) {
          throw new BadRequestException('נדרשת סיבת כישלון — בחר סיבה מהרשימה');
        }
        failureReasonRecord = await (prisma as any).failureReason.findFirst({
          where: { reason: failedReason.trim(), isActive: true },
          select: { id: true, requiresRollback: true },
        });
        if (!failureReasonRecord) {
          throw new BadRequestException(`סיבת הכישלון "${failedReason}" אינה קיימת ברשימה המאושרת`);
        }
        statusData.failedReason = failedReason.trim();
        statusData.failureReasonId = failureReasonRecord.id;
      } else if (failedReason?.trim()) {
        // Catalogue empty but reason was provided — save it as free text
        statusData.failedReason = failedReason.trim();
      }
    }

    // Any transition to or from FAILED invalidates a prior waiver:
    // - new failure (→ FAILED): fresh incident, old approval no longer relevant
    // - re-run (FAILED → *): task is being retried, waiver must not carry over
    if (status === 'FAILED' || before.status === 'FAILED') {
      statusData.goNoGoWaived = false;
      statusData.waivedBy = null;
      statusData.waivedAt = null;
    }

    const task = await prisma.task.update({
      where: { id },
      data: statusData,
      include: {
        assignedTeam: true,
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        taskId: id,
        action: 'STATUS_CHANGED',
        beforeData: { status: before.status } as any,
        afterData: {
          status,
          ...(failedReason && { failedReason }),
          ...(failureReasonRecord?.requiresRollback && { requiresRollback: true }),
        } as any,
        ipAddress,
      },
    });

    this.eventsGateway.emitTaskUpdated(task);

    if (status === 'BLOCKED') {
      this.eventsGateway.emitTaskBlocked(task);
    } else if (before.status === 'BLOCKED') {
      this.eventsGateway.emitTaskUnblocked(task);
    }

    if (status === 'OPEN') {
      this.eventsGateway.emitTaskOpen(task);
    } else if (status === 'IN_PROGRESS') {
      this.eventsGateway.emitTaskStarted(task);
    } else if (status === 'DONE') {
      this.eventsGateway.emitTaskCompleted(task);
      await this.autoOpenDependents(id);
    }

    // Return requiresRollback flag alongside the task so the frontend can warn the user
    return { ...task, requiresRollback: failureReasonRecord?.requiresRollback ?? false };
  }

  async update(id: string, data: any, userId: string) {
    const before = await prisma.task.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Task not found');

    // Version lock: when ACTIVE, only operational fields are allowed
    if (before.versionId) {
      const ver = await prisma.version.findUnique({ where: { id: before.versionId }, select: { status: true } });
      if (ver?.status === 'ACTIVE') {
        const LOCKED = ['title', 'description', 'notes', 'dependencyNote', 'duration',
                        'priority', 'assignedTeamId', 'assignedUserId', 'assignedUserName',
                        'crNumber', 'application', 'environment', 'dueDate', 'plannedStart', 'plannedEnd',
                        'orderIndex'];
        if (LOCKED.some(f => data[f] !== undefined)) {
          throw new ForbiddenException('גרסה פעילה — לא ניתן לערוך פרטי משימה');
        }
      }
    }

    const {
      title, description, notes, dependencyNote, duration,
      priority, assignedTeamId, assignedUserId, assignedUserName,
      crNumber, application, environment, dueDate, plannedStart, plannedEnd,
      actualStart, actualFinish, delayReason, blockedReason, blockedSeverity, subPhaseId,
      orderIndex,
    } = data;

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(notes !== undefined && { notes }),
        ...(dependencyNote !== undefined && { dependencyNote }),
        ...(duration !== undefined && { duration }),
        ...(priority !== undefined && { priority }),
        ...(assignedTeamId !== undefined && { assignedTeamId: assignedTeamId || null }),
        ...(assignedUserId !== undefined && { assignedUserId: assignedUserId || null }),
        ...(assignedUserName !== undefined && { assignedUserName: assignedUserName || null }),
        ...(crNumber !== undefined && { crNumber }),
        ...(application !== undefined && { application }),
        ...(environment !== undefined && { environment }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(plannedStart !== undefined && { plannedStart: plannedStart ? new Date(plannedStart) : null }),
        ...(plannedEnd !== undefined && { plannedEnd: plannedEnd ? new Date(plannedEnd) : null }),
        ...(actualStart !== undefined && { actualStart: actualStart ? new Date(actualStart) : null }),
        ...(actualFinish !== undefined && { actualFinish: actualFinish ? new Date(actualFinish) : null }),
        ...(delayReason !== undefined && { delayReason: delayReason || null }),
        ...(blockedReason !== undefined && { blockedReason: blockedReason || null }),
        ...(blockedSeverity !== undefined && { blockedSeverity: (blockedSeverity || null) as any }),
        ...(subPhaseId !== undefined && { subPhaseId }),
        ...(orderIndex !== undefined && { orderIndex: Number(orderIndex) }),
      },
    });

    await prisma.auditLog.create({
      data: {
        userId,
        taskId: id,
        action: 'TASK_UPDATED',
        beforeData: before as any,
        afterData: task as any,
      },
    });

    return task;
  }

  private async autoOpenDependents(completedTaskId: string) {
    const dependents = await prisma.taskDependency.findMany({
      where: { dependsOnTaskId: completedTaskId },
      select: { taskId: true },
    });

    for (const { taskId: depId } of dependents) {
      const depTask = await prisma.task.findUnique({
        where: { id: depId },
        include: { dependencies: { include: { dependsOn: { select: { status: true } } } } },
      });
      if (!depTask || depTask.status !== 'WAITING') continue;
      // All deps must be terminal (DONE, FAILED, or ROLLED_BACK) before auto-opening
      const TERMINAL_SET = new Set(['DONE', 'FAILED', 'ROLLED_BACK']);
      const allTerminal = depTask.dependencies.every(d => TERMINAL_SET.has(d.dependsOn.status));
      if (allTerminal) {
        const opened = await prisma.task.update({
          where: { id: depId },
          data: { status: 'OPEN' },
          include: {
            assignedTeam: true,
            assignedUser: { select: { id: true, fullName: true, email: true } },
          },
        });
        // Broadcast status change to all connected clients (WarRoom update)
        this.eventsGateway.emitTaskUpdated(opened as any);
        // Push notification to the assigned user — their task is now ready
        await this.eventsGateway.emitTaskOpen(opened as any);
      }
    }
  }

  async rollbackStatus(id: string, userId: string) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');

    const ROLLBACK_MAP: Record<string, string> = {
      FAILED: 'IN_PROGRESS',
      DONE: 'IN_PROGRESS',
      IN_PROGRESS: 'OPEN',
      OPEN: 'WAITING',
      ROLLED_BACK: 'IN_PROGRESS',
      BLOCKED: 'OPEN',
    };
    const prevStatus = ROLLBACK_MAP[task.status];
    if (!prevStatus) throw new BadRequestException(`לא ניתן להחזיר סטטוס "${task.status}" אחורה`);

    const updated = await prisma.task.update({
      where: { id },
      data: {
        status: prevStatus as any,
        blockedReason: prevStatus !== 'BLOCKED' ? null : undefined,
        // Rolling back from FAILED means a re-run is imminent — clear the waiver
        ...(task.status === 'FAILED' ? { goNoGoWaived: false, waivedBy: null, waivedAt: null } : {}),
      } as any,
      include: {
        assignedTeam: true,
        assignedUser: { select: { id: true, fullName: true, email: true } },
      },
    });

    await prisma.auditLog.create({
      data: {
        userId, taskId: id, action: 'STATUS_CHANGED',
        beforeData: { status: task.status } as any,
        afterData: { status: prevStatus } as any,
      },
    });

    this.eventsGateway.emitTaskUpdated(updated as any);
    return updated;
  }

  async waiveGoNoGo(id: string, userId: string, reason?: string) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');

    const waived = !(task as any).goNoGoWaived;
    if (waived && !reason?.trim()) {
      throw new BadRequestException('נדרשת סיבה לאישור דילוג GO/NO-GO');
    }
    const updated = await prisma.task.update({
      where: { id },
      data: {
        goNoGoWaived: waived,
        waivedBy: waived ? userId : null,
        waivedAt: waived ? new Date() : null,
      } as any,
    });
    await prisma.auditLog.create({
      data: {
        userId, taskId: id,
        action: waived ? 'GO_NOGO_WAIVED' : 'GO_NOGO_UNWAIVED',
        afterData: { taskTitle: task.title, reason: waived ? reason?.trim() : undefined } as any,
      },
    });
    this.eventsGateway.emitTaskUpdated(updated as any);
    return updated;
  }

  async getWaiverHistory(id: string) {
    return prisma.auditLog.findMany({
      where: { taskId: id, action: { in: ['GO_NOGO_WAIVED', 'GO_NOGO_UNWAIVED'] } },
      include: { user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async duplicate(id: string, userId: string) {
    const orig = await prisma.task.findUnique({ where: { id } });
    if (!orig) throw new NotFoundException('Task not found');

    const { id: _id, createdAt, updatedAt, startedAt, completedAt,
            actualStart, actualFinish, blockedReason, delayReason, ...rest } = orig as any;

    const copy = await prisma.task.create({
      data: {
        ...rest,
        title: `${orig.title} (עותק)`,
        status: 'WAITING',
        createdBy: userId,
        orderIndex: (orig.orderIndex ?? 0) + 1,
      },
      include: { assignedTeam: true },
    });

    await prisma.auditLog.create({
      data: { userId, taskId: copy.id, action: 'TASK_CREATED', afterData: copy as any },
    });

    return copy;
  }

  async remove(id: string, userId: string) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');

    // Delete all related records before the task itself (no cascade configured in schema).
    await prisma.taskDependency.deleteMany({
      where: { OR: [{ taskId: id }, { dependsOnTaskId: id }] },
    });
    await prisma.auditLog.deleteMany({ where: { taskId: id } });

    // Unlink any proposal that referenced this task so it's available again
    await prisma.taskProposal.updateMany({
      where: { usedInTaskId: id },
      data: { usedInTaskId: null },
    });

    await prisma.task.delete({ where: { id } });

    return { message: 'Task deleted successfully' };
  }
}