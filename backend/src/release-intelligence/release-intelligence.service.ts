import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { QcService, TestCoverageDto, DefectDto, BugDashboardDto, DefectByCycleDto, CrCoverageDto, CycleQgTargetDto } from '../qc/qc.service';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// QG thresholds — spec section 25: should come from QC Cycle Configuration,
// not be hardcoded. No such configuration exists yet, so these are the
// documented current defaults until that config surface is built.
const QG_DEFAULTS = { SHOW_STOPPER: 1, SEVERE: 5, MEDIUM: 10, LOW: 20 };

// Status Board "aging" tile — same "documented default until a real config
// surface exists" reasoning as QG_DEFAULTS above. discoveryDate on DefectDto
// comes back as Oracle's DD/MM/YYYY string, parsed below (never via
// Date.parse, which reads DD/MM/YYYY as MM/DD/YYYY and silently misdates).
const AGING_DEFECT_THRESHOLD_DAYS = 10;

function parseOracleDateAgeDays(ddMmYyyy: string, nowMs: number): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(ddMmYyyy?.trim() ?? '');
  if (!m) return null;
  const [, d, mo, y] = m;
  const discovered = new Date(Number(y), Number(mo) - 1, Number(d)).getTime();
  if (Number.isNaN(discovered)) return null;
  return Math.floor((nowMs - discovered) / 86400000);
}

const CLOSED_DEFECT_STATUSES = ['Closed', 'Canceled', 'Rejected', 'Fixed'];
const CRITICAL_SEVERITIES = ['Show Stopper', 'Severe'];

// Per-CR quality score — release-intelligence Home page's "CR-ים לא עומדים
// ביעד איכות" card. score = Σ(defectCount × severityWeight) / actualEffortDays;
// a CR "meets the target" when score <= CR_QUALITY_TARGET. Defects counted:
// everything reported against the CR in this version EXCEPT Canceled status
// and Production-environment defects (spec confirmed 2026-09-01).
const CR_QUALITY_TARGET = 0.15;
const CR_QUALITY_SEVERITY_WEIGHT: Record<string, number> = {
  'Show Stopper': 1, 'Severe': 0.8, 'Medium': 0.5, 'Low': 0.05,
};
function isCrQualityDefect(d: DefectDto, crNumber: string): boolean {
  return d.crReferenceNumber === crNumber
    && d.status !== 'Canceled'
    && !(d.environment || '').toUpperCase().includes('PROD');
}

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

// Maps our internal QaCycle.cycleType to the real QC RELEASE_CYCLES.RCYC_NAME
// values it corresponds to — normalized (lowercase/trim) since the real data
// has several human-typo variants for the same real cycle (confirmed against
// the actual CYCLES.xlsx export 2026-07-28): "Dress Rehearsal" also appears
// as "Dress Reherssal", "Dress Rehessal", and "Dress rehearsal"; Stand Alone
// appears as "Stand Alone Item"/"Stand Alone Items", never bare "Stand Alone".
function cycleNameMatches(cycleType: string, realCycleName: string): boolean {
  const n = realCycleName.trim().toLowerCase();
  switch (cycleType) {
    case 'CYCLE_1': return n === 'cycle 1';
    case 'CYCLE_2': return n === 'cycle 2';
    case 'CYCLE_3': return n === 'cycle 3';
    case 'UAT': return n === 'uat';
    case 'GO_LIVE': return n === 'go live';
    case 'REHEARSAL': return n.startsWith('dress reh');
    case 'STAND_ALONE': return n.startsWith('stand alone');
    default: return false;
  }
}

@Injectable()
export class ReleaseIntelligenceService {
  private qcService = new QcService();

  // ── Overview aggregator — spec section 11 ──────────────────────────────────
  async getOverview(versionId: string) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const [coverage, defects, openRisks, crPlans, params] = await Promise.all([
      this.qcService.getTestCoverage(versionId).catch((): TestCoverageDto[] => []),
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      prisma.releaseRisk.findMany({ where: { versionId, status: 'OPEN' } }),
      prisma.crPlan.findMany({ where: { versionId }, select: { riskLevel: true } }),
      prisma.systemParam.findMany({ where: { key: { in: ['DEFAULT_TEST_DURATION_MINUTES', 'FORECAST_ALERT_DAYS'] } } }),
    ]);

    const paramMap = Object.fromEntries(params.map(p => [p.key, p.value]));
    const testDurationMin = Number(paramMap['DEFAULT_TEST_DURATION_MINUTES'] ?? 15);
    const alertDays = Number(paramMap['FORECAST_ALERT_DAYS'] ?? 5);

    // Coverage %
    const totalPlanned = coverage.reduce((s, c) => s + (c.planned || 0), 0);
    const totalPassed = coverage.reduce((s, c) => s + (c.passed || 0), 0);
    const coveragePct = totalPlanned > 0 ? Math.round((totalPassed / totalPlanned) * 100) : 0;

    // Critical defects — open, severity Show Stopper/Severe
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
    const criticalDefects = openDefects.filter(d => CRITICAL_SEVERITIES.includes(d.severity)).length;

    // QG summary — open defect counts by severity vs thresholds
    const { qgSummary, qgPass } = this.computeQgSummary(openDefects);

    // Days to go live
    const daysToGoLive = version.plannedStart
      ? Math.ceil((new Date(version.plannedStart).getTime() - Date.now()) / 86400000)
      : null;

    // Remaining tests / forecast — v1 heuristic (see plan notes: not a fixed
    // formula in the spec, tune once real data is observed)
    const remainingTests = coverage.reduce((s, c) => s + (c.notRun || 0) + (c.blocked || 0) + (c.notCompleted || 0), 0);
    const remainingEffortDays = (remainingTests * testDurationMin) / (60 * 8); // 8h workday
    let forecastStatus: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' = 'ON_TRACK';
    if (daysToGoLive !== null) {
      if (remainingEffortDays > daysToGoLive) forecastStatus = 'BEHIND_PLAN';
      else if (remainingEffortDays > daysToGoLive - alertDays) forecastStatus = 'AT_RISK';
    }

    // Risk score from CrPlan.riskLevel + ReleaseRisk table
    const highRiskCrs = crPlans.filter(p => p.riskLevel === 'HIGH').length;
    const openRisksCount = openRisks.length;

    // Health score (0-100) — v1 weighted average, documented as tunable
    const qualityScore = Math.max(0, 100 - criticalDefects * 10);
    const riskScore = Math.max(0, 100 - (openRisksCount + highRiskCrs) * 15);
    const forecastScore = forecastStatus === 'ON_TRACK' ? 100 : forecastStatus === 'AT_RISK' ? 60 : 20;
    const healthScore = Math.round((coveragePct + qualityScore + riskScore + forecastScore) / 4);

    // Persist snapshot rows (ReleaseHealth/ReleaseForecast — spec section 8)
    await Promise.all([
      prisma.releaseHealth.upsert({
        where: { versionId },
        create: { versionId, healthScore, coverageScore: coveragePct, qualityScore, riskScore, forecastScore },
        update: { healthScore, coverageScore: coveragePct, qualityScore, riskScore, forecastScore, calculatedAt: new Date() },
      }),
      prisma.releaseForecast.upsert({
        where: { versionId },
        create: { versionId, remainingTests, velocity: 0, status: forecastStatus },
        update: { remainingTests, status: forecastStatus, calculatedDate: new Date() },
      }),
    ]);

    const topRisks = [...openRisks]
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
      .slice(0, 5);

    const criticalAlerts: { category: string; message: string }[] = [];
    if (!qgPass) criticalAlerts.push({ category: 'COVERAGE', message: 'כמות הבאגים החוסמים חורגת מסף ה-QG' });
    if (forecastStatus === 'BEHIND_PLAN') criticalAlerts.push({ category: 'FORECAST', message: 'התחזית מצביעה על חריגה מלוח הזמנים' });

    // Persist as the current AUTO-insight snapshot — replaced in full each
    // call, same "recompute snapshot" pattern as ReleaseHealth/ReleaseForecast
    // above (spec section 22, section B: Automatic Insights).
    await prisma.releaseInsight.deleteMany({ where: { versionId, source: 'AUTO' } });
    if (criticalAlerts.length > 0) {
      await prisma.releaseInsight.createMany({
        data: criticalAlerts.map(a => ({ versionId, category: a.category, message: a.message, source: 'AUTO', severity: 'HIGH' as any })),
      });
    }

    return {
      healthScore,
      coveragePct,
      criticalDefects,
      openRisksCount,
      daysToGoLive,
      forecastStatus,
      qgSummary,
      qgPass,
      topRisks,
      criticalAlerts,
      forecastWarnings: forecastStatus !== 'ON_TRACK'
        ? [`נותרו ${remainingTests} בדיקות (${remainingEffortDays.toFixed(1)} ימי עבודה משוערים) מול ${daysToGoLive ?? '—'} ימים לעלייה לאוויר`]
        : [],
    };
  }

  // ── Shared QG helper — reused by Overview and Cycle Progress ────────────────
  private computeQgSummary(openDefects: DefectDto[]) {
    const bySeverity = (sev: string) => openDefects.filter(d => d.severity === sev).length;
    const qgSummary = {
      showStopper: { count: bySeverity('Show Stopper'), threshold: QG_DEFAULTS.SHOW_STOPPER },
      severe:      { count: bySeverity('Severe'),        threshold: QG_DEFAULTS.SEVERE },
      medium:      { count: bySeverity('Medium'),         threshold: QG_DEFAULTS.MEDIUM },
      low:         { count: bySeverity('Low'),             threshold: QG_DEFAULTS.LOW },
    };
    const qgPass = qgSummary.showStopper.count <= qgSummary.showStopper.threshold
      && qgSummary.severe.count <= qgSummary.severe.threshold;
    return { qgSummary, qgPass };
  }

  // ── Shared per-CR row builder — reused by Daily QA Management and CR Health ──
  // CR and Requirement are separate granularities in this data model (CR from
  // QaAssignment, Requirement from Oracle test-plan rows with no FK back to a
  // CR) — one row per QaAssignment (= per CR), "Requirement" shows crLabel.
  // Open/reopen/critical defect counts ARE real per-CR (bridged via
  // CR_REFERENCE_NUMBER, which shares the "{crNumber} - {title}" shape with
  // crLabel). "coveragePct" (aka Pass Rate elsewhere) has no such bridge and
  // is the same version-wide Oracle aggregate on every row.
  private async buildCrRows(versionId: string) {
    const [assignments, workPlan, bugDashboard, coverage, users] = await Promise.all([
      prisma.qaAssignment.findMany({ where: { versionId } }),
      prisma.qaWorkPlan.findUnique({ where: { versionId }, include: { cycles: { include: { tasks: true } } } }),
      this.qcService.getBugDashboard(versionId).catch((): BugDashboardDto | null => null),
      this.qcService.getTestCoverage(versionId).catch((): TestCoverageDto[] => []),
      prisma.user.findMany({ select: { id: true, fullName: true } }),
    ]);

    const userNameById = new Map(users.map(u => [u.id, u.fullName]));
    const allTasks = (workPlan?.cycles ?? []).flatMap(c => c.tasks);
    const now = Date.now();

    // Version-wide coverage/pass-rate (no per-CR bridge available for Oracle test results)
    const totalPlanned = coverage.reduce((s, c) => s + (c.planned || 0), 0);
    const totalPassed = coverage.reduce((s, c) => s + (c.passed || 0), 0);
    const coveragePct = totalPlanned > 0 ? Math.round((totalPassed / totalPlanned) * 100) : 0;

    // Defect counts per CR — bridged via CR_REFERENCE_NUMBER's "{crNumber} - {title}" shape
    const byCrFromLabel = (rows: { label: string; count: number }[] | undefined) => {
      const map = new Map<string, number>();
      for (const row of rows ?? []) {
        const crNum = row.label.split(' - ')[0].trim();
        map.set(crNum, (map.get(crNum) ?? 0) + row.count);
      }
      return map;
    };
    const openDefectsByCr = byCrFromLabel(bugDashboard?.openByCr);
    const reopenByCr = byCrFromLabel(bugDashboard?.reopenByCr);
    const criticalByCr = byCrFromLabel(bugDashboard?.criticalByCr);

    const rows = assignments.map(a => {
      const crTasks = allTasks.filter(t => t.crNumber === a.crNumber);
      const totalDays = crTasks.reduce((s, t) => s + t.effortDays, 0);
      const elapsedDays = crTasks.reduce((s, t) => {
        const start = t.plannedStart.getTime();
        const end = t.plannedEnd.getTime();
        if (now >= end) return s + t.effortDays;
        if (now <= start) return s;
        const frac = (now - start) / (end - start);
        return s + t.effortDays * Math.min(1, Math.max(0, frac));
      }, 0);
      const progressPct = totalDays > 0 ? Math.round((elapsedDays / totalDays) * 100) : 0;
      const latestPlannedEnd = crTasks.length
        ? new Date(Math.max(...crTasks.map(t => t.plannedEnd.getTime())))
        : null;
      const openDefects = openDefectsByCr.get(a.crNumber) ?? 0;
      const reopen = reopenByCr.get(a.crNumber) ?? 0;
      const criticalDefects = criticalByCr.get(a.crNumber) ?? 0;
      const isDelayed = !!latestPlannedEnd && now > latestPlannedEnd.getTime() && openDefects > 0;
      const isWaiting = crTasks.length > 0 && crTasks.every(t => now < t.plannedStart.getTime());

      return {
        crNumber: a.crNumber,
        requirement: a.crLabel ?? a.crNumber,
        tester: userNameById.get(a.userId) ?? '—',
        secondaryTester: a.secondaryTesterId ? (userNameById.get(a.secondaryTesterId) ?? '—') : null,
        progressPct,
        coveragePct,
        openDefects,
        reopen,
        criticalDefects,
        forecastCompletion: latestPlannedEnd,
        isDelayed,
        isWaiting,
      };
    });

    return { rows, bugDashboard };
  }

  // ── Daily QA Management — spec section 12 ───────────────────────────────────
  async getDailyQaManagement(versionId: string) {
    const { rows: baseRows, bugDashboard } = await this.buildCrRows(versionId);

    const rows = baseRows.map(r => {
      let health: 'GOOD' | 'WARNING' | 'CRITICAL' = 'GOOD';
      if (r.isDelayed || r.openDefects > 3) health = 'CRITICAL';
      else if (r.openDefects > 0) health = 'WARNING';
      return { ...r, passRatePct: r.coveragePct, health };
    });

    const kpis = {
      openTargets: rows.filter(r => r.progressPct < 100).length,
      openDefects: bugDashboard?.open ?? 0,
      waitingForQa: rows.filter(r => r.isWaiting).length,
      reopenDefects: bugDashboard?.reopen ?? 0,
      delayedTargets: rows.filter(r => r.isDelayed).length,
    };

    return { kpis, rows };
  }

  // ── CR Health — spec section 13 ─────────────────────────────────────────────
  // Classification is a v1 heuristic (documented, tunable — same transparency
  // pattern as the Overview health-score formula) since QaAssignment/
  // QaCycleTask have no explicit status field to key a "done" state off of.
  async getCrHealth(versionId: string) {
    const { rows: baseRows } = await this.buildCrRows(versionId);

    const rows = baseRows.map(r => {
      let status: 'HEALTHY' | 'AT_RISK' | 'CRITICAL' = 'HEALTHY';
      if (r.criticalDefects > 0 || r.isDelayed || r.reopen > 1) status = 'CRITICAL';
      else if (r.openDefects > 0 || r.reopen === 1 || r.progressPct < 50) status = 'AT_RISK';
      return {
        crNumber: r.crNumber,
        requirement: r.requirement,
        status,
        coveragePct: r.coveragePct,
        criticalDefects: r.criticalDefects,
        reopen: r.reopen,
        progressPct: r.progressPct,
      };
    }).sort((a, b) => {
      const rank = { CRITICAL: 0, AT_RISK: 1, HEALTHY: 2 };
      return rank[a.status] - rank[b.status];
    });

    const kpis = {
      healthy: rows.filter(r => r.status === 'HEALTHY').length,
      atRisk: rows.filter(r => r.status === 'AT_RISK').length,
      critical: rows.filter(r => r.status === 'CRITICAL').length,
    };

    return { kpis, rows };
  }

  // ── Coverage & Readiness — spec section 14 ──────────────────────────────────
  async getCoverageReadiness(versionId: string) {
    const coverage = await this.qcService.getTestCoverage(versionId).catch((): TestCoverageDto[] => []);
    const sum = (key: keyof TestCoverageDto) => coverage.reduce((s, c) => s + (Number(c[key]) || 0), 0);
    const planned = sum('planned');
    const failed = sum('failed');
    const blocked = sum('blocked');
    const notReady = sum('notReady');
    const notRun = sum('notRun');
    const covered = Math.max(0, planned - notRun - notReady);
    const coveragePct = planned > 0 ? Math.round((covered / planned) * 100) : 0;

    return {
      kpis: { covered, failed, blocked, notReady, coveragePct },
      byRequirement: coverage.map(c => ({
        title: c.title, subject: c.subject, planned: c.planned, passed: c.passed,
        failed: c.failed, blocked: c.blocked, notReady: c.notReady, notRun: c.notRun,
      })),
    };
  }

  // ── Cycle Progress & QG — spec section 17 ───────────────────────────────────
  async getCycleProgress(versionId: string) {
    const [workPlan, defects, users, version] = await Promise.all([
      prisma.qaWorkPlan.findUnique({ where: { versionId }, include: { cycles: { include: { tasks: true } } } }),
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      prisma.user.findMany({ select: { id: true, fullName: true } }),
      prisma.version.findUnique({ where: { id: versionId }, include: { qcRelease: true } }),
    ]);
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
    const { qgSummary, qgPass } = this.computeQgSummary(openDefects);
    const nameById = new Map(users.map(u => [u.id, u.fullName]));
    const releaseName = (version as any)?.qcRelease?.relName ?? version?.name ?? '';

    const now = Date.now();
    const cycles = [...(workPlan?.cycles ?? [])].sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime());

    // Real per-CR test coverage (see qc.service.ts's getCrCoverage), fetched
    // for the version's own real CR scope (VersionCrAssignment — same source
    // getScopeOverview uses), NOT from our dev/test QaCycleTask scheduling.
    // Caught live 2026-07-28: CR 12978 was listed under Cycle 1 only because
    // OUR OWN synthetic work-plan scheduler happened to assign it there —
    // its real coverage is entirely under "Stand Alone Items". The per-cycle
    // CR list below must be grounded in the real (release, cycle) match, not
    // in an arbitrary fake scheduling decision that has no bearing on which
    // cycle a CR was actually tested in historically.
    const vcaRows = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { crNumber: true },
    });
    const versionCrNumbers = [...new Set(vcaRows.map(r => r.crNumber))];
    // Each Oracle-backed call is caught independently — a failure in any one
    // of them (e.g. a real-Oracle query that behaves differently in prod
    // than in the mock/offline path — see qc.service.ts's own error logging
    // for the real cause) degrades just that piece of data instead of
    // taking down the whole screen with "לא ניתן לטעון נתונים עבור גרסה זו"
    // (found live in production, 2026-08-02 — getCrCoverage/getCycleQgTargets
    // were the only two of these four calls NOT wrapped like this).
    const [coverageRows, qgTargets, defectsByCycle] = await Promise.all([
      this.qcService.getCrCoverage(versionCrNumbers, versionId).catch((): CrCoverageDto[] => []),
      this.qcService.getCycleQgTargets(versionId).catch((): CycleQgTargetDto[] => []),
      this.qcService.getDefectsByCycle(versionId).catch((): DefectByCycleDto[] => []),
    ]);

    const timeline = cycles.map(c => {
      const total = c.plannedEnd.getTime() - c.plannedStart.getTime();
      const elapsed = Math.min(Math.max(now - c.plannedStart.getTime(), 0), Math.max(total, 0));
      const progressPct = total > 0 ? Math.round((elapsed / total) * 100) : (now > c.plannedEnd.getTime() ? 100 : 0);

      // testerCount/testers still reflect OUR OWN work-plan staffing for this
      // cycle (a legitimate, separate stat) — only the CR list + coverage
      // numbers below are now real-data-driven, not this cycle's tasks.
      const crTasks = c.tasks.filter(t => t.taskType !== 'REGRESSION');
      const testerIds = new Set(crTasks.map(t => t.userId));

      // Real per-cycle defect count — replaces testerCount in the card per
      // the user's request (2026-07-24): "instead of testers, put the number
      // of defects reported in the cycle". Same real detected-cycle match as
      // crCoverage below, grounded in DETECTED_IN_REL/DETECTED_IN_CYCLE, not
      // our own work-plan staffing.
      const defectCount = defectsByCycle.filter(d => cycleNameMatches(c.cycleType, d.detectedInCycle)).length;

      const crCoverage = coverageRows
        .filter(row => row.releaseName === releaseName && cycleNameMatches(c.cycleType, row.cycleName))
        .map(row => ({
          crNumber: row.crNumber, crLabel: `${row.crNumber} - ${row.crTitle}`,
          passed: row.passed, failed: row.failed, notRun: row.notRun,
          blocked: row.blocked, notCompleted: row.notCompleted, notReady: row.notReady,
          total: row.total, coveragePct: row.coveragePct,
        }));
      const crs = crCoverage.map(cc => ({ crNumber: cc.crNumber, crLabel: cc.crLabel }));
      const totalTests = crCoverage.reduce((s, cc) => s + cc.total, 0);
      const executedTests = crCoverage.reduce((s, cc) => s + cc.passed + cc.failed + cc.blocked + cc.notCompleted, 0);
      const passedTests = crCoverage.reduce((s, cc) => s + cc.passed, 0);
      // Coverage = how much of the plan ran (executed/total); Success = how
      // much of the plan actually passed (passed/total) — same denominator as
      // coverage so both sit on the same 0-100% scale as the QG target marker.
      // Kept as two separate numbers per the user's explicit request — they'd
      // been conflated (the target was compared against coverage, i.e. against
      // "did it run" rather than "did it pass") (spec confirmed 2026-08-31).
      const coveragePct = totalTests > 0 ? Math.round((executedTests / totalTests) * 100) : null;
      const successPct = totalTests > 0 ? Math.round((passedTests / totalTests) * 100) : null;

      // Real QG target for this cycle (RELEASE_CYCLES.QG_HIGH) — shown as a
      // marker on the success bar, not baked into the bar's own fill color,
      // per the user's explicit choice (2026-07-28: "קו מסומן עם סימון יעד").
      const qgTarget = qgTargets.find(t => t.releaseName === releaseName && cycleNameMatches(c.cycleType, t.cycleName));
      const qgTargetPct = qgTarget?.qgHigh ?? null;

      // "הושלם" requires the end date to have passed AND the quality target to
      // have actually been reached (successPct >= qgTargetPct) — previously
      // this was purely time-based, so a cycle whose end date passed without
      // meeting its quality target still showed as "done". When the target
      // can't be evaluated (no QG target defined, or no test data yet for this
      // cycle) falls back to the old time-only rule — there's nothing to
      // compare against. A cycle past its end date that hasn't met the target
      // stays "active" (no new status) until it does (spec confirmed 2026-08-31).
      const pastEnd = now > c.plannedEnd.getTime();
      const canEvaluateQg = qgTargetPct != null && successPct != null;
      const qgReached = canEvaluateQg && (successPct as number) >= (qgTargetPct as number);
      const state: 'done' | 'active' | 'upcoming' =
        now < c.plannedStart.getTime() ? 'upcoming'
        : pastEnd && (canEvaluateQg ? qgReached : true) ? 'done'
        : 'active';

      return {
        cycleType: c.cycleType, plannedStart: c.plannedStart, plannedEnd: c.plannedEnd, progressPct, state,
        crCount: crs.length, testerCount: testerIds.size, defectCount, crs,
        testers: [...testerIds].map(id => nameById.get(id) ?? id),
        coveragePct, successPct, crCoverage, qgTargetPct,
      };
    });
    const currentCycle = timeline.find(t => t.state === 'active') ?? null;
    const overallProgressPct = timeline.length > 0
      ? Math.round(timeline.reduce((s, t) => s + t.progressPct, 0) / timeline.length)
      : 0;

    return {
      kpis: { currentCycle: currentCycle?.cycleType ?? '—', qgStatus: qgPass ? 'PASS' : 'FAIL', progressPct: overallProgressPct },
      qgSummary,
      timeline,
    };
  }

  // ── Status Board — dense at-a-glance view for the release-intelligence
  // module home. Deliberately built entirely out of existing aggregations
  // (getCycleProgress, computeQgSummary, listRisks, getAlerts) rather than
  // new queries — this screen doesn't compute anything the app didn't
  // already track, it just puts the three "did we hit the target" reads
  // (coverage / open severe+ defects / aging defects) next to each other.
  async getStatusBoard(versionId: string) {
    const [cycleProgress, defects, risks, alerts] = await Promise.all([
      this.getCycleProgress(versionId),
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      this.listRisks(versionId),
      this.getAlerts(versionId),
    ]);

    const activeCycle = cycleProgress.timeline.find(t => t.state === 'active') ?? null;
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
    const { qgSummary } = this.computeQgSummary(openDefects);

    const now = Date.now();
    const agingDefects = openDefects.filter(d => {
      const age = parseOracleDateAgeDays(d.discoveryDate, now);
      return age != null && age > AGING_DEFECT_THRESHOLD_DAYS;
    });
    const avgAgingDays = agingDefects.length > 0
      ? Math.round(agingDefects.reduce((s, d) => s + (parseOracleDateAgeDays(d.discoveryDate, now) ?? 0), 0) / agingDefects.length)
      : 0;

    const severeOrWorseActual = qgSummary.showStopper.count + qgSummary.severe.count;
    const severeOrWorseTarget = qgSummary.showStopper.threshold + qgSummary.severe.threshold;

    return {
      activeCycle: activeCycle ? { cycleType: activeCycle.cycleType, state: activeCycle.state } : null,
      // "met" compares against successPct (passed/total), not coveragePct
      // (executed/total) — same fix as getCycleProgress's own state/done
      // logic: the QG target is a quality bar, not an execution bar (spec
      // confirmed 2026-08-31).
      coverage: {
        actualPct: activeCycle?.successPct ?? null,
        targetPct: activeCycle?.qgTargetPct ?? null,
        met: activeCycle?.successPct != null && activeCycle?.qgTargetPct != null
          ? activeCycle.successPct >= activeCycle.qgTargetPct
          : null,
      },
      openDefects: {
        total: openDefects.length,
        severeOrWorseActual,
        severeOrWorseTarget,
        met: severeOrWorseActual <= severeOrWorseTarget,
      },
      aging: {
        thresholdDays: AGING_DEFECT_THRESHOLD_DAYS,
        count: agingDefects.length,
        avgAgingDays,
        met: agingDefects.length === 0,
      },
      timeline: cycleProgress.timeline,
      risks: risks.filter((r: any) => r.status !== 'CLOSED').slice(0, 8),
      notices: [...alerts.manual, ...alerts.auto]
        .sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 8),
    };
  }

  // ── Timeline & Activities — spec section 18 ─────────────────────────────────
  // "Critical Milestones" = activities in the 'golive' category — the only
  // category value in this app's data with a clear "milestone" meaning
  // (frontend/src/components/qa/QaActivityPlanView.tsx also special-cases it).
  async getTimelineActivities(versionId: string) {
    const activities = await prisma.activityBoardEntry.findMany({
      where: { versionId, isRelevant: true },
      orderBy: { dateStart: 'asc' },
    });
    const now = Date.now();
    const rows = activities.map(a => ({
      label: a.label,
      owner: a.owner,
      category: a.category,
      dateStart: a.dateStart,
      dateEnd: a.dateEnd,
      delayed: !!a.dateEnd && a.dateEnd.getTime() < now,
      upcoming: !!a.dateStart && a.dateStart.getTime() > now,
    }));

    return {
      kpis: {
        activities: rows.length,
        delayed: rows.filter(r => r.delayed).length,
        upcoming: rows.filter(r => r.upcoming).length,
        criticalMilestones: rows.filter(r => r.category === 'golive').length,
      },
      rows,
    };
  }

  // ── Capacity — spec section 19 ──────────────────────────────────────────────
  async getCapacity(versionId: string) {
    const [vcaRows, qaAssignments, teams] = await Promise.all([
      prisma.versionCrAssignment.findMany({ where: { versionId }, select: { crNumber: true, teamId: true, teamEstimateDays: true } }),
      prisma.qaAssignment.findMany({ where: { versionId }, select: { crNumber: true, qaEffort: true } }),
      prisma.team.findMany({ select: { id: true, name: true } }),
    ]);
    const teamNameById = new Map(teams.map(t => [t.id, t.name]));

    const byTeam = new Map<string, { teamId: string; teamName: string; totalDays: number; crNumbers: Set<string> }>();
    for (const v of vcaRows) {
      if (!byTeam.has(v.teamId)) {
        byTeam.set(v.teamId, { teamId: v.teamId, teamName: teamNameById.get(v.teamId) ?? v.teamId, totalDays: 0, crNumbers: new Set() });
      }
      const entry = byTeam.get(v.teamId)!;
      entry.totalDays += (v as any).teamEstimateDays ?? 0;
      entry.crNumbers.add(v.crNumber);
    }
    const teamLoad = [...byTeam.values()]
      .map(t => ({ teamId: t.teamId, teamName: t.teamName, totalDays: Math.round(t.totalDays * 100) / 100, crCount: t.crNumbers.size }))
      .sort((a, b) => b.totalDays - a.totalDays);

    const qaEffortDays = qaAssignments.reduce((s, a) => s + (a.qaEffort ?? 0), 0);
    const crCount = new Set(vcaRows.map(v => v.crNumber)).size;

    return {
      kpis: {
        qaEffortDays: Math.round(qaEffortDays * 100) / 100,
        crCount,
        teamCount: byTeam.size,
        assignmentCount: qaAssignments.length,
      },
      teamLoad,
    };
  }

  // ── Forecast & Tracking — spec section 20 ───────────────────────────────────
  // Same formula as getOverview's forecast block, recomputed fresh here rather
  // than reading the ReleaseHealth/ReleaseForecast snapshot rows — this screen
  // works even for a version whose Overview was never opened first.
  async getForecastTracking(versionId: string) {
    const [coverage, workPlan, version, params, users] = await Promise.all([
      this.qcService.getTestCoverage(versionId).catch((): TestCoverageDto[] => []),
      prisma.qaWorkPlan.findUnique({ where: { versionId }, include: { cycles: { include: { tasks: true } } } }),
      prisma.version.findUnique({ where: { id: versionId } }),
      prisma.systemParam.findMany({ where: { key: { in: ['DEFAULT_TEST_DURATION_MINUTES', 'FORECAST_ALERT_DAYS'] } } }),
      prisma.user.findMany({ select: { id: true, fullName: true } }),
    ]);
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const paramMap = Object.fromEntries(params.map(p => [p.key, p.value]));
    const testDurationMin = Number(paramMap['DEFAULT_TEST_DURATION_MINUTES'] ?? 15);
    const alertDays = Number(paramMap['FORECAST_ALERT_DAYS'] ?? 5);

    const remainingTests = coverage.reduce((s, c) => s + (c.notRun || 0) + (c.blocked || 0) + (c.notCompleted || 0), 0);
    const remainingEffortDays = (remainingTests * testDurationMin) / (60 * 8);
    const daysToGoLive = version.plannedStart
      ? Math.ceil((new Date(version.plannedStart).getTime() - Date.now()) / 86400000)
      : null;
    let status: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' = 'ON_TRACK';
    if (daysToGoLive !== null) {
      if (remainingEffortDays > daysToGoLive) status = 'BEHIND_PLAN';
      else if (remainingEffortDays > daysToGoLive - alertDays) status = 'AT_RISK';
    }
    const forecastDate = new Date(Date.now() + remainingEffortDays * 86400000);

    const userNameById = new Map(users.map(u => [u.id, u.fullName]));
    const allTasks = (workPlan?.cycles ?? []).flatMap(c => c.tasks);
    const now = Date.now();
    const byUser = new Map<string, { userId: string; name: string; remainingDays: number }>();
    for (const t of allTasks) {
      if (t.plannedEnd.getTime() <= now) continue;
      if (!byUser.has(t.userId)) byUser.set(t.userId, { userId: t.userId, name: userNameById.get(t.userId) ?? '—', remainingDays: 0 });
      byUser.get(t.userId)!.remainingDays += t.effortDays;
    }
    const byTeamMember = [...byUser.values()]
      .map(u => ({ ...u, remainingDays: Math.round(u.remainingDays * 100) / 100 }))
      .sort((a, b) => b.remainingDays - a.remainingDays);

    return {
      kpis: {
        remainingWork: Math.round(remainingEffortDays * 10) / 10,
        remainingTests,
        forecastDate,
        status,
      },
      daysToGoLive,
      byTeamMember,
    };
  }

  // ── Defects — spec section 15 ────────────────────────────────────────────────
  // "By Vendor" has no distinct backing field on DefectDto in this data model
  // — aliased to the same assignedTo grouping as "By Team" (documented
  // simplification, same precedent as Coverage/Pass-Rate elsewhere in this module).
  async getDefectsBreakdown(versionId: string) {
    const defects = await this.qcService.getDefects(versionId).catch((): DefectDto[] => []);

    const groupCount = (items: DefectDto[], keyFn: (d: DefectDto) => string) => {
      const counts = new Map<string, number>();
      for (const d of items) {
        const key = keyFn(d) || 'ללא סיווג';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };

    const open = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
    const fixed = defects.filter(d => ['Fixed_Dev', 'Fixed_Test', 'Fixed'].includes(d.status));
    const closed = defects.filter(d => d.status === 'Closed');
    const rejected = defects.filter(d => d.status === 'Canceled');
    const reopen = defects.filter(d => d.status === 'Reopen');

    return {
      kpis: { open: open.length, fixed: fixed.length, closed: closed.length, rejected: rejected.length, reopen: reopen.length },
      bySeverity: groupCount(open, d => d.severity),
      byStatus: groupCount(defects, d => d.status),
      byTeam: groupCount(open, d => d.assignedTo),
      byProject: groupCount(open, d => d.system),
    };
  }

  // ── Reopen Analysis — spec section 16 ───────────────────────────────────────
  // "Production Reopen" has no dedicated production flag on DefectDto (that's
  // CATEGORY_REF, only present on bug-dashboard raw rows) — approximated via
  // the `environment` field containing "prod" (documented simplification).
  async getReopenAnalysis(versionId: string) {
    const [defects, bugDashboard] = await Promise.all([
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      this.qcService.getBugDashboard(versionId).catch((): BugDashboardDto | null => null),
    ]);
    const reopen = defects.filter(d => d.status === 'Reopen');
    const reopenRate = defects.length > 0 ? Math.round((reopen.length / defects.length) * 100) : 0;
    const criticalReopen = reopen.filter(d => CRITICAL_SEVERITIES.includes(d.severity)).length;
    const productionReopen = reopen.filter(d => (d.environment || '').toLowerCase().includes('prod')).length;

    const groupCount = (items: DefectDto[], keyFn: (d: DefectDto) => string) => {
      const counts = new Map<string, number>();
      for (const d of items) {
        const key = keyFn(d) || 'ללא סיווג';
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      return Array.from(counts.entries()).map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
    };
    const byTeam = groupCount(reopen, d => d.assignedTo);

    const dailyCounts = new Map<string, number>();
    for (const d of reopen) {
      if (!d.discoveryDate) continue;
      dailyCounts.set(d.discoveryDate, (dailyCounts.get(d.discoveryDate) ?? 0) + 1);
    }
    const trend = Array.from(dailyCounts.entries())
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => {
        // discoveryDate is "DD/MM/YYYY" (he-IL locale) — parse for chronological sort
        const [da, ma, ya] = a.date.split('/').map(Number);
        const [db, mb, yb] = b.date.split('/').map(Number);
        return new Date(ya || 0, (ma || 1) - 1, da || 1).getTime() - new Date(yb || 0, (mb || 1) - 1, db || 1).getTime();
      });

    return {
      kpis: { reopenRate, criticalReopen, productionReopen },
      byCr: bugDashboard?.reopenByCr ?? [],
      byTeam,
      trend,
    };
  }

  // ── Defect drill-down — every summary card/bar across this module that
  // shows a defect COUNT should be clickable into the exact list behind it
  // (spec confirmed 2026-08-29). Re-derives the same filter each aggregate
  // method above already computes, from the same real defect list, instead
  // of a second query — so a drill-down list can never disagree with the
  // number the user clicked. `screen` picks which aggregate's filters apply;
  // `filter`/`value` pick which specific bucket within that screen.
  //
  // Not covered: Reopen Analysis's "byCr" bars — those come from
  // getBugDashboard's aggregate rows (BugRawRow-based), not DefectDto, so
  // there's no defect-level list to hand back without a new Oracle query.
  async getDefectsDrilldown(versionId: string, screen: string, filter: string, value?: string): Promise<DefectDto[]> {
    const defects = await this.qcService.getDefects(versionId).catch((): DefectDto[] => []);
    const open = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));

    switch (screen) {
      case 'defects': {
        if (filter === 'kpi') {
          if (value === 'open') return open;
          if (value === 'fixed') return defects.filter(d => ['Fixed_Dev', 'Fixed_Test', 'Fixed'].includes(d.status));
          if (value === 'closed') return defects.filter(d => d.status === 'Closed');
          if (value === 'rejected') return defects.filter(d => d.status === 'Canceled');
          if (value === 'reopen') return defects.filter(d => d.status === 'Reopen');
          return [];
        }
        if (filter === 'severity') return open.filter(d => (d.severity || 'ללא סיווג') === value);
        if (filter === 'status') return defects.filter(d => (d.status || 'ללא סיווג') === value);
        if (filter === 'team') return open.filter(d => (d.assignedTo || 'ללא סיווג') === value);
        if (filter === 'project') return open.filter(d => (d.system || 'ללא סיווג') === value);
        return [];
      }
      case 'status-board': {
        if (filter === 'openTotal') return open;
        if (filter === 'openSevereOrWorse') return open.filter(d => CRITICAL_SEVERITIES.includes(d.severity));
        if (filter === 'aging') {
          const now = Date.now();
          return open.filter(d => {
            const age = parseOracleDateAgeDays(d.discoveryDate, now);
            return age != null && age > AGING_DEFECT_THRESHOLD_DAYS;
          });
        }
        return [];
      }
      case 'cycle-progress': {
        if (filter === 'cycleDefects' && value) {
          const defectsByCycle = await this.qcService.getDefectsByCycle(versionId).catch((): DefectByCycleDto[] => []);
          const idsInCycle = new Set(defectsByCycle.filter(d => cycleNameMatches(value, d.detectedInCycle)).map(d => d.id));
          return defects.filter(d => idsInCycle.has(d.id));
        }
        return [];
      }
      case 'reopen-analysis': {
        const reopen = defects.filter(d => d.status === 'Reopen');
        if (filter === 'reopenAll') return reopen;
        if (filter === 'reopenCritical') return reopen.filter(d => CRITICAL_SEVERITIES.includes(d.severity));
        if (filter === 'reopenProduction') return reopen.filter(d => (d.environment || '').toLowerCase().includes('prod'));
        if (filter === 'reopenTeam') return reopen.filter(d => (d.assignedTo || 'ללא סיווג') === value);
        return [];
      }
      case 'home': {
        if (filter === 'crQuality' && value) return defects.filter(d => isCrQualityDefect(d, value));
        return [];
      }
      default:
        return [];
    }
  }

  // release-intelligence Home page's "CR-ים לא עומדים ביעד איכות" card — see
  // CR_QUALITY_TARGET/CR_QUALITY_SEVERITY_WEIGHT above for the formula.
  // actualEffortDays comes from VersionCrAssignment (denormalized per team
  // row from CR_LIST's "Actuals" column); a CR with no effort data can't be
  // scored and is left out of the result entirely, not counted as pass or fail.
  async getCrQualityScores(versionId: string): Promise<{
    crNumber: string; crLabel: string; defectCount: number; actualEffortDays: number; score: number; meetsTarget: boolean;
  }[]> {
    const [defects, vcaRows] = await Promise.all([
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      prisma.versionCrAssignment.findMany({ where: { versionId, syncStatus: { not: 'REMOVED' } } }),
    ]);

    // One row per CR — VersionCrAssignment has one row per (CR, team), so
    // dedupe and keep the largest actualEffortDays seen for that CR.
    const byCr = new Map<string, { crNumber: string; crLabel: string; actualEffortDays: number | null }>();
    for (const r of vcaRows as any[]) {
      const existing = byCr.get(r.crNumber);
      const days = r.actualEffortDays ?? null;
      if (!existing || (days ?? 0) > (existing.actualEffortDays ?? 0)) {
        byCr.set(r.crNumber, { crNumber: r.crNumber, crLabel: r.crLabel ?? '', actualEffortDays: days });
      }
    }

    return Array.from(byCr.values())
      .filter(cr => cr.actualEffortDays != null && cr.actualEffortDays > 0)
      .map(cr => {
        const crDefects = defects.filter(d => isCrQualityDefect(d, cr.crNumber));
        const weightedSum = crDefects.reduce((s, d) => s + (CR_QUALITY_SEVERITY_WEIGHT[d.severity] ?? 0), 0);
        const score = weightedSum / (cr.actualEffortDays as number);
        return {
          crNumber: cr.crNumber, crLabel: cr.crLabel, defectCount: crDefects.length,
          actualEffortDays: cr.actualEffortDays as number, score, meetsTarget: score <= CR_QUALITY_TARGET,
        };
      });
  }

  // ── Risk CRUD — spec section 23 ─────────────────────────────────────────────
  listRisks(versionId: string) {
    return prisma.releaseRisk.findMany({ where: { versionId }, orderBy: { createdAt: 'desc' } });
  }

  createRisk(data: {
    versionId: string; title: string; description?: string; severity?: string;
    impact?: string; probability?: string; owner?: string; mitigation?: string; createdBy: string;
  }) {
    if (!data.title?.trim()) throw new BadRequestException('כותרת סיכון היא שדה חובה');
    return prisma.releaseRisk.create({ data: data as any });
  }

  updateRisk(id: string, data: Partial<{
    title: string; description: string; severity: string; impact: string;
    probability: string; owner: string; mitigation: string; status: string;
  }>) {
    return prisma.releaseRisk.update({ where: { id }, data: data as any });
  }

  closeRisk(id: string) {
    return prisma.releaseRisk.update({ where: { id }, data: { status: 'CLOSED' } });
  }

  // ── Alerts & Intelligence — spec section 22 ─────────────────────────────────
  // Section A (Manual Messages) and Section B (Automatic Insights) share the
  // ReleaseInsight table, distinguished by `source`. Auto-insights are written
  // by getOverview() as a recomputed snapshot; manual messages are CRUD below.
  // Section C (Recommended Actions) is UI-only — no backend, see GoNoGoView/
  // AlertsIntelligenceView linking back to the existing risk-creation flow.
  async getAlerts(versionId: string) {
    const [manual, auto] = await Promise.all([
      prisma.releaseInsight.findMany({ where: { versionId, source: 'MANUAL' }, orderBy: { createdAt: 'desc' } }),
      prisma.releaseInsight.findMany({ where: { versionId, source: 'AUTO' }, orderBy: { createdAt: 'desc' } }),
    ]);
    return { manual, auto };
  }

  createAlert(data: {
    versionId: string; category: string; severity?: string; title: string; message: string; createdBy: string;
  }) {
    if (!data.title?.trim()) throw new BadRequestException('כותרת היא שדה חובה');
    return prisma.releaseInsight.create({ data: { ...data, source: 'MANUAL' } as any });
  }

  deleteAlert(id: string) {
    return prisma.releaseInsight.delete({ where: { id } });
  }

  // ── Go / No-Go — spec section 26 ────────────────────────────────────────────
  // Advisory/record-only — see model comment in schema.prisma. systemRecommendation
  // is derived from the already-persisted ReleaseHealth.healthScore (same
  // thresholds used for the Overview KPI color: ≥70 GO, 40-69 CONDITIONAL_GO, <40 NO_GO).
  private recommendationFromHealth(healthScore: number): string {
    return healthScore >= 70 ? 'GO' : healthScore >= 40 ? 'CONDITIONAL_GO' : 'NO_GO';
  }

  // Approver fields store raw user IDs (audit-correct); resolve to display
  // names only in the API response, mirroring the userNameById pattern used
  // for QA assignments/tasks elsewhere in this file.
  private async withResolvedApproverNames<T extends {
    qaManagerBy: string | null; releaseManagerBy: string | null; managementBy: string | null;
  }>(decision: T): Promise<T> {
    const ids = [decision.qaManagerBy, decision.releaseManagerBy, decision.managementBy].filter((id): id is string => !!id);
    if (ids.length === 0) return decision;
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
    const nameById = new Map(users.map(u => [u.id, u.fullName]));
    return {
      ...decision,
      qaManagerBy: decision.qaManagerBy ? (nameById.get(decision.qaManagerBy) ?? decision.qaManagerBy) : null,
      releaseManagerBy: decision.releaseManagerBy ? (nameById.get(decision.releaseManagerBy) ?? decision.releaseManagerBy) : null,
      managementBy: decision.managementBy ? (nameById.get(decision.managementBy) ?? decision.managementBy) : null,
    };
  }

  async getGoNoGo(versionId: string) {
    const health = await prisma.releaseHealth.findUnique({ where: { versionId } });
    const systemRecommendation = this.recommendationFromHealth(health?.healthScore ?? 0);

    const existing = await prisma.goNoGoDecision.findUnique({ where: { versionId } });
    if (!existing) {
      const created = await prisma.goNoGoDecision.create({ data: { versionId, systemRecommendation } });
      return this.withResolvedApproverNames(created);
    }
    if (existing.systemRecommendation !== systemRecommendation) {
      const updated = await prisma.goNoGoDecision.update({ where: { versionId }, data: { systemRecommendation } });
      return this.withResolvedApproverNames(updated);
    }
    return this.withResolvedApproverNames(existing);
  }

  async updateGoNoGoStage(
    versionId: string,
    stage: 'qa-manager' | 'release-manager' | 'management',
    status: string,
    userId: string,
  ) {
    const fieldMap = {
      'qa-manager':      { statusField: 'qaManagerStatus',      byField: 'qaManagerBy',      atField: 'qaManagerAt' },
      'release-manager': { statusField: 'releaseManagerStatus', byField: 'releaseManagerBy', atField: 'releaseManagerAt' },
      'management':      { statusField: 'managementStatus',     byField: 'managementBy',     atField: 'managementAt' },
    } as const;
    const fields = fieldMap[stage];
    if (!fields) throw new BadRequestException('שלב לא חוקי');

    const health = await prisma.releaseHealth.findUnique({ where: { versionId } });
    const systemRecommendation = this.recommendationFromHealth(health?.healthScore ?? 0);
    const data = { [fields.statusField]: status, [fields.byField]: userId, [fields.atField]: new Date() };

    const updated = await prisma.goNoGoDecision.upsert({
      where: { versionId },
      create: { versionId, systemRecommendation, ...data },
      update: data,
    });
    return this.withResolvedApproverNames(updated);
  }
}
