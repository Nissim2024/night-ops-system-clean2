import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@UseGuards(JwtGuard)
@Controller('qa-stats')
export class QaStatsController {

  @Get('summary')
  async getSummary(@Query('versionId') versionId: string) {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const in3Days = new Date(todayStart); in3Days.setDate(in3Days.getDate() + 3); in3Days.setHours(23, 59, 59, 999);

    const [totalCrRows, assignedCrs, workPlan, priorityRows, goLiveSoonRows, qaArrivalOverdueRows, cycles, scopeRows, assignedCrNumberRows] = await Promise.all([
      // VersionCrAssignment has one ROW PER TEAM per CR (unique on
      // [versionId, crNumber, teamId]) — a plain count() here inflates the
      // real CR count by however many teams touch each CR. Distinct on
      // crNumber (and excluding REMOVED, matching how scope is defined
      // everywhere else) gives the actual number of CRs in scope.
      prisma.versionCrAssignment.findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: { crNumber: true },
        distinct: ['crNumber'],
      }),
      prisma.qaAssignment.count({ where: { versionId } }),
      prisma.qaWorkPlan.findUnique({ where: { versionId }, select: { id: true } }),
      (prisma.versionCrAssignment as any).findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' }, OR: [{ urgent: true }, { priorityTestDate: { not: null } }] },
        select: { crNumber: true },
        distinct: ['crNumber'],
      }),
      // Go-live date within the next 3 days (or already passed) — escalating
      // reminder rather than a one-time ping on day -3.
      (prisma.versionCrAssignment as any).findMany({
        where: {
          versionId, syncStatus: { not: 'REMOVED' }, alreadyInProduction: false,
          priorityTestDate: { not: null, lte: in3Days },
        },
        select: { crNumber: true },
        distinct: ['crNumber'],
      }),
      // Expected QA-arrival date already passed without being marked received.
      (prisma.versionCrAssignment as any).findMany({
        where: {
          versionId, syncStatus: { not: 'REMOVED' }, alreadyInProduction: false,
          qaArrivalDate: { not: null, lt: todayStart }, qaReceived: false,
        },
        select: { crNumber: true },
        distinct: ['crNumber'],
      }),
      // Round/UAT/rehearsal dates for the home-page milestone timeline — filtered
      // via the workPlan relation so this doesn't need workPlan's id resolved first.
      (prisma.qaCycle as any).findMany({
        where: { workPlan: { versionId } },
        select: { cycleType: true, plannedStart: true, plannedEnd: true },
      }),
      // In-scope CRs with enough context to explain, per CR, why it hasn't
      // been assigned a tester yet (see unassignedBreakdown below).
      (prisma.versionCrAssignment as any).findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: { crNumber: true, qaEffort: true, qaEffortOverride: true, alreadyInProduction: true, isArchived: true },
        distinct: ['crNumber'],
      }),
      prisma.qaAssignment.findMany({ where: { versionId }, select: { crNumber: true } }),
    ]);

    // Reasons a scoped CR still has no QaAssignment row — best-effort
    // classification, not a stored field, so a CR moves between buckets as
    // its data changes rather than being permanently labeled.
    const assignedCrNumbers = new Set(assignedCrNumberRows.map((r: any) => r.crNumber));
    const unassigned = (scopeRows as any[]).filter(r => !assignedCrNumbers.has(r.crNumber));
    const pendingCrs = unassigned
      .filter(r => !r.alreadyInProduction && !r.isArchived && (r.qaEffortOverride ?? r.qaEffort ?? 0) > 0)
      .map(r => r.crNumber);
    const unassignedBreakdown = {
      alreadyInProduction: unassigned.filter(r => r.alreadyInProduction).length,
      archived:             unassigned.filter(r => !r.alreadyInProduction && r.isArchived).length,
      noQaEffort:           unassigned.filter(r => !r.alreadyInProduction && !r.isArchived && !((r.qaEffortOverride ?? r.qaEffort ?? 0) > 0)).length,
      pending:              pendingCrs.length,
      pendingCrs,
    };

    return {
      totalCrs: totalCrRows.length, assignedCrs, hasWorkPlan: !!workPlan, priorityCount: priorityRows.length,
      goLiveSoonCount: goLiveSoonRows.length, qaArrivalOverdueCount: qaArrivalOverdueRows.length,
      qaArrivalOverdueCrs: qaArrivalOverdueRows.map((r: any) => r.crNumber),
      cycles, unassignedBreakdown,
    };
  }
}
