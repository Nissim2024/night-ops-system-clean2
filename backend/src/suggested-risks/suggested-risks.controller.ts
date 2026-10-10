import { Controller, Get, Post, Param, Body, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { SuggestedRisksService } from './suggested-risks.service';

// Same split as ReleaseRisk's own RISK_WRITERS (release-intelligence.controller.ts)
// — promoting a candidate creates a real ReleaseRisk, so it needs the same
// permission createRisk itself requires.
const RISK_WRITERS = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('suggested-risks')
export class SuggestedRisksController {
  constructor(private service: SuggestedRisksService) {}

  // status per version (2026-10-10)
  @Get()
  list(@Query('versionId') versionId?: string) {
    return this.service.listForVersion(versionId);
  }

  @Post(':id/promote')
  promote(@Param('id') id: string, @Body() body: { versionId: string }, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.promote(id, body.versionId, req.user.sub);
  }

  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() body: { versionId: string }, @Request() req: any) {
    requireRole(req, RISK_WRITERS);
    return this.service.reject(id, body?.versionId, req.user.sub);
  }
}
