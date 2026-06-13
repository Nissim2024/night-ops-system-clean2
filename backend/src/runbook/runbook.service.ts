import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

interface RunbookEntry {
  stepIndex: number;
  employee:  string;
  startTime: string;
  endTime:   string;
  team:      string;
  status:    string;
}

@Injectable()
export class RunbookService {

  async getEntries(versionId: string, runbookId: string) {
    return prisma.runbookEntry.findMany({
      where: { versionId, runbookId },
      orderBy: { stepIndex: 'asc' },
      select: { stepIndex: true, employee: true, startTime: true, endTime: true, team: true, status: true },
    });
  }

  async saveEntries(versionId: string, runbookId: string, entries: RunbookEntry[]) {
    for (const e of entries) {
      await prisma.runbookEntry.upsert({
        where:  { versionId_runbookId_stepIndex: { versionId, runbookId, stepIndex: e.stepIndex } },
        update: { employee: e.employee, startTime: e.startTime, endTime: e.endTime, team: e.team, status: e.status },
        create: { versionId, runbookId, stepIndex: e.stepIndex, employee: e.employee, startTime: e.startTime, endTime: e.endTime, team: e.team, status: e.status },
      });
    }
    return this.getEntries(versionId, runbookId);
  }

  async bulkReplace(versionId: string, runbookId: string, from: string, to: string) {
    const entries = await prisma.runbookEntry.findMany({ where: { versionId, runbookId } });
    let updated = 0;
    for (const e of entries) {
      if (e.employee.includes(from)) {
        await prisma.runbookEntry.update({
          where: { id: e.id },
          data:  { employee: e.employee.replace(new RegExp(from, 'g'), to) },
        });
        updated++;
      }
    }
    return { updated };
  }

  async bulkReplaceTeam(versionId: string, runbookId: string, from: string, to: string) {
    const entries = await prisma.runbookEntry.findMany({ where: { versionId, runbookId } });
    let updated = 0;
    for (const e of entries) {
      if (e.team === from) {
        await prisma.runbookEntry.update({ where: { id: e.id }, data: { team: to } });
        updated++;
      }
    }
    return { updated };
  }
}
