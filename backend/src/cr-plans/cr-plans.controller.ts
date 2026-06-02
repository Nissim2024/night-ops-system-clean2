import { Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { CrPlansService } from './cr-plans.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const MANAGERS  = ['RELEASE_MANAGER', 'ADMIN'];

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
}
