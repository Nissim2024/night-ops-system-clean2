import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Request,
  UseGuards,
  ForbiddenException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { TaskStatus, Priority } from '@prisma/client';

const MANAGERS       = ['RELEASE_MANAGER', 'ADMIN'];
const LEADS_UP       = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const TASK_EXECUTORS = ['EMPLOYEE', 'TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@UseGuards(JwtGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  findAll(
    @Request() req: any,
    @Query('status') status?: TaskStatus,
    @Query('teamId') teamId?: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.tasksService.findAll({ status, teamId, versionId }, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.tasksService.findOne(id);
  }

  @Post()
  create(@Body() body: {
    title: string;
    description?: string;
    crNumber?: string;
    application?: string;
    priority?: Priority;
    assignedTeamId?: string;
    assignedUserId?: string;
    dueDate?: string;
  }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול ליצור משימה בתוכנית');
    const { title, description, crNumber, application, priority, assignedTeamId, assignedUserId, dueDate } = body;
    return this.tasksService.create({
      title, description, crNumber, application, priority, assignedTeamId, assignedUserId, dueDate,
      createdBy: req.user.sub,
    });
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: TaskStatus; blockedReason?: string; failedReason?: string },
    @Request() req: any,
  ) {
    requireRole(req, TASK_EXECUTORS, 'אין הרשאה לעדכון סטטוס משימה');
    return this.tasksService.updateStatus(
      id,
      body.status,
      req.user.sub,
      req.ip,
      body.blockedReason,
      body.failedReason,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן פרטי משימה בתוכנית');
    return this.tasksService.update(id, body, req.user.sub);
  }

  @Patch(':id/rollback-status')
  rollbackStatus(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להחזיר סטטוס');
    return this.tasksService.rollbackStatus(id, req.user.sub);
  }

  @Patch(':id/waive-gonogo')
  waiveGoNoGo(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לבצע Waive');
    return this.tasksService.waiveGoNoGo(id, req.user.sub);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לשכפל משימה');
    return this.tasksService.duplicate(id, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול למחוק משימה');
    return this.tasksService.remove(id, req.user.sub);
  }
}
