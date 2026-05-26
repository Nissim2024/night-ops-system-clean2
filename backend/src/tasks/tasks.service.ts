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
              ...(filters?.versionId && { versionId: filters.versionId }),
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
        ...(filters?.versionId && { versionId: filters.versionId }),
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
    createdBy: string;
  }) {
    if (!data.title?.trim()) throw new BadRequestException('שדה "כותרת" הוא חובה');
    const task = await prisma.task.create({
      data: {
        ...data,
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
  ) {
    const VALID_STATUSES: TaskStatus[] = ['OPEN', 'WAITING', 'IN_PROGRESS', 'DONE', 'FAILED', 'ROLLED_BACK', 'BLOCKED'];
    if (!VALID_STATUSES.includes(status)) {
      throw new BadRequestException(`סטטוס לא חוקי: "${status}". ערכים מותרים: ${VALID_STATUSES.join(', ')}`);
    }
    const before = await prisma.task.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Task not found');

    const statusData: any = { status };
    if (status === 'IN_PROGRESS' && !before.actualStart) {
      statusData.actualStart = new Date();
    }
    if (status === 'DONE' || status === 'FAILED') {
      statusData.actualFinish = new Date();
    }
    if (status === 'BLOCKED' && blockedReason !== undefined) {
      statusData.blockedReason = blockedReason;
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
        afterData: { status } as any,
        ipAddress,
      },
    });

    this.eventsGateway.emitTaskUpdated(task);

    if (status === 'BLOCKED') {
      this.eventsGateway.emitTaskBlocked(task);
    } else if (before.status === 'BLOCKED') {
      // was blocked, now unblocked
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

    return task;
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
                        'crNumber', 'application', 'environment', 'dueDate', 'plannedStart', 'plannedEnd'];
        if (LOCKED.some(f => data[f] !== undefined)) {
          throw new ForbiddenException('גרסה פעילה — לא ניתן לערוך פרטי משימה');
        }
      }
    }

    const {
      title, description, notes, dependencyNote, duration,
      priority, assignedTeamId, assignedUserId, assignedUserName,
      crNumber, application, environment, dueDate, plannedStart, plannedEnd,
      actualStart, actualFinish, delayReason, blockedReason, subPhaseId,
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
        ...(subPhaseId !== undefined && { subPhaseId }),
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
      const allDone = depTask.dependencies.every(d => d.dependsOn.status === 'DONE');
      if (allDone) {
        const opened = await prisma.task.update({
          where: { id: depId },
          data: { status: 'OPEN' },
          include: {
            assignedTeam: true,
            assignedUser: { select: { id: true, fullName: true, email: true } },
          },
        });
        this.eventsGateway.emitTaskUpdated(opened as any);
      }
    }
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