import {
  Controller, Post, Get, Query, UploadedFile, UseInterceptors,
  Body, Request, UseGuards, ForbiddenException, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

const ALLOWED_MIMETYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
  'application/vnd.ms-excel',                                           // .xls
];

@UseGuards(JwtGuard)
@Controller('import')
export class ImportController {
  constructor(private importService: ImportService) {}

  @Get('crs-for-team')
  async getCrsForTeam(
    @Query('versionId') versionId: string,
    @Request() req: any,
  ) {
    if (!versionId) throw new BadRequestException('versionId חסר');
    return this.importService.fetchCrsForTeam(versionId, req.user.sub);
  }

  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('versionName') versionName: string,
    @Body('plannedStart') plannedStartStr: string,
    @Body('qcReleaseId') qcReleaseId: string,
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לייבא קובץ');

    if (!file) {
      return { success: false, message: 'לא נבחר קובץ' };
    }

    // Validate file type
    const extOk = /\.(xlsx|xls)$/i.test(file.originalname ?? '');
    const mimeOk = ALLOWED_MIMETYPES.includes(file.mimetype);
    if (!extOk && !mimeOk) {
      throw new BadRequestException('סוג קובץ לא חוקי — יש להעלות קובץ Excel בלבד (.xlsx / .xls)');
    }

    if (!versionName) {
      return { success: false, message: 'שם גרסה חסר' };
    }

    const versionPlannedStart = plannedStartStr ? new Date(plannedStartStr) : undefined;

    try {
      return await this.importService.importFromBuffer(
        file.buffer,
        versionName,
        req.user.sub,
        file.originalname,
        versionPlannedStart,
        qcReleaseId || undefined,
      );
    } catch (err: any) {
      console.error('Import error:', err);
      // Return a safe message — never expose raw exception details to the client
      return { success: false, message: 'שגיאה בעיבוד הקובץ. ודא שהפורמט תקין.' };
    }
  }
}
