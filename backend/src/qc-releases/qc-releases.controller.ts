import { Controller, Get, Post, Patch, Param, UseGuards, Request } from '@nestjs/common';
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

  @Patch(':id/toggle')
  toggleActive(@Param('id') id: string) {
    return this.service.toggleActive(id);
  }
}
