import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards, Request, ForbiddenException,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { LeavesService } from './leaves.service';
import { PermissionsService } from '../permissions/permissions.service';
const permissions = new PermissionsService();

@UseGuards(JwtGuard)
@Controller('leaves')
export class LeavesController {
  constructor(private readonly svc: LeavesService) {}

  private requireAdmin(req: any) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('נדרשת הרשאת מנהל');
  }

  private requireAdminOrTeamLead(req: any) {
    if (!['ADMIN', 'TEAM_LEAD'].includes(req.user?.role)) throw new ForbiddenException('נדרשת הרשאת מנהל או ראש צוות');
  }

  // ── Seasons (read: all; write: admin) ────────────────────────────────────────

  @Get('seasons')
  getSeasons() { return this.svc.getSeasons(); }

  @Post('seasons')
  createSeason(@Request() req: any, @Body() body: { name: string; dateRange: string; isActive?: boolean; forcesOff?: boolean; sortOrder?: number }) {
    this.requireAdmin(req);
    return this.svc.createSeason(body);
  }

  @Patch('seasons/:id')
  updateSeason(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    this.requireAdmin(req);
    return this.svc.updateSeason(id, body);
  }

  @Post('seasons/:id/dates')
  addSeasonDate(@Request() req: any, @Param('id') seasonId: string, @Body() body: { date: string; label: string; type: string; orderIndex?: number }) {
    this.requireAdmin(req);
    return this.svc.addSeasonDate(seasonId, body);
  }

  @Post('seasons/import-holidays')
  importHolidays(@Request() req: any, @Query('year') year?: string) {
    this.requireAdmin(req);
    const y = year ? parseInt(year, 10) : new Date().getFullYear();
    return this.svc.importHolidays(y);
  }

  // ── My requests (employee) ───────────────────────────────────────────────────

  @Get('my-requests')
  async getMyRequests(@Request() req: any) {
    if (!(await permissions.userHas(req.user, 'action:qa_leave_request'))) throw new ForbiddenException('אין לך הרשאה לבקשות חופשה');
    return this.svc.getMyRequests(req.user.sub);
  }

  @Post('requests')
  async submitRequest(
    @Request() req: any,
    @Body() body: { seasonId?: string; date: string; kind: string; reason?: string; groupId?: string },
  ) {
    if (!(await permissions.userHas(req.user, 'action:qa_leave_request'))) throw new ForbiddenException('אין לך הרשאה להגיש בקשת חופשה');
    return this.svc.submitRequest(req.user.sub, body);
  }

  @Delete('requests/:id')
  cancelRequest(@Request() req: any, @Param('id') id: string, @Body('reason') reason?: string) {
    return this.svc.cancelRequest(req.user.sub, id, reason);
  }

  // ── All requests (admin) ─────────────────────────────────────────────────────

  @Get('requests')
  getAllRequests(@Request() req: any, @Query('seasonId') seasonId?: string) {
    this.requireAdminOrTeamLead(req);
    return this.svc.getAllRequests(seasonId, req.user.sub, req.user.role);
  }

  @Get('requests/pending-count')
  getPendingCount(@Request() req: any) {
    this.requireAdminOrTeamLead(req);
    return this.svc.getPendingCount(req.user.sub, req.user.role);
  }

  @Patch('requests/:id')
  updateStatus(
    @Request() req: any,
    @Param('id') id: string,
    @Body('status') status: 'APPROVED' | 'DECLINED' | 'CANCELLED',
    @Body('reason') reason?: string,
  ) {
    this.requireAdminOrTeamLead(req);
    return this.svc.updateRequestStatus(id, status, req.user.sub, req.user.role, reason);
  }
}
