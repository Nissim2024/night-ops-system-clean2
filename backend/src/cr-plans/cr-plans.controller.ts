import { Controller, Get, Post, Delete, Body, Param, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { CrPlansService } from './cr-plans.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('cr-plans')
export class CrPlansController {
  constructor(private service: CrPlansService) {}

  @Get('version/:versionId')
  getForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.findForVersion(versionId, req.user);
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

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.remove(id, req.user);
  }
}
