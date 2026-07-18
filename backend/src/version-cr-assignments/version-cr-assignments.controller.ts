import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { VersionCrAssignmentsService } from './version-cr-assignments.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'];
const MANAGERS  = ['RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('version-cr-assignments')
export class VersionCrAssignmentsController {
  constructor(private service: VersionCrAssignmentsService) {}

  @Get('version/:versionId')
  findForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.findForVersion(versionId, req.user);
  }

  // Silent auto-sync — called on mount by frontend, or manually. Same underlying
  // logic as sync/apply (upsert new CRs, soft-mark removed ones); kept as its own
  // route since callers here don't go through the preview/exclude flow.
  @Post('version/:versionId/sync')
  syncFromExcel(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.syncApply(versionId);
  }

  // Preview diff — reads Excel and returns added/removed/unchanged without touching DB
  @Post('version/:versionId/sync/preview')
  syncPreview(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.syncPreview(versionId);
  }

  // Apply sync diff — upserts new CRs (status=NEW), marks removed CRs (status=REMOVED)
  @Post('version/:versionId/sync/apply')
  syncApply(@Param('versionId') versionId: string, @Body() body: { excludeCrNumbers?: string[] }, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.syncApply(versionId, body?.excludeCrNumbers ?? []);
  }

  // Manual delete of a CR after user confirmation (MANAGERS only)
  @Delete('cr/:versionId/:crNumber')
  deleteCr(
    @Param('versionId') versionId: string,
    @Param('crNumber')  crNumber: string,
    @Request() req: any,
  ) {
    return this.service.deleteCr(versionId, crNumber, req.user);
  }

  @Patch('cr/:versionId/:crNumber')
  patchCr(
    @Param('versionId') versionId: string,
    @Param('crNumber')  crNumber: string,
    @Body() body: {
      qaEffortOverride?: number | null; isStandAlone?: boolean; reviewed?: boolean;
      isCore?: boolean; priorityTestDate?: string | null; notes?: string | null; urgent?: boolean;
    },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.patchCr(versionId, crNumber, body);
  }

  // Explains why a CR is tagged NEW/REMOVED — reads live CR_LIST file, no DB writes
  @Get('version/:versionId/cr/:crNumber/team/:teamId/change-detail')
  getChangeDetail(
    @Param('versionId') versionId: string,
    @Param('crNumber')  crNumber: string,
    @Param('teamId')    teamId: string,
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getChangeDetail(versionId, crNumber, teamId);
  }

  // Cross-team coordination info — all teams + systems touching each CR,
  // regardless of caller's own team (a team lead needs to see who else is
  // involved on a shared CR, not just their own team's assignment row).
  @Get('version/:versionId/cr-scope')
  getCrScope(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getCrScope(versionId);
  }

  // QA classification progress (isCore/urgent/priorityTestDate) — available
  // before scope approval, unlike scope-change flags.
  @Get('version/:versionId/classification-stats')
  getClassificationStats(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getClassificationStats(versionId);
  }

  @Get('version/:versionId/stats')
  getVersionStats(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getVersionStats(versionId);
  }

  @Delete('version/:versionId')
  clearForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');
    return this.service.clearForVersion(versionId, req.user);
  }
}
