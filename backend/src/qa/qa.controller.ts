import {
  Controller, Get, Post, Delete, Put, Patch,
  Body, Param, Query, Res, UploadedFile, UseInterceptors,
  UseGuards, ParseIntPipe, Request, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
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

  @Post('matrix/import')
  @UseInterceptors(FileInterceptor('file'))
  async importMatrix(@UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('לא נבחר קובץ');
    const extOk = /\.(xlsx|xls)$/i.test(file.originalname ?? '');
    if (!extOk) throw new BadRequestException('סוג קובץ לא חוקי — יש להעלות קובץ Excel בלבד (.xlsx / .xls)');
    return this.qa.importMatrixFromBuffer(file.buffer);
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

  @Get('assignments/secondary-suggest')
  suggestSecondaryTesters(
    @Query('versionId') versionId: string,
    @Query('crNumber')  crNumber:  string,
  ) {
    return this.qa.suggestSecondaryTesters(versionId, crNumber);
  }

  @Get('assignments/second-tester-suggestions')
  getSecondTesterSuggestions(@Query('versionId') versionId: string) {
    return this.qa.getSecondTesterSuggestions(versionId);
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
    @Body() body: {
      isStandAlone?:        boolean | null;
      cycles?:              string[];
      sortOrder?:           number;
      qaEffort?:            number | null;
      secondaryTesterId?:   string | null;
      secondarySkillLevel?: number | null;
      secondaryParticipationPct?: number | null;
      standAloneDueDate?:   string | null;
    },
  ) {
    return this.qa.patchAssignment(id, {
      ...body,
      standAloneDueDate: body.standAloneDueDate !== undefined
        ? (body.standAloneDueDate ? new Date(body.standAloneDueDate) : null)
        : undefined,
    });
  }

  @Patch('assignments/:id/secondary')
  async patchSecondary(
    @Param('id') id: string,
    @Body() body: { secondaryTesterId: string | null; secondarySkillLevel?: number },
    @Request() req: any,
  ) {
    const asg = await this.qa.patchAssignment(id, {
      secondaryTesterId:   body.secondaryTesterId,
      secondarySkillLevel: body.secondaryTesterId ? (body.secondarySkillLevel ?? 3) : null,
    });

    // Regenerate work plan to incorporate the secondary tester's effort split —
    // preserving the existing cycle-length parameters (they're editable and
    // must not silently reset to the 12/6/4 defaults on every secondary change).
    const versionId = (asg as any).versionId;
    const existingPlan = await this.workPlan.getWorkPlan(versionId);
    if (existingPlan) {
      const regen = await this.workPlan.generateWorkPlan(
        versionId,
        new Date(existingPlan.cycle1Start),
        new Date(existingPlan.testingEnd),
        req.user?.email,
        (existingPlan as any).cycle1LengthDays,
        (existingPlan as any).cycle2LengthDays,
        (existingPlan as any).cycle3LengthDays,
      );
      return { assignment: asg, workPlan: regen.workPlan };
    }
    return { assignment: asg };
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
    @Body() body: {
      versionId: string; cycle1Start: string; testingEnd: string;
      cycle1LengthDays?: number; cycle2LengthDays?: number; cycle3LengthDays?: number;
    },
    @Request() req: any,
  ) {
    return this.workPlan.generateWorkPlan(
      body.versionId,
      new Date(body.cycle1Start),
      new Date(body.testingEnd),
      req.user?.email,
      body.cycle1LengthDays,
      body.cycle2LengthDays,
      body.cycle3LengthDays,
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

  @Patch('workplan/task/:id/sort')
  reorderTask(
    @Param('id') taskId: string,
    @Body('newSortOrder') newSortOrder: number,
  ) {
    return this.workPlan.reorderTask(taskId, newSortOrder);
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
    const { buffer, filename } = await this.workPlan.exportToExcel(versionId);
    const ascii    = filename.replace(/[^\x20-\x7E]/g, '_');
    const encoded  = encodeURIComponent(filename);
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    });
    res.send(buffer);
  }
}
