import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { RunbookService } from './runbook.service';

@UseGuards(JwtGuard)
@Controller('runbook')
export class RunbookController {
  constructor(private readonly svc: RunbookService) {}

  @Get(':versionId/upcoming')
  getUpcoming(
    @Param('versionId') versionId: string,
  ) {
    return this.svc.getUpcoming(versionId);
  }

  @Get(':versionId/:runbookId')
  getEntries(
    @Param('versionId') versionId: string,
    @Param('runbookId') runbookId: string,
  ) {
    return this.svc.getEntries(versionId, runbookId);
  }

  @Post(':versionId/:runbookId/save')
  saveEntries(
    @Param('versionId') versionId: string,
    @Param('runbookId') runbookId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.saveEntries(versionId, runbookId, body.entries ?? []);
  }

  @Post(':versionId/:runbookId/replace')
  bulkReplace(
    @Param('versionId') versionId: string,
    @Param('runbookId') runbookId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.bulkReplace(versionId, runbookId, body.from, body.to);
  }

  @Post(':versionId/:runbookId/replace-team')
  bulkReplaceTeam(
    @Param('versionId') versionId: string,
    @Param('runbookId') runbookId: string,
    @Body() body: Record<string, any>,
  ) {
    return this.svc.bulkReplaceTeam(versionId, runbookId, body.from, body.to);
  }

  @Post(':versionId/:runbookId/fill-empty')
  bulkFillEmpty(
    @Param('versionId') versionId: string,
    @Param('runbookId') runbookId: string,
    @Body() body: { employee: string; employeeUserId?: string | null; team: string },
  ) {
    return this.svc.bulkFillEmpty(versionId, runbookId, body.employee, body.employeeUserId ?? null, body.team);
  }

  @Post(':versionId/:runbookId/step/:stepIndex/fill-employee')
  fillEmptyEmployee(
    @Param('versionId') versionId: string,
    @Param('runbookId') runbookId: string,
    @Param('stepIndex') stepIndex: string,
    @Body() body: { employee: string; employeeUserId?: string | null; team: string },
  ) {
    return this.svc.fillEmptyEmployee(versionId, runbookId, Number(stepIndex), body.employee, body.employeeUserId ?? null, body.team);
  }
}
