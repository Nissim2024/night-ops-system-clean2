import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class TeamsService {
  async findAll() {
    const teams = await prisma.team.findMany({
      include: {
        members: {
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true } },
          },
        },
        _count: { select: { assignedTasks: true } },
      },
      orderBy: { name: 'asc' },
    });
    // Enrich with requiresPlan via raw SQL (Prisma client may be stale after schema change)
    const rpRows: any[] = await prisma.$queryRawUnsafe(`SELECT id, "requiresPlan" FROM "Team"`);
    const rpMap = new Map(rpRows.map((r: any) => [r.id, r.requiresPlan]));
    return teams.map(t => ({ ...t, requiresPlan: rpMap.get(t.id) ?? true }));
  }

  async findOne(id: string) {
    const team = await prisma.team.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true } },
          },
        },
        assignedTasks: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(data: { name: string; description?: string }) {
    const name = data.name.trim();
    const existing = await prisma.team.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
    });
    if (existing) {
      throw new BadRequestException(`צוות בשם "${name}" כבר קיים במערכת`);
    }
    return prisma.team.create({ data: { ...data, name } });
  }

  async addMember(teamId: string, userId: string, isLead: boolean = false) {
    const team = await prisma.team.findUnique({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');

    return prisma.teamMember.upsert({
      where: { userId_teamId: { userId, teamId } },
      update: { isLead },
      create: { userId, teamId, isLead },
    });
  }

  async removeMember(teamId: string, userId: string) {
    return prisma.teamMember.delete({
      where: { userId_teamId: { userId, teamId } },
    });
  }

  async update(id: string, data: { name?: string; description?: string; active?: boolean; apps?: string[]; requiresPlan?: boolean }) {
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    if (data.name !== undefined) {
      const name = data.name.trim();
      const existing = await prisma.team.findFirst({
        where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } },
      });
      if (existing) throw new BadRequestException(`צוות בשם "${name}" כבר קיים במערכת`);
      data = { ...data, name };
    }
    // Use raw SQL when requiresPlan is included — Prisma client may not have this field if not regenerated
    if (data.requiresPlan !== undefined) {
      await prisma.$queryRawUnsafe(
        `UPDATE "Team" SET "requiresPlan" = $1 WHERE id = $2`,
        data.requiresPlan,
        id,
      );
      const { requiresPlan: _rp, ...rest } = data;
      if (Object.keys(rest).length > 0) {
        await prisma.team.update({ where: { id }, data: rest });
      }
      const updated = await prisma.team.findUnique({ where: { id } });
      return { ...updated, requiresPlan: data.requiresPlan };
    }
    return prisma.team.update({ where: { id }, data });
  }

  async findMine(userId: string) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT t.id, t.name, t."requiresPlan" FROM "Team" t
       JOIN "TeamMember" tm ON tm."teamId" = t.id
       WHERE tm."userId" = $1 LIMIT 1`,
      userId,
    );
    return rows.length > 0 ? rows[0] : null;
  }

  async delete(id: string) {
    const team = await prisma.team.findUnique({ where: { id }, include: { _count: { select: { assignedTasks: true, phases: true } } } });
    if (!team) throw new NotFoundException('Team not found');
    if (team._count.assignedTasks > 0 || team._count.phases > 0) {
      throw new Error(`לא ניתן למחוק את הצוות — יש לו ${team._count.assignedTasks} משימות ו-${team._count.phases} שלבים מקושרים`);
    }
    await prisma.teamMember.deleteMany({ where: { teamId: id } });
    await prisma.teamSubmission.deleteMany({ where: { teamId: id } });
    return prisma.team.delete({ where: { id } });
  }

  async seedDefaultTeams() {
    const defaultTeams = [
      { name: 'QA Team', description: 'צוות בדיקות איכות' },
      { name: 'NOC', description: 'Network Operations Center' },
      { name: 'DBA Team', description: 'צוות מסדי נתונים' },
      { name: 'EAI Team', description: 'צוות אינטגרציות' },
      { name: 'CRM Team', description: 'צוות CRM' },
      { name: 'NETC Team', description: 'צוות תשתיות רשת' },
      { name: 'Operation', description: 'צוות תפעול' },
    ];

    const results: any[] = [];
    for (const team of defaultTeams) {
      const existing = await prisma.team.findFirst({ where: { name: team.name } });
      if (!existing) {
        results.push(await prisma.team.create({ data: team }));
      }
    }
    return { created: results.length, teams: results };
  }
}