import { Controller, Get, Post, Patch, Delete, Body, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { TaskProposalsService } from './task-proposals.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const MANAGERS  = ['RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('task-proposals')
export class TaskProposalsController {
  constructor(private service: TaskProposalsService) {}

  @Get('version/:versionId')
  getForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.findForVersion(versionId, req.user);
  }

  @Post('version/:versionId')
  create(
    @Param('versionId') versionId: string,
    @Request() req: any,
    @Body() body: { title: string; phase: number; app?: string; estimatedMins?: number; crNumber?: string; notes?: string },
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.create(versionId, req.user, body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Request() req: any, @Body() body: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.update(id, req.user, body);
  }

  @Delete('version/:versionId/cr/:crNumber')
  removeByCr(
    @Param('versionId') versionId: string,
    @Param('crNumber') crNumber: string,
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.removeByCr(versionId, crNumber, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.remove(id, req.user);
  }

  @Patch(':id/mark-used')
  markUsed(@Param('id') id: string, @Request() req: any, @Body() body: { taskId: string }) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');
    return this.service.markUsed(id, body.taskId);
  }
}
