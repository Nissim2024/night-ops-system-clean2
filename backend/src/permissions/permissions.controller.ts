import { Controller, Get, Put, Param, Body, UseGuards, Req, ForbiddenException } from '@nestjs/common';
import { PermissionsService } from './permissions.service';
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
