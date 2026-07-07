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

  @Get('cr-items')
  getCrItems(
    @Query('releaseId') releaseId?: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.qcService.getCrItems(releaseId, versionId);
  }
}
