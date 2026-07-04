import {
  Controller, Get, Post, Patch, Param, Query,
  UseGuards, UseInterceptors, UploadedFile, Request,
  HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { QcReleasesService } from './qc-releases.service';
import { SmbAccessError } from './smb-file-reader';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('qc-releases')
export class QcReleasesController {
  private readonly logger = new Logger(QcReleasesController.name);

  constructor(private readonly service: QcReleasesService) {}

  @Get('active')
  findActive() {
    return this.service.findActive();
  }

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post('sync')
  async sync(@Request() req: any) {
    if (!['ADMIN', 'RELEASE_MANAGER'].includes(req.user.role)) {
      return { error: 'אין הרשאה לסנכרון' };
    }
    try {
      return await this.service.sync();
    } catch (err: any) {
      throw new HttpException(
        { error: 'Oracle sync failed', message: err.message },
        HttpStatus.BAD_GATEWAY,
      );
    }
  }

  @Post('sync-excel')
  @UseInterceptors(FileInterceptor('file'))
  async syncFromExcel(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
    @Query('fromYear') fromYear?: string,
  ) {
    if (!['ADMIN', 'RELEASE_MANAGER'].includes(req.user.role)) {
      return { error: 'אין הרשאה לסנכרון' };
    }
    if (!file) return { error: 'לא נבחר קובץ' };
    try {
      return await this.service.syncFromExcel(file.buffer, fromYear ? Number(fromYear) : 2026);
    } catch (err: any) {
      throw new HttpException(
        { error: 'שגיאה בעיבוד קובץ Excel', message: err.message },
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  // Sync from network path (SMB/CIFS mount). Returns descriptive error, never Internal Server Error.
  @Post('sync-excel-path')
  async syncFromFilePath(
    @Request() req: any,
    @Query('fromYear') fromYear?: string,
  ) {
    if (!['ADMIN', 'RELEASE_MANAGER'].includes(req.user.role)) {
      return { error: 'אין הרשאה לסנכרון' };
    }
    try {
      return await this.service.syncFromFilePath(fromYear ? Number(fromYear) : 2026);
    } catch (err: any) {
      this.logger.error(`sync-excel-path failed: ${err.message}`);

      if (err instanceof SmbAccessError) {
        const statusMap: Record<string, number> = {
          NOT_CONFIGURED: HttpStatus.BAD_REQUEST,
          WINDOWS_PATH:   HttpStatus.BAD_REQUEST,
          UNC_PATH:       HttpStatus.BAD_REQUEST,
          ENOENT:         HttpStatus.NOT_FOUND,
          EACCES:         HttpStatus.FORBIDDEN,
          EPERM:          HttpStatus.FORBIDDEN,
          EISDIR:         HttpStatus.BAD_REQUEST,
          ENOTCONN:       HttpStatus.BAD_GATEWAY,
          ENETUNREACH:    HttpStatus.BAD_GATEWAY,
          EHOSTUNREACH:   HttpStatus.BAD_GATEWAY,
          ECONNREFUSED:   HttpStatus.BAD_GATEWAY,
          ETIMEDOUT:      HttpStatus.BAD_GATEWAY,
          ESTALE:         HttpStatus.BAD_GATEWAY,
        };
        const status = statusMap[err.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
        throw new HttpException(
          { error: 'שגיאת גישה לקובץ QC', code: err.code, message: err.message },
          status,
        );
      }

      throw new HttpException(
        { error: 'שגיאה בסנכרון קובץ QC', message: err.message },
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }
}
