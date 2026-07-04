import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

interface RunbookEntry {
  stepIndex:      number;
  employee:       string;
  employeeUserId?: string | null;
  startTime:      string;
  endTime:        string;
  runDate?:       string | null; // ISO date, the calendar day this step belongs to
  team:           string;
  status:         string;
}

@Injectable()
export class RunbookService {
  private readonly logger = new Logger(RunbookService.name);

  constructor(
    private readonly notifications: NotificationsService,
  ) {}

  // Fires a "starts in ~15 minutes" notification once per step, to the assigned
  // employee (if resolved to a real user) and to managers — covers the "run mode
  // notification mechanism" requirement without needing the run-mode UI to be
  // open; this runs regardless of whether anyone has the screen open.
  @Cron(CronExpression.EVERY_MINUTE)
  async notifyUpcomingSteps() {
    const now = new Date();
    const in15 = new Date(now.getTime() + 15 * 60000);

    const candidates = await prisma.runbookEntry.findMany({
      where: { status: 'pending', notified15MinAt: null, runDate: { not: null } },
    });

    for (const e of candidates) {
      if (!e.runDate || !/^\d{1,2}:\d{2}$/.test(e.startTime)) continue;
      const [h, m] = e.startTime.split(':').map(Number);
      const start = new Date(e.runDate);
      start.setHours(h, m, 0, 0);

      if (start <= now || start > in15) continue;

      try {
        const payload = {
          title: '⏰ שלב Runbook מתקרב',
          body: `${e.team ? `${e.team} — ` : ''}מתחיל בעוד כ-15 דקות (${e.startTime})${e.employee ? ` · ${e.employee}` : ''}`,
          urgent: true,
        };
        const tasks: Promise<any>[] = [this.notifications.sendToManagers(payload)];
        if (e.employeeUserId) tasks.push(this.notifications.sendToUser(e.employeeUserId, payload));
        await Promise.allSettled(tasks);
      } catch (err: any) {
        this.logger.warn(`Runbook notify failed for entry ${e.id}: ${err.message}`);
      } finally {
        await prisma.runbookEntry.update({ where: { id: e.id }, data: { notified15MinAt: now } });
      }
    }
  }

  // All not-yet-done steps across every runbook type for this version, scheduled
  // in the next `days` days — used by Home dashboards to surface "today/tomorrow"
  // activities. Activity names live client-side only (RUNBOOKS templates), so
  // the caller resolves runbookId+stepIndex → label itself.
  async getUpcoming(versionId: string, days = 2) {
    const now = new Date();
    const until = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    return prisma.runbookEntry.findMany({
      where: {
        versionId,
        status: { in: ['pending', 'in_progress'] },
        runDate: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()), lte: until },
      },
      select: { runbookId: true, stepIndex: true, employee: true, employeeUserId: true, startTime: true, endTime: true, runDate: true, team: true, status: true },
      orderBy: [{ runDate: 'asc' }, { startTime: 'asc' }],
    });
  }

  async getEntries(versionId: string, runbookId: string) {
    return prisma.runbookEntry.findMany({
      where: { versionId, runbookId },
      orderBy: { stepIndex: 'asc' },
      select: { stepIndex: true, employee: true, employeeUserId: true, startTime: true, endTime: true, runDate: true, team: true, status: true },
    });
  }

  async saveEntries(versionId: string, runbookId: string, entries: RunbookEntry[]) {
    for (const e of entries) {
      const data = {
        employee: e.employee, employeeUserId: e.employeeUserId ?? null,
        startTime: e.startTime, endTime: e.endTime,
        runDate: e.runDate ? new Date(e.runDate) : null,
        team: e.team, status: e.status,
      };
      await prisma.runbookEntry.upsert({
        where:  { versionId_runbookId_stepIndex: { versionId, runbookId, stepIndex: e.stepIndex } },
        update: data,
        create: { versionId, runbookId, stepIndex: e.stepIndex, ...data },
      });
    }
    return this.getEntries(versionId, runbookId);
  }

  // Fills the employee/team into a step ONLY if it's currently unassigned —
  // distinct from bulkReplace, which overwrites an existing value by substring
  // match. Guards against accidentally clobbering a real assignment.
  async fillEmptyEmployee(
    versionId: string, runbookId: string, stepIndex: number,
    employee: string, employeeUserId: string | null, team: string,
  ) {
    const existing = await prisma.runbookEntry.findUnique({
      where: { versionId_runbookId_stepIndex: { versionId, runbookId, stepIndex } },
    });
    if (existing?.employee?.trim()) {
      throw new BadRequestException('השדה כבר מאויש — השתמש בהחלפה כדי לשנות עובד קיים');
    }
    return prisma.runbookEntry.upsert({
      where:  { versionId_runbookId_stepIndex: { versionId, runbookId, stepIndex } },
      update: { employee, employeeUserId, team },
      create: { versionId, runbookId, stepIndex, employee, employeeUserId, team, status: 'pending' },
    });
  }

  // Bulk-assigns every currently-unstaffed step to one person/team — the bulk
  // counterpart to fillEmptyEmployee, mirroring bulkReplace's shape but scoped
  // to blank rows so it never overwrites an existing assignment.
  async bulkFillEmpty(versionId: string, runbookId: string, employee: string, employeeUserId: string | null, team: string) {
    const entries = await prisma.runbookEntry.findMany({ where: { versionId, runbookId } });
    let updated = 0;
    for (const e of entries) {
      if (!e.employee?.trim()) {
        await prisma.runbookEntry.update({ where: { id: e.id }, data: { employee, employeeUserId, team } });
        updated++;
      }
    }
    return { updated };
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
