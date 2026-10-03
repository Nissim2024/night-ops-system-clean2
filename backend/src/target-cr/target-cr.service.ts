import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { QcService, TargetDefectDto, getQcUserDirectory } from '../qc/qc.service';
import { CrPlansService } from '../cr-plans/cr-plans.service';
import { TARGET_CR_PATTERN } from '../common/team-columns';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@Injectable()
export class TargetCrService {
  constructor(private qcService: QcService, private crPlansService: CrPlansService) {}

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
  // defect assignment) and BG_RESPONSIBLE/assignedTo (the person the fix is
  // assigned to — the handling team is BG_USER_03/responsibility). Confirmed
  // with the user (2026-07-24):
  //   - "Fixed_Test" = fixed by dev, waiting for the tester to verify/retest.
  //   - "too few defects" threshold = sum of each assigned CR's own dev-effort
  //     days (VersionCrAssignment.estimateDays), at a rate of 1 expected
  //     defect per dev-day — a CR with no known estimate contributes 0, and if
  //     the total is 0 the warning never fires (nothing to compare against).
  //
  // Two more personal alerts added 2026-09-29 (role-by-role home-page review,
  // tester questions): underCoveredCrs and staleVerifications. Both reuse
  // data this method already fetches (crNumbers, estimateByCr, mine) rather
  // than adding new round-trips.
  async getMyDefectStats(versionId: string, user: { sub: string; role: string }) {
    const [tasks, me] = await Promise.all([
      prisma.qaCycleTask.findMany({
        where: { userId: user.sub, isArchived: false, taskType: { not: 'REGRESSION' }, cycle: { workPlan: { versionId } } } as any,
        select: { crNumber: true },
      }),
      prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } }),
    ]);
    const crNumbers = Array.from(new Set(tasks.map(t => t.crNumber)));

    const estimateByCr = new Map<string, number>();
    if (crNumbers.length > 0) {
      const vcas = await prisma.versionCrAssignment.findMany({
        where: { versionId, crNumber: { in: crNumbers } },
        select: { crNumber: true, estimateDays: true },
      });
      for (const v of vcas) {
        if (!estimateByCr.has(v.crNumber) && v.estimateDays != null) estimateByCr.set(v.crNumber, v.estimateDays);
      }
    }
    const expectedMin = Math.round(Array.from(estimateByCr.values()).reduce((sum, d) => sum + d, 0));

    // Scenario-coverage check (spec 2026-09-29, user's own words: "לבדוק את
    // מספר הימים שהושקעו בפיתוח CR... ולראות אם כמות התרחישים שנכתבו עבורו
    // משקפים התייחסות ראויה") — expected minimum scenario count per CR is
    // its dev-effort days × SCENARIOS_PER_DEV_DAY (2, user-confirmed
    // threshold), compared against the real written-scenario count from
    // getCrCoverage (QC_REQUIRMENTS_COVERAGE's per-CR "total"). A CR with no
    // known estimate is skipped — nothing to compare against, same
    // "unknown ≠ violation" rule as expectedMin above.
    const SCENARIOS_PER_DEV_DAY = 2;
    const underCoveredCrs: { crNumber: string; crLabel: string; scenarioCount: number; expectedMinScenarios: number; devDays: number }[] = [];
    if (crNumbers.length > 0) {
      const coverage = await this.qcService.getCrCoverage(crNumbers, versionId).catch(() => [] as { crNumber: string; crTitle: string; total: number }[]);
      const scenarioCountByCr = new Map<string, number>();
      const labelByCr = new Map<string, string>();
      for (const c of coverage) {
        scenarioCountByCr.set(c.crNumber, (scenarioCountByCr.get(c.crNumber) ?? 0) + c.total);
        if (!labelByCr.has(c.crNumber)) labelByCr.set(c.crNumber, c.crTitle);
      }
      for (const [crNumber, devDays] of estimateByCr) {
        if (devDays <= 0) continue;
        const expectedMinScenarios = Math.round(devDays * SCENARIOS_PER_DEV_DAY);
        const scenarioCount = scenarioCountByCr.get(crNumber) ?? 0;
        if (scenarioCount < expectedMinScenarios) {
          underCoveredCrs.push({ crNumber, crLabel: labelByCr.get(crNumber) ?? '', scenarioCount, expectedMinScenarios, devDays });
        }
      }
    }

    const allDefects = await this.qcService.getMyReportedDefects(versionId);
    const myName = me?.fullName ?? '';
    const mine = allDefects.filter(d => this.namesLikelyMatch(d.detectedBy, myName));
    const CLOSED_STATUSES = new Set(['Closed', 'Canceled']);
    const opened = mine.length;
    const stillOpen = mine.filter(d => !CLOSED_STATUSES.has(d.status)).length;
    const waitingForMyVerification = mine.filter(d => d.status === 'Fixed_Test').length;

    // Stale-verification alert (spec 2026-09-29, user-confirmed thresholds):
    // Show Stopper defects sitting in Fixed_Test over 1 day, everything else
    // over 2 days. BG_VTS ("modified") is a proxy for "when it entered
    // Fixed_Test" — see ReportedDefectDto's own comment for why there's no
    // real state-transition timestamp to use instead.
    const STALE_VERIFICATION_THRESHOLD_DAYS: Record<string, number> = { 'Show Stopper': 1 };
    const DEFAULT_STALE_THRESHOLD_DAYS = 2;
    const now = Date.now();
    const staleVerifications = mine
      .filter(d => d.status === 'Fixed_Test' && d.modified)
      .map(d => {
        const daysWaiting = Math.floor((now - new Date(d.modified as string).getTime()) / 86400000);
        const threshold = STALE_VERIFICATION_THRESHOLD_DAYS[d.severity] ?? DEFAULT_STALE_THRESHOLD_DAYS;
        return { id: d.id, severity: d.severity, daysWaiting, threshold };
      })
      .filter(d => d.daysWaiting >= d.threshold)
      .sort((a, b) => b.daysWaiting - a.daysWaiting);

    return {
      opened, stillOpen, waitingForMyVerification, expectedMin,
      tooFew: expectedMin > 0 && opened < expectedMin,
      underCoveredCrs,
      staleVerifications,
    };
  }

  // ── Raw defect list for a home-page stat-tile drill-down ────────────────────
  // Backs DefectDrilldownModal's `endpoint` mode from EmployeeHomeView — same
  // "mine" resolution as getMyDefectStats above (kept as a second Oracle call
  // rather than a shared cache: this only runs on an explicit user click, and
  // duplicating the ~20-line filter is simpler than threading a shared result
  // through two independently-triggered HTTP requests).
  async getMyDefectsList(
    versionId: string,
    bucket: 'opened' | 'stillOpen' | 'waitingForVerification',
    user: { sub: string; role: string },
  ) {
    const me = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    const allDefects = await this.qcService.getMyReportedDefects(versionId);
    const myName = me?.fullName ?? '';
    const mine = allDefects.filter(d => this.namesLikelyMatch(d.detectedBy, myName));
    const CLOSED_STATUSES = new Set(['Closed', 'Canceled']);

    let filtered = mine;
    if (bucket === 'stillOpen') filtered = mine.filter(d => !CLOSED_STATUSES.has(d.status));
    else if (bucket === 'waitingForVerification') filtered = mine.filter(d => d.status === 'Fixed_Test');

    return filtered.map(d => ({
      id: d.id, title: d.title, severity: d.severity, status: d.status,
      assignedTo: d.assignedTo, discoveryDate: d.discoveryDate,
    }));
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

    // No team filter, live Oracle or mock alike: this is a version-wide
    // rollup, scoped only by release — not per-team. An earlier version of
    // this tried scoping live Oracle results by matching this version's own
    // team assignments against BG_RESPONSIBLE/ASSIGNED_TO, on the assumption
    // that a real production org would line up cleanly. It didn't: caught
    // live in production on ITv01-2026, 26 real defects collapsed to 2 once
    // that filter ran — the same failure mode already documented (and fixed)
    // for mock mode below, just never applied to the live branch. Per-team
    // scoping still exists where it belongs: the Consolidated CR Review
    // screen (getSummary, TargetCrReview) is genuinely team-scoped by design.
    addDefects(await this.qcService.getTargetCrDefects(versionId, ''));

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
      qcUserNames: await this.resolveQcUserNames(defectList),
    };
  }

  // TARGET-defect person fields (assignedTo, qaTester, detectedBy, etc.) hold
  // raw QC login strings (BG_RESPONSIBLE/BG_USER_37/BG_DETECTED_BY — e.g.
  // "guyp"), not "First Last" names — QC.USERS.USER_NAME synced into
  // User.qcLogin by syncQcUsers(). Lowercased-login → fullName map so the
  // frontend can render a real name/avatar instead of the raw login, falling
  // back to the login itself when no User has that qcLogin synced (spec
  // confirmed 2026-08-30).
  private async resolveQcUserNames(defects: TargetDefectDto[]): Promise<Record<string, string>> {
    const PERSON_FIELDS: (keyof TargetDefectDto)[] = [
      'assignedTo', 'qaTester', 'detectedBy', 'closedBy', 'defectResponsible', 'escDefectResponsible', 'vendorAssignTo',
    ];
    const logins = new Set<string>();
    for (const d of defects) {
      for (const f of PERSON_FIELDS) {
        const v = (d[f] as string | undefined)?.trim();
        if (v) logins.add(v.toLowerCase());
      }
    }
    if (logins.size === 0) return {};
    const [users, directory] = await Promise.all([
      prisma.user.findMany({
        where: { qcLogin: { in: Array.from(logins), mode: 'insensitive' } },
        select: { qcLogin: true, fullName: true },
      }),
      getQcUserDirectory(),
    ]);
    // QC's own user directory covers people with no DeployCenter account
    // (2026-10-03); a DeployCenter account's name still wins.
    const map: Record<string, string> = {};
    for (const login of logins) {
      const name = directory.get(login);
      if (name) map[login] = name;
    }
    for (const u of users) {
      if (u.qcLogin) map[u.qcLogin.toLowerCase()] = u.fullName;
    }
    return map;
  }

  async updateGate(reviewId: string, patch: { gateChecklist1?: boolean; gateChecklist2?: boolean; gateChecklist3?: boolean }) {
    return prisma.targetCrReview.update({ where: { id: reviewId }, data: patch });
  }

  async approve(reviewId: string, user: { sub: string; role: string; fullName?: string }) {
    const review = await prisma.targetCrReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('לא נמצאה סקירת TARGET CR');
    if (!review.gateChecklist1 || !review.gateChecklist2 || !review.gateChecklist3) {
      throw new BadRequestException('יש לאשר את כל שלושת התנאים לפני אישור ה-CR');
    }

    // Materialize real TaskProposals from whatever Section-2 actions the lead
    // built up for this CR's defects — same submitPlan a regular CR's own
    // "✓ אשר תוכנית CR" runs, since TARGET has no separate submit step of its
    // own; approving the review IS the commit point. Skipped entirely when no
    // defect was ever marked "requires special implementation" (no plan to submit).
    const plan = await prisma.crPlan.findFirst({ where: { versionId: review.versionId, crNumber: review.crNumber, teamId: review.teamId } });
    if (plan) await this.crPlansService.submitPlan(plan.id, user);

    const approver = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    return prisma.targetCrReview.update({
      where: { id: reviewId },
      data: { approved: true, approvedByName: approver?.fullName ?? null, approvedAt: new Date() },
    });
  }

  async updateDefect(
    defectRowId: string,
    patch: { requiresSpecialImplementation?: boolean; importantToManagement?: boolean },
  ) {
    const row = await prisma.targetCrDefect.findUnique({ where: { id: defectRowId } });
    if (!row) throw new NotFoundException('תקלה לא נמצאה');

    // The linked CrPlanAction itself (type/description/phase/owner/etc.) is
    // created and edited entirely through the regular CR-plan save flow
    // (POST /cr-plans/version/:id, Section 2 of that CR's own plan) — this
    // endpoint only tracks the checkbox. Unchecking clears derivedActionId
    // defensively; the actual row gets deleted server-side the next time the
    // plan is saved without it in the actions array (reconcileActions).
    const nextRequires = patch.requiresSpecialImplementation ?? row.requiresSpecialImplementation;
    return prisma.targetCrDefect.update({
      where: { id: defectRowId },
      data: {
        requiresSpecialImplementation: nextRequires,
        importantToManagement: patch.importantToManagement ?? row.importantToManagement,
        ...(nextRequires ? {} : { derivedActionId: null }),
      },
    });
  }
}
