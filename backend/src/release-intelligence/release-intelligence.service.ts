import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { QcService, TestCoverageDto, DefectDto, BugDashboardDto } from '../qc/qc.service';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// QG thresholds — spec section 25: should come from QC Cycle Configuration,
// not be hardcoded. No such configuration exists yet, so these are the
// documented current defaults until that config surface is built.
const QG_DEFAULTS = { SHOW_STOPPER: 1, SEVERE: 5, MEDIUM: 10, LOW: 20 };

const CLOSED_DEFECT_STATUSES = ['Closed', 'Canceled', 'Rejected', 'Fixed'];
const CRITICAL_SEVERITIES = ['Show Stopper', 'Severe'];

const SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

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
    const [workPlan, defects] = await Promise.all([
      prisma.qaWorkPlan.findUnique({ where: { versionId }, include: { cycles: true } }),
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
    ]);
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
    const { qgSummary, qgPass } = this.computeQgSummary(openDefects);

    const now = Date.now();
    const cycles = [...(workPlan?.cycles ?? [])].sort((a, b) => a.plannedStart.getTime() - b.plannedStart.getTime());
    const timeline = cycles.map(c => {
      const total = c.plannedEnd.getTime() - c.plannedStart.getTime();
      const elapsed = Math.min(Math.max(now - c.plannedStart.getTime(), 0), Math.max(total, 0));
      const progressPct = total > 0 ? Math.round((elapsed / total) * 100) : (now > c.plannedEnd.getTime() ? 100 : 0);
      const state: 'done' | 'active' | 'upcoming' = now > c.plannedEnd.getTime() ? 'done' : now < c.plannedStart.getTime() ? 'upcoming' : 'active';
      return { cycleType: c.cycleType, plannedStart: c.plannedStart, plannedEnd: c.plannedEnd, progressPct, state };
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
