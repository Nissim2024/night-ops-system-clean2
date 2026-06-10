import {
  Controller, Get, Post, Delete, Put, Patch,
  Body, Param, Query, Res,
  UseGuards, ParseIntPipe, Request,
} from '@nestjs/common';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QaAdminGuard } from './qa-admin.guard';
import { QaService } from './qa.service';
import { QaWorkPlanService } from './qa-workplan.service';

@UseGuards(JwtGuard, QaAdminGuard)
@Controller('qa')
export class QaController {
  constructor(
    private readonly qa: QaService,
    private readonly workPlan: QaWorkPlanService,
  ) {}

  // ── Skills ──────────────────────────────────────────────────────────────────

  @Get('skills')
  getSkills() { return this.qa.getSkills(); }

  @Post('skills')
  createSkill(@Body() body: { name: string; type: string; weight?: number }) {
    return this.qa.createSkill(body.name, body.type, body.weight);
  }

  @Delete('skills/:id')
  deleteSkill(@Param('id') id: string) { return this.qa.deleteSkill(id); }

  // ── Testers ─────────────────────────────────────────────────────────────────

  @Get('testers')
  getTesters() { return this.qa.getTesters(); }

  @Post('testers')
  addTester(@Body() body: { userId: string }) { return this.qa.addTester(body.userId); }

  @Delete('testers/:userId')
  removeTester(@Param('userId') userId: string) { return this.qa.removeTester(userId); }

  @Get('users/available')
  getAvailableUsers(@Query('teamId') teamId?: string) { return this.qa.getAvailableUsers(teamId); }

  // ── Matrix ──────────────────────────────────────────────────────────────────

  @Get('matrix')
  getMatrix() { return this.qa.getMatrix(); }

  @Put('matrix/:userId/:skillId')
  setSkillLevel(
    @Param('userId') userId: string,
    @Param('skillId') skillId: string,
    @Body('level', ParseIntPipe) level: number,
  ) {
    return this.qa.setSkillLevel(userId, skillId, level);
  }

  @Delete('matrix/:userId/:skillId')
  removeSkillLevel(
    @Param('userId') userId: string,
    @Param('skillId') skillId: string,
  ) {
    return this.qa.removeSkillLevel(userId, skillId);
  }

  // ── Assignments ──────────────────────────────────────────────────────────────

  @Get('assignments')
  getAssignments(@Query('versionId') versionId: string) {
    return this.qa.getAssignments(versionId);
  }

  @Get('assignments/recommend')
  recommendTesters(@Query('versionId') versionId: string) {
    return this.qa.recommendTesters(versionId);
  }

  @Get('assignments/score')
  scoreForCr(
    @Query('versionId') versionId: string,
    @Query('crNumber')  crNumber:  string,
  ) {
    return this.qa.scoreForCr(crNumber, versionId);
  }

  @Post('assignments')
  upsertAssignment(
    @Body() body: {
      versionId:    string;
      crNumber:     string;
      crLabel?:     string;
      userId:       string;
      notes?:       string;
      autoScore?:   number;
      isStandAlone?: boolean | null;
      cycles?:      string[];
      sortOrder?:   number;
    },
    @Request() req: any,
  ) {
    return this.qa.upsertAssignment(
      body.versionId, body.crNumber, body.crLabel ?? null,
      body.userId, body.notes, req.user?.email, body.autoScore,
      body.isStandAlone, body.cycles, body.sortOrder,
    );
  }

  @Patch('assignments/:id')
  patchAssignment(
    @Param('id') id: string,
    @Body() body: { isStandAlone?: boolean | null; cycles?: string[]; sortOrder?: number; qaEffort?: number | null },
  ) {
    return this.qa.patchAssignment(id, body);
  }

  @Post('assignments/auto-assign')
  autoAssign(
    @Body() body: { versionId: string; crNumber: string },
  ) {
    return this.qa.autoAssign(body.crNumber, body.versionId);
  }

  @Delete('assignments/:id')
  deleteAssignment(@Param('id') id: string) {
    return this.qa.deleteAssignment(id);
  }

  // ── Work Plan ────────────────────────────────────────────────────────────────

  @Get('workplan')
  getWorkPlan(@Query('versionId') versionId: string) {
    return this.workPlan.getWorkPlan(versionId);
  }

  @Post('workplan/generate')
  generateWorkPlan(
    @Body() body: { versionId: string; cycle1Start: string; testingEnd: string },
    @Request() req: any,
  ) {
    return this.workPlan.generateWorkPlan(
      body.versionId,
      new Date(body.cycle1Start),
      new Date(body.testingEnd),
      req.user?.email,
    );
  }

  @Post('workplan/approve')
  approveWorkPlan(
    @Body('versionId') versionId: string,
    @Request() req: any,
  ) {
    return this.workPlan.approveWorkPlan(versionId, req.user?.email);
  }

  @Patch('workplan/task/:id/toggle')
  toggleTask(
    @Param('id') taskId: string,
    @Body('isActive') isActive: boolean,
  ) {
    return this.workPlan.toggleTask(taskId, isActive);
  }

  @Patch('workplan/task/:id/effort')
  updateTaskEffort(
    @Param('id') taskId: string,
    @Body('effortDays') effortDays: number,
  ) {
    return this.workPlan.updateTaskEffort(taskId, effortDays);
  }

  @Patch('workplan/cycle/:id/notes')
  updateCycleNotes(
    @Param('id') cycleId: string,
    @Body('notes') notes: string,
  ) {
    return this.workPlan.updateCycleNotes(cycleId, notes);
  }

  @Patch('workplan/cycle/:id/dates')
  updateCycleDates(
    @Param('id') cycleId: string,
    @Body() body: { plannedStart: string; plannedEnd: string },
  ) {
    return this.workPlan.updateCycleDates(
      cycleId,
      new Date(body.plannedStart),
      new Date(body.plannedEnd),
    );
  }

  @Get('workplan/export')
  async exportWorkPlan(
    @Query('versionId') versionId: string,
    @Res() res: Response,
  ) {
    const buf = await this.workPlan.exportToExcel(versionId);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="qa-workplan.xlsx"`,
    });
    res.send(buf);
  }
}
