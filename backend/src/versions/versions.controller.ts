import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Request, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { VersionsService } from './versions.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { VersionStatus } from '@prisma/client';

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];
const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

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
    plannedEnd?: string;
    integrationStart?: string;
    integrationEnd?: string;
    qaStart?: string;
    qaEnd?: string;
    collectionDeadline?: string;
    reviewMeetingTime?: string;
    qcReleaseId?: string;
  }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול ליצור גרסה');
    return this.versionsService.create({ ...body, createdBy: req.user.sub });
  }

  @Patch(':id/submissions/:teamId/not-required')
  setNotRequired(
    @Param('id') versionId: string,
    @Param('teamId') teamId: string,
    @Body() body: { notRequiredForApproval: boolean },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לסמן צוות כלא נדרש');
    return this.versionsService.setNotRequiredForApproval(versionId, teamId, body.notRequiredForApproval);
  }

  @Patch(':id')
  updateFields(
    @Param('id') id: string,
    @Body() body: {
      plannedStart?: string | null; plannedEnd?: string | null; reviewMeetingTime?: string | null;
      integrationStart?: string | null; integrationEnd?: string | null; qaStart?: string | null; qaEnd?: string | null;
      name?: string; description?: string;
    },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן פרטי גרסה');
    return this.versionsService.updateFields(id, body);
  }

  @Patch(':id/planned-end')
  updatePlannedEnd(
    @Param('id') id: string,
    @Body() body: { plannedEnd: string },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן שעת סיום מתוכנת');
    return this.versionsService.updatePlannedEnd(id, body.plannedEnd);
  }

  @Patch(':id/review-meeting-time')
  updateReviewMeetingTime(
    @Param('id') id: string,
    @Body() body: { reviewMeetingTime: string | null },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן מועד ישיבת המעבר');
    return this.versionsService.updateReviewMeetingTime(id, body.reviewMeetingTime);
  }

  @Post(':id/phases')
  addPhase(@Param('id') id: string, @Body() body: {
    name: string;
    orderIndex: number;
    environment?: string;
    teamId?: string;
  }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להוסיף שלבים');
    return this.versionsService.addPhase(id, body);
  }

  @Post(':id/seed-phases')
  seedDefaultPhases(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לאתחל שלבים');
    return this.versionsService.seedDefaultPhases(id, req.user.sub);
  }

  @Post(':id/seed-template')
  seedTemplate(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לאתחל תבנית');
    return this.versionsService.seedTemplate(id, req.user.sub);
  }

  @Patch('phases/:phaseId')
  updatePhase(
    @Param('phaseId') phaseId: string,
    @Body() body: { name?: string; isGoNoGo?: boolean },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לערוך שלב');
    return this.versionsService.updatePhase(phaseId, body);
  }

  @Delete('phases/:phaseId')
  deletePhase(@Param('phaseId') phaseId: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול למחוק שלב');
    return this.versionsService.deletePhase(phaseId);
  }

  @Post('phases/:phaseId/sub-phases')
  addSubPhase(@Param('phaseId') phaseId: string, @Body() body: {
    name: string;
    orderIndex: number;
  }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להוסיף תת-שלבים');
    return this.versionsService.addSubPhase(phaseId, body);
  }

  @Post('sub-phases/:subPhaseId/tasks')
  addTask(@Param('subPhaseId') subPhaseId: string, @Body() body: any, @Request() req: any) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה להוספת משימות');
    return this.versionsService.addTask(subPhaseId, { ...body, createdBy: req.user.sub });
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: { status: VersionStatus; force?: boolean }, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לשנות סטטוס גרסה');
    return this.versionsService.updateStatus(id, body.status, req.user.sub, body.force ?? false);
  }

  @Patch(':id/archive')
  archiveVersion(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לארכב גרסה');
    return this.versionsService.archiveVersion(id);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לשחזר גרסה');
    return this.versionsService.restore(id);
  }

  @Post(':id/end-rehearsal')
  endRehearsal(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לסיים חזרה גנרלית');
    return this.versionsService.endRehearsal(id);
  }

  @Post(':id/cancel-rehearsal')
  cancelRehearsal(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לבטל חזרה גנרלית');
    return this.versionsService.cancelRehearsal(id);
  }

  @Post(':id/submit/:teamId')
  submitTeamTasks(
    @Param('id') versionId: string,
    @Param('teamId') teamId: string,
    @Request() req: any,
  ) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה להגשת צוות');
    return this.versionsService.submitTeamTasks(versionId, teamId, req.user.sub, req.user.role);
  }

  @Get(':id/submissions')
  getSubmissionStatus(@Param('id') versionId: string) {
    return this.versionsService.getSubmissionStatus(versionId);
  }

  @Delete(':id')
  delete(@Param('id') id: string, @Request() req: any) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול למחוק גרסה');
    return this.versionsService.delete(id);
  }

  @Post(':id/resolve-deps')
  resolveAllDependencies(@Param('id') id: string, @Request() req: any) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה לעדכון תלויות');
    return this.versionsService.resolveAllDependencies(id);
  }

  @Post(':id/auto-deps-by-user')
  autoDepsByUser(@Param('id') id: string, @Request() req: any) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה ליצירת תלויות אוטומטיות');
    return this.versionsService.autoDepsByUser(id);
  }

  @Post(':id/fix-cross-phase-deps')
  deleteCrossPhaseUserDeps(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול למחוק תלויות שגויות');
    return this.versionsService.deleteCrossPhaseUserDeps(id);
  }

  @Post('tasks/:taskId/dependencies')
  addDependency(@Param('taskId') taskId: string, @Body() body: { dependsOnTaskId: string }, @Request() req: any) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה לניהול תלויות');
    return this.versionsService.addDependency(taskId, body.dependsOnTaskId);
  }

  @Post('tasks/:taskId/dependencies/remove')
  removeDependency(@Param('taskId') taskId: string, @Body() body: { dependsOnTaskId: string }, @Request() req: any) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה לניהול תלויות');
    return this.versionsService.removeDependency(taskId, body.dependsOnTaskId);
  }

  @Post(':id/apply-schedule')
  applySchedule(
    @Param('id') _id: string,
    @Body() body: {
      updates: { taskId: string; plannedStart: string; plannedEnd: string }[];
      phases: { phaseId: string; startTime?: string; endTime?: string }[];
    },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן תוכנית');
    return this.versionsService.applySchedule(body.updates ?? [], body.phases ?? []);
  }

  @Post('tasks/:taskId/promote')
  promoteToSubPhase(@Param('taskId') taskId: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להמיר משימה לתת-שלב');
    return this.versionsService.promoteTaskToSubPhase(taskId);
  }

  @Post(':id/fix-task-order')
  fixTaskOrder(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לתקן סדר משימות');
    return this.versionsService.fixTaskOrder(id);
  }

  @Patch(':id/reassign-tasks')
  reassignTasks(
    @Param('id') id: string,
    @Body() body: { fromUserName: string | null; toUserId: string; phaseId?: string; fromTeamId?: string },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול להחליף עובד במשימות');
    return this.versionsService.reassignTasks(id, body.fromUserName ?? null, body.toUserId, body.phaseId, body.fromTeamId);
  }

  @Post(':id/rollback-user-deps')
  rollbackUserDeps(
    @Param('id') id: string,
    @Body() body: { pairs: { taskId: string; dependsOnTaskId: string }[] },
    @Request() req: any,
  ) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה לביטול תלויות');
    return this.versionsService.deleteDepPairs(body.pairs ?? []);
  }

  @Post('sub-phases/:subPhaseId/reorder')
  reorderSubPhaseTasks(
    @Param('subPhaseId') subPhaseId: string,
    @Body() body: { taskIds: string[] },
    @Request() req: any,
  ) {
    requireRole(req, LEADS_UP, 'נדרשת הרשאת ראש צוות ומעלה לסידור מחדש');
    return this.versionsService.reorderSubPhaseTasks(subPhaseId, body.taskIds ?? []);
  }

  @Patch(':id/wizard-state')
  updateWizardState(
    @Param('id') id: string,
    @Body() body: { state: Record<string, string | null> },
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לעדכן מצב אשף');
    return this.versionsService.updateWizardState(id, body.state);
  }

  @Get(':id/cr-review')
  getCrReview(@Param('id') id: string) {
    return this.versionsService.getCrReview(id);
  }

  @Get(':id/sub-phases')
  getSubPhases(@Param('id') id: string) {
    return this.versionsService.getSubPhases(id);
  }

  @Get(':id/detect-anomalies')
  detectAnomalies(@Param('id') id: string) {
    return this.versionsService.detectAnomalies(id);
  }

  @Post(':id/sort-by-planned-start')
  sortByPlannedStart(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול למיין משימות');
    return this.versionsService.sortByPlannedStart(id);
  }

  @Post(':id/reschedule')
  reschedule(
    @Param('id') id: string,
    @Body() body: { phases: { phaseId: string; startTime: string; endTime?: string }[]; respectDeps?: boolean; taskOverrides?: { taskId: string; plannedStart: string }[] },
    @Query('preview') preview: string,
    @Request() req: any,
  ) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לתזמן מחדש');
    return this.versionsService.reschedule(id, body.phases ?? [], preview === 'true', body.respectDeps ?? false, body.taskOverrides ?? []);
  }

  @Post(':id/send-collecting-reminder')
  sendCollectingReminder(@Param('id') id: string, @Request() req: any) {
    requireRole(req, MANAGERS, 'רק מנהל לילה יכול לשלוח תזכורות');
    return this.versionsService.sendCollectingReminder(id);
  }
}
