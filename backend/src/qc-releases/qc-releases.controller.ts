import {
  Controller, Get, Post, Patch, Param,
  UseGuards, Request,
  HttpException, HttpStatus, UseInterceptors } from '@nestjs/common';
import { PersonNamesInterceptor } from '../qc/person-names.interceptor';
import { QcReleasesService } from './qc-releases.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
@UseInterceptors(PersonNamesInterceptor)
@Controller('qc-releases')
export class QcReleasesController {
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

  // Any signed-in non-viewer may open a historical release — it only adds a
  // read-only COMPLETED Version pointing at existing QC data.
  @Post(':relId/open-as-version')
  async openAsVersion(@Param('relId') relId: string, @Request() req: any) {
    if (req.user.role === 'VIEWER') {
      throw new HttpException('אין הרשאה', HttpStatus.FORBIDDEN);
    }
    try {
      return await this.service.openAsVersion(Number(relId), req.user.sub);
    } catch (err: any) {
      throw new HttpException(err.message, HttpStatus.BAD_REQUEST);
    }
  }

  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }
}
