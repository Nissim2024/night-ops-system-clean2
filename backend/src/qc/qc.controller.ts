import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QcService } from './qc.service';

@Controller('qc')
@UseGuards(JwtGuard)
export class QcController {
  constructor(private readonly qcService: QcService) {}

  @Get('status')
  getStatus() {
    return this.qcService.getStatus();
  }

  @Get('test-coverage')
  getTestCoverage(@Query('versionId') versionId: string) {
    return this.qcService.getTestCoverage(versionId);
  }

  @Get('defects')
  getDefects(@Query('versionId') versionId: string) {
    return this.qcService.getDefects(versionId);
  }

  @Get('bug-dashboard')
  getBugDashboard(@Query('versionId') versionId: string) {
    return this.qcService.getBugDashboard(versionId);
  }

  @Get('open-production-defects-history')
  getOpenProductionDefectsHistory() {
    return this.qcService.getOpenProductionDefectsHistory();
  }

  @Get('defect-status-history')
  getDefectStatusHistory(@Query('defectId') defectId: string) {
    return this.qcService.getDefectStatusHistory(defectId);
  }

  @Get('cr-items')
  getCrItems(
    @Query('releaseId') releaseId?: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.qcService.getCrItems(releaseId, versionId);
  }
}
