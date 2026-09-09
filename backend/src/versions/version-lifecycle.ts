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

export interface VersionLifecycle {
  phase: VersionPhase;
  phaseLabel: string;
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
  }, now);
}
