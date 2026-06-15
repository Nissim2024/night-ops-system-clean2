/**
 * QA Scoring & Assignment Engine — v2
 *
 * Weights (dynamic by risk level):
 *
 *   Risk LOW      → 60% Load  | 25% Skill | 15% Continuity
 *   Risk MEDIUM   → 50% Load  | 35% Skill | 15% Continuity  (default)
 *   Risk HIGH     → 30% Load  | 55% Skill | 15% Continuity
 *   Risk CRITICAL → 30% Load  | 55% Skill | 15% Continuity
 *
 * Improvements over v1:
 *   ✔ Risk-aware dynamic weights
 *   ✔ Gradual continuity decay (not binary 100/0)
 *   ✔ Capacity-aware load (vs. actual testing window, not just relative)
 *   ✔ Parallel-version load (sum across all overlapping versions)
 *   ✔ Over-qualified penalty waived for HIGH/CRITICAL CRs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Public types ──────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  load: {
    weightedScore: number;
    rawScore:      number;
    currentHours:  number;   // total days across all overlapping versions
    windowDays:    number;   // testing window length in days
  };
  skill: {
    weightedScore: number;
    rawScore:      number;
    level:         number | null;
    requiredLevel: number;
  };
  continuity: {
    weightedScore: number;
    rawScore:      number;
    hasHistory:    boolean;
    lastAssignedDaysAgo: number | null;
  };
}

export interface ScoredTester {
  userId:     string;
  fullName:   string;
  email:      string;
  totalScore: number;
  breakdown:  ScoreBreakdown;
}

export interface ScoringResult {
  status:            'OK' | 'MANUAL_INTERVENTION';
  crNumber:          string;
  crLabel:           string | null;
  application:       string | null;
  requiredSkillName: string | null;
  requiredMinLevel:  number;
  qaEffortDays:      number;
  recommendations:   ScoredTester[];
  filteredByLeave:   string[];
  filteredBySkill:   string[];
  blockReasons:      string[];
}

// ── Risk-aware weights ────────────────────────────────────────────────────────

function getWeights(riskLevel: string | null): { load: number; skill: number; continuity: number } {
  switch ((riskLevel ?? '').toUpperCase()) {
    case 'CRITICAL':
    case 'HIGH':   return { load: 0.30, skill: 0.55, continuity: 0.15 };
    case 'LOW':    return { load: 0.60, skill: 0.25, continuity: 0.15 };
    default:       return { load: 0.50, skill: 0.35, continuity: 0.15 }; // MEDIUM / unknown
  }
}

// ── Gradual continuity score (time-decay) ─────────────────────────────────────
// Returns 0–100 based on how recently the tester worked on this application.

function continuitScore(lastAssignedDate: Date | null): number {
  if (!lastAssignedDate) return 0;
  const daysAgo = (Date.now() - lastAssignedDate.getTime()) / (1000 * 60 * 60 * 24);
  if (daysAgo <=  30) return 100;
  if (daysAgo <=  60) return  75;
  if (daysAgo <=  90) return  50;
  if (daysAgo <= 180) return  25;
  return 0;
}

// ── Skill name → application alias map ───────────────────────────────────────

const APP_ALIASES: Record<string, string> = {
  WIZ: 'Wizard', WIZARD: 'Wizard', wizard: 'Wizard', wiz: 'Wizard',
  crm: 'CRM',    CRM:    'CRM',
  zoo: 'ZOO',    ZOO:    'ZOO',
  prov: 'Provisioning', PROV: 'Provisioning', provisioning: 'Provisioning',
  top: 'TOP',    TOP: 'TOP',
  osb: 'OSB',    OSB: 'OSB',
  web: 'WEB',    WEB: 'WEB',
  dwh: 'DWH',    DWH: 'DWH',
  remedy: 'Remedy', REMEDY: 'Remedy',
  ivr: 'IVR',    IVR: 'IVR',
  erp: 'ERP',    ERP: 'ERP',
};

function resolveSkillName(application: string | null): string | null {
  if (!application || application === 'null') return null;
  if (APP_ALIASES[application]) return APP_ALIASES[application];
  const lower = application.toLowerCase();
  const known = ['Wizard','CRM','ZOO','Provisioning','TOP','OSB','WEB','DWH','Remedy','IVR','ERP'];
  return known.find(s =>
    s.toLowerCase() === lower ||
    s.toLowerCase().includes(lower) ||
    lower.includes(s.toLowerCase()),
  ) ?? null;
}

// ── Load tester roster ────────────────────────────────────────────────────────

async function getActiveTesters() {
  const profiles = await prisma.testerProfile.findMany({
    where: { isActive: true },
    include: {
      user: { select: { id: true, fullName: true, email: true } },
      testerSkills: { include: { skill: true } },
    },
  });
  return profiles.map(p => ({
    userId:   p.userId,
    fullName: p.user.fullName,
    email:    p.user.email,
    skills:   p.testerSkills.map(ts => ({
      skillId:   ts.skillId,
      skillName: ts.skill.name,
      skillType: ts.skill.type as string,
      level:     ts.level,
    })),
  }));
}

// ── Main scoring function ─────────────────────────────────────────────────────

export async function scoreForCr(crNumber: string, versionId: string, maxResults = 3): Promise<ScoringResult> {

  // ── 1. Load CR info ───────────────────────────────────────────────────────

  const vcaRow = await prisma.versionCrAssignment.findFirst({
    where: { versionId, crNumber },
  });
  if (!vcaRow) {
    return {
      status: 'MANUAL_INTERVENTION',
      crNumber, crLabel: null, application: null,
      requiredSkillName: null, requiredMinLevel: 1, qaEffortDays: 0,
      recommendations: [],
      filteredByLeave: [], filteredBySkill: [],
      blockReasons: [`CR ${crNumber} לא נמצא בגרסה ${versionId}`],
    };
  }

  const requiredSkillName = resolveSkillName(vcaRow.application);
  const requiredMinLevel  = vcaRow.requiredSkillMinLevel ?? 1;
  const qaEffortDays      = vcaRow.qaEffort ?? 0;

  // riskLevel lives in CrPlan, not VersionCrAssignment
  const crPlan   = await prisma.crPlan.findFirst({ where: { versionId, crNumber }, select: { riskLevel: true } });
  const riskLevel = crPlan?.riskLevel ?? null;
  const weights   = getWeights(riskLevel);

  // ── 2. Load version dates + testing window ────────────────────────────────

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { plannedStart: true, plannedEnd: true },
  });
  const versionStart = version?.plannedStart ?? null;
  const versionEnd   = version?.plannedEnd   ?? null;

  // Testing window in days (used for capacity-aware load)
  let windowDays = 0;
  if (versionStart && versionEnd) {
    windowDays = Math.max(
      1,
      Math.round((versionEnd.getTime() - versionStart.getTime()) / (1000 * 60 * 60 * 24)),
    );
  }

  // ── 3. Load all active testers ────────────────────────────────────────────

  const allTesters = await getActiveTesters();

  // ── 4. Load across ALL overlapping versions (parallel-version awareness) ──
  // Sum qaEffort for each tester across any version that overlaps with this one.

  let parallelVersionIds: string[] = [versionId];

  if (versionStart && versionEnd) {
    const overlapping = await prisma.version.findMany({
      where: {
        id:           { not: versionId },
        plannedStart: { lte: versionEnd   },
        plannedEnd:   { gte: versionStart },
      },
      select: { id: true },
    });
    parallelVersionIds = [versionId, ...overlapping.map(v => v.id)];
  }

  const allAssignments = await prisma.qaAssignment.findMany({
    where: { versionId: { in: parallelVersionIds } },
    select: { userId: true, qaEffort: true },
  });

  const loadMap = new Map<string, number>(); // userId → total days across overlapping versions
  allAssignments.forEach(a => {
    loadMap.set(a.userId, (loadMap.get(a.userId) ?? 0) + (a.qaEffort ?? 0));
  });

  // ── 5. Gradual continuity — most recent assignment date per tester ─────────

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 6); // look back 6 months for decay

  const history = await prisma.qaAssignment.findMany({
    where: {
      versionId:  { not: versionId },
      createdAt:  { gte: threeMonthsAgo },
      ...(requiredSkillName
        ? { application: { contains: requiredSkillName, mode: 'insensitive' } }
        : {}),
    },
    select: { userId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  // Keep most recent assignment per tester
  const lastAssignedMap = new Map<string, Date>();
  history.forEach(h => {
    if (!lastAssignedMap.has(h.userId)) {
      lastAssignedMap.set(h.userId, h.createdAt);
    }
  });

  // ── 6. Hard constraint: leaves ────────────────────────────────────────────

  const filteredByLeave: string[] = [];
  let testers = allTesters;

  if (versionStart && versionEnd) {
    const leaves = await prisma.leaveRequest.findMany({
      where: {
        status: 'APPROVED',
        kind:   'leave',
        date:   { gte: versionStart, lte: versionEnd },
        userId: { in: allTesters.map(t => t.userId) },
      },
      select: { userId: true },
    });
    const onLeaveIds = new Set(leaves.map(l => l.userId));
    filteredByLeave.push(...testers.filter(t => onLeaveIds.has(t.userId)).map(t => t.fullName));
    testers = testers.filter(t => !onLeaveIds.has(t.userId));
  }

  // ── 7. Hard constraint: mandatory skill ───────────────────────────────────

  const filteredBySkill: string[] = [];

  if (requiredSkillName) {
    const blocked = testers.filter(t => {
      const skill = t.skills.find(
        s => s.skillType === 'Applications' && s.skillName === requiredSkillName,
      );
      return !skill || skill.level < requiredMinLevel;
    });
    filteredBySkill.push(...blocked.map(t => t.fullName));
    testers = testers.filter(t => {
      const skill = t.skills.find(
        s => s.skillType === 'Applications' && s.skillName === requiredSkillName,
      );
      return skill && skill.level >= requiredMinLevel;
    });
  }

  // ── 8. No viable candidates → Manual Intervention ────────────────────────

  if (testers.length === 0) {
    const blockReasons: string[] = [];
    if (filteredByLeave.length > 0) {
      blockReasons.push(
        `${filteredByLeave.length} בודק${filteredByLeave.length > 1 ? 'ים' : ''} מסוננ${filteredByLeave.length > 1 ? 'ים' : ''} בשל חופשה מאושרת: ${filteredByLeave.join(', ')}`,
      );
    }
    if (filteredBySkill.length > 0) {
      blockReasons.push(
        `${filteredBySkill.length} בודק${filteredBySkill.length > 1 ? 'ים' : ''} מסוננ${filteredBySkill.length > 1 ? 'ים' : ''} כי אין להם סקיל ${requiredSkillName} ברמה ${requiredMinLevel}+: ${filteredBySkill.join(', ')}`,
      );
    }
    if (blockReasons.length === 0) blockReasons.push('אין בודקים פעילים במערכת');

    return {
      status: 'MANUAL_INTERVENTION',
      crNumber, crLabel: vcaRow.crLabel, application: vcaRow.application,
      requiredSkillName, requiredMinLevel, qaEffortDays,
      recommendations: [],
      filteredByLeave, filteredBySkill,
      blockReasons,
    };
  }

  // ── 9. Compute scores ─────────────────────────────────────────────────────

  const scored: ScoredTester[] = testers.map(t => {

    // ── Load (capacity-aware) ─────────────────────────────────────────
    const currentDays = loadMap.get(t.userId) ?? 0;
    let loadRaw: number;
    if (windowDays > 0) {
      // Capacity-aware: how full is the tester relative to the testing window?
      loadRaw = Math.max(0, (1 - currentDays / windowDays) * 100);
    } else {
      // Fallback: relative comparison between testers
      const maxLoad = Math.max(...Array.from(loadMap.values()), 0);
      loadRaw = maxLoad > 0 ? (1 - currentDays / maxLoad) * 100 : 100;
    }

    // ── Skill ─────────────────────────────────────────────────────────
    let skillRaw  = 50;
    let skillLevel: number | null = null;
    if (requiredSkillName) {
      const skillEntry = t.skills.find(
        s => s.skillType === 'Applications' && s.skillName === requiredSkillName,
      );
      skillLevel = skillEntry?.level ?? null;
      if (skillLevel !== null) {
        const diff = skillLevel - requiredMinLevel;
        const isHighRisk = ['HIGH', 'CRITICAL'].includes((riskLevel ?? '').toUpperCase());
        // Over-qualified penalty waived for HIGH/CRITICAL CRs
        skillRaw = (diff >= 2 && !isHighRisk) ? 70 : 100;
      }
    }

    // ── Continuity (gradual decay) ────────────────────────────────────
    const lastDate         = lastAssignedMap.get(t.userId) ?? null;
    const continuityRaw    = continuitScore(lastDate);
    const lastDaysAgo      = lastDate
      ? Math.round((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    // ── Weighted total ────────────────────────────────────────────────
    const total = weights.load * loadRaw + weights.skill * skillRaw + weights.continuity * continuityRaw;

    return {
      userId:     t.userId,
      fullName:   t.fullName,
      email:      t.email,
      totalScore: Math.round(total),
      breakdown: {
        load: {
          weightedScore: Math.round(weights.load * loadRaw),
          rawScore:      Math.round(loadRaw),
          currentHours:  currentDays,
          windowDays,
        },
        skill: {
          weightedScore: Math.round(weights.skill * skillRaw),
          rawScore:      Math.round(skillRaw),
          level:         skillLevel,
          requiredLevel: requiredMinLevel,
        },
        continuity: {
          weightedScore:       Math.round(weights.continuity * continuityRaw),
          rawScore:            continuityRaw,
          hasHistory:          continuityRaw > 0,
          lastAssignedDaysAgo: lastDaysAgo,
        },
      },
    };
  });

  scored.sort((a, b) => b.totalScore - a.totalScore);

  return {
    status:           'OK',
    crNumber,
    crLabel:          vcaRow.crLabel,
    application:      vcaRow.application,
    requiredSkillName,
    requiredMinLevel,
    qaEffortDays,
    recommendations:  scored.slice(0, maxResults),
    filteredByLeave,
    filteredBySkill,
    blockReasons:     [],
  };
}
