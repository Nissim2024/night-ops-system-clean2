import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, Request, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { PermissionsService } from '../permissions/permissions.service';
import { ReleaseInsightsService } from './release-insights.service';
import type { ManualBody } from './release-insights.service';

const permissions = new PermissionsService();

// תובנות גרסה — the version summary page. Its own permission (ri:insights,
// explicit grant only — a module-wide ניהול בדיקות grant does not include it)
// so the page can be kept for the summary meeting.
@UseGuards(JwtGuard)
@Controller('release-insights')
export class ReleaseInsightsController {
  constructor(private service: ReleaseInsightsService) {}

  private async gate(req: any) {
    if (!(await permissions.userHas(req.user, 'ri:insights'))) throw new ForbiddenException('אין הרשאה לדף תובנות הגרסה');
  }

  @Get(':versionId')
  async list(@Param('versionId') versionId: string, @Request() req: any) {
    await this.gate(req);
    return this.service.getInsights(versionId);
  }

  @Post(':versionId/manual')
  async create(@Param('versionId') versionId: string, @Body() body: ManualBody, @Request() req: any) {
    await this.gate(req);
    return this.service.createManual(versionId, body, req.user);
  }

  @Patch(':versionId/manual/:id')
  async update(@Param('versionId') versionId: string, @Param('id') id: string, @Body() body: ManualBody, @Request() req: any) {
    await this.gate(req);
    return this.service.updateManual(versionId, id, body);
  }

  // hide = "delete" for this version only (auto and manual alike), with a reason
  @Post(':versionId/hide')
  async hide(@Param('versionId') versionId: string, @Body() body: { key: string; level: string; reason: string }, @Request() req: any) {
    await this.gate(req);
    return this.service.hide(versionId, body, req.user);
  }

  @Delete(':versionId/hide')
  async unhide(@Param('versionId') versionId: string, @Query('key') key: string, @Request() req: any) {
    await this.gate(req);
    return this.service.unhide(versionId, key);
  }
}
