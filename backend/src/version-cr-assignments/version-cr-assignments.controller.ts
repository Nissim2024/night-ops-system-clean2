import { Controller, Get, Post, Delete, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
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

  @Delete('version/:versionId')
  clearForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    return this.service.clearForVersion(versionId, req.user);
  }
}
