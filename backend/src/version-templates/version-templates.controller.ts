import { Controller, Get, Post, Patch, Delete, Param, Body, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { VersionTemplatesService } from './version-templates.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('version-templates')
export class VersionTemplatesController {
  constructor(private service: VersionTemplatesService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Post('from-version/:versionId')
  createFromVersion(
    @Param('versionId') versionId: string,
    @Body() body: { name: string; description?: string },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לשמור תבנית');
    return this.service.create(versionId, body.name, body.description, req.user.sub);
  }

  @Post(':id/apply-to-version/:versionId')
  applyToVersion(
    @Param('id') id: string,
    @Param('versionId') versionId: string,
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להחיל תבנית');
    return this.service.applyToVersion(id, versionId, req.user.sub);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { name?: string; description?: string }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לערוך תבנית');
    return this.service.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול למחוק תבנית');
    return this.service.remove(id);
  }
}
