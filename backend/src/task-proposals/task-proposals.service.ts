import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@Injectable()
export class TaskProposalsService {

  async findForVersion(versionId: string, user: { sub: string; role: string; teamId?: string }) {
    if (MANAGERS.includes(user.role)) {
      // managers see all proposals for the version, grouped
      return prisma.taskProposal.findMany({
        where: { versionId },
        orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
      });
    }

    // TEAM_LEAD sees only their team's proposals
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];

    return prisma.taskProposal.findMany({
      where: { versionId, teamId: membership.teamId },
      orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    versionId: string,
    user: { sub: string; role: string },
    dto: { title: string; phase: number; app?: string; estimatedMins?: number; crNumber?: string; crLabel?: string; notes?: string; assignedUserName?: string },
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('שדה "שם המשימה" הוא חובה');
    if (!dto.phase || dto.phase < 1 || dto.phase > 4) throw new BadRequestException('שלב חייב להיות בין 1 ל-4');

    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) throw new ForbiddenException('לא שויכת לצוות');

    return prisma.taskProposal.create({
      data: {
        versionId,
        teamId: membership.teamId,
        submittedBy: user.sub,
        title: dto.title,
        phase: dto.phase,
        app: dto.app ?? null,
        estimatedMins: dto.estimatedMins ?? null,
        crNumber: dto.crNumber ?? null,
        crLabel: dto.crLabel ?? null,
        notes: dto.notes ?? null,
        assignedUserName: dto.assignedUserName ?? null,
        status: 'DRAFT',
      },
    });
  }

  async update(
    id: string,
    user: { sub: string; role: string },
    dto: Partial<{ title: string; phase: number; app: string; estimatedMins: number; crNumber: string; crLabel: string; notes: string; assignedUserName: string; status: string }>,
  ) {
    const proposal = await prisma.taskProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('הצעה לא נמצאה');

    if (!MANAGERS.includes(user.role) && proposal.submittedBy !== user.sub) {
      throw new ForbiddenException('אין הרשאה לעדכן הצעה זו');
    }

    return prisma.taskProposal.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.phase !== undefined && { phase: dto.phase }),
        ...(dto.app !== undefined && { app: dto.app }),
        ...(dto.estimatedMins !== undefined && { estimatedMins: dto.estimatedMins }),
        ...(dto.crNumber !== undefined && { crNumber: dto.crNumber }),
        ...(dto.crLabel !== undefined && { crLabel: dto.crLabel }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.assignedUserName !== undefined && { assignedUserName: dto.assignedUserName }),
        ...(dto.status !== undefined && { status: dto.status as any }),
      },
    });
  }

  async remove(id: string, user: { sub: string; role: string }) {
    const proposal = await prisma.taskProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('הצעה לא נמצאה');

    if (!MANAGERS.includes(user.role) && proposal.submittedBy !== user.sub) {
      throw new ForbiddenException('אין הרשאה למחוק הצעה זו');
    }

    await prisma.taskProposal.delete({ where: { id } });
    return { ok: true };
  }

  async removeByCr(versionId: string, crNumber: string, user: { sub: string; role: string }) {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    await prisma.taskProposal.deleteMany({
      where: {
        versionId,
        crNumber,
        ...(membership && !MANAGERS.includes(user.role) ? { teamId: membership.teamId } : {}),
      },
    });
    return { ok: true };
  }

  async markUsed(id: string, taskId: string) {
    return prisma.taskProposal.update({
      where: { id },
      data: { usedInTaskId: taskId },
    });
  }
}
