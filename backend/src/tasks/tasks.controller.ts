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
  BadRequestException,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { TaskStatus, Priority, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

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
    subPhaseId?: string;
    versionId?: string;
  }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול ליצור משימה בתוכנית');
    if (body?.title && body.title.length > 500) {
      throw new BadRequestException('title cannot exceed 500 characters');
    }
    const { title, description, crNumber, application, priority, assignedTeamId, assignedUserId, dueDate, subPhaseId, versionId } = body;
    return this.tasksService.create({
      title, description, crNumber, application, priority, assignedTeamId, assignedUserId, dueDate, subPhaseId, versionId,
      createdBy: req.user.sub,
    });
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() body: { status: TaskStatus; blockedReason?: string; failedReason?: string; blockedSeverity?: string },
    @Request() req: any,
  ) {
    requireRole(req, TASK_EXECUTORS, 'אין הרשאה לעדכון סטטוס משימה');

    // TEAM_LEAD and EMPLOYEE may only update tasks belonging to their own team(s)
    if (['TEAM_LEAD', 'EMPLOYEE'].includes(req.user.role)) {
      const task = await prisma.task.findUnique({ where: { id }, select: { assignedTeamId: true } });
      if (task?.assignedTeamId) {
        const membership = await prisma.teamMember.findFirst({
          where: { userId: req.user.sub, teamId: task.assignedTeamId },
        });
        if (!membership) {
          throw new ForbiddenException('אין הרשאה לעדכן משימה של צוות אחר');
        }
      }
    }

    return this.tasksService.updateStatus(
      id,
      body.status,
      req.user.sub,
      req.ip,
      body.blockedReason,
      body.failedReason,
      body.blockedSeverity,
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
  waiveGoNoGo(@Param('id') id: string, @Body('reason') reason: string | undefined, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לבצע Waive');
    return this.tasksService.waiveGoNoGo(id, req.user.sub, reason);
  }

  @Get(':id/waiver-history')
  getWaiverHistory(@Param('id') id: string) {
    return this.tasksService.getWaiverHistory(id);
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
