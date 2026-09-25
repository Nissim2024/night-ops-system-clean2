import { Controller, Get, Post, Patch, Delete, Param, Query, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { ReleaseIntelligenceService } from './release-intelligence.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

// Spec section 27 has no literal "QA Lead" role in this app — mapped to
// TEAM_LEAD, the closest existing equivalent (see plan file assumptions).
const RISK_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const RISK_CLOSERS = ['RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('release-intelligence')
export class ReleaseIntelligenceController {
  constructor(private service: ReleaseIntelligenceService) {}

  @Get('overview/:versionId')
  getOverview(@Param('versionId') versionId: string) {
    return this.service.getOverview(versionId);
  }

  @Get('defect-create-defaults/:versionId')
  getDefectCreateDefaults(@Param('versionId') versionId: string, @Request() req: any) {
    return this.service.getDefectCreateDefaults(versionId, req.user.sub);
  }

  @Get('defect-create-responsibility-options/:versionId/:crNumber')
  getResponsibilityOptionsForCr(@Param('versionId') versionId: string, @Param('crNumber') crNumber: string) {
    return this.service.getResponsibilityOptionsForCr(versionId, crNumber);
  }

  @Get('daily-qa/:versionId')
  getDailyQaManagement(@Param('versionId') versionId: string, @Query('targetDay') targetDay?: string) {
    const override = targetDay === 'today' || targetDay === 'tomorrow' ? targetDay : undefined;
    return this.service.getDailyQaManagement(versionId, override);
  }

  @Get('daily-qa/:versionId/yesterday-diff')
  getYesterdayDiff(@Param('versionId') versionId: string) {
    return this.service.getYesterdayDiff(versionId);
  }

  // Home-page KPI tile (access-control spec 2026-09-25) — a team lead's own
  // team's test progress %, not the full daily-QA payload. null when the
  // caller doesn't lead any team or that team has no CRs in this version.
  @Get('team-progress/:versionId')
  getTeamProgress(@Param('versionId') versionId: string, @Request() req: any) {
    return this.service.getTeamProgress(versionId, req.user);
  }

  @Get('cr-health/:versionId')
  getCrHealth(@Param('versionId') versionId: string) {
    return this.service.getCrHealth(versionId);
  }

  @Get('coverage-readiness/:versionId')
  getCoverageReadiness(@Param('versionId') versionId: string) {
    return this.service.getCoverageReadiness(versionId);
  }

  @Get('cycle-progress/:versionId')
  getCycleProgress(@Param('versionId') versionId: string) {
    return this.service.getCycleProgress(versionId);
  }

  @Get('status-board/:versionId')
  getStatusBoard(@Param('versionId') versionId: string) {
    return this.service.getStatusBoard(versionId);
  }

  @Get('cr-quality/:versionId')
  getCrQualityScores(@Param('versionId') versionId: string) {
    return this.service.getCrQualityScores(versionId);
  }

  @Get('timeline-activities/:versionId')
  getTimelineActivities(@Param('versionId') versionId: string) {
    return this.service.getTimelineActivities(versionId);
  }

  @Get('capacity/:versionId')
  getCapacity(@Param('versionId') versionId: string) {
    return this.service.getCapacity(versionId);
  }

  @Get('forecast-tracking/:versionId')
  getForecastTracking(@Param('versionId') versionId: string) {
    return this.service.getForecastTracking(versionId);
  }

  @Get('defects/:versionId')
  getDefectsBreakdown(@Param('versionId') versionId: string) {
    return this.service.getDefectsBreakdown(versionId);
  }

  @Get('reopen-analysis/:versionId')
  getReopenAnalysis(@Param('versionId') versionId: string) {
    return this.service.getReopenAnalysis(versionId);
  }

  @Get('defects-drilldown/:versionId')
  getDefectsDrilldown(
    @Param('versionId') versionId: string,
    @Query('screen') screen: string,
    @Query('filter') filter: string,
    @Query('value') value?: string,
  ) {
    return this.service.getDefectsDrilldown(versionId, screen, filter, value);
  }

  @Get('risks/:versionId')
  listRisks(@Param('versionId') versionId: string) {
    return this.service.listRisks(versionId);
  }

  @Post('risks')
  createRisk(@Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.createRisk({ ...body, createdBy: req.user.sub });
  }

  @Patch('risks/:id')
  updateRisk(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.updateRisk(id, body);
  }

  @Patch('risks/:id/close')
  closeRisk(@Param('id') id: string, @Request() req: any) {
    requireRole(req, RISK_CLOSERS);
    return this.service.closeRisk(id);
  }

  @Get('blockers/:versionId')
  listBlockers(@Param('versionId') versionId: string) {
    return this.service.listBlockers(versionId);
  }

  @Post('blockers')
  createBlocker(@Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.createBlocker({ ...body, createdBy: req.user.sub });
  }

  @Patch('blockers/:id')
  updateBlocker(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.updateBlocker(id, body);
  }

  @Patch('blockers/:id/resolve')
  resolveBlocker(@Param('id') id: string, @Request() req: any) {
    requireRole(req, RISK_CLOSERS);
    return this.service.resolveBlocker(id);
  }

  @Patch('blockers/:id/reopen')
  reopenBlocker(@Param('id') id: string, @Request() req: any) {
    requireRole(req, RISK_CLOSERS);
    return this.service.reopenBlocker(id);
  }

  @Get('action-items/:versionId')
  listActionItems(@Param('versionId') versionId: string) {
    return this.service.listActionItems(versionId);
  }

  @Post('action-items')
  createActionItem(@Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.createActionItem({ ...body, createdBy: req.user.sub });
  }

  @Patch('action-items/:id')
  updateActionItem(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.updateActionItem(id, body);
  }

  @Get('alerts/:versionId')
  getAlerts(@Param('versionId') versionId: string) {
    return this.service.getAlerts(versionId);
  }

  @Post('alerts')
  createAlert(@Body() body: any, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.createAlert({ ...body, createdBy: req.user.sub });
  }

  @Delete('alerts/:id')
  deleteAlert(@Param('id') id: string, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.deleteAlert(id);
  }

  @Get('go-no-go/:versionId')
  getGoNoGo(@Param('versionId') versionId: string) {
    return this.service.getGoNoGo(versionId);
  }

  @Patch('go-no-go/:versionId/:stage')
  updateGoNoGoStage(
    @Param('versionId') versionId: string,
    @Param('stage') stage: 'qa-manager' | 'release-manager' | 'management',
    @Body() body: { status: string },
    @Request() req: any,
  ) {
    if (stage === 'qa-manager') requireRole(req, RISK_WRITERS);
    else requireRole(req, RISK_CLOSERS);
    return this.service.updateGoNoGoStage(versionId, stage, body.status, req.user.sub);
  }
}
