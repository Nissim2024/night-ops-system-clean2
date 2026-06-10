/**
 * QA Scoring & Assignment Engine
 *
 * Weights:
 *   50% — Load Balancing   (fewer assigned hours = higher score)
 *   35% — Skill Match      (exact / +1 level = 100, over-qualified ≥+2 = 70)
 *   15% — Continuity       (tested same app in last 3 months = 100, else 0)
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Public types ──────────────────────────────────────────────────────────────

export interface ScoreBreakdown {
  load: {
    weightedScore: number;   // 0–50
    rawScore:      number;   // 0–100
    currentHours:  number;   // minutes already assigned this version
  };
  skill: {
    weightedScore: number;   // 0–35
    rawScore:      number;   // 0–100
    level:         number | null;
    requiredLevel: number;
  };
  continuity: {
    weightedScore: number;   // 0–15
    rawScore:      number;   // 0–100
    hasHistory:    boolean;
  };
}

export interface ScoredTester {
  userId:     string;
  fullName:   string;
  email:      string;
  totalScore: number;   // 0–100, rounded integer
  breakdown:  ScoreBreakdown;
}

export interface ScoringResult {
  status:           'OK' | 'MANUAL_INTERVENTION';
  crNumber:         string;
  crLabel:          string | null;
  application:      string | null;
  requiredSkillName: string | null;
  requiredMinLevel:  number;
  qaEffortDays:      number;
  recommendations:  ScoredTester[];   // top-3, empty on MANUAL_INTERVENTION
  filteredByLeave:  string[];         // tester full names
  filteredBySkill:  string[];         // tester full names
  blockReasons:     string[];         // human-readable, shown to manager
}

// ── Skill name → application alias map ───────────────────────────────────────
// Maps values that appear in VersionCrAssignment.application to the
// canonical Skill.name stored in the DB (Applications category).

const APP_ALIASES: Record<string, string> = {
  WIZ:          'Wizard',
  WIZARD:       'Wizard',
  wizard:       'Wizard',
  wiz:          'Wizard',
  crm:          'CRM',
  CRM:          'CRM',
  zoo:          'ZOO',
  ZOO:          'ZOO',
  prov:         'Provisioning',
  PROV:         'Provisioning',
  provisioning: 'Provisioning',
  top:          'TOP',
  TOP:          'TOP',
  osb:          'OSB',
  OSB:          'OSB',
  web:          'WEB',
  WEB:          'WEB',
  dwh:          'DWH',
  DWH:          'DWH',
  remedy:       'Remedy',
  REMEDY:       'Remedy',
  ivr:          'IVR',
  IVR:          'IVR',
  erp:          'ERP',
  ERP:          'ERP',
};

function resolveSkillName(application: string | null): string | null {
  if (!application || application === 'null') return null;
  // direct alias lookup
  if (APP_ALIASES[application]) return APP_ALIASES[application];
  // case-insensitive partial match against known skill names
  const lower = application.toLowerCase();
  const known = ['Wizard','CRM','ZOO','Provisioning','TOP','OSB','WEB','DWH','Remedy','IVR','ERP'];
  return known.find(s => s.toLowerCase() === lower || s.toLowerCase().includes(lower) || lower.includes(s.toLowerCase())) ?? null;
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

export async function scoreForCr(crNumber: string, versionId: string): Promise<ScoringResult> {

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
  const qaEffortDays   = vcaRow.qaEffort ?? 0;

  // ── 2. Load version dates ─────────────────────────────────────────────────

  const version = await prisma.version.findUnique({
    where: { id: versionId },
    select: { plannedStart: true, plannedEnd: true },
  });
  const versionStart = version?.plannedStart ?? null;
  const versionEnd   = version?.plannedEnd   ?? null;

  // ── 3. Load all active testers ────────────────────────────────────────────

  const allTesters = await getActiveTesters();

  // ── 4. Load existing assignments for this version (for load balancing) ────

  const existingAssignments = await prisma.qaAssignment.findMany({
    where: { versionId },
    select: { userId: true, qaEffort: true },
  });
  const loadMap = new Map<string, number>(); // userId → total days (qaEffort in DAYS)
  existingAssignments.forEach(a => {
    loadMap.set(a.userId, (loadMap.get(a.userId) ?? 0) + (a.qaEffort ?? 0));
  });

  // ── 5. Load historical assignments for continuity (last 3 months) ─────────

  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

  const history = await prisma.qaAssignment.findMany({
    where: {
      versionId: { not: versionId },
      createdAt: { gte: threeMonthsAgo },
      ...(requiredSkillName ? { application: { contains: requiredSkillName, mode: 'insensitive' } } : {}),
    },
    select: { userId: true, application: true },
  });
  const historySet = new Set<string>(history.map(h => h.userId)); // testers with recent history on this app

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
    const blocked = testers.filter(t => onLeaveIds.has(t.userId));
    filteredByLeave.push(...blocked.map(t => t.fullName));
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
        `${filteredByLeave.length} בודק${filteredByLeave.length > 1 ? 'ים' : ''} מסוננ${filteredByLeave.length > 1 ? 'ים' : ''} בשל חופשה מאושרת בתאריכי הגרסה: ${filteredByLeave.join(', ')}`,
      );
    }
    if (filteredBySkill.length > 0) {
      blockReasons.push(
        `${filteredBySkill.length} בודק${filteredBySkill.length > 1 ? 'ים' : ''} מסוננ${filteredBySkill.length > 1 ? 'ים' : ''} כי אין להם סקיל ${requiredSkillName} ברמה ${requiredMinLevel} ומעלה: ${filteredBySkill.join(', ')}`,
      );
    }
    if (blockReasons.length === 0) {
      blockReasons.push('אין בודקים פעילים במערכת');
    }

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

  const maxLoad = Math.max(...[...loadMap.values(), 0]);

  const scored: ScoredTester[] = testers.map(t => {
    // ── Load (50%) ────────────────────────────────────────────────────
    const currentHours = loadMap.get(t.userId) ?? 0;
    const loadRaw      = maxLoad > 0 ? (1 - currentHours / maxLoad) * 100 : 100;

    // ── Skill (35%) ───────────────────────────────────────────────────
    let skillRaw = 50; // neutral when no skill can be matched
    let skillLevel: number | null = null;
    if (requiredSkillName) {
      const skillEntry = t.skills.find(
        s => s.skillType === 'Applications' && s.skillName === requiredSkillName,
      );
      skillLevel = skillEntry?.level ?? null;
      if (skillLevel !== null) {
        const diff = skillLevel - requiredMinLevel;
        skillRaw = diff >= 2 ? 70 : 100; // over-qualified → 70, exact/+1 → 100
      }
    }

    // ── Continuity (15%) ──────────────────────────────────────────────
    const hasHistory  = historySet.has(t.userId);
    const continuityRaw = hasHistory ? 100 : 0;

    // ── Weighted total ────────────────────────────────────────────────
    const total = 0.50 * loadRaw + 0.35 * skillRaw + 0.15 * continuityRaw;

    return {
      userId:     t.userId,
      fullName:   t.fullName,
      email:      t.email,
      totalScore: Math.round(total),
      breakdown: {
        load:       { weightedScore: Math.round(0.50 * loadRaw),       rawScore: Math.round(loadRaw),       currentHours },
        skill:      { weightedScore: Math.round(0.35 * skillRaw),      rawScore: Math.round(skillRaw),      level: skillLevel, requiredLevel: requiredMinLevel },
        continuity: { weightedScore: Math.round(0.15 * continuityRaw), rawScore: continuityRaw,             hasHistory },
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
    recommendations:  scored.slice(0, 3),
    filteredByLeave,
    filteredBySkill,
    blockReasons:     [],
  };
}
