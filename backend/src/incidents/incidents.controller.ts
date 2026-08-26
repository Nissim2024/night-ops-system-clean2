import { Controller, Get, Post, Patch, Body, Param, Query, Request, UseGuards, ForbiddenException } from '@nestjs/common';
import { IncidentsService } from './incidents.service';
import { JwtGuard } from '../auth/jwt/jwt.guard';

const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN'];
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@UseGuards(JwtGuard)
@Controller('incidents')
export class IncidentsController {
  constructor(private service: IncidentsService) {}

  @Get('golive/:versionId')
  list(@Param('versionId') versionId: string, @Query('status') status: string | undefined, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.listForVersion(versionId, status);
  }

  @Get('golive/:versionId/import-preview')
  previewImport(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.previewImportFromQc(versionId);
  }

  @Post('golive/:versionId/import')
  import(@Param('versionId') versionId: string, @Body() body: { qcIds: string[] }, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.importFromQc(versionId, body.qcIds, req.user.fullName ?? req.user.email ?? req.user.sub);
  }

  @Get('golive/:versionId/metrics')
  metrics(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getMetrics(versionId);
  }

  // Root Cause Category rollup — cross-version by default (BI-over-time),
  // optionally scoped with ?versionId=. Top-level route (not nested under
  // golive/:versionId) since this is a cross-cutting report, not a
  // per-version resource.
  @Get('category-breakdown')
  getCategoryBreakdown(@Query('versionId') versionId: string | undefined, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getCategoryBreakdown(versionId || undefined);
  }

  @Get('golive/:versionId/suggest-groups')
  suggestGroups(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.suggestGroups(versionId);
  }

  // Fallback-mode team resolution by user-picked CR — see getCrsForVersion/
  // getTeamsForCr in the service for why this exists alongside the
  // auto-detected :id/relevant-teams route.
  @Get('golive/:versionId/crs')
  getCrsForVersion(@Param('versionId') versionId: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getCrsForVersion(versionId);
  }

  @Get('golive/:versionId/crs/:crNumber/teams')
  getTeamsForCr(@Param('versionId') versionId: string, @Param('crNumber') crNumber: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getTeamsForCr(versionId, crNumber);
  }

  // Fixed Root Cause Category → Root Cause (RCA) taxonomy — see
  // root-cause-taxonomy.ts. Static reference data, no incident/version scope.
  @Get('root-cause-taxonomy')
  getRootCauseTaxonomy(@Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getRootCauseTaxonomy();
  }

  // GUIDED method's decision-tree data — see guided-investigation-tree.ts.
  // Static reference data, no incident/version scope.
  @Get('guided-tree')
  getGuidedTree(@Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getGuidedTree();
  }

  @Post('golive/:versionId/groups')
  createGroup(@Param('versionId') versionId: string, @Body() body: { reason: string; incidentIds: string[] }, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.createGroupFromSuggestion(versionId, body.reason, body.incidentIds);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getIncident(id);
  }

  // Real teams to offer for lessons/actions — scoped to the CrPlan teams for
  // this incident's linked CR when one resolves, else every active team.
  @Get(':id/relevant-teams')
  getRelevantTeams(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.getRelevantTeams(id);
  }

  @Patch(':id/group')
  assignGroup(@Param('id') id: string, @Body() body: { groupId: string | null }, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.assignToGroup(id, body.groupId);
  }

  // Manual triage fields — affected-user count / customer-facing / downtime.
  // None of these exist anywhere in QC's real schema (verified against a
  // live export), so they're entered by hand here instead of invented.
  @Patch(':id/triage')
  updateTriageFields(
    @Param('id') id: string,
    @Body() body: { affectedUsersCount?: number | null; customerFacing?: boolean | null; downtimeMinutes?: number | null },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.updateTriageFields(id, body);
  }

  @Post(':id/collect')
  collectEvidence(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.collectEvidence(id);
  }

  @Post(':id/evidence')
  addEvidence(@Param('id') id: string, @Body() body: { content: string; meta?: any }, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.addManualEvidence(id, body.content, body.meta);
  }

  // GUIDED method stage 2 — see saveGuidedFacts's comment: this exists as a
  // separate call specifically so stage 3 (the tree) can be gated behind it.
  @Post(':id/rca/facts')
  saveGuidedFacts(
    @Param('id') id: string,
    @Body() body: { actionTaken: string; expectedResult: string; actualResult: string; timing: string; reproducibility: string },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.saveGuidedFacts(id, body, req.user.fullName ?? req.user.email ?? req.user.sub);
  }

  @Post(':id/rca')
  submitRca(
    @Param('id') id: string,
    @Body() body: {
      method: 'FIVE_WHY' | 'FISHBONE' | 'AI' | 'GUIDED';
      category?: string; rootCauseReason?: string; rootCause?: string; description?: string;
      lessons?: { teamId?: string; teamName: string; text: string }[];
      answers?: { step: number; question: string; answer: string; isRootCause?: boolean; evidenceIds?: string[] }[];
      treePath?: { nodeId: string; question: string; answerValue: string; answerLabel: string }[];
      treeLeafId?: string;
    },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.submitRca(id, {
      method: body.method, category: body.category, rootCauseReason: body.rootCauseReason,
      rootCause: body.rootCause, description: body.description, lessons: body.lessons,
      answers: body.answers, treePath: body.treePath, treeLeafId: body.treeLeafId,
      createdByName: req.user.fullName ?? req.user.email ?? req.user.sub,
    });
  }

  // Root Cause Status — tracks lesson-implementation follow-through,
  // independent of the incident's own close/reopen workflow.
  @Patch(':id/rca/status')
  updateRcaStatus(
    @Param('id') id: string,
    @Body() body: { status: 'OPEN' | 'INVESTIGATION' | 'COMPLETED' | 'CANCELLED' },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.updateRcaStatus(id, body.status);
  }

  @Post(':id/ai-analyze')
  aiAnalyze(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.aiAnalyze(id, req.user.fullName ?? req.user.email ?? req.user.sub);
  }

  @Post(':id/rca/next-question')
  suggestNextWhyQuestion(
    @Param('id') id: string,
    @Body() body: { answers: { step: number; question: string; answer: string }[] },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.suggestNextWhyQuestion(id, body.answers);
  }

  // Chat-driven RCA — the whole wizard run by AI conversationally. start is
  // idempotent (returns the existing transcript if the chat was already
  // begun, instead of restarting it).
  @Post(':id/chat/start')
  startChat(@Param('id') id: string, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.startChat(id);
  }

  @Post(':id/chat/reply')
  replyChat(@Param('id') id: string, @Body() body: { message: string }, @Request() req: any) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.replyChat(id, body.message, req.user.fullName ?? req.user.email ?? req.user.sub);
  }

  @Post(':id/actions')
  addAction(
    @Param('id') id: string,
    @Body() body: { title: string; team: string; owner?: string; dueAt?: string; notes?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.addAction(id, body);
  }

  @Patch('actions/:actionId')
  updateAction(
    @Param('actionId') actionId: string,
    @Body() body: { status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'OVERDUE'; ownerName?: string; dueAt?: string | null; notes?: string },
    @Request() req: any,
  ) {
    if (!LEADS_UP.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת ראש צוות לפחות');
    return this.service.updateAction(actionId, body);
  }

  // Closing an incident is the RCA sign-off gate — restricted to RM/ADMIN,
  // same as CrPlan approval and the version status-machine's manager gates.
  @Post(':id/close')
  close(@Param('id') id: string, @Body() body: { noActionRationale?: string }, @Request() req: any) {
    if (!MANAGERS.includes(req.user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל לילה לסגירת תקלה');
    return this.service.closeIncident(id, req.user.fullName ?? req.user.email ?? req.user.sub, body?.noActionRationale);
  }
}
