import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Request, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { FailureReasonsService } from './failure-reasons.service';

const ADMINS   = ['ADMIN'];
const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('failure-reasons')
export class FailureReasonsController {
  constructor(private service: FailureReasonsService) {}

  @Get()
  findAll(@Request() req: any) {
    requireRole(req, LEADS_UP, 'אין הרשאה לצפות בסיבות כישלון');
    return this.service.findAll();
  }

  @Post()
  create(
    @Body() body: { reason: string; requiresRollback?: boolean },
    @Request() req: any,
  ) {
    requireRole(req, ADMINS, 'רק מנהל מערכת יכול להוסיף סיבת כישלון');
    return this.service.create(body.reason, body.requiresRollback ?? false);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { reason?: string; requiresRollback?: boolean; isActive?: boolean },
    @Request() req: any,
  ) {
    requireRole(req, ADMINS, 'רק מנהל מערכת יכול לעדכן סיבת כישלון');
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    requireRole(req, ADMINS, 'רק מנהל מערכת יכול למחוק סיבת כישלון');
    return this.service.remove(id);
  }
}
