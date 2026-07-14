import {
  Controller, Get, Post, Patch, Param,
  UseGuards, Request,
  HttpException, HttpStatus,
} from '@nestjs/common';
import { QcReleasesService } from './qc-releases.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

@UseGuards(JwtGuard)
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

  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }
}
