import { Controller, Get, Post, Delete, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { VersionCrAssignmentsService } from './version-cr-assignments.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('version-cr-assignments')
export class VersionCrAssignmentsController {
  constructor(private service: VersionCrAssignmentsService) {}

  @Get('version/:versionId')
  findForTeam(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.findForTeam(versionId, req.user);
  }

  @Post('version/:versionId/import')
  importFromQc(@Param('versionId') versionId: string, @Request() req: any) {
    return this.service.importFromQc(versionId, req.user);
  }

  @Delete('version/:versionId')
  clearForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    return this.service.clearForVersion(versionId, req.user);
  }
}
