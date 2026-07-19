import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@UseGuards(JwtGuard)
@Controller('qa-stats')
export class QaStatsController {

  @Get('summary')
  async getSummary(@Query('versionId') versionId: string) {
    const [totalCrRows, assignedCrs, workPlan, priorityRows] = await Promise.all([
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
    ]);
    return { totalCrs: totalCrRows.length, assignedCrs, hasWorkPlan: !!workPlan, priorityCount: priorityRows.length };
  }
}
