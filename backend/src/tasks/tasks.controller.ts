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
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { TaskStatus, Priority } from '@prisma/client';

@UseGuards(JwtGuard)
@Controller('tasks')
export class TasksController {
  constructor(private tasksService: TasksService) {}

  @Get()
  findAll(
    @Query('status') status?: TaskStatus,
    @Query('teamId') teamId?: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.tasksService.findAll({ status, teamId, versionId });
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
    return this.tasksService.create({
      ...body,
      createdBy: req.user.sub,
    });
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: TaskStatus },
    @Request() req: any,
  ) {
    return this.tasksService.updateStatus(
      id,
      body.status,
      req.user.sub,
      req.ip,
    );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.tasksService.update(id, body, req.user.sub);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Request() req: any) {
    return this.tasksService.remove(id, req.user.sub);
  }
}