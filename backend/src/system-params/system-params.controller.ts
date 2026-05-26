import { Controller, Get, Patch, Param, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { SystemParamsService } from './system-params.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const MANAGERS_UP = ['RELEASE_MANAGER', 'ADMIN'];
const ADMINS = ['ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('system-params')
export class SystemParamsController {
  constructor(private service: SystemParamsService) {}

  @Get()
  findAll(@Request() req: any) {
    requireRole(req, MANAGERS_UP, 'אין הרשאה לצפות בפרמטרי מערכת');
    return this.service.findAll();
  }

  @Patch(':key')
  update(
    @Param('key') key: string,
    @Body() body: { value: string },
    @Request() req: any,
  ) {
    requireRole(req, ADMINS, 'רק מנהל מערכת יכול לעדכן פרמטרי מערכת');
    return this.service.update(key, body.value, req.user.sub);
  }
}
