import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { QcService, TestCoverageDto, DefectDto, BugDashboardDto, DefectByCycleDto, CrCoverageDto, CycleQgTargetDto, CycleTestTotalsDto, resolveDefectPersonNames, bugStatusBucket, executedScriptCount } from '../qc/qc.service';
import { countWorkDays, nextWorkDay, isWorkDay, dateKey } from '../qa/qa.scheduler';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// QG thresholds — spec section 25: should come from QC Cycle Configuration,
// not be hardcoded. No such configuration exists yet, so these are the
// documented current defaults until that config surface is built.
// SHOW_STOPPER is 0, not a typo — zero tolerance (user-confirmed 2026-09-01:
// a single open Show Stopper must fail the gate, unlike the other
// severities which tolerate a threshold count before failing).
const QG_DEFAULTS = { SHOW_STOPPER: 0, SEVERE: 5, MEDIUM: 10, LOW: 20 };

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
// "תקלה קריטית" = Show Stopper ONLY (user-confirmed 2026-09-09 — Severe is
// serious but NOT "critical"). SEVERE_OR_WORSE stays the two-severity set for
// the places that genuinely mean "חמור ומעלה" (the QG severe-or-worse target,
// its drill-down), never labelled "critical" to the user.
const CRITICAL_SEVERITIES = ['Show Stopper'];
const SEVERE_OR_WORSE = ['Show Stopper', 'Severe'];

// "Core" cycles for the Home page's version-wide coverage % and the forecast
// pace check — UAT/REHEARSAL/STAND_ALONE/GO_LIVE deliberately excluded (spec
// confirmed 2026-09-02: coverage should reflect the 3 real testing cycles,
// not rehearsal/UAT noise).
const CORE_CYCLE_TYPES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'];
// Daily QA standup cutoff — if the meeting runs before this local hour the
// per-CR daily targets are framed for TODAY (today's work day still counts);
// at or after it, they're framed for TOMORROW. Overridable per request and
// admin-configurable via the DAILY_QA_STANDUP_CUTOFF SystemParam.
const DAILY_QA_STANDUP_CUTOFF_DEFAULT = '12:00';
// Real QC priority value for a script-blocking defect (spec confirmed
// 2026-09-02) — usually opened alongside a test script marked "Blocked",
// used here to supply the human-readable "why is this CR blocked" reason.
const TEST_BLOCKER_PRIORITY = 'Test Blocker';

// Same Hebrew cycle labels as the frontend's own CYCLE_LABEL (CycleProgressView.tsx
// / ReleaseIntelligenceHomeView.tsx) — needed here only for forecastWarnings'
// human-readable message text, not duplicated logic.
const CYCLE_LABEL: Record<string, string> = {
  CYCLE_1: 'סבב 1', CYCLE_2: 'סבב 2', CYCLE_3: 'סבב 3',
  STAND_ALONE: 'Stand Alone', UAT: 'UAT', REHEARSAL: 'חזרה גנרלית', GO_LIVE: 'עליה לאוויר',
};

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
// Points a single open/mitigating ReleaseRisk costs the 0-100 riskScore,
// severity-weighted instead of a flat 15 each (spec 2026-09-06). A HIGH-risk
// CrPlan weighs the same as a HIGH-severity risk.
const RISK_SEVERITY_WEIGHT: Record<string, number> = { CRITICAL: 15, HIGH: 10, MEDIUM: 6, LOW: 3 };
const HIGH_RISK_CR_WEIGHT = 10;

// ── Release readiness model (spec 2026-09-09) ──────────────────────────────
// A GATED model, not a flat average: hard blockers cap the final score, the
// soft weighted score fills in "how much polish is left" when nothing blocks.
//   readiness = min(softScore, min(ceiling of every triggered blocker))
// Time-agnostic in v1 (no proximity-to-go-live weighting — user decision).
const READINESS_WEIGHTS = { defects: 0.35, coverage: 0.35, forecast: 0.20, risk: 0.10 };
// Defect axis — weighted penalty per OPEN defect, anchored to QG_DEFAULTS
// ("sitting exactly at a severity's gate limit" costs roughly its share of
// the axis). Show Stopper is also a hard blocker below, so its weight only
// matters for the pre-ceiling number.
const DEFECT_QUALITY_PENALTY: Record<string, number> = { 'Show Stopper': 45, Severe: 4, Medium: 1.5, Low: 0.5 };
// executed% / passed% below these (once there IS core-cycle data) are blockers.
const READINESS_COVERAGE_FLOOR_PCT = 50;
const READINESS_PASSRATE_FLOOR_PCT = 60;
// Ceiling each blocker imposes on the final readiness score.
const READINESS_CEILING = {
  showStopperOpen:         25,
  severeOverQg:            40,
  coverageCriticallyLow:   40,
  passRateCriticallyLow:   40,
  forecastBehind:          45,
  unmitigatedCriticalRisk: 45,
};
// readiness → recommendation (also the Overview KPI colour bands).
function readinessRecommendation(score: number): string {
  return score >= 75 ? 'GO' : score >= 50 ? 'CONDITIONAL_GO' : 'NO_GO';
}

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
  private readonly logger = new Logger(ReleaseIntelligenceService.name);

  // ── Overview aggregator — spec section 11 ──────────────────────────────────
  async getOverview(versionId: string) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const [defects, openRisks, crPlans, params, cycleProgress, crAssignments, workPlan] = await Promise.all([
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      // A risk stays "open" until it's CLOSED — MITIGATED ("בטיפול") still
      // counts against readiness (spec 2026-09-06).
      prisma.releaseRisk.findMany({ where: { versionId, status: { not: 'CLOSED' } } }),
      prisma.crPlan.findMany({ where: { versionId }, select: { riskLevel: true } }),
      prisma.systemParam.findMany({ where: { key: { in: ['FORECAST_ALERT_DAYS'] } } }),
      this.getCycleProgress(versionId).catch(() => null),
      // For overdueUnstartedCrs below — needs qaReceived (don't re-flag a CR
      // dev simply hasn't delivered yet, already its own separate alert) and
      // the tester's actual planned slot for the CR (don't flag a CR that's
      // just legitimately still queued behind other work).
      prisma.versionCrAssignment.findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: { crNumber: true, qaReceived: true, qaArrivalDate: true },
      }),
      prisma.qaWorkPlan.findUnique({ where: { versionId }, include: { cycles: { include: { tasks: true } } } }),
    ]);

    const paramMap = Object.fromEntries(params.map(p => [p.key, p.value]));
    const alertDays = Number(paramMap['FORECAST_ALERT_DAYS'] ?? 5);

    // Version-wide coverage % — real per-CR script counts (Passed+Failed only,
    // NOT blocked/notRun/notCompleted/notReady/N/A), summed across the 3 core
    // cycles only. Replaces the old subject/folder-level getTestCoverage calc
    // (spec confirmed 2026-09-02).
    const coreCrCoverage = (cycleProgress?.timeline ?? [])
      .filter(t => CORE_CYCLE_TYPES.includes(t.cycleType))
      .flatMap(t => t.crCoverage.map(cc => ({ ...cc, cycleType: t.cycleType })));
    const coreTotal = coreCrCoverage.reduce((s, cc) => s + cc.total, 0);
    // executed% must use the SAME definition as getCrCoverage / getCycleProgress
    // and ALM (executedScriptCount — includes Blocked / Not Completed / N/A /
    // Not Relevant, excludes No Run / Not Ready for QA). This spot previously
    // counted passed+failed only, so the RI-Home "כיסוי בדיקות" tile and the
    // readiness coverage axis read lower than the cycle screen for the same
    // release (fixed 2026-09-10).
    const coreExecuted = coreCrCoverage.reduce((s, cc) => s + executedScriptCount(cc), 0);
    const corePassed = coreCrCoverage.reduce((s, cc) => s + cc.passed, 0);
    // executed% (ran) and passed% (ran AND passed) across the 3 core cycles.
    const coveragePct = coreTotal > 0 ? Math.round((coreExecuted / coreTotal) * 10000) / 100 : 0;
    const passedPct = coreTotal > 0 ? Math.round((corePassed / coreTotal) * 10000) / 100 : 0;

    // Critical defects — open, severity Show Stopper (see CRITICAL_SEVERITIES)
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));

    // Blocked CRs — a CR only appears here if it BOTH has blocked scripts in
    // a core cycle AND has a still-genuinely-open Test Blocker-priority
    // defect reported against it (usually opened alongside the blocked
    // script — no guaranteed 1:1 link, so this is a best-effort match by CR
    // number, not a hard reference). "Still open" is stricter than the
    // general openDefects filter above: it also excludes Fixed_Test — once
    // QA has verified the fix, the CR shouldn't keep nagging as blocked here
    // even if the script's own exec status in QC hasn't been re-run yet
    // (spec confirmed 2026-09-03).
    const blockedCrs = coreCrCoverage
      .filter(cc => cc.blocked > 0)
      .map(cc => ({
        crNumber: cc.crNumber, crLabel: cc.crLabel, cycleType: cc.cycleType, blockedCount: cc.blocked,
        reasonDefects: openDefects
          .filter(d => d.crReferenceNumber === cc.crNumber && d.priority === TEST_BLOCKER_PRIORITY && d.status !== 'Fixed_Test')
          .map(d => ({ id: d.id, title: d.title })),
      }))
      .filter(cr => cr.reasonDefects.length > 0);

    // Overdue-unstarted CRs — deliberately NOT just "0% executed": that alone
    // is noisy (a CR legitimately queued behind other work for the same
    // tester, or one dev hasn't delivered yet, both show 0% and aren't a QA
    // problem). Flagged only when ALL of: has scenarios planned, genuinely
    // 0 executed and not blocked (blocked CRs already surface via blockedCrs
    // above — don't double-flag), QA actually received it (qaReceived —
    // otherwise it's the existing "not yet received" alert's job, not this
    // one's), AND the tester's own planned slot for it (QaCycleTask.plannedStart,
    // core cycles only, earliest if more than one) has already passed — a CR
    // with no matching task at all is left out rather than guessed at (user
    // confirmed 2026-09-04).
    const crTotals = new Map<string, { crLabel: string; total: number; passed: number; failed: number; blocked: number }>();
    for (const cc of coreCrCoverage) {
      const existing = crTotals.get(cc.crNumber) ?? { crLabel: cc.crLabel, total: 0, passed: 0, failed: 0, blocked: 0 };
      existing.total += cc.total; existing.passed += cc.passed; existing.failed += cc.failed; existing.blocked += cc.blocked;
      crTotals.set(cc.crNumber, existing);
    }
    const qaReceivedByCr = new Map(crAssignments.map(a => [a.crNumber, a.qaReceived]));
    const plannedStartByCr = new Map<string, Date>();
    for (const cycle of workPlan?.cycles ?? []) {
      if (!CORE_CYCLE_TYPES.includes(cycle.cycleType)) continue;
      for (const task of cycle.tasks) {
        if (task.taskType !== 'CR' || task.isArchived || !task.isActive) continue;
        const existing = plannedStartByCr.get(task.crNumber);
        if (!existing || task.plannedStart < existing) plannedStartByCr.set(task.crNumber, task.plannedStart);
      }
    }
    const nowMs = Date.now();
    const overdueUnstartedCrs = Array.from(crTotals.entries())
      .filter(([, t]) => t.total > 0 && t.passed === 0 && t.failed === 0 && t.blocked === 0)
      .filter(([crNumber]) => qaReceivedByCr.get(crNumber) === true)
      .map(([crNumber, t]) => {
        const plannedStart = plannedStartByCr.get(crNumber);
        return plannedStart && plannedStart.getTime() <= nowMs ? { crNumber, crLabel: t.crLabel, plannedStart } : null;
      })
      .filter((x): x is { crNumber: string; crLabel: string; plannedStart: Date } => x !== null);

    // Worst-offending CR by open defect count — openDefects already excludes
    // Canceled (CLOSED_DEFECT_STATUSES), so no separate exclusion needed.
    // Surfaced on the Home defects tile so "N תקלות פתוחות" isn't just a flat
    // count with no sense of concentration (spec confirmed 2026-09-04).
    const openDefectsByCrCount = new Map<string, number>();
    for (const d of openDefects) {
      if (!d.crReferenceNumber) continue;
      openDefectsByCrCount.set(d.crReferenceNumber, (openDefectsByCrCount.get(d.crReferenceNumber) ?? 0) + 1);
    }
    let worstCr: { crNumber: string; count: number } | null = null;
    for (const [crNumber, count] of openDefectsByCrCount) {
      if (!worstCr || count > worstCr.count) worstCr = { crNumber, count };
    }

    const criticalOpenDefects = openDefects.filter(d => CRITICAL_SEVERITIES.includes(d.severity));
    const criticalDefects = criticalOpenDefects.length;
    // Oldest still-open critical defect's age — a bare count doesn't say
    // whether the criticals are fresh or have been sitting for weeks.
    const criticalAges = criticalOpenDefects.map(d => parseOracleDateAgeDays(d.discoveryDate, nowMs)).filter((a): a is number => a != null);
    const oldestCriticalDefectAgeDays = criticalAges.length > 0 ? Math.max(...criticalAges) : null;

    // QG summary — open defect counts by severity vs thresholds
    const { qgSummary, qgPass } = this.computeQgSummary(openDefects);

    // Days to go live
    const daysToGoLive = version.plannedStart
      ? Math.ceil((new Date(version.plannedStart).getTime() - Date.now()) / 86400000)
      : null;

    // ── Forecast — two independent checks, shown as two separate indicators
    // on the same card (spec confirmed 2026-09-02), replacing the old single
    // remainingTests/testDurationMin heuristic:

    // 1) Pace: scenarios remaining in the CURRENT core cycle (CYCLE_1/2/3),
    // at a fixed 1 hour/scenario, against time remaining to that cycle's own
    // end — EXCEPT when it's the last core cycle (CYCLE_3), where the
    // deadline is the version's own go-live (plannedStart) instead, since
    // there's no next cycle left to absorb overflow into.
    const coreCycles = (cycleProgress?.timeline ?? []).filter(t => CORE_CYCLE_TYPES.includes(t.cycleType));
    const activeCoreCycle = coreCycles.find(t => t.state === 'active') ?? null;
    let forecastPace: {
      status: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN'; cycleType: string; isLastCycle: boolean;
      remainingScenarios: number; hoursRequired: number; hoursRemaining: number;
    } | null = null;
    if (activeCoreCycle) {
      const remainingScenarios = activeCoreCycle.crCoverage.reduce((s, cc) => s + Math.max(0, cc.total - cc.passed - cc.failed), 0);
      const isLastCycle = activeCoreCycle.cycleType === CORE_CYCLE_TYPES[CORE_CYCLE_TYPES.length - 1];
      const deadline = isLastCycle ? version.plannedStart : activeCoreCycle.plannedEnd;
      if (deadline) {
        const hoursRequired = remainingScenarios * 1; // 1 hour/scenario, fixed (spec confirmed 2026-09-02)
        const hoursRemaining = (new Date(deadline).getTime() - Date.now()) / 3600000;
        const bufferHours = alertDays * 8; // reuse FORECAST_ALERT_DAYS as an 8h-workday buffer, same param the old heuristic used
        const status: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' =
          hoursRemaining < hoursRequired ? 'BEHIND_PLAN'
          : hoursRemaining < hoursRequired + bufferHours ? 'AT_RISK'
          : 'ON_TRACK';
        forecastPace = { status, cycleType: activeCoreCycle.cycleType, isLastCycle, remainingScenarios, hoursRequired, hoursRemaining: Math.round(hoursRemaining) };
      }
    }

    // 2) Defect-rate: current open-defect count against how many defects the
    // team could realistically fix by go-live, projected from the historical
    // defect-fix throughput of the last 3 completed versions' own testing-
    // phase windows (qaStart→qaEnd). Best-effort — null (and simply not
    // shown) when there isn't enough historical data or Oracle is disabled,
    // per the user's own "if possible" framing (spec confirmed 2026-09-02).
    const historicalRate = await this.getHistoricalDefectFixRate(versionId).catch(() => null);
    let forecastDefectRate: {
      status: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN'; openDefects: number; expectedFixable: number;
      avgFixesPerDay: number; sampleVersions: number;
    } | null = null;
    if (historicalRate && daysToGoLive != null && daysToGoLive > 0) {
      const expectedFixable = historicalRate.avgFixesPerDay * daysToGoLive;
      const ratio = expectedFixable > 0 ? openDefects.length / expectedFixable : (openDefects.length > 0 ? Infinity : 0);
      const status: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' = ratio > 1 ? 'BEHIND_PLAN' : ratio > 0.8 ? 'AT_RISK' : 'ON_TRACK';
      forecastDefectRate = {
        status, openDefects: openDefects.length, expectedFixable: Math.round(expectedFixable),
        avgFixesPerDay: Math.round(historicalRate.avgFixesPerDay * 10) / 10, sampleVersions: historicalRate.sampleVersions,
      };
    }

    // Overall forecastStatus — worst of the two checks that actually have
    // data, kept for healthScore and any existing single-status consumers;
    // ON_TRACK when neither check has data (nothing to flag).
    const STATUS_RANK = { ON_TRACK: 0, AT_RISK: 1, BEHIND_PLAN: 2 } as const;
    const forecastStatus: 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' = [forecastPace?.status, forecastDefectRate?.status]
      .filter((s): s is 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN' => !!s)
      .reduce((worst, s) => (STATUS_RANK[s] > STATUS_RANK[worst] ? s : worst), 'ON_TRACK' as 'ON_TRACK' | 'AT_RISK' | 'BEHIND_PLAN');

    // Risk score from CrPlan.riskLevel + ReleaseRisk table
    const highRiskCrs = crPlans.filter(p => p.riskLevel === 'HIGH').length;
    const openRisksCount = openRisks.length;

    // ── Readiness score (0-100) — GATED model (spec 2026-09-09) ─────────────
    // Four soft axes, unequal weights (READINESS_WEIGHTS), then hard blockers
    // cap the result: readiness = min(softScore, min(triggered ceilings)).

    // Axis 1 — defects: severity-weighted penalty from the QG summary (one
    // model, so this can't disagree with qgPass the way the old flat
    // "100 − criticalDefects*10" did). qgSummary keys: showStopper/severe/medium/low.
    const defectPenalty =
        qgSummary.showStopper.count * DEFECT_QUALITY_PENALTY['Show Stopper']
      + qgSummary.severe.count      * DEFECT_QUALITY_PENALTY.Severe
      + qgSummary.medium.count      * DEFECT_QUALITY_PENALTY.Medium
      + qgSummary.low.count         * DEFECT_QUALITY_PENALTY.Low;
    const defectsAxis = Math.max(0, Math.round(100 - defectPenalty));

    // Axis 2 — coverage: blend of executed% and pass% (0.4/0.6). Neutral 50
    // when there's no core-cycle data yet (Oracle off / testing not started) —
    // not 100, so an untested version doesn't read as "ready".
    const coverageAxis = coreTotal > 0 ? Math.round(0.4 * coveragePct + 0.6 * passedPct) : 50;

    // Axis 3 — forecast.
    const forecastAxis = forecastStatus === 'ON_TRACK' ? 100 : forecastStatus === 'AT_RISK' ? 60 : 20;

    // Axis 4 — risk (unchanged weighting).
    const riskWeight = openRisks.reduce((s, r) => s + (RISK_SEVERITY_WEIGHT[r.severity] ?? RISK_SEVERITY_WEIGHT.MEDIUM), 0)
      + highRiskCrs * HIGH_RISK_CR_WEIGHT;
    const riskAxis = Math.max(0, 100 - riskWeight);

    const softScore = Math.round(
        READINESS_WEIGHTS.defects  * defectsAxis
      + READINESS_WEIGHTS.coverage * coverageAxis
      + READINESS_WEIGHTS.forecast * forecastAxis
      + READINESS_WEIGHTS.risk     * riskAxis,
    );

    // Hard blockers — each caps the final score; the score also carries the
    // human-readable reason(s) it landed where it did.
    const ceilings: number[] = [];
    const readinessBlockers: string[] = [];
    if (qgSummary.showStopper.count > 0) {
      ceilings.push(READINESS_CEILING.showStopperOpen);
      readinessBlockers.push(`${qgSummary.showStopper.count} תקלות Show Stopper פתוחות`);
    }
    if (qgSummary.severe.count > qgSummary.severe.threshold) {
      ceilings.push(READINESS_CEILING.severeOverQg);
      readinessBlockers.push(`${qgSummary.severe.count} תקלות Severe פתוחות (סף QG: ${qgSummary.severe.threshold})`);
    }
    if (coreTotal > 0 && coveragePct < READINESS_COVERAGE_FLOOR_PCT) {
      ceilings.push(READINESS_CEILING.coverageCriticallyLow);
      readinessBlockers.push(`כיסוי ביצוע ${coveragePct}% (מתחת ל-${READINESS_COVERAGE_FLOOR_PCT}%)`);
    }
    if (coreTotal > 0 && passedPct < READINESS_PASSRATE_FLOOR_PCT) {
      ceilings.push(READINESS_CEILING.passRateCriticallyLow);
      readinessBlockers.push(`אחוז הצלחה ${passedPct}% (מתחת ל-${READINESS_PASSRATE_FLOOR_PCT}%)`);
    }
    if (forecastStatus === 'BEHIND_PLAN') {
      ceilings.push(READINESS_CEILING.forecastBehind);
      readinessBlockers.push('התחזית מצביעה על חריגה מלוח הזמנים');
    }
    const unmitigatedCriticalRisks = openRisks.filter(r => r.severity === 'CRITICAL' && r.status !== 'MITIGATED');
    if (unmitigatedCriticalRisks.length > 0) {
      ceilings.push(READINESS_CEILING.unmitigatedCriticalRisk);
      readinessBlockers.push(`${unmitigatedCriticalRisks.length} סיכון קריטי לא ממותן`);
    }
    const ceiling = ceilings.length > 0 ? Math.min(...ceilings) : 100;
    const healthScore = Math.min(softScore, ceiling);

    // "Why the score is here" — every blocker that fired, plus the single
    // lowest soft axis when there are 0-1 blockers (so the reason list is
    // never empty and never just repeats one thing).
    const AXIS_LABEL: Record<string, string> = { defects: 'תקלות', coverage: 'כיסוי והצלחה', forecast: 'תחזית', risk: 'סיכון' };
    const axesSorted = ([
      ['defects', defectsAxis], ['coverage', coverageAxis], ['forecast', forecastAxis], ['risk', riskAxis],
    ] as [string, number][]).sort((a, b) => a[1] - b[1]);
    const readinessReasons = [
      ...readinessBlockers.map(b => `⛔ ${b}`),
      ...(readinessBlockers.length < 2 && axesSorted[0][1] < 70 ? [`ציר נמוך — ${AXIS_LABEL[axesSorted[0][0]]}: ${axesSorted[0][1]}`] : []),
    ].slice(0, 3);

    // Kept names for the persisted ReleaseHealth columns + the frontend
    // breakdown: qualityScore = the defects axis, coverageScore = coverage axis.
    const qualityScore = defectsAxis;
    const riskScore = riskAxis;
    const forecastScore = forecastAxis;
    const coverageScoreForSnapshot = coverageAxis;

    // Persist snapshot rows (ReleaseHealth/ReleaseForecast — spec section 8)
    await Promise.all([
      prisma.releaseHealth.upsert({
        where: { versionId },
        create: { versionId, healthScore, coverageScore: coverageScoreForSnapshot, qualityScore, riskScore, forecastScore },
        update: { healthScore, coverageScore: coverageScoreForSnapshot, qualityScore, riskScore, forecastScore, calculatedAt: new Date() },
      }),
      prisma.releaseForecast.upsert({
        where: { versionId },
        create: { versionId, remainingTests: forecastPace?.remainingScenarios ?? 0, velocity: 0, status: forecastStatus },
        update: { remainingTests: forecastPace?.remainingScenarios ?? 0, status: forecastStatus, calculatedDate: new Date() },
      }),
    ]);

    // Every non-closed risk, worst severity first — the Home strip lists them
    // all now, not just the top-1 teaser the tile shows (spec 2026-09-06).
    const topRisks = [...openRisks]
      .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9))
      .map(r => ({ id: r.id, title: r.title, severity: r.severity, status: r.status, mitigation: r.mitigation ?? null }));

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

    const forecastWarnings: string[] = [];
    if (forecastPace && forecastPace.status !== 'ON_TRACK') {
      const cycleLabel = CYCLE_LABEL[forecastPace.cycleType] ?? forecastPace.cycleType;
      forecastWarnings.push(`נותרו ${forecastPace.remainingScenarios} תרחישים ב${cycleLabel} (${forecastPace.hoursRequired} שעות נדרשות) מול ${Math.max(0, forecastPace.hoursRemaining)} שעות שנותרו${forecastPace.isLastCycle ? ' עד לעלייה לאוויר' : ' עד לסיום הסבב'}`);
    }
    if (forecastDefectRate && forecastDefectRate.status !== 'ON_TRACK') {
      forecastWarnings.push(`${forecastDefectRate.openDefects} תקלות פתוחות מול יכולת תיקון משוערת של ${forecastDefectRate.expectedFixable} עד לעלייה לאוויר (קצב היסטורי: ${forecastDefectRate.avgFixesPerDay}/יום, ${forecastDefectRate.sampleVersions} גרסאות)`);
    }

    return {
      healthScore,
      // Sub-scores + GO/NO-GO reading + the "why". healthScore is the GATED
      // result (min of the weighted soft score and every triggered blocker's
      // ceiling), so a headline number can always be expanded into its 4
      // weighted axes AND the reason(s) it's capped where it is.
      healthBreakdown: { coverageScore: coverageAxis, qualityScore, riskScore, forecastScore },
      healthRecommendation: readinessRecommendation(healthScore),
      readinessReasons,
      softScore,
      coveragePct,
      passedPct,
      blockedCrs,
      overdueUnstartedCrs,
      criticalDefects,
      worstCr,
      oldestCriticalDefectAgeDays,
      openRisksCount,
      daysToGoLive,
      forecastStatus,
      forecastPace,
      forecastDefectRate,
      qgSummary,
      qgPass,
      topRisks,
      criticalAlerts,
      forecastWarnings,
      // Cross-module readiness context surfaced on the RI Home strip + the
      // emailed report (spec confirmed 2026-09-05). reviewMeetingTime is the
      // version's own field (already loaded above); the CR-plan submission
      // status and QA-arrival lateness are computed client-side from the
      // team-status / cr-assignments endpoints the Home already calls.
      reviewMeetingTime: version.reviewMeetingTime,
      // Bug found 2026-09-17: qgPass is purely severity-count math (0 open
      // Show Stopper/Severe trivially satisfies "<= threshold"), so a version
      // that hasn't started testing at all — nothing has run, nothing COULD
      // have violated the gate yet — showed "Quality Gate: PASS", read by
      // Nissim as a real pass. testingStarted (coreTotal > 0, same flag
      // already gating the coverage/pass-rate blockers above) lets the
      // frontend show "not evaluated yet" instead of a misleading PASS.
      testingStarted: coreTotal > 0,
      // Forecast card fix (2026-09-17): a COMPLETED version's daysToGoLive
      // goes negative (plannedStart is in the past) and reads as "N days
      // overdue" — the frontend swaps to "in production since <date>" using
      // these two instead once the version is actually done.
      versionStatus: version.status,
      productionSinceDate: version.actualStart ? version.actualStart.toISOString() : null,
    };
  }

  // Blended historical defect-fix throughput (fixes/day) from the last 3
  // COMPLETED versions' own testing-phase windows (qaStart→qaEnd), excluding
  // the version being forecast. Feeds the Forecast card's defect-rate check
  // (spec confirmed 2026-09-02: "אם אפשר לחשב 3 גרסאות אחרונות רק בשלב
  // הבדיקות"). Returns null when there's no usable history — Oracle
  // disabled, no completed versions with both QA dates set, or every
  // per-version Oracle call failed — rather than fabricate a rate.
  private async getHistoricalDefectFixRate(excludeVersionId: string): Promise<{ avgFixesPerDay: number; sampleVersions: number } | null> {
    const pastVersions = await prisma.version.findMany({
      where: { status: 'COMPLETED', id: { not: excludeVersionId }, qaStart: { not: null }, qaEnd: { not: null } },
      orderBy: { qaEnd: 'desc' },
      take: 3,
      select: { id: true, qaStart: true, qaEnd: true },
    });
    if (pastVersions.length === 0) return null;

    let totalFixed = 0;
    let totalDays = 0;
    let sampled = 0;
    for (const v of pastVersions) {
      if (!v.qaStart || !v.qaEnd) continue;
      const fixed = await this.qcService.getDefectFixRate(v.id, v.qaStart, v.qaEnd).catch(() => null);
      if (fixed == null) continue;
      const days = Math.max(1, (v.qaEnd.getTime() - v.qaStart.getTime()) / 86400000);
      totalFixed += fixed;
      totalDays += days;
      sampled++;
    }
    if (sampled === 0 || totalDays === 0) return null;
    return { avgFixesPerDay: totalFixed / totalDays, sampleVersions: sampled };
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
    const coveragePct = totalPlanned > 0 ? Math.round((totalPassed / totalPlanned) * 10000) / 100 : 0;

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

  // ── Daily QA Meeting — redesigned 2026-09-03 (was a flat per-CR table with
  // a simple health flag). New structure: exec summary, per-tester heat map,
  // per-CR risk list, and auto-alerts — built for the actual daily standup
  // use case ("30 seconds to know if the release is at risk, who's stuck,
  // what needs escalation"). Deliberately a SEPARATE risk metric from
  // Quality Gate PASS/FAIL, CR Quality Score, and the coverage card's
  // blocked-CR list — those answer different questions, not something this
  // screen reconciles with (spec confirmed 2026-09-03). Reuses
  // getCycleProgress as its data foundation instead of re-deriving per-CR
  // data a second time — crCoverage rows already carry
  // tester/project/defectsBySeverity per CR (added 2026-09-02/03).
  async getDailyQaManagement(versionId: string, targetDayOverride?: 'today' | 'tomorrow') {
    const [version, cycleProgress, defects, crAssignments, releaseHealth, prevSnapshot, holidayDates, cutoffParam] = await Promise.all([
      prisma.version.findUnique({ where: { id: versionId }, select: { plannedStart: true } }),
      this.getCycleProgress(versionId),
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
      prisma.versionCrAssignment.findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: { crNumber: true, teamId: true, team: { select: { name: true } } },
      }),
      // Read the persisted Overview snapshot rather than recompute the whole
      // health formula here (it needs every input getOverview gathers). Same
      // read-the-snapshot pattern getGoNoGo uses. null until getOverview has
      // run once for this version — the UI shows a "not computed yet" state.
      prisma.releaseHealth.findUnique({ where: { versionId } }),
      // Yesterday's DailyQaSnapshot — for the per-CR "done today" delta.
      prisma.dailyQaSnapshot.findFirst({ where: { versionId }, orderBy: { snapshotDate: 'desc' } }),
      prisma.seasonDate.findMany({ where: { season: { forcesOff: true } }, select: { date: true } }),
      prisma.systemParam.findUnique({ where: { key: 'DAILY_QA_STANDUP_CUTOFF' } }),
    ]);
    const openDefects = defects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
    const now = Date.now();
    const holidayDays = new Set(holidayDates.map(d => dateKey(d.date)));

    // ── Per-CR daily targets — "how many scenarios each CR needs to clear
    // today/tomorrow to still finish its cycle on time". Frame for today vs
    // tomorrow by the standup-cutoff hour (overridable per request).
    const cutoff = (cutoffParam?.value ?? DAILY_QA_STANDUP_CUTOFF_DEFAULT).trim();
    const cutoffHour = Number(cutoff.split(':')[0]) || 12;
    const nowDate = new Date(now);
    const targetDay: 'today' | 'tomorrow' = targetDayOverride ?? (nowDate.getHours() < cutoffHour ? 'today' : 'tomorrow');
    // The work day the target is counted from: today if it's a work day and
    // we're framing for "today", otherwise the next work day.
    const targetStart = (targetDay === 'today' && isWorkDay(nowDate, holidayDays))
      ? (() => { const d = new Date(nowDate); d.setHours(0, 0, 0, 0); return d; })()
      : nextWorkDay(nowDate, holidayDays);
    const activeCoreForTarget = cycleProgress.timeline.filter(t => CORE_CYCLE_TYPES.includes(t.cycleType)).find(t => t.state === 'active') ?? null;
    const isLastCore = activeCoreForTarget?.cycleType === CORE_CYCLE_TYPES[CORE_CYCLE_TYPES.length - 1];
    const targetDeadline: Date | null = activeCoreForTarget
      ? (isLastCore ? (version?.plannedStart ?? activeCoreForTarget.plannedEnd) : activeCoreForTarget.plannedEnd)
      : null;
    const workDaysLeft = targetDeadline ? countWorkDays(targetStart, targetDeadline, holidayDays) : null;
    const prevCrProgress = (prevSnapshot?.crProgress ?? null) as Record<string, { passed: number; failed: number; total: number }> | null;

    // Per CR: remaining scenarios ÷ work days left (rounded up). No active
    // core cycle → no target. Past the deadline (workDaysLeft ≤ 0) → the whole
    // remainder is "due now".
    const dailyTargetForCr = (remaining: number): { target: number | null; mustFinishNow: boolean } => {
      if (remaining <= 0) return { target: 0, mustFinishNow: false };
      if (workDaysLeft == null) return { target: null, mustFinishNow: false };
      if (workDaysLeft <= 0) return { target: remaining, mustFinishNow: true };
      return { target: Math.ceil(remaining / workDaysLeft), mustFinishNow: false };
    };

    // CR → team(s) — spec area's Release/Team view toggle. A CR can be
    // assigned to more than one team (VersionCrAssignment's unique key is
    // versionId+crNumber+teamId, not just versionId+crNumber), so it can
    // legitimately show up under more than one team in Team View.
    const teamsByCr = new Map<string, { id: string; name: string }[]>();
    for (const a of crAssignments) {
      const list = teamsByCr.get(a.crNumber) ?? [];
      if (!list.some(t => t.id === a.teamId)) list.push({ id: a.teamId, name: a.team.name });
      teamsByCr.set(a.crNumber, list);
    }

    const coreCrCoverage = cycleProgress.timeline
      .filter(t => CORE_CYCLE_TYPES.includes(t.cycleType))
      .flatMap(t => t.crCoverage);

    // One row per CR — a CR can appear in more than one core cycle; script
    // execution counts are genuinely additive across cycles, but
    // tester/project/defect breakdown are identical on every cycle-row for
    // the same CR (assignment and defects aren't cycle-scoped, only script
    // execution is) — keep the first-seen value for those, don't sum them.
    interface DailyCrAgg {
      crNumber: string; crLabel: string; tester: string | null;
      passed: number; failed: number; total: number; blocked: number;
      defectsBySeverity: { showStopper: number; severe: number; medium: number; low: number };
    }
    const byCr = new Map<string, DailyCrAgg>();
    for (const cc of coreCrCoverage) {
      const existing = byCr.get(cc.crNumber);
      if (!existing) {
        byCr.set(cc.crNumber, {
          crNumber: cc.crNumber, crLabel: cc.crLabel, tester: cc.tester,
          passed: cc.passed, failed: cc.failed, total: cc.total, blocked: cc.blocked,
          defectsBySeverity: { ...cc.defectsBySeverity },
        });
      } else {
        existing.passed += cc.passed;
        existing.failed += cc.failed;
        existing.total += cc.total;
        existing.blocked += cc.blocked;
      }
    }

    // Blocker "days open" — approximated from the age of a linked open Test
    // Blocker-priority defect (same best-effort CR-number match as the
    // coverage card's blocked-CR list), since there's no real Blocker entity
    // with its own open-date yet (a "Blockers Center" catalog is a separate,
    // larger follow-up, not built here). A CR with blocked>0 but no linked
    // defect still counts as blocked, just without an age to compare against
    // the 2-day threshold — treated as over-threshold rather than under,
    // since an unknown age shouldn't silently hide a real blocker.
    const blockerAgeByCr = new Map<string, number>();
    for (const d of openDefects) {
      if (d.priority !== TEST_BLOCKER_PRIORITY || !d.crReferenceNumber) continue;
      const age = parseOracleDateAgeDays(d.discoveryDate, now);
      if (age == null) continue;
      const existing = blockerAgeByCr.get(d.crReferenceNumber);
      if (existing == null || age > existing) blockerAgeByCr.set(d.crReferenceNumber, age);
    }

    const RISK_RANK = { HIGH: 2, MEDIUM: 1, LOW: 0 } as const;
    const crRows = Array.from(byCr.values()).map(cr => {
      const progressPct = cr.total > 0 ? Math.round((cr.passed / cr.total) * 100) : 0;
      const defectCount = cr.defectsBySeverity.showStopper + cr.defectsBySeverity.severe + cr.defectsBySeverity.medium + cr.defectsBySeverity.low;
      const hasCriticalDefect = cr.defectsBySeverity.showStopper > 0;
      const hasHighDefect = cr.defectsBySeverity.severe > 0;
      const blockerCount = cr.blocked;
      const blockerAge = blockerAgeByCr.get(cr.crNumber) ?? null;
      const blockerOver2Days = blockerCount > 0 && (blockerAge == null || blockerAge > 2);

      // Risk formula — spec confirmed 2026-09-03. "No progress in 3 days"
      // isn't evaluated — it needs day-over-day history this app doesn't
      // capture yet (a future daily-snapshot job), so it's left out rather
      // than guessed at with a proxy signal.
      const reasons: string[] = [];
      if (progressPct < 50) reasons.push('התקדמות מתחת ל-50%');
      if (hasCriticalDefect) reasons.push('תקלה קריטית פתוחה');
      if (blockerOver2Days) reasons.push('חסם פתוח מעל יומיים');
      let risk: 'HIGH' | 'MEDIUM' | 'LOW';
      if (reasons.length > 0) {
        risk = 'HIGH';
      } else if (progressPct >= 50 && progressPct <= 80) {
        risk = 'MEDIUM'; reasons.push('התקדמות בין 50%-80%');
      } else if (hasHighDefect) {
        risk = 'MEDIUM'; reasons.push('תקלת Severe פתוחה');
      } else {
        risk = 'LOW';
      }

      // ── Daily progress tracking (per CR) ──
      // "Done since yesterday": passed now minus passed at the last snapshot.
      // null when there's no snapshot yet (first run) or the CR wasn't in it.
      const prev = prevCrProgress?.[cr.crNumber];
      const passedDelta = prev ? cr.passed - prev.passed : null;
      // "Target for today/tomorrow": remaining scenarios spread evenly over the
      // work days left until this cycle's deadline.
      const remaining = Math.max(0, cr.total - cr.passed - cr.failed);
      const { target: dailyTarget, mustFinishNow } = dailyTargetForCr(remaining);

      return {
        crNumber: cr.crNumber, crLabel: cr.crLabel, tester: cr.tester, progressPct, defectCount, blockerCount, risk, reasons,
        teams: teamsByCr.get(cr.crNumber) ?? [],
        passed: cr.passed, failed: cr.failed, total: cr.total, remaining, passedDelta, dailyTarget, mustFinishNow,
      };
    });

    // Per-tester heat map — same crRows, grouped by tester.
    interface DailyTesterAgg {
      tester: string; defectCount: number; blockerCount: number;
      doneToday: number; hasAnyDelta: boolean; dailyTarget: number;
      crs: { crNumber: string; crLabel: string; progressPct: number }[];
    }
    const byTester = new Map<string, DailyTesterAgg>();
    for (const cr of crRows) {
      const name = cr.tester ?? 'לא משויך';
      const existing = byTester.get(name) ?? { tester: name, defectCount: 0, blockerCount: 0, doneToday: 0, hasAnyDelta: false, dailyTarget: 0, crs: [] };
      existing.defectCount += cr.defectCount;
      existing.blockerCount += cr.blockerCount;
      if (cr.passedDelta != null) { existing.doneToday += cr.passedDelta; existing.hasAnyDelta = true; }
      if (cr.dailyTarget != null) existing.dailyTarget += cr.dailyTarget;
      existing.crs.push({ crNumber: cr.crNumber, crLabel: cr.crLabel, progressPct: cr.progressPct });
      byTester.set(name, existing);
    }
    const testerRows = Array.from(byTester.values()).map(t => {
      const progressPct = t.crs.length > 0 ? Math.round(t.crs.reduce((s, c) => s + c.progressPct, 0) / t.crs.length) : 0;
      const status: 'GOOD' | 'WARNING' | 'CRITICAL' =
        t.blockerCount > 0 || progressPct === 0 ? 'CRITICAL' : (t.defectCount > 0 || progressPct < 80) ? 'WARNING' : 'GOOD';
      return {
        tester: t.tester, progressPct, crCount: t.crs.length, defectCount: t.defectCount, blockerCount: t.blockerCount, status, crs: t.crs,
        doneToday: t.hasAnyDelta ? t.doneToday : null, dailyTarget: t.dailyTarget,
      };
    }).sort((a, b) => a.progressPct - b.progressPct);

    // Executive summary
    const totalPassed = coreCrCoverage.reduce((s, cc) => s + cc.passed, 0);
    const totalFailed = coreCrCoverage.reduce((s, cc) => s + cc.failed, 0);
    const totalBlockedScripts = coreCrCoverage.reduce((s, cc) => s + cc.blocked, 0);
    const totalScripts = coreCrCoverage.reduce((s, cc) => s + cc.total, 0);
    const testProgressPct = totalScripts > 0 ? Math.round((totalPassed / totalScripts) * 100) : 0;

    const criticalDefectsCount = openDefects.filter(d => d.severity === 'Show Stopper').length;
    const openBlockersCount = crRows.filter(c => c.blockerCount > 0).length;
    const crsAtRiskCount = crRows.filter(c => c.risk === 'HIGH').length;
    const testersNoProgressCount = testerRows.filter(t => t.progressPct === 0).length;
    const blockersOver2DaysCount = crRows.filter(c => c.blockerCount > 0 && c.reasons.includes('חסם פתוח מעל יומיים')).length;

    const alerts: string[] = [];
    if (testersNoProgressCount > 0) alerts.push(`⚠️ ${testersNoProgressCount} בודקים ללא התקדמות`);
    if (crsAtRiskCount > 0) alerts.push(`⚠️ ${crsAtRiskCount} CR-ים בסיכון גבוה`);
    if (blockersOver2DaysCount > 0) alerts.push(`⚠️ ${blockersOver2DaysCount} חסמים פתוחים מעל יומיים`);
    if (criticalDefectsCount > 0) alerts.push(`⚠️ ${criticalDefectsCount} תקלות קריטיות פתוחות`);

    return {
      summary: {
        testProgressPct, passed: totalPassed, failed: totalFailed, blocked: totalBlockedScripts,
        openDefects: openDefects.length, criticalDefects: criticalDefectsCount,
        openBlockers: openBlockersCount, crsAtRisk: crsAtRiskCount, testersNoProgress: testersNoProgressCount,
      },
      // Same Release Health snapshot shown on the RI Home — surfaced here so a
      // QA manager tracking it doesn't have to leave the standup screen. Blended
      // 4-axis average; breakdown carried so it's never a bare number.
      health: releaseHealth ? {
        score: releaseHealth.healthScore,
        recommendation: this.recommendationFromHealth(releaseHealth.healthScore),
        breakdown: {
          coverageScore: releaseHealth.coverageScore, qualityScore: releaseHealth.qualityScore,
          riskScore: releaseHealth.riskScore, forecastScore: releaseHealth.forecastScore,
        },
        calculatedAt: releaseHealth.calculatedAt,
      } : null,
      // Per-CR daily targets context — what "day" the targets are framed for,
      // the deadline they're counted against, and whether a yesterday snapshot
      // exists yet for the "done today" deltas.
      dailyTargets: {
        targetDay,
        standupCutoff: cutoff,
        workDaysLeft,
        deadline: targetDeadline,
        deadlineCycle: activeCoreForTarget?.cycleType ?? null,
        deadlineIsGoLive: !!isLastCore,
        hasSnapshot: !!prevSnapshot,
        snapshotDate: prevSnapshot?.snapshotDate ?? null,
      },
      testers: testerRows,
      crs: crRows.sort((a, b) => RISK_RANK[b.risk] - RISK_RANK[a.risk] || a.progressPct - b.progressPct),
      alerts,
    };
  }

  // ── "What Changed Since Yesterday" — Daily QA spec's headline feature.
  // Live rollups can't diff against a point they never stored, so a daily
  // snapshot job (below) writes a compact DailyQaSnapshot once/day; this
  // compares the latest one against today's live getDailyQaManagement
  // result. Deltas are net-count comparisons (e.g. openDefects today minus
  // openDefects at the snapshot), not a real opened/closed event log — same
  // "documented approximation, not invented precision" convention as the
  // blocker-age heuristic above.
  private normalizeToMidnight(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  async captureDailyQaSnapshot(versionId: string) {
    const live = await this.getDailyQaManagement(versionId);
    const crRisk: Record<string, string> = {};
    const crProgress: Record<string, { passed: number; failed: number; total: number }> = {};
    for (const cr of live.crs) {
      crRisk[cr.crNumber] = cr.risk;
      crProgress[cr.crNumber] = { passed: cr.passed, failed: cr.failed, total: cr.total };
    }
    const testerProgress: Record<string, number> = {};
    for (const t of live.testers) testerProgress[t.tester] = t.progressPct;

    const snapshotDate = this.normalizeToMidnight(new Date());
    await prisma.dailyQaSnapshot.upsert({
      where: { versionId_snapshotDate: { versionId, snapshotDate } },
      create: {
        versionId, snapshotDate,
        testProgressPct: live.summary.testProgressPct, passed: live.summary.passed, failed: live.summary.failed, blocked: live.summary.blocked,
        openDefects: live.summary.openDefects, criticalDefects: live.summary.criticalDefects, openBlockers: live.summary.openBlockers,
        crsAtRisk: live.summary.crsAtRisk, testersNoProgress: live.summary.testersNoProgress,
        crRisk, testerProgress, crProgress,
      },
      update: {
        testProgressPct: live.summary.testProgressPct, passed: live.summary.passed, failed: live.summary.failed, blocked: live.summary.blocked,
        openDefects: live.summary.openDefects, criticalDefects: live.summary.criticalDefects, openBlockers: live.summary.openBlockers,
        crsAtRisk: live.summary.crsAtRisk, testersNoProgress: live.summary.testersNoProgress,
        crRisk, testerProgress, crProgress,
      },
    });
  }

  // Checked every minute against admin-configurable DAILY_QA_SNAPSHOT_TIME —
  // same polling-cron pattern as QUALITY_KPI_SYNC_TIME/CR_LIST_SYNC_TIME (see
  // quality-hub.service.ts's checkScheduledImportTime). Snapshots every
  // version still in an active QA lifecycle — not DRAFT (nothing to
  // snapshot yet), not COMPLETED/ROLLED_BACK (frozen), not archived.
  private lastScheduledSnapshotDate: string | null = null;

  @Cron(CronExpression.EVERY_MINUTE)
  async checkScheduledSnapshotTime() {
    const param = await prisma.systemParam.findUnique({ where: { key: 'DAILY_QA_SNAPSHOT_TIME' } });
    const target = (param?.value ?? '23:00').trim();
    const now = new Date();
    const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    if (current !== target || this.lastScheduledSnapshotDate === today) return;
    this.lastScheduledSnapshotDate = today;

    const versions = await prisma.version.findMany({
      where: { isArchived: false, status: { notIn: ['DRAFT', 'COMPLETED', 'ROLLED_BACK'] } },
      select: { id: true },
    });
    this.logger.log(`Capturing Daily QA snapshots for ${versions.length} version(s)...`);
    for (const v of versions) {
      try {
        await this.captureDailyQaSnapshot(v.id);
      } catch (err: any) {
        this.logger.error(`Daily QA snapshot failed for version ${v.id}: ${err?.message ?? err}`);
      }
    }
  }

  async getYesterdayDiff(versionId: string) {
    const [live, snapshots] = await Promise.all([
      this.getDailyQaManagement(versionId),
      prisma.dailyQaSnapshot.findMany({ where: { versionId }, orderBy: { snapshotDate: 'desc' }, take: 6 }),
    ]);
    if (snapshots.length === 0) return { hasData: false as const };

    const [yesterday] = snapshots;
    const testsPassedDelta = live.summary.passed - yesterday.passed;
    const openDefectsDelta = live.summary.openDefects - yesterday.openDefects;
    const openBlockersDelta = live.summary.openBlockers - yesterday.openBlockers;

    const yesterdayRisk = yesterday.crRisk as Record<string, string>;
    const crsMovedToHighRisk = live.crs
      .filter(cr => cr.risk === 'HIGH' && yesterdayRisk[cr.crNumber] && yesterdayRisk[cr.crNumber] !== 'HIGH')
      .map(cr => cr.crNumber);

    // Streak of unchanged progress, walking back through consecutive stored
    // snapshots (newest first) while the value matches today's live value.
    const testersNoUpdates = live.testers
      .map(t => {
        let days = 0;
        for (const snap of snapshots) {
          const val = (snap.testerProgress as Record<string, number>)[t.tester];
          if (val === undefined || val !== t.progressPct) break;
          days++;
        }
        return { tester: t.tester, days };
      })
      .filter(t => t.days >= 2);

    return {
      hasData: true as const,
      sinceDate: yesterday.snapshotDate,
      testsPassedDelta, openDefectsDelta, openBlockersDelta,
      crsMovedToHighRisk, testersNoUpdates,
    };
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
  // Rewritten 2026-09-14 (feedback: gauge-grid redesign, same clock widget as
  // Cycle Progress, CORE/Stand-Alone toggle, search by CR name/number) to
  // read from getCrCoverage instead of getTestCoverage — the latter groups
  // by Requirement with SQL-side SUM(CASE...), the exact double-count/drop
  // pattern the 2026-09-14 ITv06-2026 audit found (see CYCLE_TEST_TOTALS_SQL's
  // own comment); getCrCoverage already dedupes by DISTINCT test id per (CR,
  // cycle), so summing it per-CR across cycles here inherits that fix rather
  // than repeating the old bug in a third place.
  async getCoverageReadiness(versionId: string) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const vcaRows = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { crNumber: true, project: true },
    });
    const versionCrNumbers = [...new Set(vcaRows.map(r => r.crNumber))];
    const projectByCr = new Map<string, string>();
    for (const row of vcaRows) {
      if (row.project && !projectByCr.has(row.crNumber)) projectByCr.set(row.crNumber, row.project);
    }

    const [coverageRows, defects] = await Promise.all([
      this.qcService.getCrCoverage(versionCrNumbers, versionId).catch((): CrCoverageDto[] => []),
      this.qcService.getDefects(versionId).catch((): DefectDto[] => []),
    ]);

    const emptyCounts = () => ({
      passed: 0, failed: 0, notRun: 0, blocked: 0, notCompleted: 0, notReady: 0,
      notApplicable: 0, notRelevant: 0, total: 0,
    });
    type ScopedCounts = ReturnType<typeof emptyCounts>;
    const addRow = (bucket: ScopedCounts, row: CrCoverageDto) => {
      bucket.passed += row.passed; bucket.failed += row.failed; bucket.notRun += row.notRun;
      bucket.blocked += row.blocked; bucket.notCompleted += row.notCompleted; bucket.notReady += row.notReady;
      bucket.notApplicable += row.notApplicable; bucket.notRelevant += row.notRelevant; bucket.total += row.total;
    };
    const withPct = (c: ScopedCounts) => ({ ...c, coveragePct: c.total > 0 ? Math.round((executedScriptCount(c) / c.total) * 10000) / 100 : 0 });

    // Same CYCLE_1/2/3 vs "stand alone" split cycleNameMatches uses elsewhere
    // in this file, just classifying a raw Oracle cycle name directly instead
    // of checking it against one already-known cycleType — a CR's rows can
    // land in either bucket (or both, if it's tested in a core cycle and
    // separately in Stand Alone) or in neither (UAT/Dress Rehearsal/Go Live
    // rows exist in coverageRows too but aren't part of this screen's toggle).
    const classifyScope = (realCycleName: string): 'CORE' | 'SA' | null => {
      const n = realCycleName.trim().toLowerCase();
      if (n === 'cycle 1' || n === 'cycle 2' || n === 'cycle 3') return 'CORE';
      if (n.startsWith('stand alone')) return 'SA';
      return null;
    };

    const byCr = new Map<string, { crNumber: string; crLabel: string; core: ScopedCounts; sa: ScopedCounts }>();
    for (const row of coverageRows) {
      const scope = classifyScope(row.cycleName);
      if (!scope) continue;
      let entry = byCr.get(row.crNumber);
      if (!entry) {
        entry = { crNumber: row.crNumber, crLabel: `${row.crNumber} - ${row.crTitle}`, core: emptyCounts(), sa: emptyCounts() };
        byCr.set(row.crNumber, entry);
      }
      addRow(scope === 'CORE' ? entry.core : entry.sa, row);
    }

    // Per-CR defect counts — reportedDefectsCount/stillOpenDefectsCount as
    // requested (2026-09-14: "כמות התקלות שנפתחו... וגם כמה עדיין לא נסגרו
    // ולא בוטלו" — deliberately only Closed/Canceled, narrower than this
    // file's CLOSED_DEFECT_STATUSES). defectsBySeverity kept for the same
    // hover-tooltip use as the Cycle Progress cards, scoped to the broader
    // CLOSED_DEFECT_STATUSES "open" definition like everywhere else.
    const crRows = Array.from(byCr.values()).map(e => {
      const crDefects = defects.filter(d => d.crReferenceNumber === e.crNumber);
      const openDefects = crDefects.filter(d => !CLOSED_DEFECT_STATUSES.includes(d.status));
      return {
        crNumber: e.crNumber, crLabel: e.crLabel, project: projectByCr.get(e.crNumber) ?? null,
        core: withPct(e.core), sa: withPct(e.sa),
        reportedDefectsCount: crDefects.length,
        stillOpenDefectsCount: crDefects.filter(d => !['Closed', 'Canceled'].includes(d.status)).length,
        defectsBySeverity: {
          showStopper: openDefects.filter(d => d.severity === 'Show Stopper').length,
          severe: openDefects.filter(d => d.severity === 'Severe').length,
          medium: openDefects.filter(d => d.severity === 'Medium').length,
          low: openDefects.filter(d => d.severity === 'Low').length,
        },
      };
    });

    const scopeKpis = (key: 'core' | 'sa') => {
      const rows = crRows.map(r => r[key]);
      const total = rows.reduce((s, c) => s + c.total, 0);
      const executed = rows.reduce((s, c) => s + executedScriptCount(c), 0);
      return {
        covered: executed,
        failed: rows.reduce((s, c) => s + c.failed, 0),
        blocked: rows.reduce((s, c) => s + c.blocked, 0),
        notReady: rows.reduce((s, c) => s + c.notReady, 0),
        coveragePct: total > 0 ? Math.round((executed / total) * 10000) / 100 : 0,
      };
    };

    return {
      kpis: { core: scopeKpis('core'), sa: scopeKpis('sa') },
      crRows,
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
      select: { crNumber: true, project: true, priorityTestDate: true },
    });
    const versionCrNumbers = [...new Set(vcaRows.map(r => r.crNumber))];
    // Project name per CR — a CR can have one VersionCrAssignment row per
    // team, occasionally with different `project` values per team; joined
    // with " / " when they actually differ rather than picking one
    // arbitrarily (spec confirmed 2026-09-02, added alongside tester name
    // for the cycle-detail CR breakdown).
    const projectByCr = new Map<string, string>();
    // Earliest priorityTestDate across this CR's team rows — an explicit
    // early deadline (go-live before this version's own scope, must be
    // tested first) takes precedence over the cycle's own end date as "days
    // remaining for the task" below (spec confirmed 2026-09-02).
    const priorityDateByCr = new Map<string, Date>();
    for (const row of vcaRows) {
      if (row.project) {
        const existing = projectByCr.get(row.crNumber);
        if (!existing) projectByCr.set(row.crNumber, row.project);
        else if (!existing.split(' / ').includes(row.project)) projectByCr.set(row.crNumber, `${existing} / ${row.project}`);
      }
      if (row.priorityTestDate) {
        const existing = priorityDateByCr.get(row.crNumber);
        if (!existing || row.priorityTestDate < existing) priorityDateByCr.set(row.crNumber, row.priorityTestDate);
      }
    }
    // Tester name per (CR, cycle) — from our own QaAssignment table (the
    // person actually assigned to test this CR in this cycle), not an Oracle
    // field. secondaryTesterId is appended when present (spec confirmed
    // 2026-09-02).
    const qaAssignments = await prisma.qaAssignment.findMany({
      where: { versionId },
      select: { crNumber: true, userId: true, secondaryTesterId: true, cycles: true },
    });
    // Each Oracle-backed call is caught independently — a failure in any one
    // of them (e.g. a real-Oracle query that behaves differently in prod
    // than in the mock/offline path — see qc.service.ts's own error logging
    // for the real cause) degrades just that piece of data instead of
    // taking down the whole screen with "לא ניתן לטעון נתונים עבור גרסה זו"
    // (found live in production, 2026-08-02 — getCrCoverage/getCycleQgTargets
    // were the only two of these four calls NOT wrapped like this).
    const [coverageRows, qgTargets, defectsByCycle, cycleTestTotals, crQualityScores] = await Promise.all([
      this.qcService.getCrCoverage(versionCrNumbers, versionId).catch((): CrCoverageDto[] => []),
      this.qcService.getCycleQgTargets(versionId).catch((): CycleQgTargetDto[] => []),
      this.qcService.getDefectsByCycle(versionId).catch((): DefectByCycleDto[] => []),
      // Cycle-level headline totals — CR-agnostic, so immune to getCrCoverage's
      // per-CR dedup gaps (see CYCLE_TEST_TOTALS_SQL's comment). Empty when
      // Oracle's disabled or the release isn't linked yet; the per-cycle
      // fallback below then behaves exactly as it did before this existed.
      this.qcService.getCycleTestTotals(versionId).catch((): CycleTestTotalsDto[] => []),
      // Per-CR quality score (2026-09-17: "אם אפשר להציג בכרטיסיה את מדד
      // האיכות של ה-CR רק כאשר הוא חורג") — joined into each crCoverage row
      // below so the card can show it ONLY when meetsTarget is false.
      this.getCrQualityScores(versionId).catch((): Awaited<ReturnType<typeof this.getCrQualityScores>> => []),
    ]);
    const qualityByCr = new Map(crQualityScores.map(q => [q.crNumber, q]));

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
        .map(row => {
          const assignment = qaAssignments.find(a => a.crNumber === row.crNumber && a.cycles.includes(c.cycleType));
          const testerNames = assignment
            ? [assignment.userId, assignment.secondaryTesterId].filter((id): id is string => !!id).map(id => nameById.get(id) ?? id)
            : [];
          // Deadline for this CR's testing task — its own explicit priority
          // date when one was set (must be tested before the version's own
          // scope), else the cycle's own end date (spec confirmed 2026-09-02).
          const deadline = priorityDateByCr.get(row.crNumber) ?? c.plannedEnd;
          const daysRemaining = Math.ceil((deadline.getTime() - now) / 86400000);
          // Open defects reported against this CR, by severity — same
          // crReferenceNumber match as isCrQualityDefect but WITHOUT its
          // Canceled/Production exclusions (those are specific to the CR
          // Quality Score metric, not a general "what's open right now"
          // count) — reuses openDefects/CLOSED_DEFECT_STATUSES already
          // computed above for the cycle's own qgSummary (spec confirmed
          // 2026-09-02).
          const crDefects = openDefects.filter(d => d.crReferenceNumber === row.crNumber);
          const defectsBySeverity = {
            showStopper: crDefects.filter(d => d.severity === 'Show Stopper').length,
            severe: crDefects.filter(d => d.severity === 'Severe').length,
            medium: crDefects.filter(d => d.severity === 'Medium').length,
            low: crDefects.filter(d => d.severity === 'Low').length,
          };
          // Two extra CR-level defect counts for the cycle-detail gauge cards
          // (feedback 2026-09-14): total ever reported against this CR
          // (any status, from the full unfiltered `defects`, not `openDefects`),
          // and "still not closed and not canceled" — deliberately ONLY those
          // two statuses per the user's own wording, NOT this file's broader
          // CLOSED_DEFECT_STATUSES (which also excludes Rejected/Fixed) — a
          // narrower definition than "open" everywhere else in this file.
          const reportedDefectsCount = defects.filter(d => d.crReferenceNumber === row.crNumber).length;
          const stillOpenDefectsCount = defects.filter(d =>
            d.crReferenceNumber === row.crNumber && !['Closed', 'Canceled'].includes(d.status)
          ).length;
          // Planned test-start date for this CR in THIS cycle — c.tasks is
          // already scoped to the current cycle (c IS one element of
          // workPlan.cycles), so no cross-cycle lookup needed, unlike
          // getOverview's own plannedStartByCr (spec 2026-09-17: "אם CR עדיין
          // לא הגיע זמנו לבדיקות להציג הודעה בדיקות יחלו ב-[...]"). null when
          // there's no scheduled CR task at all (e.g. Stand Alone items,
          // which aren't scheduled the same way).
          const crTask = c.tasks.find(t => t.taskType === 'CR' && t.crNumber === row.crNumber && !t.isArchived && t.isActive);
          const testingStartDate = crTask?.plannedStart ? crTask.plannedStart.toISOString() : null;
          const notStartedYet = row.total === 0 && !!crTask?.plannedStart && crTask.plannedStart.getTime() > now;
          // Quality score only surfaced when it's BREACHING target — the card
          // shouldn't show a number for every CR, just the ones worth flagging
          // (spec 2026-09-17).
          const quality = qualityByCr.get(row.crNumber);
          const qualityScore = quality && quality.meetsTarget === false ? quality.score : null;
          return {
            crNumber: row.crNumber, crLabel: `${row.crNumber} - ${row.crTitle}`,
            passed: row.passed, failed: row.failed, notRun: row.notRun,
            blocked: row.blocked, notCompleted: row.notCompleted, notReady: row.notReady,
            // notApplicable/notRelevant were previously dropped here while still
            // counted in `total` (from Oracle's TS_EXEC_STATUS breakdown) — the
            // segmented bar's colored segments silently fell short of the bar's
            // own 100% whenever a script had one of these statuses (found
            // 2026-09-02 investigating a user-reported script-count mismatch).
            notApplicable: row.notApplicable, notRelevant: row.notRelevant,
            total: row.total, coveragePct: row.coveragePct,
            project: projectByCr.get(row.crNumber) ?? null,
            tester: testerNames.length > 0 ? testerNames.join(' + ') : null,
            daysRemaining, defectsBySeverity, reportedDefectsCount, stillOpenDefectsCount,
            testingStartDate, notStartedYet, qualityScore,
          };
        });
      const crs = crCoverage.map(cc => ({ crNumber: cc.crNumber, crLabel: cc.crLabel }));
      // Cycle-wide headline totals come from getCycleTestTotals (CR-agnostic,
      // COUNT(DISTINCT TS_TEST_ID) per status) when available — matches QC's
      // own Requirements Coverage screen for the same release+cycle (real
      // audit, 2026-09-14, ITv06-2026). Summing crCoverage's per-CR rows
      // instead double-counts a test whose requirements span two DIFFERENT
      // CRs (each CR bucket counts it once) and drops a test whose CR can't
      // be resolved at all (resolveCr() dead-ends, or the CR isn't in this
      // version's own VersionCrAssignment scope) — both gaps confirmed
      // against real production numbers. Falls back to the old per-CR sum
      // only when no matching totals row exists (Oracle disabled, release
      // not yet linked, or this specific cycle has no QC data yet) — same
      // behavior as before this existed.
      const cycleTotals = cycleTestTotals.find(t => cycleNameMatches(c.cycleType, t.cycleName));
      const totalTests = cycleTotals ? cycleTotals.total : crCoverage.reduce((s, cc) => s + cc.total, 0);
      // Same "executed" definition as getCrCoverage's own per-CR coveragePct
      // and ALM (executedScriptCount) — this rollup previously omitted N/A and
      // Not Relevant, so the cycle-level % read lower than the sum of its own
      // CR rows whenever a script was marked out of scope (fixed 2026-09-10).
      const executedTests = cycleTotals ? executedScriptCount(cycleTotals) : crCoverage.reduce((s, cc) => s + executedScriptCount(cc), 0);
      const passedTests = cycleTotals ? cycleTotals.passed : crCoverage.reduce((s, cc) => s + cc.passed, 0);
      // Coverage = how much of the plan ran (executed/total); Success = how
      // much of the plan actually passed (passed/total) — same denominator as
      // coverage so both sit on the same 0-100% scale as the QG target marker.
      // Kept as two separate numbers per the user's explicit request — they'd
      // been conflated (the target was compared against coverage, i.e. against
      // "did it run" rather than "did it pass") (spec confirmed 2026-08-31).
      const coveragePct = totalTests > 0 ? Math.round((executedTests / totalTests) * 10000) / 100 : null;
      const successPct = totalTests > 0 ? Math.round((passedTests / totalTests) * 10000) / 100 : null;

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

      // Same cycleTotals-or-fallback source as totalTests/passedTests above,
      // exposed as raw counts (not just the two rollup %s) — the frontend's
      // segmented progress bar was independently re-summing crCoverage's
      // per-CR rows for its own segment sizes, which would have silently
      // kept the exact bug this whole cycleTotals fix targets even after
      // successPct/coveragePct started coming from the deduped source.
      const scriptCounts = cycleTotals ?? crCoverage.reduce((acc, cr) => ({
        total: acc.total + cr.total, passed: acc.passed + cr.passed, failed: acc.failed + cr.failed,
        blocked: acc.blocked + cr.blocked, notCompleted: acc.notCompleted + cr.notCompleted,
        notRun: acc.notRun + cr.notRun, notReady: acc.notReady + cr.notReady,
        notApplicable: acc.notApplicable + cr.notApplicable, notRelevant: acc.notRelevant + cr.notRelevant,
        cycleName: '',
      }), { total: 0, passed: 0, failed: 0, blocked: 0, notCompleted: 0, notRun: 0, notReady: 0, notApplicable: 0, notRelevant: 0, cycleName: '' });

      return {
        cycleType: c.cycleType, plannedStart: c.plannedStart, plannedEnd: c.plannedEnd, progressPct, state,
        crCount: crs.length, testerCount: testerIds.size, defectCount, crs,
        testers: [...testerIds].map(id => nameById.get(id) ?? id),
        coveragePct, successPct, crCoverage, qgTargetPct,
        scriptCounts: {
          total: scriptCounts.total, passed: scriptCounts.passed, failed: scriptCounts.failed,
          blocked: scriptCounts.blocked, notCompleted: scriptCounts.notCompleted, notRun: scriptCounts.notRun,
          notReady: scriptCounts.notReady, notApplicable: scriptCounts.notApplicable, notRelevant: scriptCounts.notRelevant,
        },
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
    // Overage = how far PAST the threshold each defect is (age - threshold),
    // distinct from avgAgingDays above (raw age since discovery). "ממוצע
    // חריגה" (average overage) on the Home page notice must show this, not
    // the raw age (spec confirmed 2026-09-01).
    const avgOverageDays = agingDefects.length > 0
      ? Math.round(agingDefects.reduce((s, d) => s + Math.max(0, (parseOracleDateAgeDays(d.discoveryDate, now) ?? 0) - AGING_DEFECT_THRESHOLD_DAYS), 0) / agingDefects.length)
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
        avgOverageDays,
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
  // NOTE 2026-09-02: getOverview's own forecast block was reworked (1h/scenario
  // pace check on core cycles + historical defect-fix-rate check) and this
  // screen's formula was NOT updated to match — it still uses the old single
  // remainingTests/testDurationMin heuristic, so this screen and the Home
  // page's Forecast card can now show different statuses for the same
  // version. Flagged, not fixed, since only the Home card was in scope.
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
    // Translate QC login strings on person-fields (assignedTo/reporter/…) to
    // real names for the whole drilldown list at once (spec 2026-09-06).
    return resolveDefectPersonNames(await this.getDefectsDrilldownRaw(versionId, screen, filter, value));
  }

  private async getDefectsDrilldownRaw(versionId: string, screen: string, filter: string, value?: string): Promise<DefectDto[]> {
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
        // Open defects deferred to a later release (BG_TARGET_REL set) — excluded
        // from the Home open-defects count, listed here (spec 2026-09-07 §1).
        if (filter === 'target-moved') return open.filter(d => !!(d.targetRelease || '').trim());
        return [];
      }
      case 'status-board': {
        if (filter === 'openTotal') return open;
        if (filter === 'openSevereOrWorse') return open.filter(d => SEVERE_OR_WORSE.includes(d.severity));
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
      case 'daily-qa': {
        // Same crReferenceNumber match (and same `open` set) getDailyQaManagement
        // uses to build each CR's defectCount, so the drilled-down list can
        // never disagree with the number that was clicked.
        if (filter === 'openAll') return open;
        // Executive-summary "Critical Defects" card counts Show Stopper only
        // (getDailyQaManagement's criticalDefectsCount) — match it exactly.
        if (filter === 'critical') return open.filter(d => d.severity === 'Show Stopper');
        if (filter === 'cr' && value) return open.filter(d => d.crReferenceNumber === value);
        if (filter === 'tester' && value) {
          const cycleProgress = await this.getCycleProgress(versionId);
          const crNumbers = new Set(
            cycleProgress.timeline
              .filter(t => CORE_CYCLE_TYPES.includes(t.cycleType))
              .flatMap(t => t.crCoverage)
              .filter(cc => (cc.tester ?? '').split(' + ').includes(value))
              .map(cc => cc.crNumber),
          );
          return open.filter(d => d.crReferenceNumber && crNumbers.has(d.crReferenceNumber));
        }
        return [];
      }
      case 'bug-dashboard': {
        // Bug Dashboard's own SQL (BUG_DASHBOARD_SQL) is a separate Oracle
        // query from this method's own `defects` (DEFECTS_SQL) — but both
        // select BG_BUG_ID for the same release, so an id-based reopen match
        // is exact, not best-effort. Bucket predicates below are copied
        // verbatim from computeBugDashboard (qc.service.ts) wherever the
        // underlying field also exists on DefectDto, so a drilled-down list
        // can never disagree with the KPI number that was clicked.
        //
        // "Open" here excludes only Closed/Canceled (computeBugDashboard's
        // own isOpen()) — narrower than this method's generic `open` above
        // (which also drops Rejected/Fixed) — reusing that one would silently
        // disagree with the Bug Dashboard's own Open Bugs count.
        const bdOpen = defects.filter(d => !['Closed', 'Canceled'].includes(d.status));
        const notNewOrCanceled = (s: string) => !['New', 'Canceled'].includes(s);
        if (filter === 'reported') return defects;
        if (filter === 'open') return bdOpen;
        if (filter === 'rejected') return defects.filter(d => d.status === 'Canceled');
        if (filter === 'changes') return defects.filter(d => d.defectType === 'Change Requests');
        if (filter === 'reopen') {
          const reopenedIds = await this.qcService.getReopenedDefectIdsForVersion(versionId);
          return defects.filter(d => reopenedIds.has(d.id));
        }
        if (filter === 'type' && value) return bdOpen.filter(d => (d.defectType || 'ללא סיווג') === value);
        if (filter === 'severity' && value) return bdOpen.filter(d => (d.severity || 'ללא סיווג') === value);
        // The breakdowns/cards below key on BUG_DASHBOARD_SQL-specific columns
        // (BG_USER_03 responsibility, BG_USER_10 category, status buckets,
        // Production/Regression). DEFECTS_SQL exposes some of these on a
        // DIFFERENT column and, in dev, from a disjoint mock set — so pull the
        // Bug Dashboard's own row set here, exactly what the KPI numbers were
        // computed from (spec 2026-09-07).
        if (['responsibility', 'cr', 'status', 'production', 'regression', 'day', 'moved-to-next'].includes(filter)) {
          const bdDefects = await this.qcService.getBugDashboardDefects(versionId).catch((): DefectDto[] => []);
          const bdOpenRows = bdDefects.filter(d => !['Closed', 'Canceled'].includes(d.status));
          if (filter === 'responsibility' && value) return bdOpenRows.filter(d => (d.responsibility || 'ללא סיווג') === value);
          if (filter === 'cr' && value) return bdOpenRows.filter(d => (d.crHbrNumberReference || 'ללא סיווג') === value);
          if (filter === 'status' && value) return bdOpenRows.filter(d => bugStatusBucket(d.status) === value);
          if (filter === 'production') return bdDefects.filter(d => d.crHbrNumberReference === 'Production' && notNewOrCanceled(d.status));
          if (filter === 'regression') return bdDefects.filter(d => d.crHbrNumberReference === 'Regression' && notNewOrCanceled(d.status));
          // "עוברות לגרסה הבאה" — opened in this release (BUG_DASHBOARD_SQL scope)
          // with a non-empty BG_TARGET_REL. Status-agnostic, mirrors the KPI
          // count in computeBugDashboard (spec 2026-09-09).
          if (filter === 'moved-to-next') return bdDefects.filter(d => !!(d.targetRelease || '').trim());
          // "דיווח יומי" chart — every defect REPORTED on that calendar day
          // (matches the chart's own per-day tally, which counts all rows).
          if (filter === 'day' && value) return bdDefects.filter(d => (d.discoveryDate || '').slice(0, 10) === value);
          return [];
        }
        // TARGET card — defects detected in an earlier release, targeted at this one.
        if (filter === 'target' || filter === 'target-open') {
          const targetDefects = await this.qcService.getBugDashboardTargetDefects(versionId).catch((): DefectDto[] => []);
          return filter === 'target-open'
            ? targetDefects.filter(d => !['Closed', 'Canceled'].includes(d.status))
            : targetDefects;
        }
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
    crNumber: string; crLabel: string; defectCount: number; actualEffortDays: number | null; score: number | null; meetsTarget: boolean | null;
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

    // Bug found 2026-09-17: CRs with no actualEffortDays filled in yet used to
    // be silently dropped from this list entirely (can't divide by a missing
    // denominator) — Nissim found real CRs breaching the 0.15 target that
    // never showed up on the Home page's "סיכוני איכות" card because of this,
    // with no indication anything was excluded. Now every CR in scope is
    // returned; score/meetsTarget are null (not "false"/0) when effort data
    // is missing, so the frontend can show "לא ניתן לחשב" instead of either
    // silently hiding the CR or wrongly counting it as passing.
    return Array.from(byCr.values()).map(cr => {
      const crDefects = defects.filter(d => isCrQualityDefect(d, cr.crNumber));
      const hasEffort = cr.actualEffortDays != null && cr.actualEffortDays > 0;
      const score = hasEffort ? crDefects.reduce((s, d) => s + (CR_QUALITY_SEVERITY_WEIGHT[d.severity] ?? 0), 0) / (cr.actualEffortDays as number) : null;
      return {
        crNumber: cr.crNumber, crLabel: cr.crLabel, defectCount: crDefects.length,
        actualEffortDays: cr.actualEffortDays, score, meetsTarget: score == null ? null : score <= CR_QUALITY_TARGET,
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

  // ── Blockers Center CRUD — Daily QA spec area 4 (structured catalog, not
  // free text; see the DailyBlocker model comment for why it's kept separate
  // from the QC-script-status "blocked" heuristic used in getDailyQaManagement) ──
  listBlockers(versionId: string) {
    return prisma.dailyBlocker.findMany({
      where: { versionId },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    });
  }

  createBlocker(data: {
    versionId: string; title: string; type: string; crNumber?: string; ownerName?: string; createdBy: string;
  }) {
    if (!data.title?.trim()) throw new BadRequestException('כותרת חסם היא שדה חובה');
    return prisma.dailyBlocker.create({ data: data as any });
  }

  updateBlocker(id: string, data: Partial<{
    title: string; type: string; crNumber: string; ownerName: string;
  }>) {
    return prisma.dailyBlocker.update({ where: { id }, data: data as any });
  }

  resolveBlocker(id: string) {
    return prisma.dailyBlocker.update({ where: { id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
  }

  reopenBlocker(id: string) {
    return prisma.dailyBlocker.update({ where: { id }, data: { status: 'OPEN', resolvedAt: null } });
  }

  // ── Action Items CRUD — Daily QA spec area 5 ("נגזר מישיבת ה-Daily"). Own
  // model, not the Incidents/RCA ActionItem table — see DailyActionItem's
  // schema comment for why. No separate "closer" role split like Risk/
  // Blocker: these are lightweight day-to-day follow-ups owned by whoever's
  // assigned, not risk-governance items requiring RM sign-off to close.
  listActionItems(versionId: string) {
    return prisma.dailyActionItem.findMany({
      where: { versionId },
      orderBy: [{ status: 'asc' }, { dueAt: 'asc' }],
    });
  }

  createActionItem(data: {
    versionId: string; title: string; ownerName?: string; dueAt?: string; createdBy: string;
  }) {
    if (!data.title?.trim()) throw new BadRequestException('כותרת משימה היא שדה חובה');
    return prisma.dailyActionItem.create({
      data: { ...data, dueAt: data.dueAt ? new Date(data.dueAt) : null } as any,
    });
  }

  updateActionItem(id: string, data: Partial<{
    title: string; ownerName: string; dueAt: string | null; status: string;
  }>) {
    const { dueAt, ...rest } = data;
    return prisma.dailyActionItem.update({
      where: { id },
      data: { ...rest, ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}) } as any,
    });
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
  // is derived from the already-persisted ReleaseHealth.healthScore. Bands
  // updated with the gated readiness model (spec 2026-09-09): ≥75 GO,
  // 50-74 CONDITIONAL_GO, <50 NO_GO — same as readinessRecommendation().
  private recommendationFromHealth(healthScore: number): string {
    return readinessRecommendation(healthScore);
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
