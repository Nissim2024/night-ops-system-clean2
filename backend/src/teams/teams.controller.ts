import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  ForbiddenException,
} from '@nestjs/common';
import { TeamsService } from './teams.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const ADMINS    = ['ADMIN'];
const MANAGERS  = ['RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('teams')
export class TeamsController {
  constructor(private teamsService: TeamsService) {}

  @Get()
  findAll() {
    return this.teamsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.teamsService.findOne(id);
  }

  @Post()
  create(@Body() body: { name: string; description?: string }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול ליצור צוות');
    return this.teamsService.create(body);
  }

  @Post('seed')
  seedDefaultTeams(@Request() req: any) {
    requireRole(req, ADMINS, 'רק מנהל מערכת יכול לאתחל צוותי ברירת מחדל');
    return this.teamsService.seedDefaultTeams();
  }

  @Post(':id/members')
  addMember(
    @Param('id') teamId: string,
    @Body() body: { userId: string; isLead?: boolean },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לשייך משתמשים לצוות');
    return this.teamsService.addMember(teamId, body.userId, body.isLead);
  }

  @Delete(':id/members/:userId')
  removeMember(
    @Param('id') teamId: string,
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להסיר משתמשים מצוות');
    return this.teamsService.removeMember(teamId, userId);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; active?: boolean },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן פרטי צוות');
    return this.teamsService.update(id, body);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Request() req: any) {
    requireRole(req, ADMINS, 'רק מנהל מערכת יכול למחוק צוות');
    return this.teamsService.delete(id);
  }
}
