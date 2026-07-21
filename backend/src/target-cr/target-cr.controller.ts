import { Controller, Get, Patch, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { TargetCrService } from './target-cr.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const CR_APPROVERS = ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'];

@UseGuards(JwtGuard)
@Controller('target-cr')
export class TargetCrController {
  constructor(private service: TargetCrService) {}

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
    @Body() body: { requiresSpecialImplementation?: boolean; implementationReason?: string | null; importantToManagement?: boolean },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.updateDefect(id, body, req.user);
  }
}
