import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

@UseGuards(JwtGuard)
@Controller('qa-stats')
export class QaStatsController {

  @Get('summary')
  async getSummary(@Query('versionId') versionId: string) {
    const [totalCrs, assignedCrs, workPlan] = await Promise.all([
      prisma.versionCrAssignment.count({ where: { versionId } }),
      prisma.qaAssignment.count({ where: { versionId } }),
      prisma.qaWorkPlan.findUnique({ where: { versionId }, select: { id: true } }),
    ]);
    return { totalCrs, assignedCrs, hasWorkPlan: !!workPlan };
  }
}
