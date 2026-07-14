import {
  Controller, Get, Post, Patch, Param, Query, Body,
  UploadedFile, UseInterceptors, Request, UseGuards,
  ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { QualityHubService } from './quality-hub.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const IMPORTERS = ['RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

const ALLOWED_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];

function assertExcelFile(file: Express.Multer.File | undefined) {
  if (!file) throw new BadRequestException('לא נבחר קובץ');
  const extOk = /\.(xlsx|xls)$/i.test(file.originalname ?? '');
  const mimeOk = ALLOWED_MIMETYPES.includes(file.mimetype);
  if (!extOk && !mimeOk) {
    throw new BadRequestException('סוג קובץ לא חוקי — יש להעלות קובץ Excel בלבד (.xlsx / .xls)');
  }
}

function parseList(v?: string): string[] | undefined {
  if (!v) return undefined;
  return v.split(',').map(s => s.trim()).filter(Boolean);
}

function parseYearList(v?: string): number[] | undefined {
  const list = parseList(v);
  if (!list) return undefined;
  return list.map(Number).filter(n => Number.isFinite(n));
}

@UseGuards(JwtGuard)
@Controller('quality-hub')
export class QualityHubController {
  constructor(private service: QualityHubService) {}

  @Post('import/kpi-definitions')
  @UseInterceptors(FileInterceptor('file'))
  async importKpiDefinitions(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    requireRole(req, IMPORTERS, 'רק מנהל גרסה או אדמין יכולים לייבא הגדרות KPI');
    assertExcelFile(file);
    try {
      return { success: true, ...(await this.service.importKpiDefinitions(file.buffer)) };
    } catch (err) {
      console.error('KPI definitions import error:', err);
      return { success: false, message: 'שגיאה בעיבוד הקובץ. ודא שהפורמט תקין.' };
    }
  }

  @Post('import/kpi-scores')
  @UseInterceptors(FileInterceptor('file'))
  async importKpiScores(@UploadedFile() file: Express.Multer.File, @Request() req: any) {
    requireRole(req, IMPORTERS, 'רק מנהל גרסה או אדמין יכולים לייבא ציוני KPI');
    assertExcelFile(file);
    try {
      return { success: true, ...(await this.service.importKpiScores(file.buffer)) };
    } catch (err) {
      console.error('KPI scores import error:', err);
      return { success: false, message: 'שגיאה בעיבוד הקובץ. ודא שהפורמט תקין.' };
    }
  }

  @Get('releases')
  getReleases() {
    return this.service.getReleases();
  }

  @Get('kpi-definitions')
  getKpiDefinitions() {
    return this.service.getKpiDefinitions();
  }

  @Get('overview/:releaseName')
  getOverview(@Param('releaseName') releaseName: string) {
    return this.service.getOverview(decodeURIComponent(releaseName));
  }

  @Get('overview-chart')
  getOverviewChart(
    @Query('releaseNames') releaseNames: string,
    @Query('years') years: string,
    @Query('count') count: string,
  ) {
    return this.service.getOverviewChart({
      releaseNames: parseList(releaseNames),
      years: parseYearList(years),
      count: count ? Number(count) : undefined,
    });
  }

  @Get('kpi-matrix/:releaseName')
  getKpiMatrix(@Param('releaseName') releaseName: string) {
    return this.service.getKpiMatrix(decodeURIComponent(releaseName));
  }

  @Get('comparison')
  getComparison(
    @Query('releases') releases: string,
    @Query('includeYearAverage') includeYearAverage: string,
  ) {
    const list = parseList(releases) ?? [];
    return this.service.getComparison(list, includeYearAverage === 'true');
  }

  @Get('timeline')
  getTimeline(
    @Query('releaseNames') releaseNames: string,
    @Query('years') years: string,
    @Query('kpiName') kpiName: string,
  ) {
    return this.service.getTimeline({
      releaseNames: parseList(releaseNames),
      years: parseYearList(years),
      kpiName: kpiName || undefined,
    });
  }

  @Get('timeline-all')
  getTimelineAll(
    @Query('releaseNames') releaseNames: string,
    @Query('years') years: string,
  ) {
    return this.service.getTimelineAll({
      releaseNames: parseList(releaseNames),
      years: parseYearList(years),
    });
  }

  @Get('kpi-detail/:kpiName/:releaseName')
  getKpiDetail(
    @Param('kpiName') kpiName: string,
    @Param('releaseName') releaseName: string,
    @Query('releaseNames') releaseNames: string,
    @Query('years') years: string,
  ) {
    return this.service.getKpiDetail(
      decodeURIComponent(kpiName),
      decodeURIComponent(releaseName),
      { releaseNames: parseList(releaseNames), years: parseYearList(years) },
    );
  }

  @Patch('kpi-score/:releaseName/:kpiName/note')
  updateQualitativeNote(
    @Request() req: any,
    @Param('releaseName') releaseName: string,
    @Param('kpiName') kpiName: string,
    @Body('note') note: string | null,
  ) {
    requireRole(req, IMPORTERS, 'רק מנהל גרסה או אדמין יכולים לערוך הערה זו');
    return this.service.updateQualitativeNote(decodeURIComponent(releaseName), decodeURIComponent(kpiName), note);
  }

  @Get('qc-link/:releaseName')
  getQcLinkForRelease(@Param('releaseName') releaseName: string) {
    return this.service.getQcLinkForRelease(decodeURIComponent(releaseName));
  }
}
