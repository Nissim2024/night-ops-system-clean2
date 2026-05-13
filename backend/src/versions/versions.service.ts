import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient, VersionStatus } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class VersionsService {

  async findAll() {
    return prisma.version.findMany({
      include: {
        creator: { select: { id: true, fullName: true } },
        _count: { select: { phases: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
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
    collectionDeadline?: string;
    reviewMeetingTime?: string;
    createdBy: string;
  }) {
    const version = await prisma.version.create({
      data: {
        name: data.name,
        description: data.description,
        plannedStart: data.plannedStart ? new Date(data.plannedStart) : undefined,
        collectionDeadline: data.collectionDeadline ? new Date(data.collectionDeadline) : undefined,
        reviewMeetingTime: data.reviewMeetingTime ? new Date(data.reviewMeetingTime) : undefined,
        createdBy: data.createdBy,
        status: VersionStatus.DRAFT,
      },
    });

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
    const task = await prisma.task.create({
      data: {
        subPhaseId,
        versionId: data.versionId,
        title: data.title,
        notes: data.notes,
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
    return task;
  }

  async updateStatus(id: string, status: VersionStatus, userId: string) {
    const version = await prisma.version.findUnique({ where: { id } });
    if (!version) throw new NotFoundException('Version not found');

    const data: any = { status };
    if (status === VersionStatus.ACTIVE) data.actualStart = new Date();
    if (status === VersionStatus.COMPLETED) data.completedAt = new Date();
    if (status === VersionStatus.APPROVED) {
      data.approvedBy = userId;
      data.approvedAt = new Date();
    }

    return prisma.version.update({ where: { id }, data });
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

  async addDependency(taskId: string, dependsOnTaskId: string) {
    if (taskId === dependsOnTaskId) {
      throw new BadRequestException('משימה לא יכולה להיות תלויה בעצמה');
    }
    return prisma.taskDependency.create({
      data: { taskId, dependsOnTaskId },
    });
  }

  async removeDependency(taskId: string, dependsOnTaskId: string) {
    return prisma.taskDependency.delete({
      where: { taskId_dependsOnTaskId: { taskId, dependsOnTaskId } },
    });
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