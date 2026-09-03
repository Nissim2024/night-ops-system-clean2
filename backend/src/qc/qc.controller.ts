import { Controller, Get, Post, Patch, Query, Param, Body, Request, Res, UseGuards, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QcService } from './qc.service';
import { QcRestService } from './qc-rest.service';
import { PermissionsService } from '../permissions/permissions.service';

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@Controller('qc')
@UseGuards(JwtGuard)
export class QcController {
  constructor(
    private readonly qcService: QcService,
    private readonly qcRestService: QcRestService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // Gates the QC REST write-back tool — ADMIN always passes; any other role
  // needs the runtime-grantable 'action:qc_write' permission (Admin Panel >
  // permissions), replacing the earlier hardcoded ADMIN-only check (spec
  // confirmed 2026-09-02).
  private async requireQcWrite(req: any) {
    const allowed = await this.permissionsService.hasPermission(req.user.role, 'action:qc_write');
    if (!allowed) throw new ForbiddenException('אין לך הרשאה להשתמש בכלי הכתיבה ל-QC — פנה למנהל מערכת');
  }

  @Get('status')
  getStatus() {
    return this.qcService.getStatus();
  }

  @Get('test-coverage')
  getTestCoverage(@Query('versionId') versionId: string, @Query('cycle') cycle?: 'REHEARSAL' | 'GO_LIVE') {
    return this.qcService.getTestCoverage(versionId, cycle);
  }

  @Get('defects')
  getDefects(@Query('versionId') versionId: string, @Query('cycle') cycle?: 'REHEARSAL' | 'GO_LIVE') {
    return this.qcService.getDefects(versionId, cycle);
  }

  @Get('defects-by-kpi')
  getDefectsForKpi(@Query('versionId') versionId: string, @Query('kpiName') kpiName: string) {
    return this.qcService.getDefectsForKpi(versionId, kpiName);
  }

  @Get('cr-defect-indicators')
  getCrDefectIndicators(@Query('versionId') versionId: string, @Query('crNumber') crNumber: string, @Query('teamName') teamName?: string) {
    return this.qcService.getCrDefectIndicators(versionId, crNumber, teamName);
  }

  @Get('bug-dashboard')
  getBugDashboard(@Query('versionId') versionId: string) {
    return this.qcService.getBugDashboard(versionId);
  }

  @Get('open-production-defects-history')
  getOpenProductionDefectsHistory() {
    return this.qcService.getOpenProductionDefectsHistory();
  }

  @Get('new-vs-target-defects')
  getNewVsTargetDefects() {
    return this.qcService.getNewVsTargetDefects();
  }

  @Get('defect-status-history')
  getDefectStatusHistory(@Query('defectId') defectId: string) {
    return this.qcService.getDefectStatusHistory(defectId);
  }

  @Get('defect-field-history')
  getDefectFieldHistory(@Query('defectId') defectId: string) {
    return this.qcService.getDefectFieldHistory(defectId);
  }

  @Get('open-prod-defect-detail/:defectId')
  getOpenProdDefectDetail(@Param('defectId') defectId: string) {
    return this.qcService.getDefectFullDetail(defectId);
  }

  @Get('open-prod-defects-config')
  getOpenProdDefectsConfig() {
    return this.qcService.getOpenProdDefectsConfig();
  }

  @Patch('open-prod-defects-config')
  setOpenProdDefectsConfig(@Body() body: { tableColumns?: string[]; detailFields?: string[] }, @Request() req: any) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לעדכן את תצורת מסך תקלות הייצור');
    return this.qcService.setOpenProdDefectsConfig(body);
  }

  @Get('cr-items')
  getCrItems(
    @Query('releaseId') releaseId?: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.qcService.getCrItems(releaseId, versionId);
  }

  // ── QC REST write-back tool (spec confirmed 2026-08-30, per-user auth
  // 2026-09-02): writes to real production QC, not the read-only Oracle
  // connection every other endpoint in this controller uses. Every call
  // authenticates as the CALLING USER's own QC identity (qcLogin + empty
  // password) — see qc-rest.service.ts for why, and why there's no fallback
  // to a shared account.
  @Get('rest-test/defect/:id')
  async previewRestDefect(@Request() req: any, @Param('id') id: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.previewDefect(id, req.user.sub);
  }

  @Get('rest-test/defect/:id/fields')
  async listAllRestFields(@Request() req: any, @Param('id') id: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.listAllFields(id, req.user.sub);
  }

  @Post('rest-test/defect/:id/append-note')
  async appendRestNote(@Request() req: any, @Param('id') id: string, @Body('note') note: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.appendComment(id, note, req.user.email ?? req.user.sub ?? 'DeployCenter', req.user.sub);
  }

  // ── Defect attachments (spec confirmed 2026-09-03) — read-only, so no
  // action:qc_write gate: any authenticated user with a linked qcLogin can
  // view/download whatever their own QC account is allowed to see (access
  // control lives in QC itself, same principle as the write-back tool).
  @Get('defect/:id/attachments')
  listAttachments(@Request() req: any, @Param('id') id: string) {
    return this.qcRestService.listAttachments(id, req.user.sub);
  }

  @Get('defect/:id/attachments/:fileName/download')
  async downloadAttachment(
    @Request() req: any,
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const { data, contentType } = await this.qcRestService.downloadAttachment(id, fileName, req.user.sub);
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(fileName);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    });
    res.send(data);
  }
}
