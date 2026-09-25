import { Controller, Get, Post, Patch, Query, Param, Body, Request, Res, UseGuards, ForbiddenException, BadRequestException, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QcService } from './qc.service';
import { QcRestService } from './qc-rest.service';
import { PermissionsService } from '../permissions/permissions.service';

function requireRole(req: any, roles: string[], msg = 'אין הרשאה לבצע פעולה זו') {
  if (!roles.includes(req.user.role)) throw new ForbiddenException(msg);
}

@Controller('qc')
@UseGuards(JwtGuard)
export class QcController {
  constructor(
    private readonly qcService: QcService,
    private readonly qcRestService: QcRestService,
    private readonly permissionsService: PermissionsService,
  ) {}

  // Gates the QC REST write-back tool — ADMIN always passes; any other role
  // needs the runtime-grantable 'action:qc_write' permission (Admin Panel >
  // permissions), replacing the earlier hardcoded ADMIN-only check (spec
  // confirmed 2026-09-02).
  private async requireQcWrite(req: any) {
    const allowed = await this.permissionsService.hasPermission(req.user.role, 'action:qc_write');
    if (!allowed) throw new ForbiddenException('אין לך הרשאה להשתמש בכלי הכתיבה ל-QC — פנה למנהל מערכת');
  }

  // Split-out permissions (docs/spec-defects-module.md §9, 2026-09-18) —
  // separate blast radius from action:qc_write (status/comment only).
  private async requirePermission(req: any, key: string, msg: string) {
    const allowed = await this.permissionsService.hasPermission(req.user.role, key);
    if (!allowed) throw new ForbiddenException(msg);
  }

  @Get('status')
  getStatus() {
    return this.qcService.getStatus();
  }

  @Get('test-coverage')
  getTestCoverage(@Query('versionId') versionId: string, @Query('cycle') cycle?: 'REHEARSAL' | 'GO_LIVE') {
    return this.qcService.getTestCoverage(versionId, cycle);
  }

  @Get('defects')
  getDefects(@Query('versionId') versionId: string, @Query('cycle') cycle?: 'REHEARSAL' | 'GO_LIVE') {
    return this.qcService.getDefects(versionId, cycle);
  }

  // `relId` accepted as an alternative to `versionId` (2026-09-23,
  // fixes-batch item I/J) — Quality Hub releases with no local Version row
  // (everything older than this app) only ever have a relId, same relId-
  // direct pattern as /qc/defects-by-relid. `severity` is an optional
  // post-filter (KpiDetailView's per-severity KPI cards) — kept here rather
  // than in the service since it's a simple, generic list narrow, not a
  // KPI-specific rule like kpiDefectFilters.
  @Get('defects-by-kpi')
  async getDefectsForKpi(
    @Query('versionId') versionId: string, @Query('relId') relId: string,
    @Query('kpiName') kpiName: string, @Query('severity') severity?: string,
  ) {
    const defects = relId
      ? await this.qcService.getDefectsForKpiByRelId(Number(relId), kpiName)
      : await this.qcService.getDefectsForKpi(versionId, kpiName);
    return severity ? defects.filter(d => d.severity === severity) : defects;
  }

  @Get('cr-defect-indicators')
  getCrDefectIndicators(@Query('versionId') versionId: string, @Query('crNumber') crNumber: string, @Query('teamName') teamName?: string) {
    return this.qcService.getCrDefectIndicators(versionId, crNumber, teamName);
  }

  @Get('bug-dashboard')
  getBugDashboard(@Query('versionId') versionId: string) {
    return this.qcService.getBugDashboard(versionId);
  }

  // System-wide dashboard for the general Defects module (2026-09-22) — every
  // defect in the QC instance, all statuses, no version/release scope. Rows
  // ARE scoped by caller role (access-control spec 2026-09-25): TEAM_LEAD sees
  // their team's Responsibility, EMPLOYEE sees only defects assigned to them —
  // see QcService.resolveDefectScope().
  @Get('all-defects-dashboard')
  getAllDefectsDashboard(@Request() req: any) {
    return this.qcService.getAllDefectsDashboard(req.user);
  }

  @Get('all-defects-filtered')
  getAllDefectsFiltered(@Query('field') field: string, @Query('value') value: string, @Request() req: any) {
    return this.qcService.getAllDefectsFiltered(field, value, req.user);
  }

  // relId-direct (2026-09-20) — QC-only historical releases have no local
  // Version to key off of; mirrors defects-by-relid's bypass of the
  // Version-scoped path entirely.
  @Get('bug-dashboard-by-rel')
  getBugDashboardByRel(@Query('relId') relId: string) {
    return this.qcService.getBugDashboardByRelId(Number(relId));
  }

  @Get('open-production-defects-history')
  getOpenProductionDefectsHistory() {
    return this.qcService.getOpenProductionDefectsHistory();
  }

  @Get('new-vs-target-defects')
  getNewVsTargetDefects() {
    return this.qcService.getNewVsTargetDefects();
  }

  @Get('defect-status-history')
  getDefectStatusHistory(@Query('defectId') defectId: string) {
    return this.qcService.getDefectStatusHistory(defectId);
  }

  @Get('defect-field-history')
  getDefectFieldHistory(@Query('defectId') defectId: string) {
    return this.qcService.getDefectFieldHistory(defectId);
  }

  @Get('open-prod-defect-detail/:defectId')
  getOpenProdDefectDetail(@Param('defectId') defectId: string) {
    return this.qcService.getDefectFullDetail(defectId);
  }

  @Get('open-prod-defects-config')
  getOpenProdDefectsConfig() {
    return this.qcService.getOpenProdDefectsConfig();
  }

  @Patch('open-prod-defects-config')
  setOpenProdDefectsConfig(@Body() body: { tableColumns?: string[]; detailFields?: string[] }, @Request() req: any) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לעדכן את תצורת מסך תקלות הייצור');
    return this.qcService.setOpenProdDefectsConfig(body);
  }

  // `versionId` optional (2026-09-23) — scopes the Oracle lookup to this
  // specific release, tried before the unscoped fallback (see
  // getCrTestSummary's own comment for why).
  @Get('cr-test-summary')
  getCrTestSummary(@Query('crNumber') crNumber: string, @Query('versionId') versionId?: string) {
    return this.qcService.getCrTestSummary(crNumber, versionId);
  }

  @Get('cr-items')
  getCrItems(
    @Query('releaseId') releaseId?: string,
    @Query('versionId') versionId?: string,
  ) {
    return this.qcService.getCrItems(releaseId, versionId);
  }

  // ── QC REST write-back tool (spec confirmed 2026-08-30, per-user auth
  // 2026-09-02): writes to real production QC, not the read-only Oracle
  // connection every other endpoint in this controller uses. Every call
  // authenticates as the CALLING USER's own QC identity (qcLogin + empty
  // password) — see qc-rest.service.ts for why, and why there's no fallback
  // to a shared account.
  @Get('rest-test/defect/:id')
  async previewRestDefect(@Request() req: any, @Param('id') id: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.previewDefect(id, req.user.sub);
  }

  @Get('rest-test/defect/:id/fields')
  async listAllRestFields(@Request() req: any, @Param('id') id: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.listAllFields(id, req.user.sub);
  }

  @Post('rest-test/defect/:id/append-note')
  async appendRestNote(@Request() req: any, @Param('id') id: string, @Body('note') note: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.appendComment(id, note, req.user.sub);
  }

  @Patch('rest-test/defect/:id/status')
  async updateRestStatus(@Request() req: any, @Param('id') id: string, @Body('status') status: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.updateStatus(id, status, req.user.sub);
  }

  // ── Stage-0 de-risk (2026-09-15): can this QC instance's REST API create
  // Release + Release Cycle at all? Both probes are read-only.
  @Get('rest-test/entity-fields/:type')
  async probeEntityFields(@Request() req: any, @Param('type') type: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.probeEntityFields(type, req.user.sub);
  }

  // Picklist values (2026-09-19) — read-only, same risk level as the field-
  // names probe above; see qc-rest.service.ts::probeProjectLists.
  @Get('rest-test/lists')
  async probeProjectLists(@Request() req: any) {
    await this.requireQcWrite(req);
    return this.qcRestService.probeProjectLists(req.user.sub);
  }

  // Picklist cache refresh + read (2026-09-23, fixes-batch A.6) — the sync
  // is an explicit admin action (calls QC live, so ADMIN-gated like the other
  // rest-test tools); the read is a plain cache lookup any caller with
  // action:qc_defect_edit_extended can hit (same gate as everything else on
  // the defect edit form).
  @Post('sync-picklists')
  async syncPicklists(@Request() req: any) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לרענן רשימות ערכים מ-QC');
    return this.qcRestService.syncQcPicklists(req.user.sub);
  }

  @Get('defect-field-picklists')
  async getDefectFieldPicklists(@Request() req: any) {
    await this.requirePermission(req, 'action:qc_defect_edit_extended', 'אין לך הרשאה לערוך שדות תקלה מורחבים — פנה למנהל מערכת');
    return this.qcRestService.getDefectFieldPicklists();
  }

  // Site Administration probe (2026-09-23) — ADMIN-only, not the general
  // action:qc_write gate: this authenticates with the shared QC_ADMIN_
  // USERNAME/PASSWORD credential rather than the caller's own qcLogin, so
  // access to it is a system-administration decision, not a QC-write-
  // permission one. Read-only; see qc-rest.service.ts::probeSiteAdmin.
  @Get('rest-test/site-admin/:segment')
  async probeSiteAdmin(@Request() req: any, @Param('segment') segment: string) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לבדוק Site Administration מול QC');
    return this.qcRestService.probeSiteAdmin(segment);
  }

  @Get('rest-test/releases')
  async listRestReleases(@Request() req: any) {
    await this.requireQcWrite(req);
    return this.qcRestService.listReleasesRest(req.user.sub);
  }

  @Get('rest-test/release-folders')
  async listRestReleaseFolders(@Request() req: any, @Query('q') q?: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.listReleaseFoldersRest(req.user.sub, q);
  }

  // ── Defect "lab" (2026-09-16) — generic create/edit, ADMIN-only. Hard role
  // gate (not just action:qc_write, which any role can be granted) since this
  // writes arbitrary fields / creates real defects in production QC with no
  // allowlist — a deliberately wider blast radius than the narrow tools above,
  // meant for end-to-end discovery before the real Create/Edit screens are
  // built (docs/spec-defects-module.md).
  @Patch('rest-test/defect/:id/fields')
  async updateRestFields(@Request() req: any, @Param('id') id: string, @Body('fields') fields: Record<string, string>) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לערוך שדות מכלי המעבדה');
    return this.qcRestService.updateFieldsRaw(id, fields, req.user.sub);
  }

  @Post('rest-test/defect')
  async createRestDefect(@Request() req: any, @Body('fields') fields: Record<string, string>) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול ליצור תקלה חדשה מכלי המעבדה');
    return this.qcRestService.createDefectRaw(fields, req.user.sub);
  }

  // Stage-0 final test (2026-09-16): permission + entity-readability already
  // confirmed manually — this is the one-shot POST test to settle whether
  // release creation is supported via REST at all. ADMIN-only, same as the
  // defect lab above.
  @Post('rest-test/release')
  async createRestRelease(@Request() req: any, @Body('fields') fields: Record<string, string>) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול ליצור Release מכלי המעבדה');
    return this.qcRestService.createReleaseRaw(fields, req.user.sub);
  }

  @Post('rest-test/release-cycle')
  async createRestReleaseCycle(@Request() req: any, @Body('fields') fields: Record<string, string>) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול ליצור Release Cycle מכלי המעבדה');
    return this.qcRestService.createReleaseCycleRaw(fields, req.user.sub);
  }

  // Production orchestration test (2026-09-18) — the real create-Release+
  // Cycles flow with auto-resolved parent folder, still only reachable
  // through this ADMIN-gated lab endpoint until confirmed working live.
  @Post('rest-test/release-orchestration')
  async createReleaseOrchestration(@Request() req: any, @Body() body: {
    releaseName: string; startDate: string; endDate: string; productionDate?: string; year: string;
    cycles: { name: string; startDate: string; endDate: string; environment?: string; thresholdHigh?: string; thresholdMedium?: string; thresholdLow?: string }[];
  }) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול להריץ את בדיקת ה-orchestration');
    return this.qcRestService.createReleaseWithCycles(body, req.user.sub);
  }

  // Gap-fill lab routes (2026-09-18) — read cycles under an existing release,
  // and update an already-created release/cycle's dates+QG. Same ADMIN-only
  // gate as the other structural (non-defect) lab tools above.
  @Get('rest-test/release/:id/cycles')
  async listRestReleaseCycles(@Request() req: any, @Param('id') id: string) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לקרוא סבבים מכלי המעבדה');
    return this.qcRestService.listReleaseCyclesRest(id, req.user.sub);
  }

  @Patch('rest-test/release/:id')
  async updateRestRelease(@Request() req: any, @Param('id') id: string, @Body('fields') fields: Record<string, string>) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לעדכן Release מכלי המעבדה');
    return this.qcRestService.updateReleaseRaw(id, fields, req.user.sub);
  }

  @Patch('rest-test/release-cycle/:id')
  async updateRestReleaseCycle(@Request() req: any, @Param('id') id: string, @Body('fields') fields: Record<string, string>) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול לעדכן Release Cycle מכלי המעבדה');
    return this.qcRestService.updateReleaseCycleRaw(id, fields, req.user.sub);
  }

  // ── Production endpoints (2026-09-18, spec-qc-full-integration.md §7.4) —
  // first real (non-`rest-test`) write paths. Gated the same way as the lab
  // (action:qc_write) plus their own SystemParam kill-switch
  // (QC_REST_RELEASE_PUBLISH_ENABLED, checked inside the service) so a bad
  // assumption about the real QC schema can be switched off without a
  // rollback. Intended caller: an explicit confirm-modal in the QA work-plan
  // approval flow / version screen — never triggered silently.
  @Post('releases/version/:versionId/publish')
  async publishVersionRelease(@Request() req: any, @Param('versionId') versionId: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.publishVersionRelease(versionId, req.user.sub);
  }

  @Post('releases/version/:versionId/sync-dates')
  async syncVersionReleaseDates(@Request() req: any, @Param('versionId') versionId: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.syncVersionReleaseDates(versionId, req.user.sub);
  }

  // ── REQ lab tools (2026-09-18) — same ADMIN-only gate as the other
  // structural creation lab tools, since this can create real folders/leaves
  // in production QC with no allowlist.
  @Post('rest-test/folder')
  async findOrCreateRestFolder(@Request() req: any, @Body() body: { collection: string; entityType: string; name: string; parentId: string | null }) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול ליצור תיקייה מכלי המעבדה');
    return this.qcRestService.findOrCreateFolder(body.collection, body.entityType, body.name, body.parentId, req.user.sub);
  }

  @Post('rest-test/requirement')
  async createRestRequirement(@Request() req: any, @Body() body: { fields: Record<string, string>; refFields?: Record<string, { id: string; label: string }> }) {
    requireRole(req, ['ADMIN'], 'רק מנהל מערכת יכול ליצור Requirement מכלי המעבדה');
    return this.qcRestService.createRequirementRaw(body.fields, body.refFields ?? {}, req.user.sub);
  }

  // ── REQ production endpoints ──────────────────────────────────────────
  @Post('requirements/assignment/:assignmentId/publish')
  async publishCrRequirement(@Request() req: any, @Param('assignmentId') assignmentId: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.publishCrRequirement(assignmentId, req.user.sub);
  }

  @Post('requirements/version/:versionId/publish-pending')
  async publishPendingReqs(@Request() req: any, @Param('versionId') versionId: string) {
    await this.requireQcWrite(req);
    return this.qcRestService.publishPendingReqsForVersion(versionId, req.user.sub);
  }

  // Bulk status update (§11, lowest priority) — same action:qc_write gate as
  // the single-defect status update it wraps (not the create/edit-extended
  // permissions, since this doesn't touch new fields, just loops the
  // existing status action).
  @Post('defects/bulk-status')
  async bulkUpdateDefectStatus(@Request() req: any, @Body() body: { defectIds: string[]; newStatus: string }) {
    await this.requireQcWrite(req);
    return this.qcRestService.bulkUpdateStatus(body.defectIds, body.newStatus, req.user.sub);
  }

  // ── Defects module (2026-09-18, docs/spec-defects-module.md) — clean
  // production namespace (§10), separate from /qc/rest-test/*. Each gated by
  // its own split-out permission (§9), not the broad action:qc_write.

  // Tier 2 — the 6 "safe" fields (§6), business keys translated through
  // SystemParam-configured REST names (see updateDefectTier2Fields's own
  // comment) — refuses per-field while any mapping is still unconfigured,
  // never guesses.
  @Patch('defects/:id/fields')
  async updateDefectFields(@Request() req: any, @Param('id') id: string, @Body('fields') fields: Record<string, string>) {
    await this.requirePermission(req, 'action:qc_defect_edit_extended', 'אין לך הרשאה לערוך שדות תקלה מורחבים — פנה למנהל מערכת');
    return this.qcRestService.updateDefectTier2Fields(id, fields, req.user.sub);
  }

  // Reference-field counterpart (2026-09-23, fixes-batch A.5) — Detected in
  // Release/Cycle, which need a real QC id+label pair, not just a string.
  @Patch('defects/:id/ref-fields')
  async updateDefectRefFields(@Request() req: any, @Param('id') id: string, @Body('refFields') refFields: Record<string, { id: string; label: string }>) {
    await this.requirePermission(req, 'action:qc_defect_edit_extended', 'אין לך הרשאה לערוך שדות תקלה מורחבים — פנה למנהל מערכת');
    return this.qcRestService.updateDefectTier2RefFields(id, refFields, req.user.sub);
  }

  // Single source of truth for the detail screen's "which fields can I offer
  // double-click editing on" (2026-09-23, fixes-batch A.5) — same permission
  // as the write endpoints above, since there's no point advertising edit
  // affordances to someone who can't actually save them.
  @Get('defect-editable-fields')
  async getDefectEditableFields(@Request() req: any) {
    await this.requirePermission(req, 'action:qc_defect_edit_extended', 'אין לך הרשאה לערוך שדות תקלה מורחבים — פנה למנהל מערכת');
    return this.qcRestService.getEditableDefectFieldKeys();
  }

  // Defect creation (§5), permission-gated for "every QA" instead of
  // ADMIN-only. 2026-09-20: the frontend now sends `title` + the 6 mapped
  // Tier2 business fields + 2 reference-type fields (Target Release/Detected
  // Cycle, same discover-then-configure pattern as editing) instead of only
  // raw REST field names — `createDefectWithFields` does the
  // business-key→REST-name translation. `fields` (legacy shape: raw REST
  // names only) is kept for backward compat with the admin lab / any caller
  // that still wants the fully generic path.
  @Post('defects')
  async createDefect(
    @Request() req: any,
    @Body('title') title?: string,
    @Body('businessFields') businessFields?: Record<string, string>,
    @Body('businessRefFields') businessRefFields?: Record<string, { id: string; label: string }>,
    @Body('rawFields') rawFields?: Record<string, string>,
    @Body('fields') legacyFields?: Record<string, string>,
  ) {
    await this.requirePermission(req, 'action:qc_defect_create', 'אין לך הרשאה לפתוח תקלה חדשה ב-QC — פנה למנהל מערכת');
    if (title) {
      return this.qcRestService.createDefectWithFields(title, businessFields ?? {}, businessRefFields ?? {}, rawFields ?? {}, req.user.sub);
    }
    return this.qcRestService.createDefectRaw(legacyFields ?? {}, req.user.sub);
  }

  // Historical QC releases browse (2026-09-18) — defects for a QcRelease
  // that has no local Version at all (the whole point of browsing releases
  // that predate this tool), keyed directly by the real Oracle relId
  // instead of a versionId.
  @Get('defects-by-relid')
  getDefectsByRelId(@Query('relId') relId: string) {
    return this.qcService.getDefectsByRelId(Number(relId));
  }

  // Real workflow-aware next-status options (§4) — resolved from the acting
  // user's team(s) → Team.qcGroupName → the transcribed real QC transition
  // rules. No permission gate beyond being logged in: this only reveals
  // which statuses are reachable, it doesn't write anything.
  @Get('defects/allowed-transitions')
  getAllowedStatusTransitions(@Request() req: any, @Query('currentStatus') currentStatus: string) {
    return this.qcService.getAllowedStatusTransitions(req.user.sub, currentStatus ?? '');
  }

  // ── Defect attachments (spec confirmed 2026-09-03) — read-only, so no
  // action:qc_write gate: any authenticated user with a linked qcLogin can
  // view/download whatever their own QC account is allowed to see (access
  // control lives in QC itself, same principle as the write-back tool).
  @Get('defect/:id/attachments')
  listAttachments(@Request() req: any, @Param('id') id: string) {
    return this.qcRestService.listAttachments(id, req.user.sub);
  }

  @Get('defect/:id/attachments/:fileName/download')
  async downloadAttachment(
    @Request() req: any,
    @Param('id') id: string,
    @Param('fileName') fileName: string,
    @Res() res: Response,
  ) {
    const { data, contentType } = await this.qcRestService.downloadAttachment(id, fileName, req.user.sub);
    const ascii = fileName.replace(/[^\x20-\x7E]/g, '_');
    const encoded = encodeURIComponent(fileName);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encoded}`,
    });
    res.send(data);
  }

  // Upload (2026-09-22, user request: "חסר אפשרות לצרף קבצים" in the
  // create-defect form). Gated by the same permission as opening a new
  // defect — reusable against ANY defect id, so this also unlocks
  // attaching a file to an EXISTING defect later without further backend
  // work, even though today's ask is specifically the create form.
  @Post('defect/:id/attachments')
  @UseInterceptors(FileInterceptor('file'))
  async uploadAttachment(
    @Request() req: any,
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.requirePermission(req, 'action:qc_defect_create', 'אין לך הרשאה לצרף קבצים לתקלה — פנה למנהל מערכת');
    if (!file) throw new BadRequestException('לא התקבל קובץ');
    return this.qcRestService.uploadAttachment(id, file.originalname, file.buffer, file.mimetype, req.user.sub);
  }
}
