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

  // Auto-sync from Excel file — called on mount by frontend (silent) or manually by manager
  @Post('version/:versionId/sync')
  syncFromExcel(@Param('versionId') versionId: string, @Request() req: any) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');
    return this.service.syncFromExcel(versionId);
  }

  // Preview diff — reads Excel and returns added/removed/unchanged without touching DB
  @Post('version/:versionId/sync/preview')
  syncPreview(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.syncPreview(versionId);
  }

  // Apply sync diff — upserts new CRs (status=NEW), marks removed CRs (status=REMOVED)
  @Post('version/:versionId/sync/apply')
  syncApply(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.syncApply(versionId);
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
    @Body() body: { qaEffortOverride?: number | null; isStandAlone?: boolean },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.patchCr(versionId, crNumber, body);
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
