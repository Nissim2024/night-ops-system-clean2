import {
  Controller, Get, Post, Patch, Body, Param, Request, UseGuards,
} from '@nestjs/common';
import { VersionsService } from './versions.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { VersionStatus } from '@prisma/client';

@UseGuards(JwtGuard)
@Controller('versions')
export class VersionsController {
  constructor(private versionsService: VersionsService) {}

  @Get()
  findAll() {
    return this.versionsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.versionsService.findOne(id);
  }

  @Post()
  create(@Body() body: {
    name: string;
    description?: string;
    plannedStart?: string;
    collectionDeadline?: string;
    reviewMeetingTime?: string;
  }, @Request() req: any) {
    return this.versionsService.create({ ...body, createdBy: req.user.sub });
  }

  @Post(':id/phases')
  addPhase(@Param('id') id: string, @Body() body: {
    name: string;
    orderIndex: number;
    environment?: string;
    teamId?: string;
  }) {
    return this.versionsService.addPhase(id, body);
  }

  @Post(':id/seed-phases')
  seedDefaultPhases(@Param('id') id: string, @Request() req: any) {
    return this.versionsService.seedDefaultPhases(id, req.user.sub);
  }

  @Post('phases/:phaseId/sub-phases')
  addSubPhase(@Param('phaseId') phaseId: string, @Body() body: {
    name: string;
    orderIndex: number;
  }) {
    return this.versionsService.addSubPhase(phaseId, body);
  }

  @Post('sub-phases/:subPhaseId/tasks')
  addTask(@Param('subPhaseId') subPhaseId: string, @Body() body: any, @Request() req: any) {
    return this.versionsService.addTask(subPhaseId, { ...body, createdBy: req.user.sub });
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: VersionStatus }, @Request() req: any) {
    return this.versionsService.updateStatus(id, body.status, req.user.sub);
  }

  @Post(':id/submit/:teamId')
  submitTeamTasks(
    @Param('id') versionId: string,
    @Param('teamId') teamId: string,
    @Request() req: any,
  ) {
    return this.versionsService.submitTeamTasks(versionId, teamId, req.user.sub);
  }

  @Get(':id/submissions')
  getSubmissionStatus(@Param('id') versionId: string) {
    return this.versionsService.getSubmissionStatus(versionId);
  }

  @Post('tasks/:taskId/dependencies')
  addDependency(@Param('taskId') taskId: string, @Body() body: { dependsOnTaskId: string }) {
    return this.versionsService.addDependency(taskId, body.dependsOnTaskId);
  }

  @Post('tasks/:taskId/dependencies/remove')
  removeDependency(@Param('taskId') taskId: string, @Body() body: { dependsOnTaskId: string }) {
    return this.versionsService.removeDependency(taskId, body.dependsOnTaskId);
  }
}