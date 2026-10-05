import { Controller, Get, Put, Param, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
import type { TeamGrants } from './permissions.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { Role } from '@prisma/client';

@Controller('permissions')
@UseGuards(JwtGuard)
export class PermissionsController {
  constructor(private readonly service: PermissionsService) {}

  @Get()
  getAll() {
    return this.service.getAll();
  }

  // Module → component tree the admin matrix renders.
  @Get('catalog')
  getCatalog() {
    return this.service.catalog();
  }

  // The caller's effective keys (role + teams, module grants expanded).
  @Get('me')
  getMine(@Req() req: any) {
    return this.service.getEffective(req.user);
  }

  @Get('teams')
  getTeamGrants(@Req() req: any) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('רק ADMIN יכול לצפות בהרשאות צוותים');
    return this.service.getTeamGrants();
  }

  // Declared before ':role' so "teams" isn't taken as a role name.
  @Put('teams')
  setTeamGrants(@Body() body: TeamGrants, @Req() req: any) {
    if (req.user.role !== 'ADMIN') throw new ForbiddenException('רק ADMIN יכול לשנות הרשאות');
    return this.service.setTeamGrants(body);
  }

  @Put(':role')
  updateRole(
    @Param('role') role: string,
    @Body('permissions') permissions: string[],
    @Req() req: any,
  ) {
    if (req.user.role !== 'ADMIN') {
      throw new ForbiddenException('רק ADMIN יכול לשנות הרשאות');
    }
    return this.service.updateRole(role as Role, permissions);
  }
}
