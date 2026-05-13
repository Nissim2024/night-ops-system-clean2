import { Injectable, NotFoundException } from '@nestjs/common';
import { EventsGateway } from '../events/events.gateway';
import { PrismaClient, TaskStatus, Priority } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class TasksService {
  constructor(private eventsGateway: EventsGateway) {}

  async findAll(filters?: { status?: TaskStatus; teamId?: string; versionId?: string }) {
    return prisma.task.findMany({
      where: {
        ...(filters?.status && { status: filters.status }),
        ...(filters?.teamId && { assignedTeamId: filters.teamId }),
        ...(filters?.versionId && { versionId: filters.versionId }),
      },
      include: {
        assignedTeam: true,
        assignedUser: { select: { id: true, fullName: true, email: true } },
        creator: { select: { id: true, fullName: true, email: true } },
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
  ) {
    const before = await prisma.task.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Task not found');

    const task = await prisma.task.update({
      where: { id },
      data: { status },
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

    console.log('Emitting TASK_UPDATED for task:', task.id);
    this.eventsGateway.emitTaskUpdated(task);
    if (status === 'BLOCKED') {
      this.eventsGateway.emitTaskBlocked(task);
    }

    return task;
  }

  async update(
    id: string,
    data: Partial<{
      title: string;
      description: string;
      priority: Priority;
      assignedTeamId: string;
      assignedUserId: string;
      dueDate: string;
    }>,
    userId: string,
  ) {
    const before = await prisma.task.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Task not found');

    const task = await prisma.task.update({
      where: { id },
      data: {
        ...data,
        dueDate: data.dueDate ? new Date(data.dueDate) : undefined,
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

  async remove(id: string, userId: string) {
    const task = await prisma.task.findUnique({ where: { id } });
    if (!task) throw new NotFoundException('Task not found');

    await prisma.auditLog.deleteMany({ where: { taskId: id } });
    await prisma.task.delete({ where: { id } });

    return { message: 'Task deleted successfully' };
  }
}