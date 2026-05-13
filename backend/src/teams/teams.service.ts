import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class TeamsService {
  async findAll() {
    return prisma.team.findMany({
      where: { active: true },
      include: {
        members: {
          include: {
            user: { select: { id: true, fullName: true, email: true, role: true } },
          },
        },
        _count: { select: { tasks: true } },
      },
      orderBy: { name: 'asc' },
    });
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
        tasks: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return team;
  }

  async create(data: { name: string; description?: string }) {
    return prisma.team.create({ data });
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

  async update(id: string, data: { name?: string; description?: string; active?: boolean }) {
    const team = await prisma.team.findUnique({ where: { id } });
    if (!team) throw new NotFoundException('Team not found');
    return prisma.team.update({ where: { id }, data });
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