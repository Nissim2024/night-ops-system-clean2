import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { QcService, TargetDefectDto } from '../qc/qc.service';
import { TARGET_CR_PATTERN } from '../common/team-columns';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

// Reason a defect was marked "requires special implementation" → which kind
// of derived plan item it becomes, and a sensible default phase for it.
const REASON_TO_ACTION: Record<string, { actionType: string; phase: number } | 'MONITORING'> = {
  'Script':            { actionType: 'הרצת סקריפט', phase: 2 },
  'Data Migration':    { actionType: 'הסבת נתונים', phase: 2 },
  'בדיקת לקוח ראשון':  { actionType: 'בדיקה ידנית', phase: 4 },
  'ניטור מיוחד':       'MONITORING',
  'אחר':               { actionType: 'אחר', phase: 2 },
};

@Injectable()
export class TargetCrService {
  constructor(private qcService: QcService) {}

  private async resolveTeamId(crNumber: string, teamId: string | undefined, user: { sub: string; role: string }): Promise<string> {
    if (MANAGERS.includes(user.role) && teamId) return teamId;
    const membership = await prisma.teamMember.findFirst({ where: { userId: user.sub }, select: { teamId: true } });
    if (!membership) throw new ForbiddenException('לא שויכת לצוות');
    return membership.teamId;
  }

  async getReview(versionId: string, crNumber: string, teamIdParam: string, user: { sub: string; role: string }) {
    const teamId = await this.resolveTeamId(crNumber, teamIdParam, user);
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
    if (!team) throw new NotFoundException('צוות לא נמצא');

    const oracleDefects = await this.qcService.getTargetCrDefects(versionId, crNumber, team.name);

    let review = await prisma.targetCrReview.findUnique({
      where: { versionId_crNumber_teamId: { versionId, crNumber, teamId } },
      include: { defects: true },
    });
    if (!review) {
      review = await prisma.targetCrReview.create({
        data: { versionId, crNumber, teamId },
        include: { defects: true },
      });
    }

    // Ensure a local row exists for every defect Oracle currently returns —
    // new defects added to the CR after the team lead's first visit still show up.
    const existingIds = new Set(review.defects.map(d => d.defectId));
    const missing = oracleDefects.filter(d => !existingIds.has(d.id));
    if (missing.length) {
      await prisma.targetCrDefect.createMany({
        data: missing.map(d => ({ reviewId: review!.id, defectId: d.id, description: d.title })),
        skipDuplicates: true,
      });
      review = await prisma.targetCrReview.findUnique({
        where: { id: review.id },
        include: { defects: true },
      });
    }

    const localByDefectId = new Map(review!.defects.map(d => [d.defectId, d]));
    const defects = oracleDefects.map(od => {
      const local = localByDefectId.get(od.id);
      return {
        id: local?.id ?? null,
        defectId: od.id,
        title: od.title,
        status: od.status,
        severity: od.severity,
        assignedTo: od.assignedTo,
        qaTester: od.qaTester,
        requiresSpecialImplementation: local?.requiresSpecialImplementation ?? false,
        implementationReason: local?.implementationReason ?? null,
        importantToManagement: local?.importantToManagement ?? false,
      };
    });

    return {
      review: {
        id: review!.id,
        gateChecklist1: review!.gateChecklist1,
        gateChecklist2: review!.gateChecklist2,
        gateChecklist3: review!.gateChecklist3,
        approved: review!.approved,
        approvedByName: review!.approvedByName,
        approvedAt: review!.approvedAt,
      },
      teamName: team.name,
      defects,
    };
  }

  // ── Self-scoped: a QA tester's own TARGET CR defects ────────────────────────
  // "Assigned to me" here means: every defect under a TARGET CR I'm actually
  // testing (per QaCycleTask), not a per-defect Oracle ASSIGNED_TO match — that
  // field is free text in "Last, First" order and has no reliable link to our
  // User records, so per-defect matching would silently miss most defects.
  // Reuses getReview per CR, which already resolves the caller's own team via
  // resolveTeamId — a QA tester's TeamMember row naturally scopes this to the
  // QA team's own defect list for that CR.

  // BG_USER_37 (qaTester) is Oracle free text and its exact name order isn't
  // confirmed from real data yet (Oracle is disabled in dev) — likely "Last,
  // First" like other BG_USER_* name fields (e.g. crManager shows "Keynan,
  // Shaul"). Token-set comparison makes this order-independent, so it works
  // whichever way it turns out to be stored.
  private namesLikelyMatch(oracleName: string, fullName: string): boolean {
    if (!oracleName || !fullName) return false;
    const norm = (s: string) => s.toLowerCase().replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
    const aTokens = norm(oracleName).split(' ').filter(Boolean);
    const bTokens = norm(fullName).split(' ').filter(Boolean);
    if (aTokens.length === 0 || bTokens.length === 0 || aTokens.length !== bTokens.length) return false;
    const bSet = new Set(bTokens);
    return aTokens.every(t => bSet.has(t));
  }

  async getMyDefects(versionId: string, user: { sub: string; role: string }) {
    const [tasks, me] = await Promise.all([
      prisma.qaCycleTask.findMany({
        where: { userId: user.sub, isArchived: false, taskType: { not: 'REGRESSION' }, cycle: { workPlan: { versionId } } } as any,
        select: { crNumber: true, crLabel: true },
      }),
      prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } }),
    ]);
    const crLabelByNumber = new Map(tasks.map(t => [t.crNumber, t.crLabel]));
    const targetCrNumbers = Array.from(new Set(
      tasks.filter(t => TARGET_CR_PATTERN.test(t.crLabel ?? t.crNumber)).map(t => t.crNumber),
    ));

    const results: { crNumber: string; crLabel: string | null; teamName: string; defects: any[] }[] = [];
    for (const crNumber of targetCrNumbers) {
      try {
        const r = await this.getReview(versionId, crNumber, undefined as any, user);
        // Inclusion stays CR-based (every defect under a TARGET CR I'm testing) —
        // isMine is a soft, best-effort highlight only, never a filter, since the
        // Oracle field's exact name format isn't confirmed from real data yet.
        const defects = r.defects.map((d: any) => ({ ...d, isMine: this.namesLikelyMatch(d.qaTester, me?.fullName ?? '') }));
        results.push({ crNumber, crLabel: crLabelByNumber.get(crNumber) ?? null, teamName: r.teamName, defects });
      } catch {
        // Skip a CR that fails to resolve (e.g. Oracle unavailable for it right
        // now) rather than failing the whole list for every other CR.
      }
    }
    return results;
  }

  // ── Self-scoped: a QA tester's own defect-reporting stats ───────────────────
  // "Defects I reported" — filtered by Oracle's BG_DETECTED_BY (the person who
  // found/logged the bug), a different field from BG_USER_37/qaTester (TARGET
  // defect assignment) and BG_RESPONSIBLE/assignedTo (team queue). Confirmed
  // with the user (2026-07-24):
  //   - "Fixed_Test" = fixed by dev, waiting for the tester to verify/retest.
  //   - "too few defects" threshold = sum of each assigned CR's own dev-effort
  //     days (VersionCrAssignment.estimateDays), at a rate of 1 expected
  //     defect per dev-day — a CR with no known estimate contributes 0, and if
  //     the total is 0 the warning never fires (nothing to compare against).
  async getMyDefectStats(versionId: string, user: { sub: string; role: string }) {
    const [tasks, me] = await Promise.all([
      prisma.qaCycleTask.findMany({
        where: { userId: user.sub, isArchived: false, taskType: { not: 'REGRESSION' }, cycle: { workPlan: { versionId } } } as any,
        select: { crNumber: true },
      }),
      prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } }),
    ]);
    const crNumbers = Array.from(new Set(tasks.map(t => t.crNumber)));

    let expectedMin = 0;
    if (crNumbers.length > 0) {
      const vcas = await prisma.versionCrAssignment.findMany({
        where: { versionId, crNumber: { in: crNumbers } },
        select: { crNumber: true, estimateDays: true },
      });
      const estimateByCr = new Map<string, number>();
      for (const v of vcas) {
        if (!estimateByCr.has(v.crNumber) && v.estimateDays != null) estimateByCr.set(v.crNumber, v.estimateDays);
      }
      expectedMin = Math.round(Array.from(estimateByCr.values()).reduce((sum, d) => sum + d, 0));
    }

    const allDefects = await this.qcService.getMyReportedDefects(versionId);
    const myName = me?.fullName ?? '';
    const mine = allDefects.filter(d => this.namesLikelyMatch(d.detectedBy, myName));
    const CLOSED_STATUSES = new Set(['Closed', 'Canceled']);
    const opened = mine.length;
    const stillOpen = mine.filter(d => !CLOSED_STATUSES.has(d.status)).length;
    const waitingForMyVerification = mine.filter(d => d.status === 'Fixed_Test').length;

    return {
      opened, stillOpen, waitingForMyVerification, expectedMin,
      tooFew: expectedMin > 0 && opened < expectedMin,
    };
  }

  // Lightweight bulk read for a team's own TARGET-CR list (e.g. TeamLeadProposalView's
  // "done" status per CR) — approval lives on TargetCrReview, entirely separate from
  // CrPlan.submissionStatus, so the regular submitted/approved check never reflects
  // a TARGET CR's real state. No Oracle calls, no row creation — just what already exists.
  async getStatusForTeam(versionId: string, teamId: string): Promise<Record<string, boolean>> {
    const reviews = await prisma.targetCrReview.findMany({
      where: { versionId, teamId },
      select: { crNumber: true, approved: true },
    });
    return Object.fromEntries(reviews.map(r => [r.crNumber, r.approved]));
  }

  // Cross-team rollup for the Consolidated CR Review screen — one row per
  // team that has actually opened this TARGET CR (a team assigned to it but
  // never visited yet simply has no TargetCrReview row and isn't counted here;
  // CrReviewView already shows "not started" per team via the regular CrPlan data).
  async getSummary(versionId: string, crNumber: string) {
    const reviews = await prisma.targetCrReview.findMany({
      where: { versionId, crNumber },
      include: { defects: true, },
    });
    const teams = await prisma.team.findMany({ where: { id: { in: reviews.map(r => r.teamId) } }, select: { id: true, name: true } });
    const teamName = new Map(teams.map(t => [t.id, t.name]));

    const allDefects = reviews.flatMap(r => r.defects);
    return {
      teams: reviews.map(r => ({
        teamId: r.teamId,
        teamName: teamName.get(r.teamId) ?? r.teamId,
        approved: r.approved,
        defectCount: r.defects.length,
        specialCount: r.defects.filter(d => d.requiresSpecialImplementation).length,
        managementCount: r.defects.filter(d => d.importantToManagement).length,
      })),
      totalDefects: allDefects.length,
      totalSpecial: allDefects.filter(d => d.requiresSpecialImplementation).length,
      totalManagement: allDefects.filter(d => d.importantToManagement).length,
    };
  }

  // Version-wide TARGET defect rollup for the version-management overview —
  // hits live Oracle data directly via qcService.getTargetCrDefects (release+
  // team scoped, no CR-number filter — see qc.service.ts), not the locally
  // -synced TargetCrDefect rows used by getSummary above, which only exist
  // for a CR a team lead has actually opened. This way the count is accurate
  // even before anyone has visited a single TARGET CR's gate screen.
  async getVersionTargetDefectSummary(versionId: string) {
    const seen = new Set<string>();
    const byArea = new Map<string, number>();
    // Full TargetDefectDto shape (every BUG column TARGET_CR_DEFECTS_SQL
    // pulls), not just the 5-field subset the old byArea-only view needed —
    // the frontend's column-picker table lets the user choose which of these
    // to actually display.
    const defectList: TargetDefectDto[] = [];

    const addDefects = (defects: TargetDefectDto[]) => {
      for (const d of defects) {
        if (seen.has(d.id)) continue;
        seen.add(d.id);
        const area = d.system?.trim() || 'ללא אזור';
        byArea.set(area, (byArea.get(area) ?? 0) + 1);
        defectList.push({ ...d, system: area });
      }
    };

    const { enabled } = await this.qcService.getStatus();
    if (enabled) {
      // Live Oracle: scope per-team, matching this version's own real team
      // assignments — meaningful because both sides (our teams, QC's
      // BG_RESPONSIBLE) refer to the same real organization.
      const rows = await prisma.versionCrAssignment.findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: { crLabel: true, team: { select: { name: true } } },
      });
      const targetTeamNames = new Set<string>();
      for (const r of rows) {
        if (TARGET_CR_PATTERN.test(r.crLabel ?? '')) targetTeamNames.add(r.team.name);
      }
      for (const teamName of targetTeamNames) {
        addDefects(await this.qcService.getTargetCrDefects(versionId, '', teamName));
      }
    } else {
      // Mock/dev-seed mode: the version's own CR/team assignments are
      // synthetic test data with no real relationship to which real team a
      // real historical defect is assigned to — filtering by team here would
      // throw away almost every genuine release-scoped match (caught live
      // 2026-07-28: 26 real ITv01-2026 defects, only 1 survived the team
      // filter). Just take everything scoped to the release, unfiltered.
      addDefects(await this.qcService.getTargetCrDefects(versionId, ''));
    }

    // "Fixed" = status containing closed/fix (case-insensitive) — covers the
    // common QC status vocabulary (Closed, Fixed, Fixed_Dev, Fixed_Test)
    // without requiring an exact enum match, since BG_USER_04 is free text.
    const fixedCount = defectList.filter(d => /closed|fix/i.test(d.status ?? '')).length;

    return {
      total: seen.size,
      fixedCount,
      byArea: Array.from(byArea.entries())
        .map(([area, count]) => ({ area, count }))
        .sort((a, b) => b.count - a.count),
      defects: defectList,
    };
  }

  async updateGate(reviewId: string, patch: { gateChecklist1?: boolean; gateChecklist2?: boolean; gateChecklist3?: boolean }) {
    return prisma.targetCrReview.update({ where: { id: reviewId }, data: patch });
  }

  async approve(reviewId: string, user: { sub: string; fullName?: string }) {
    const review = await prisma.targetCrReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('לא נמצאה סקירת TARGET CR');
    if (!review.gateChecklist1 || !review.gateChecklist2 || !review.gateChecklist3) {
      throw new BadRequestException('יש לאשר את כל שלושת התנאים לפני אישור ה-CR');
    }
    const approver = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    return prisma.targetCrReview.update({
      where: { id: reviewId },
      data: { approved: true, approvedByName: approver?.fullName ?? null, approvedAt: new Date() },
    });
  }

  async updateDefect(
    defectRowId: string,
    patch: { requiresSpecialImplementation?: boolean; implementationReason?: string | null; importantToManagement?: boolean },
    user: { sub: string; fullName?: string },
  ) {
    const row = await prisma.targetCrDefect.findUnique({ where: { id: defectRowId }, include: { review: true } });
    if (!row) throw new NotFoundException('תקלה לא נמצאה');

    const nextRequires = patch.requiresSpecialImplementation ?? row.requiresSpecialImplementation;
    const nextReason = patch.implementationReason !== undefined ? patch.implementationReason : row.implementationReason;

    // Turning the flag off (or clearing the reason) — remove whatever was derived.
    if (!nextRequires || !nextReason) {
      if (row.derivedActionId) {
        const action = await prisma.crPlanAction.findUnique({ where: { id: row.derivedActionId } });
        if (action?.derivedProposalId) {
          await prisma.taskProposal.deleteMany({ where: { id: action.derivedProposalId, usedInTaskId: null } });
        }
        await prisma.crPlanAction.deleteMany({ where: { id: row.derivedActionId } });
      }
      if (row.derivedMonitoringPointId) {
        const point = await prisma.crPlanMonitoringPoint.findUnique({ where: { id: row.derivedMonitoringPointId } });
        if (point?.derivedProposalId) {
          await prisma.taskProposal.deleteMany({ where: { id: point.derivedProposalId, usedInTaskId: null } });
        }
        await prisma.crPlanMonitoringPoint.deleteMany({ where: { id: row.derivedMonitoringPointId } });
      }
      return prisma.targetCrDefect.update({
        where: { id: defectRowId },
        data: {
          requiresSpecialImplementation: nextRequires,
          implementationReason: nextReason ?? null,
          importantToManagement: patch.importantToManagement ?? row.importantToManagement,
          derivedActionId: null,
          derivedMonitoringPointId: null,
        },
      });
    }

    // Turning the flag on with a reason — derive (or refresh) the plan item.
    if (nextRequires && nextReason && !row.derivedActionId && !row.derivedMonitoringPointId) {
      const crPlan = await this.findOrCreateCrPlan(row.review.versionId, row.review.crNumber, row.review.teamId);
      const mapping = REASON_TO_ACTION[nextReason] ?? REASON_TO_ACTION['אחר'];
      const description = `${nextReason} בעקבות DEF-${row.defectId}${row.description ? `: ${row.description}` : ''}`;

      if (mapping === 'MONITORING') {
        const point = await prisma.crPlanMonitoringPoint.create({
          data: { crPlanId: crPlan.id, type: 'Other', name: `DEF-${row.defectId}`, note: description, phase: 4 },
        });
        return prisma.targetCrDefect.update({
          where: { id: defectRowId },
          data: {
            requiresSpecialImplementation: true, implementationReason: nextReason,
            importantToManagement: patch.importantToManagement ?? row.importantToManagement,
            derivedMonitoringPointId: point.id,
          },
        });
      }
      const action = await prisma.crPlanAction.create({
        data: { crPlanId: crPlan.id, actionType: mapping.actionType, description, phase: mapping.phase },
      });
      return prisma.targetCrDefect.update({
        where: { id: defectRowId },
        data: {
          requiresSpecialImplementation: true, implementationReason: nextReason,
          importantToManagement: patch.importantToManagement ?? row.importantToManagement,
          derivedActionId: action.id,
        },
      });
    }

    // Only importantToManagement changed — no derivation to touch.
    return prisma.targetCrDefect.update({
      where: { id: defectRowId },
      data: { importantToManagement: patch.importantToManagement ?? row.importantToManagement },
    });
  }

  private async findOrCreateCrPlan(versionId: string, crNumber: string, teamId: string) {
    const existing = await prisma.crPlan.findFirst({ where: { versionId, crNumber, teamId } });
    if (existing) return existing;
    return prisma.crPlan.create({ data: { versionId, crNumber, teamId, crType: 'TARGET' } });
  }
}
