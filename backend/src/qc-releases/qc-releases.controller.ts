import {
  Controller, Get, Post, Patch, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, Request,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { QcReleasesService } from './qc-releases.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('qc-releases')
export class QcReleasesController {
  constructor(private readonly service: QcReleasesService) {}

  // Active releases with filterDate > today — for version creation dropdown
  @Get('active')
  findActive() {
    return this.service.findActive();
  }

  // All releases — for admin view
  @Get()
  findAll() {
    return this.service.findAll();
  }

  // Trigger Oracle sync — admin action
  @Post('sync')
  sync(@Request() req: any) {
    if (!['ADMIN', 'RELEASE_MANAGER'].includes(req.user.role)) {
      return { error: 'אין הרשאה לסנכרון' };
    }
    return this.service.sync();
  }

  // Sync from uploaded CR_LIST Excel file
  @Post('sync-excel')
  @UseInterceptors(FileInterceptor('file'))
  syncFromExcel(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('fromYear') fromYear?: string,
  ) {
    if (!['ADMIN', 'RELEASE_MANAGER'].includes(req.user.role)) {
      return { error: 'אין הרשאה לסנכרון' };
    }
    if (!file) return { error: 'לא נבחר קובץ' };
    return this.service.syncFromExcel(file.buffer, fromYear ? Number(fromYear) : 2026);
  }

  // Sync from EXCEL_FILE_PATH system param (no file upload needed)
  @Post('sync-excel-path')
  syncFromFilePath(
    @Request() req: any,
    @Query('fromYear') fromYear?: string,
  ) {
    if (!['ADMIN', 'RELEASE_MANAGER'].includes(req.user.role)) {
      return { error: 'אין הרשאה לסנכרון' };
    }
    return this.service.syncFromFilePath(fromYear ? Number(fromYear) : 2026);
  }

  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }
}
