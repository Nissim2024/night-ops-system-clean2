import { Controller, Get, Patch, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { TargetCrService } from './target-cr.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const CR_APPROVERS = ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'];

@UseGuards(JwtGuard)
@Controller('target-cr')
export class TargetCrController {
  constructor(private service: TargetCrService) {}

  // Self-scoped — every query inside is hard-scoped to req.user.sub's own QA
  // assignments, so no LEADS_UP check here (unlike every other route below).
  @Get('my-defects')
  getMyDefects(@Query('versionId') versionId: string, @Request() req: any) {
    return this.service.getMyDefects(versionId, req.user);
  }

  @Get('my-defect-stats')
  getMyDefectStats(@Query('versionId') versionId: string, @Request() req: any) {
    return this.service.getMyDefectStats(versionId, req.user);
  }

  @Get('version/:versionId/status')
  getStatusForTeam(
    @Param('versionId') versionId: string,
    @Query('teamId') teamId: string,
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getStatusForTeam(versionId, teamId);
  }

  @Get('version/:versionId/cr/:crNumber')
  getReview(
    @Param('versionId') versionId: string,
    @Param('crNumber') crNumber: string,
    @Query('teamId') teamId: string | undefined,
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getReview(versionId, crNumber, teamId as string, req.user);
  }

  @Get('version/:versionId/cr/:crNumber/summary')
  getSummary(@Param('versionId') versionId: string, @Param('crNumber') crNumber: string, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.getSummary(versionId, crNumber);
  }

  // Version-wide TARGET defect rollup — for the version-management overview
  // (all teams, not just the caller's own), so restricted the same as the
  // per-CR summary above rather than the team-lead-scoped LEADS_UP routes.
  @Get('version/:versionId/defect-summary')
  getVersionTargetDefectSummary(@Param('versionId') versionId: string, @Request() req: any) {
    if (!CR_APPROVERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR לפחות');
    return this.service.getVersionTargetDefectSummary(versionId);
  }

  @Patch(':reviewId/gate')
  updateGate(
    @Param('reviewId') reviewId: string,
    @Body() body: { gateChecklist1?: boolean; gateChecklist2?: boolean; gateChecklist3?: boolean },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.updateGate(reviewId, body);
  }

  @Patch(':reviewId/approve')
  approve(@Param('reviewId') reviewId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.approve(reviewId, req.user);
  }

  @Patch('defect/:id')
  updateDefect(
    @Param('id') id: string,
    @Body() body: { requiresSpecialImplementation?: boolean; importantToManagement?: boolean },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.updateDefect(id, body);
  }
}
