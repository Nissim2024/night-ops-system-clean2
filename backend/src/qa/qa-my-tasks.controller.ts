import { Controller, Get, Query, UseGuards, Request } from '@nestjs/common';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QaWorkPlanService } from './qa-workplan.service';

// Deliberately separate from QaController (which requires QaAdminGuard) —
// this controller is JwtGuard-only and every query is hard-scoped to
// req.user.sub, so a plain QA tester (EMPLOYEE role, no team-lead/admin
// rights) can see their own assigned testing tasks without gaining any
// visibility into the rest of the work plan or anyone else's assignments.
@UseGuards(JwtGuard)
@Controller('qa/me')
export class QaMyTasksController {
  constructor(private readonly workPlan: QaWorkPlanService) {}

  @Get('tasks')
  getMyTasks(@Query('versionId') versionId: string, @Request() req: any) {
    return this.workPlan.getMyTasks(req.user.sub, versionId);
  }
}
