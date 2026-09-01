import { Controller, Get, Post, Patch, Query, Param, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QcService } from './qc.service';
import { QcRestService } from './qc-rest.service';

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@Controller('qc')
@UseGuards(JwtGuard)
export class QcController {
  constructor(
    private readonly qcService: QcService,
    private readonly qcRestService: QcRestService,
  ) {}

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

  // ── QC REST write-back test tool — ADMIN only (spec confirmed 2026-08-30):
  // this writes to real production QC, not the read-only Oracle connection
  // every other endpoint in this controller uses.
  @Get('rest-test/defect/:id')
  previewRestDefect(@Request() req: any, @Param('id') id: string) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול להשתמש בכלי בדיקת הכתיבה ל-QC');
    return this.qcRestService.previewDefect(id);
  }

  @Post('rest-test/defect/:id/append-note')
  appendRestNote(@Request() req: any, @Param('id') id: string, @Body('note') note: string) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול להשתמש בכלי בדיקת הכתיבה ל-QC');
    return this.qcRestService.appendComment(id, note, req.user.email ?? req.user.sub ?? 'DeployCenter');
  }
}
