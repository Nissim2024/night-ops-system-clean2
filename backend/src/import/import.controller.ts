import {
  Controller, Post, UploadedFile, UseInterceptors,
  Body, Request, UseGuards,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ImportService } from './import.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@Controller('import')
export class ImportController {
  constructor(private importService: ImportService) {}

  @Post('excel')
  @UseInterceptors(FileInterceptor('file'))
  async importExcel(
    @UploadedFile() file: Express.Multer.File,
    @Body('versionName') versionName: string,
    @Request() req: any,
  ) {
    if (!file) {
      return { success: false, message: 'לא נבחר קובץ' };
    }
    if (!versionName) {
      return { success: false, message: 'שם גרסה חסר' };
    }

    return this.importService.importFromBuffer(
      file.buffer,
      versionName,
      req.user.sub,
    );
  }
}