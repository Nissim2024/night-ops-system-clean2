import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { CrPlansService } from './cr-plans.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP     = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const MANAGERS     = ['RELEASE_MANAGER', 'ADMIN'];
const CR_APPROVERS = ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'];

@UseGuards(JwtGuard)
@Controller('cr-plans')
export class CrPlansController {
  constructor(private service: CrPlansService) {}

  @Get('version/:versionId')
  getForVersion(
    @Param('versionId') versionId: string,
    @Query('teamId') teamId: string | undefined,
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.findForVersion(versionId, req.user, teamId);
  }

  @Get('version/:versionId/team-visibility')
  getTeamVisibility(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getTeamVisibility(versionId, req.user);
  }

  @Get('version/:versionId/cr/:crNumber/team/:teamId/preview')
  getTeamPlanPreview(
    @Param('versionId') versionId: string,
    @Param('crNumber') crNumber: string,
    @Param('teamId') teamId: string,
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getTeamPlanPreview(versionId, crNumber, teamId, req.user);
  }

  @Post('version/:versionId')
  upsert(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.upsert(versionId, req.user, body);
  }

  @Patch('version/:versionId/approve-cr')
  approveCr(
    @Param('versionId') versionId: string,
    @Body() body: { crNumber: string },
    @Request() req: any,
  ) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל לילה');
    return this.service.approveCr(versionId, body.crNumber);
  }

  @Patch('version/:versionId/unapprove-cr')
  unapproveCr(
    @Param('versionId') versionId: string,
    @Body() body: { crNumber: string },
    @Request() req: any,
  ) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל לילה');
    return this.service.unapproveCr(versionId, body.crNumber);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.remove(id, req.user);
  }

  // ── Implementation Plan lifecycle ──────────────────────────────────────────

  @Get('version/:versionId/dashboard-stats')
  getDashboardStats(@Param('versionId') versionId: string, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.getDashboardStats(versionId);
  }

  @Get('version/:versionId/team-status')
  getTeamStatus(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getTeamStatus(versionId, req.user);
  }

  @Patch(':id/submit')
  submitPlan(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.submitPlan(id, req.user);
  }

  @Patch(':id/return')
  returnPlan(@Param('id') id: string, @Body() body: { returnReason: string }, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.returnPlan(id, body, req.user);
  }

  @Patch(':id/approve-plan')
  approvePlan(@Param('id') id: string, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.approvePlan(id, req.user);
  }

  @Patch(':id/review-note')
  addReviewNote(@Param('id') id: string, @Body() body: { reviewNote: string }, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.addReviewNote(id, body, req.user);
  }

  // ── CR Manager approval endpoints ─────────────────────────────────────────

  @Get('manager-dashboard')
  getManagerDashboard(@Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.getManagerDashboard();
  }

  @Patch('version/:versionId/cr-manager-approve')
  crManagerApproveCr(
    @Param('versionId') versionId: string,
    @Body() body: { crNumber: string },
    @Request() req: any,
  ) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.crManagerApproveCr(versionId, body.crNumber, req.user);
  }

  @Patch(':id/cr-manager-return')
  crManagerReturnPlan(@Param('id') id: string, @Body() body: { note: string }, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.crManagerReturnPlan(id, body, req.user);
  }
}
