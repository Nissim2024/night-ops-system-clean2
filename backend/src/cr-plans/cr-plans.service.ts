import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@Injectable()
export class CrPlansService {
  async findForVersion(versionId: string, user: { sub: string; role: string }) {
    if (MANAGERS.includes(user.role)) {
      return prisma.crPlan.findMany({
        where: { versionId },
        include: { crDeps: true, team: { select: { id: true, name: true } } },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
    }
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];
    return prisma.crPlan.findMany({
      where: { versionId, teamId: membership.teamId },
      include: { crDeps: true },
      orderBy: { crNumber: 'asc' },
    });
  }

  async upsert(
    versionId: string,
    user: { sub: string; role: string },
    dto: {
      crNumber: string;
      crLabel?: string;
      rollbackPlan?: string;
      gradualRollout?: boolean;
      gradualDetails?: string;
      nightTestingNotes?: string;
      morningMonitoring?: string;
      dependsOnCrs?: string[];
    },
  ) {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) throw new ForbiddenException('לא שויכת לצוות');

    const { dependsOnCrs = [], ...fields } = dto;

    const existing = await prisma.crPlan.findFirst({
      where: { versionId, crNumber: dto.crNumber, teamId: membership.teamId },
    });

    if (existing) {
      await prisma.crDependency.deleteMany({ where: { crPlanId: existing.id } });
      return prisma.crPlan.update({
        where: { id: existing.id },
        data: {
          ...fields,
          crDeps: { create: dependsOnCrs.map(cr => ({ dependsOnCr: cr })) },
        },
        include: { crDeps: true },
      });
    }

    return prisma.crPlan.create({
      data: {
        versionId,
        teamId: membership.teamId,
        ...fields,
        crDeps: { create: dependsOnCrs.map(cr => ({ dependsOnCr: cr })) },
      },
      include: { crDeps: true },
    });
  }

  async remove(id: string, user: { sub: string; role: string }) {
    const plan = await prisma.crPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('CrPlan לא נמצא');
    if (!MANAGERS.includes(user.role)) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.sub, teamId: plan.teamId },
      });
      if (!membership) throw new ForbiddenException('אין הרשאה');
    }
    await prisma.crDependency.deleteMany({ where: { crPlanId: id } });
    await prisma.crPlan.delete({ where: { id } });
    return { ok: true };
  }
}
