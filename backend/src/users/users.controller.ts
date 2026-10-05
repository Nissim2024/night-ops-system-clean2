import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Request, ForbiddenException } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { PermissionsService } from '../permissions/permissions.service';
const permissions = new PermissionsService();

const ADMINS = ['ADMIN'];
const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('users')
export class UsersController {
  constructor(private usersService: UsersService) {}

  @Get()
  findAll(@Request() req: any) {
    requireRole(req, LEADS_UP, 'אין הרשאה לצפות ברשימת המשתמשים');
    return this.usersService.findAll();
  }

  @Post()
  async create(@Body() body: {
    fullName: string;
    email: string;
    password: string;
    phone?: string;
    role?: string;
  }, @Request() req: any) {
    if (!(await permissions.userHas(req.user, 'action:user_manage'))) throw new ForbiddenException('אין לך הרשאה לניהול משתמשים');
    return this.usersService.create(body);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: { fullName?: string; role?: string; active?: boolean; phone?: string; qcLogin?: string | null },
    @Request() req: any,
  ) {
    if (!(await permissions.userHas(req.user, 'action:user_manage'))) throw new ForbiddenException('אין לך הרשאה לניהול משתמשים');
    return this.usersService.update(id, body);
  }

  @Patch(':id/team')
  async setTeam(
    @Param('id') id: string,
    @Body() body: { teamId: string | null },
    @Request() req: any,
  ) {
    if (!(await permissions.userHas(req.user, 'action:user_manage'))) throw new ForbiddenException('אין לך הרשאה לניהול משתמשים');
    return this.usersService.setTeam(id, body.teamId);
  }

  @Patch(':id/password')
  async resetPassword(
    @Param('id') id: string,
    @Body() body: { newPassword: string },
    @Request() req: any,
  ) {
    if (!(await permissions.userHas(req.user, 'action:user_manage'))) throw new ForbiddenException('אין לך הרשאה לניהול משתמשים');
    return this.usersService.resetPassword(id, body.newPassword);
  }

  @Delete(':id')
  async deleteUser(@Param('id') id: string, @Request() req: any) {
    if (!(await permissions.userHas(req.user, 'action:user_manage'))) throw new ForbiddenException('אין לך הרשאה לניהול משתמשים');
    return this.usersService.delete(id, req.user.sub);
  }

  @Post('sync-qc')
  async syncQcUsers(@Request() req: any) {
    if (!(await permissions.userHas(req.user, 'action:user_manage'))) throw new ForbiddenException('אין לך הרשאה לניהול משתמשים');
    return this.usersService.syncQcUsers();
  }
}
