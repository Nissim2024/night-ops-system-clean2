// ── Version lifecycle — a chronological, cross-module status ──────────────────
//
// `Version.status` (the VersionStatus enum) is the deployment-night state
// machine and belongs to the Deployments module. It says nothing about where
// QA / Release-Intelligence / Quality-Hub are.
//
// This module derives — never stores — two layers from data that already
// exists (spec 2026-09-08, "let's think together" thread):
//
//   Layer 1  `phase`      : one coarse, ordered version-wide phase
//   Layer 2  `perModule`  : a short status per module (Hebrew label)
//
// Fully automatic, no manual step: every underlying transition already has its
// own approval gate (scope approval, QA-plan approval, Go/No-Go, the night
// lifecycle). This just reflects them.

export type VersionPhase =
  | 'SCOPE_PLANNING'   // תכנון תכולה — scope not yet approved
  | 'TEST_PLANNING'    // תכנון בדיקות — scope approved, QA work-plan not approved
  | 'TESTING'          // בדיקות — QA plan approved / core cycles running
  | 'GO_LIVE_READY'    // מוכנות לעלייה — REHEARSAL, or a Go/No-Go decision exists
  | 'GO_LIVE_NIGHT'    // ליל העלייה — ACTIVE / MORNING_AFTER
  | 'DONE'             // הסתיים — COMPLETED
  | 'ROLLED_BACK';     // בוטל

// Strict order — Layer 1 is max() over this (the furthest phase entered wins).
export const PHASE_ORDER: VersionPhase[] = [
  'SCOPE_PLANNING', 'TEST_PLANNING', 'TESTING', 'GO_LIVE_READY', 'GO_LIVE_NIGHT', 'DONE',
];

export const PHASE_LABEL_HE: Record<VersionPhase, string> = {
  SCOPE_PLANNING: 'תכנון תכולה',
  TEST_PLANNING:  'תכנון בדיקות',
  TESTING:        'בדיקות',
  GO_LIVE_READY:  'מוכנות לעלייה',
  GO_LIVE_NIGHT:  'ליל העלייה',
  DONE:           'הסתיים',
  ROLLED_BACK:    'בוטל',
};

// ── Stage — where the version is on the testing calendar (user, 2026-10-06:
// "להציג את השלב של הגרסה ולא את שלב תוכנית ההטמעה"). Date-driven from the
// version's integration window, the QA plan's cycles, the rehearsal and the
// go-live day; between two of them it's "היערכות ל<the next one>".
export type VersionStageKey =
  | 'PREP' | 'INTEGRATION' | 'CYCLE' | 'PREP_CYCLE' | 'REHEARSAL' | 'PREP_REHEARSAL'
  | 'GO_LIVE' | 'PREP_GO_LIVE' | 'GO_LIVE_OVERDUE' | 'PRODUCTION' | 'ROLLED_BACK';

export interface VersionStage {
  key: VersionStageKey;
  label: string;          // e.g. "בבדיקות סבב 2", "היערכות לסבב 2"
  cycle?: number;         // 1..3 for CYCLE / PREP_CYCLE
  parallel: string[];     // non-core cycles running at the same time (Stand Alone, UAT…)
}

export interface StageSignals {
  status: string;
  integrationStart: Date | null;
  integrationEnd: Date | null;
  rehearsalStart: Date | null;    // Version.plannedRehearsalStart — fallback when the plan has no REHEARSAL cycle
  rehearsalEnd: Date | null;
  goLive: Date | null;            // Version.plannedStart
  cycles: { cycleType: string; plannedStart: Date; plannedEnd: Date }[];
}

const PARALLEL_LABEL: Record<string, string> = { STAND_ALONE: 'Stand Alone', UAT: 'UAT' };
const DAY_MS = 86400000;

export function deriveVersionStage(s: StageSignals, now: Date = new Date()): VersionStage {
  const t = now.getTime();
  const within = (a: Date | null, b: Date | null) => !!a && a.getTime() <= t && (!b || t <= b.getTime());
  const cyc = (type: string) => s.cycles.find(c => c.cycleType === type) ?? null;
  const parallel = s.cycles
    .filter(c => !['CYCLE_1', 'CYCLE_2', 'CYCLE_3', 'REHEARSAL', 'GO_LIVE'].includes(c.cycleType) && within(c.plannedStart, c.plannedEnd))
    .map(c => PARALLEL_LABEL[c.cycleType] ?? c.cycleType);
  const mk = (key: VersionStageKey, label: string, cycle?: number): VersionStage => ({ key, label, cycle, parallel });

  if (s.status === 'ROLLED_BACK') return mk('ROLLED_BACK', 'בוטלה');
  if (s.status === 'COMPLETED') return mk('PRODUCTION', 'בייצור');
  if (s.status === 'ACTIVE' || s.status === 'MORNING_AFTER') return mk('GO_LIVE', 'בעלייה לאוויר');
  if (s.status === 'REHEARSAL') return mk('REHEARSAL', 'בחזרה גנרלית');

  // go-live window = the GO_LIVE cycle, else the go-live calendar day
  const glCycle = cyc('GO_LIVE');
  const glStart = glCycle?.plannedStart ?? (s.goLive ? new Date(new Date(s.goLive).setHours(0, 0, 0, 0)) : null);
  const glEnd = glCycle?.plannedEnd ?? (glStart ? new Date(glStart.getTime() + DAY_MS - 1) : null);
  // Past the go-live day but the night was never run/closed here: don't claim
  // "בייצור" from a date alone — flag that the dates or the status are stale.
  if (glEnd && t > glEnd.getTime()) return mk('GO_LIVE_OVERDUE', 'עבר מועד העלייה');
  if (within(glStart, glEnd)) return mk('GO_LIVE', 'בעלייה לאוויר');

  const rh = cyc('REHEARSAL');
  const rhStart = rh?.plannedStart ?? s.rehearsalStart;
  const rhEnd = rh?.plannedEnd ?? s.rehearsalEnd;
  if (within(rhStart, rhEnd)) return mk('REHEARSAL', 'בחזרה גנרלית');

  for (const n of [3, 2, 1]) {
    const c = cyc(`CYCLE_${n}`);
    if (c && within(c.plannedStart, c.plannedEnd)) return mk('CYCLE', `בבדיקות סבב ${n}`, n);
  }
  if (within(s.integrationStart, s.integrationEnd)) return mk('INTEGRATION', 'בבדיקות אינטגרציה');

  // Nothing running → getting ready for whatever comes next.
  if (!s.integrationStart || t < s.integrationStart.getTime()) return mk('PREP', 'בהיערכות');
  const next: { at: number; stage: VersionStage }[] = [];
  for (const n of [1, 2, 3]) {
    const c = cyc(`CYCLE_${n}`);
    if (c && c.plannedStart.getTime() > t) next.push({ at: c.plannedStart.getTime(), stage: mk('PREP_CYCLE', `היערכות לסבב ${n}`, n) });
  }
  if (rhStart && rhStart.getTime() > t) next.push({ at: rhStart.getTime(), stage: mk('PREP_REHEARSAL', 'היערכות לחזרה גנרלית') });
  if (glStart && glStart.getTime() > t) next.push({ at: glStart.getTime(), stage: mk('PREP_GO_LIVE', 'היערכות לעלייה לאוויר') });
  next.sort((a, b) => a.at - b.at);
  return next[0]?.stage ?? mk('PREP', 'בהיערכות');
}

export interface VersionLifecycle {
  phase: VersionPhase;
  phaseLabel: string;
  stage: VersionStage;
  perModule: {
    versionManagement: string;
    qa: string;
    deployments: string;
    releaseIntelligence: string;
    quality: string;
  };
}

const CORE_CYCLE_TYPES = ['CYCLE_1', 'CYCLE_2', 'CYCLE_3'];

// Everything the deriver needs — a plain shape so it stays a pure function and
// is trivial to unit-test. Callers build this from a single `version.findMany`
// (see LIFECYCLE_INCLUDE) plus one batched KPI-scores lookup.
export interface LifecycleSignals {
  status: string;                 // VersionStatus
  scopeApprovedAt: Date | null;
  phaseCount: number;             // Version._count.phases — deployment plan built?
  qaWorkPlanStatus: string | null; // null = no plan
  coreCycles: { plannedStart: Date; plannedEnd: Date }[];
  // An actual Go/No-Go decision was recorded (not just a stub row that always
  // exists to hold the live system recommendation).
  goNoGoDecided: boolean;
  hasKpiScores: boolean;
  stage?: StageSignals;
}

export function deriveVersionLifecycle(s: LifecycleSignals, now: Date = new Date()): VersionLifecycle {
  const t = now.getTime();
  const coreActive = s.coreCycles.some(c => c.plannedStart.getTime() <= t && t <= c.plannedEnd.getTime());
  const coreAllPast = s.coreCycles.length > 0 && s.coreCycles.every(c => c.plannedEnd.getTime() < t);
  const qaApproved = s.qaWorkPlanStatus === 'APPROVED';
  const scopeApproved = !!s.scopeApprovedAt || ['APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED'].includes(s.status);
  // The late phases (מוכנות / ליל העלייה) are RM-gated in the deployment status
  // machine, so `Version.status` is a reliable floor for them — a stray
  // cross-module signal (e.g. a Go/No-Go row on a version still in COLLECTING)
  // must NOT jump the phase ahead of where the release manager has taken it.
  const readyFloor = ['APPROVED', 'REHEARSAL', 'ACTIVE', 'MORNING_AFTER', 'COMPLETED'].includes(s.status);

  // ── Layer 1 — coarse phase (strict precedence, first match wins) ──────────
  let phase: VersionPhase;
  if (s.status === 'ROLLED_BACK') {
    phase = 'ROLLED_BACK';
  } else if (s.status === 'COMPLETED') {
    phase = 'DONE';
  } else if (s.status === 'ACTIVE' || s.status === 'MORNING_AFTER') {
    phase = 'GO_LIVE_NIGHT';
  } else if (s.status === 'REHEARSAL' || (readyFloor && s.goNoGoDecided)) {
    phase = 'GO_LIVE_READY';
  } else if (qaApproved || coreActive || coreAllPast) {
    phase = 'TESTING';
  } else if (scopeApproved) {
    phase = 'TEST_PLANNING';
  } else {
    phase = 'SCOPE_PLANNING';
  }

  // ── Layer 2 — per-module status ─────────────────────────────────────────
  const versionManagement =
    s.status === 'DRAFT' ? 'טיוטה'
    : s.status === 'COLLECTING' ? 'איסוף CR'
    : ['CR_REVIEW', 'REFINING', 'REVIEW'].includes(s.status) ? 'בסקירת CR'
    : scopeApproved ? 'תכולה אושרה'
    : 'טיוטה';

  const qa =
    s.qaWorkPlanStatus == null ? 'אין תוכנית'
    : s.qaWorkPlanStatus === 'APPROVED' ? 'תוכנית מאושרת'
    : 'תוכנית טיוטה';

  const deployments =
    s.status === 'ROLLED_BACK' ? 'בוטל'
    : s.status === 'COMPLETED' ? 'הסתיים'
    : s.status === 'MORNING_AFTER' ? 'בוקר אחרי'
    : s.status === 'ACTIVE' ? 'לילה פעיל'
    : s.status === 'REHEARSAL' ? 'חזרה גנרלית'
    : s.phaseCount > 0 ? 'תוכנית לילה נבנתה'
    : 'תוכנית לילה טרם נבנתה';

  const releaseIntelligence =
    s.goNoGoDecided ? 'Go/No-Go התקבל'
    : coreActive ? 'סבבים פעילים'
    : coreAllPast ? 'הסבבים הושלמו'
    : s.qaWorkPlanStatus != null ? 'ממתין לתחילת סבב'
    : 'טרם החל';

  const quality = s.hasKpiScores ? 'יש ציון איכות' : 'אין נתוני איכות';

  return {
    phase,
    phaseLabel: PHASE_LABEL_HE[phase],
    stage: s.stage ? deriveVersionStage(s.stage, now) : deriveVersionStage({
      status: s.status, integrationStart: null, integrationEnd: null, rehearsalStart: null, rehearsalEnd: null, goLive: null, cycles: [],
    }, now),
    perModule: { versionManagement, qa, deployments, releaseIntelligence, quality },
  };
}

// Prisma include fragment for `version.findMany` — the cheap relations the
// deriver needs. Spread into an existing include.
export const LIFECYCLE_INCLUDE = {
  qaWorkPlan: { select: { status: true, cycles: { select: { cycleType: true, plannedStart: true, plannedEnd: true } } } },
  goNoGoDecision: { select: { qaManagerStatus: true, releaseManagerStatus: true, managementStatus: true } },
} as const;

// A recorded Go/No-Go — any of the three manager gates decided (not just the
// stub row that always exists to carry the live system recommendation).
function goNoGoDecided(d: any): boolean {
  if (!d) return false;
  const decided = (v: string | null | undefined) => !!v && v !== 'PENDING';
  return decided(d.qaManagerStatus) || decided(d.releaseManagerStatus) || decided(d.managementStatus);
}

// Map a raw prisma version row (built with LIFECYCLE_INCLUDE + _count.phases)
// plus the set of release names that have KPI scores → its lifecycle.
export function lifecycleFromVersionRow(
  v: any,
  kpiScoreNames: Set<string>,
  now: Date = new Date(),
): VersionLifecycle {
  const coreCycles = (v.qaWorkPlan?.cycles ?? [])
    .filter((c: any) => CORE_CYCLE_TYPES.includes(c.cycleType))
    .map((c: any) => ({ plannedStart: c.plannedStart as Date, plannedEnd: c.plannedEnd as Date }));

  return deriveVersionLifecycle({
    status: v.status,
    scopeApprovedAt: v.scopeApprovedAt ?? null,
    phaseCount: v._count?.phases ?? 0,
    qaWorkPlanStatus: v.qaWorkPlan?.status ?? null,
    coreCycles,
    goNoGoDecided: goNoGoDecided(v.goNoGoDecision),
    hasKpiScores: kpiScoreNames.has(v.name),
    stage: {
      status: v.status,
      integrationStart: v.integrationStart ?? null, integrationEnd: v.integrationEnd ?? null,
      rehearsalStart: v.plannedRehearsalStart ?? null, rehearsalEnd: v.plannedRehearsalEnd ?? null,
      goLive: v.plannedStart ?? null,
      cycles: (v.qaWorkPlan?.cycles ?? []).filter((c: any) => c.plannedStart && c.plannedEnd)
        .map((c: any) => ({ cycleType: c.cycleType, plannedStart: new Date(c.plannedStart), plannedEnd: new Date(c.plannedEnd) })),
    },
  }, now);
}
