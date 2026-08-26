import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import { QcService } from '../qc/qc.service';
import { ROOT_CAUSE_TAXONOMY, ROOT_CAUSE_CATEGORIES } from './root-cause-taxonomy';
import { GUIDED_TREE_NODES, GUIDED_TREE_LEAVES, GUIDED_TREE_START, buildAutoFiveWhy, GuidedTreePathEntry } from './guided-investigation-tree';

const GUIDED_TIMING_VALUES = Object.keys(GUIDED_TREE_START);
const GUIDED_REPRODUCIBILITY_VALUES = ['ALWAYS', 'PARTIAL', 'RANDOM'];

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// ── AI prompt (Hebrew) ───────────────────────────────────────────────────────
// Mirrors the same synchronous-call pattern already used in
// versions.service.ts's generateUnifiedCrSummary — this codebase calls Claude
// directly from the request handler (no job queue/worker infra exists here),
// reads the API key from SystemParam with an env-var fallback, and uses the
// same claude-haiku-4-5 model.
// Shared incident-context block for both prompt builders below — includes
// the real QC component/impact fields (when populated) and the manually-
// entered triage fields (affected users/customer-facing/downtime), which
// exist only on our own Incident row, never in QC itself.
function buildIncidentContextBlock(incident: any): string {
  const lines = [
    `תקלה: ${incident.title}`,
    `תיאור: ${incident.description ?? '—'}`,
    `גרסה צפויה: ${incident.expectedVersion ?? '—'} | גרסה בפועל: ${incident.actualVersion ?? '—'}`,
    `חומרה מקורית (QC): ${incident.severity ?? '—'}`,
  ];
  if (incident.crReferenceNumber) lines.push(`CR מקושר: ${incident.crReferenceNumber}`);
  const component = [incident.mainModule, incident.subModule, incident.systemComponent].filter(Boolean).join(' / ');
  if (component) lines.push(`רכיב חשוד (QC): ${component}`);
  if (incident.impact) lines.push(`השפעה עסקית (QC): ${incident.impact}`);
  if (incident.affectedUsersCount != null) lines.push(`משתמשים מושפעים (הוזן ידנית): ${incident.affectedUsersCount}`);
  if (incident.customerFacing != null) lines.push(`משפיע על לקוחות (הוזן ידנית): ${incident.customerFacing ? 'כן' : 'לא'}`);
  if (incident.downtimeMinutes != null) lines.push(`משך אי-זמינות (הוזן ידנית): ${incident.downtimeMinutes} דקות`);
  return lines.join('\n');
}

// Real teams the RCA should reason about — not a fixed SDLC-stage list (see
// getRelevantTeams: scoped to the CrPlan teams for the incident's linked CR
// when known, else every active team). Both prompt builders below embed
// this so the AI's lessons/actions land on the actual teams involved,
// exactly like the human-driven Fishbone/5-Why paths now do.
function buildTeamsBlock(teams: { id: string; name: string }[], scoped: boolean): string {
  const names = teams.map(t => t.name).join(', ') || '(לא נמצאו צוותים)';
  return `${scoped ? 'צוותים שעבדו בפועל על ה-CR המקושר לתקלה זו' : 'כל הצוותים הפעילים (לא נמצא CR מקושר לתקלה, אין רשימה ממוקדת)'}: ${names}`;
}

// Fixed Root Cause Category → Root Cause (RCA) taxonomy (see
// root-cause-taxonomy.ts) — embedded so the AI classifies against the same
// real picklist the manual wizard uses, instead of inventing a category.
function buildTaxonomyBlock(): string {
  const lines = ROOT_CAUSE_CATEGORIES.map(cat => `- ${cat}: ${ROOT_CAUSE_TAXONOMY[cat].join(', ')}`);
  return `רשימת קטגוריות גורם שורש (Root Cause Category) וגורמים ספציפיים (Root Cause) תחת כל קטגוריה:\n${lines.join('\n')}`;
}

function buildAnalyzePrompt(incident: any, evidence: any[], teams: { id: string; name: string }[], teamsScoped: boolean): string {
  const evidenceText = evidence.map(e => `- [${e.type}] ${e.content}`).join('\n') || '(אין ראיות שנאספו)';
  return `אתה מהנדס DevOps/Release בכיר שמבצע ניתוח שורש-בעיה (RCA) לתקלה שהתגלתה בליל גרסה.

${buildIncidentContextBlock(incident)}

${buildTeamsBlock(teams, teamsScoped)}

${buildTaxonomyBlock()}

ראיות שנאספו:
${evidenceText}

החזר אך ורק JSON תקין (ללא טקסט נוסף) במבנה הבא:
{
  "rootCause": "תקציר קצר של הגורם השורשי",
  "description": "תיאור מפורט של הסיבה לשורש התקלה, כולל ההקשר והתנאים שהובילו לה",
  "category": "<קטגוריה בדיוק מהרשימה למעלה>",
  "rootCauseReason": "<גורם ספציפי בדיוק מהרשימה, תחת הקטגוריה שנבחרה>",
  "severity": "LOW" | "MEDIUM" | "HIGH" | "CRITICAL",
  "lessons": [ { "team": "<שם צוות מהרשימה למעלה, בדיוק כפי שנכתב>", "text": "..." } ],
  "actions": [ { "team": "<שם צוות מהרשימה למעלה, בדיוק כפי שנכתב>", "title": "...", "priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "dueDays": 3 } ],
  "confidence": 0.0
}

הנחיות: lessons/actions חייבים להשתמש בשם צוות מהרשימה שסופקה למעלה בדיוק (לא לבדות שם חדש). category/rootCauseReason חייבים להיות מדויקים מרשימת הטקסונומיה שסופקה — rootCauseReason חייב להיות אחד מהגורמים שרשומים תחת ה-category שנבחר. כלול רק צוותים שבאמת רלוונטיים ללקח או לפעולה — לא כל צוות מהרשימה חייב להופיע. actions צריך לכלול לפחות פעולה אחת. confidence הוא מספר בין 0 ל-1 המשקף עד כמה אתה בטוח באבחנה בהינתן הראיות שסופקו.`;
}

// QC's CR-reference field (BG_USER_58) is free text — sometimes a bare
// number ("12714"), sometimes "12650 - מערכת תזכורות בCRM". Our own
// CrPlan.crNumber/Task.crNumber are always the bare number, so evidence
// correlation needs the leading digit run extracted first.
function extractCrNumber(raw: string | null | undefined): string | null {
  const match = (raw ?? '').match(/\d+/);
  return match ? match[0] : null;
}

@Injectable()
export class IncidentsService {
  private readonly logger = new Logger(IncidentsService.name);

  constructor(private readonly qcService: QcService) {}

  // ── List / import from QC ─────────────────────────────────────────────────

  async listForVersion(versionId: string, status?: string) {
    return prisma.incident.findMany({
      where: { versionId, ...(status ? { status: status as any } : {}) },
      include: {
        evidence: { select: { id: true, type: true } },
        rca: { select: { id: true, method: true, rootCause: true } },
        actions: { select: { id: true, status: true, team: true } },
        group: { select: { id: true, reason: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Candidates for import — QC defects for this version not yet turned into
  // an Incident (matched by qcDefectId). Sourced from the existing Oracle/QC
  // integration (qc.service.ts), not a separate incident system. Returns the
  // full real field set (same breadth as TARGET's defects — getGoLiveIncidents
  // is TargetDefectDto-shaped), not a narrow hand-picked subset — the
  // frontend's column-picker lets the user choose which of these to show
  // (2026-08-09 product decision, matching TARGET's own picker).
  async previewImportFromQc(versionId: string) {
    const [defects, existing] = await Promise.all([
      this.qcService.getGoLiveIncidents(versionId),
      prisma.incident.findMany({ where: { versionId }, select: { qcDefectId: true } }),
    ]);
    const already = new Set(existing.map(e => e.qcDefectId));
    return defects
      .filter(d => !already.has(d.id))
      .map(({ id, ...rest }) => ({ qcDefectId: id, ...rest }));
  }

  async importFromQc(versionId: string, qcDefectIds: string[], createdByName: string) {
    if (!qcDefectIds?.length) throw new BadRequestException('לא נבחרו תקלות לייבוא');
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('גרסה לא נמצאה');

    const defects = await this.qcService.getGoLiveIncidents(versionId);
    const byId = new Map(defects.map(d => [d.id, d]));
    const toCreate = qcDefectIds.map(id => byId.get(id)).filter((d): d is NonNullable<typeof d> => !!d);
    if (!toCreate.length) throw new BadRequestException('התקלות שנבחרו לא נמצאו ב-QC');

    const severityMap: Record<string, 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'> = {
      'Low': 'LOW', 'Medium': 'MEDIUM', 'High': 'HIGH', 'Severe': 'HIGH', 'Show Stopper': 'CRITICAL',
    };

    let created = 0;
    for (const d of toCreate) {
      const exists = await prisma.incident.findUnique({ where: { versionId_qcDefectId: { versionId, qcDefectId: d.id } } });
      if (exists) continue;
      await prisma.incident.create({
        data: {
          versionId, qcDefectId: d.id, title: d.title, description: d.description || null,
          expectedVersion: version.name, actualVersion: null,
          severity: severityMap[d.severity] ?? null,
          defectType: d.defectType || null,
          crReferenceNumber: d.crReferenceNumber || null,
          mainModule: d.mainModule || null, subModule: d.subModule || null,
          systemComponent: d.systemComponent || null, impact: d.impact || null,
          businessProcess: d.businessProcess || null, mainBusinessProcess: d.mainBusinessProcess || null,
        },
      });
      created++;
    }
    this.logger.log(`Imported ${created}/${toCreate.length} QC incidents for version ${versionId} (by ${createdByName})`);
    return { imported: created, skipped: toCreate.length - created };
  }

  // ── Evidence ───────────────────────────────────────────────────────────────

  // Auto-collects what this app actually has access to: the source QC defect's
  // full record, this version's own recorded lifecycle dates/status, and —
  // when the defect carries a real CR reference (BG_USER_58) — the actual
  // CrPlan submitted for that CR+version, what really happened on its tasks
  // during the night (Task + AuditLog), and real QC test-execution coverage
  // for it. There is no real access to the deployed system's docker/DB from
  // here, so this never fabricates infrastructure evidence — only real,
  // already-known data from either QC or this app's own DB.
  async collectEvidence(incidentId: string) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { version: true } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');

    const [defects] = await Promise.all([this.qcService.getGoLiveIncidents(incident.versionId)]);
    const defect = defects.find(d => d.id === incident.qcDefectId);

    const rows: { type: string; content: string; meta: any }[] = [];
    if (defect) {
      rows.push({
        type: 'QC_DEFECT_LOG',
        content: `${defect.status} · ${defect.severity} · ${defect.testPhase || '—'} · דווח ע"י ${defect.detectedBy || '—'} ב-${defect.detectedOnDate || '—'}`,
        meta: defect,
      });
    }
    rows.push({
      type: 'DB_MIGRATION_STATUS',
      content: `סטטוס גרסה: ${incident.version.status} · תאריך תכנון: ${incident.version.plannedStart ?? '—'} · תחילה בפועל: ${incident.version.actualStart ?? '—'}`,
      meta: {
        status: incident.version.status, plannedStart: incident.version.plannedStart,
        actualStart: incident.version.actualStart, completedAt: incident.version.completedAt,
      },
    });

    const crNumber = extractCrNumber(incident.crReferenceNumber);
    if (crNumber) {
      const [crPlans, tasks, coverage] = await Promise.all([
        prisma.crPlan.findMany({ where: { versionId: incident.versionId, crNumber }, include: { team: { select: { name: true } } } }),
        prisma.task.findMany({ where: { versionId: incident.versionId, crNumber }, orderBy: { createdAt: 'asc' } }),
        this.qcService.getCrCoverage([crNumber], incident.versionId).catch(() => []),
      ]);

      for (const plan of crPlans) {
        const parts = [
          plan.riskLevel ? `רמת סיכון: ${plan.riskLevel}` : null,
          plan.workPlan ? `תוכנית עבודה: ${plan.workPlan}` : null,
          plan.scripts ? `סקריפטים: ${plan.scripts}` : null,
          plan.rollbackPlan ? `תוכנית Rollback: ${plan.rollbackPlan}` : null,
          plan.gradualRollout ? 'עלייה מדורגת: כן' : null,
        ].filter(Boolean);
        rows.push({
          type: 'CR_PLAN',
          content: `תוכנית ${plan.team?.name ?? 'צוות'} עבור CR ${crNumber}${parts.length ? ' — ' + parts.join(' · ') : ' — לא מולאה תוכנית'}`,
          meta: plan,
        });
      }

      if (tasks.length) {
        const taskIds = tasks.map(t => t.id);
        const auditLogs = await prisma.auditLog.findMany({
          where: { taskId: { in: taskIds } }, include: { user: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' },
        });
        for (const task of tasks) {
          const facts = [
            task.status ? `סטטוס: ${task.status}` : null,
            task.actualStart ? `החל בפועל: ${task.actualStart.toLocaleString('he-IL')}` : null,
            task.actualFinish ? `הסתיים בפועל: ${task.actualFinish.toLocaleString('he-IL')}` : null,
            task.blockedReason ? `נחסם: ${task.blockedReason}` : null,
            task.delayReason ? `סיבת עיכוב: ${task.delayReason}` : null,
            task.followupNotes ? `הערות מעקב: ${task.followupNotes}` : null,
          ].filter(Boolean);
          rows.push({
            type: 'TASK_EXECUTION',
            content: `משימה "${task.title}"${facts.length ? ' — ' + facts.join(' · ') : ''}`,
            meta: { taskId: task.id, ...task },
          });
        }
        if (auditLogs.length) {
          rows.push({
            type: 'AUDIT_LOG',
            content: `${auditLogs.length} רשומות טרייל שינויים על משימות ה-CR: ${auditLogs.map(a => `${a.action} (${a.user?.fullName ?? '—'})`).join(', ')}`,
            meta: auditLogs,
          });
        }
      }

      if (coverage.length) {
        const c = coverage[0];
        rows.push({
          type: 'TEST_COVERAGE',
          content: `כיסוי בדיקות אמיתי מ-QC ל-CR ${crNumber}: ${c.passed} עברו / ${c.failed} נכשלו / ${c.blocked} חסומות מתוך ${c.total} (${c.coveragePct}% בוצע)`,
          meta: c,
        });
      }
    }

    const createdRows = await Promise.all(
      rows.map(r => prisma.incidentEvidence.create({ data: { incidentId, ...r } })),
    );
    if (incident.status === 'NEW') {
      await prisma.incident.update({ where: { id: incidentId }, data: { status: 'ANALYZING' } });
    }
    return createdRows;
  }

  // Manual triage fields (affected users / customer-facing / downtime) —
  // don't exist anywhere in QC's real schema (verified against a live
  // AllBugs export 2026-08-08), so they're filled by hand as part of the
  // evidence dossier rather than invented.
  async updateTriageFields(incidentId: string, patch: { affectedUsersCount?: number | null; customerFacing?: boolean | null; downtimeMinutes?: number | null }) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    return prisma.incident.update({
      where: { id: incidentId },
      data: {
        ...(patch.affectedUsersCount !== undefined ? { affectedUsersCount: patch.affectedUsersCount } : {}),
        ...(patch.customerFacing !== undefined ? { customerFacing: patch.customerFacing } : {}),
        ...(patch.downtimeMinutes !== undefined ? { downtimeMinutes: patch.downtimeMinutes } : {}),
      },
    });
  }

  async addManualEvidence(incidentId: string, content: string, meta?: any) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    return prisma.incidentEvidence.create({ data: { incidentId, type: 'MANUAL', content, meta: meta ?? null } });
  }

  // ── Relevant teams ─────────────────────────────────────────────────────────

  // Real team members, keyed by teamId — same TeamMember join TeamsService
  // uses for its own findAll(). Attached to every team this module hands to
  // the frontend so the action-item "אחראי" field can be a real per-team
  // member picker (mirrors CrPlan's assignee mechanism, e.g.
  // TaskDetailPanel's teamMembers derivation) instead of free text.
  private async attachMembers<T extends { id: string }>(teams: T[]): Promise<(T & { members: { id: string; fullName: string }[] })[]> {
    if (!teams.length) return [];
    const rows = await prisma.teamMember.findMany({
      where: { teamId: { in: teams.map(t => t.id) } },
      include: { user: { select: { id: true, fullName: true } } },
    });
    const byTeam = new Map<string, { id: string; fullName: string }[]>();
    for (const r of rows) {
      if (!r.user) continue;
      const list = byTeam.get(r.teamId) ?? [];
      list.push({ id: r.user.id, fullName: r.user.fullName });
      byTeam.set(r.teamId, list);
    }
    return teams.map(t => ({ ...t, members: byTeam.get(t.id) ?? [] }));
  }

  // Which teams should even be offered for lessons/actions — scoped to the
  // real CrPlan teams for the incident's linked CR when one resolves,
  // falling back to every active Team otherwise. Explicit product decision
  // (2026-08-08): don't use a fixed SDLC-stage list — lessons/actions should
  // land on the actual organizational team that worked the CR, not a
  // generic "Dev"/"QA" bucket.
  async getRelevantTeams(incidentId: string): Promise<{ teams: { id: string; name: string; members: { id: string; fullName: string }[] }[]; scoped: boolean }> {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');

    const crNumber = extractCrNumber(incident.crReferenceNumber);
    if (crNumber) {
      const plans = await prisma.crPlan.findMany({
        where: { versionId: incident.versionId, crNumber },
        include: { team: { select: { id: true, name: true } } },
      });
      if (plans.length) {
        const seen = new Map<string, string>();
        for (const p of plans) if (p.team) seen.set(p.team.id, p.team.name);
        const teams = await this.attachMembers(Array.from(seen.entries()).map(([id, name]) => ({ id, name })));
        return { teams, scoped: true };
      }
    }
    const all = await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return { teams: await this.attachMembers(all), scoped: false };
  }

  // Fallback-mode helper: when no CR is auto-linked to the incident (or its
  // CrPlan didn't resolve), the user may still know which CR the fault
  // actually traces back to. This lists the real CRs planned for the
  // incident's version so they can pick one, then getTeamsForCr resolves its
  // real CrPlan teams — same underlying data as getRelevantTeams' scoped
  // path, just user-selected instead of auto-detected from crReferenceNumber.
  async getCrsForVersion(versionId: string) {
    const plans = await prisma.crPlan.findMany({
      where: { versionId },
      select: { crNumber: true, crLabel: true },
      distinct: ['crNumber'],
      orderBy: { crNumber: 'asc' },
    });
    return plans.map((p) => {
      // crLabel is often already prefixed with the CR number ("12865 - ...")
      // — don't double it up in the dropdown label.
      const label = p.crLabel?.trim();
      const alreadyPrefixed = label && label.startsWith(p.crNumber);
      return { crNumber: p.crNumber, label: label ? (alreadyPrefixed ? label : `${p.crNumber} — ${label}`) : p.crNumber };
    });
  }

  async getTeamsForCr(versionId: string, crNumber: string) {
    const plans = await prisma.crPlan.findMany({
      where: { versionId, crNumber },
      include: { team: { select: { id: true, name: true } } },
    });
    const seen = new Map<string, string>();
    for (const p of plans) if (p.team) seen.set(p.team.id, p.team.name);
    return { teams: await this.attachMembers(Array.from(seen.entries()).map(([id, name]) => ({ id, name }))) };
  }

  // Fixed reference data for the manual wizard's Root Cause Category /
  // Root Cause (RCA) cascading pickers — see root-cause-taxonomy.ts for
  // provenance (partly real, partly filled in — flagged per-category there).
  getRootCauseTaxonomy() {
    return { categories: ROOT_CAUSE_CATEGORIES, taxonomy: ROOT_CAUSE_TAXONOMY };
  }

  // Static decision-tree reference data for the GUIDED method's stage 3 —
  // see guided-investigation-tree.ts. The frontend walks this tree locally
  // (like Fishbone builds its causes list locally) and only calls the
  // backend once, via submitRca, with the final path.
  getGuidedTree() {
    return { nodes: GUIDED_TREE_NODES, leaves: GUIDED_TREE_LEAVES, start: GUIDED_TREE_START };
  }

  // GUIDED method stage 2 — facts-only collection. Deliberately its own
  // endpoint/call, separate from submitRca: the whole point of this method
  // (per the user's 2026-08-09 spec) is that stage 3 (root-cause
  // investigation) must be structurally unreachable until these facts are
  // saved — the frontend gates the tree UI behind factsLocked, not just a
  // client-side hint.
  async saveGuidedFacts(incidentId: string, facts: {
    actionTaken: string; expectedResult: string; actualResult: string; timing: string; reproducibility: string;
  }, createdByName: string) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    if (!facts.actionTaken?.trim() || !facts.expectedResult?.trim() || !facts.actualResult?.trim()) {
      throw new BadRequestException('יש למלא את כל שדות איסוף העובדות לפני המשך לחקירה');
    }
    if (!GUIDED_TIMING_VALUES.includes(facts.timing)) throw new BadRequestException('ערך לא תקין עבור "מתי התחילה התקלה"');
    if (!GUIDED_REPRODUCIBILITY_VALUES.includes(facts.reproducibility)) throw new BadRequestException('ערך לא תקין עבור "האם התקלה משתחזרת"');

    await prisma.rca.upsert({
      where: { incidentId },
      create: {
        incidentId, method: 'GUIDED', createdByName,
        factsActionTaken: facts.actionTaken, factsExpectedResult: facts.expectedResult, factsActualResult: facts.actualResult,
        factsTiming: facts.timing, factsReproducibility: facts.reproducibility, factsLocked: true,
      },
      update: {
        method: 'GUIDED',
        factsActionTaken: facts.actionTaken, factsExpectedResult: facts.expectedResult, factsActualResult: facts.actualResult,
        factsTiming: facts.timing, factsReproducibility: facts.reproducibility, factsLocked: true,
      },
    });
    if (incident.status === 'NEW') await prisma.incident.update({ where: { id: incidentId }, data: { status: 'ANALYZING' } });
    return prisma.rca.findUnique({ where: { incidentId }, include: { answers: true, lessons: true } });
  }

  // ── RCA ────────────────────────────────────────────────────────────────────

  async submitRca(incidentId: string, dto: {
    method: 'FIVE_WHY' | 'FISHBONE' | 'AI' | 'GUIDED';
    category?: string; rootCauseReason?: string; rootCause?: string; description?: string;
    lessons?: { teamId?: string; teamName: string; text: string }[];
    createdByName: string;
    answers?: { step: number; question: string; answer: string; isRootCause?: boolean; evidenceIds?: string[] }[];
    treePath?: GuidedTreePathEntry[]; treeLeafId?: string;
  }) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    if (dto.method === 'FIVE_WHY' && (dto.answers?.length ?? 0) < 3) {
      throw new BadRequestException('שיטת 5-Why דורשת לפחות 3 סבבי שאלה-תשובה');
    }
    if (dto.method === 'FISHBONE') {
      if (!dto.answers?.length) throw new BadRequestException('יש להוסיף לפחות גורם אפשרי אחד לפני שמירה');
      if (!dto.answers.some(a => a.isRootCause)) throw new BadRequestException('יש לסמן איזה גורם הוא גורם השורש לפני שמירה');
    }

    // GUIDED: the system infers category/rootCause/directCause from the tree
    // leaf reached — it never asks "what's the root cause?" directly (that's
    // the whole point of the method), so these override whatever the client
    // sent for those fields rather than trusting free-text input for them.
    let guidedLeaf: (typeof GUIDED_TREE_LEAVES)[string] | undefined;
    if (dto.method === 'GUIDED') {
      const existing = await prisma.rca.findUnique({ where: { incidentId } });
      if (!existing?.factsLocked) throw new BadRequestException('יש להשלים את שלב איסוף העובדות לפני שמירת התחקיר');
      if (!dto.treePath?.length || !dto.treeLeafId) throw new BadRequestException('יש להשלים את חקירת שרשרת האירועים לפני שמירה');
      guidedLeaf = GUIDED_TREE_LEAVES[dto.treeLeafId];
      if (!guidedLeaf) throw new BadRequestException('נתיב חקירה לא תקין');
      dto = {
        ...dto,
        category: guidedLeaf.category, rootCauseReason: guidedLeaf.rootCauseReason, rootCause: guidedLeaf.rootCause,
        answers: buildAutoFiveWhy(dto.treePath, guidedLeaf),
      };
    }

    const rca = await prisma.rca.upsert({
      where: { incidentId },
      create: {
        incidentId, method: dto.method, category: dto.category ?? null, rootCauseReason: dto.rootCauseReason ?? null,
        rootCause: dto.rootCause ?? null, description: dto.description ?? null, createdByName: dto.createdByName,
        directCause: guidedLeaf?.directCause ?? null, treePath: (dto.treePath as any) ?? undefined, treeLeafId: dto.treeLeafId ?? null,
      },
      update: {
        method: dto.method, category: dto.category ?? null, rootCauseReason: dto.rootCauseReason ?? null,
        rootCause: dto.rootCause ?? null, description: dto.description ?? null,
        ...(guidedLeaf ? { directCause: guidedLeaf.directCause, treePath: dto.treePath as any, treeLeafId: dto.treeLeafId } : {}),
      },
    });

    if (dto.answers?.length) {
      // Replace the answer set on re-submit rather than accumulating duplicates.
      await prisma.rcaAnswer.deleteMany({ where: { rcaId: rca.id } });
      await prisma.rcaAnswer.createMany({
        data: dto.answers.map(a => ({ rcaId: rca.id, step: a.step, question: a.question, answer: a.answer, isRootCause: a.isRootCause ?? false, evidenceIds: a.evidenceIds ?? [] })),
      });
    }

    const filledLessons = (dto.lessons ?? []).filter(l => l.text?.trim());
    await prisma.rcaLesson.deleteMany({ where: { rcaId: rca.id } });
    if (filledLessons.length) {
      await prisma.rcaLesson.createMany({
        data: filledLessons.map(l => ({ rcaId: rca.id, teamId: l.teamId ?? null, teamName: l.teamName, text: l.text })),
      });
    }

    // Stage 6 — auto-create the corrective + preventive action items from the
    // leaf's templates (once per incident; re-submitting the same GUIDED RCA
    // — e.g. after editing facts — doesn't duplicate them). Team defaults to
    // the first relevant team (see getRelevantTeams) since ActionItem.team is
    // required; the user can reassign it afterward like any other action.
    if (guidedLeaf) {
      const existingKinds = await prisma.actionItem.findMany({ where: { incidentId, kind: { not: null } }, select: { kind: true } });
      const hasKind = (k: 'CORRECTIVE' | 'PREVENTIVE') => existingKinds.some(a => a.kind === k);
      if (!hasKind('CORRECTIVE') || !hasKind('PREVENTIVE')) {
        const { teams } = await this.getRelevantTeams(incidentId);
        const defaultTeam = teams[0]?.name;
        if (defaultTeam) {
          if (!hasKind('CORRECTIVE')) {
            await prisma.actionItem.create({ data: { incidentId, title: guidedLeaf.correctiveAction, team: defaultTeam, kind: 'CORRECTIVE', priority: 'HIGH', notes: 'נוצר אוטומטית מחקירה מונחית' } });
          }
          if (!hasKind('PREVENTIVE')) {
            await prisma.actionItem.create({ data: { incidentId, title: guidedLeaf.preventiveAction, team: defaultTeam, kind: 'PREVENTIVE', priority: 'MEDIUM', notes: 'נוצר אוטומטית מחקירה מונחית' } });
          }
        }
      }
    }

    await prisma.incident.update({ where: { id: incidentId }, data: { status: 'RCA_DONE' } });
    return prisma.rca.findUnique({ where: { incidentId }, include: { answers: true, lessons: true } });
  }

  // Same SystemParam-lookup + env-var-fallback pattern as versions.service.ts's
  // generateUnifiedCrSummary — shared by aiAnalyze and suggestNextWhyQuestion
  // below so the key lookup/error message stays in one place.
  private async getAnthropicClient() {
    const apiKeyParam = await prisma.systemParam.findUnique({ where: { key: 'ANTHROPIC_API_KEY' } });
    const apiKey = apiKeyParam?.value?.trim() || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new BadRequestException('מפתח ANTHROPIC_API_KEY לא מוגדר בפרמטרי המערכת');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey });
  }

  // Suggests the next 5-Why question given the chain of answers so far — the
  // question field stays a free-text input in the UI either way (5-Why has
  // no fixed question set by design), this just gives the user something
  // better than a generic "למה?" to start from, grounded in their own
  // previous answer instead of a canned list.
  async suggestNextWhyQuestion(incidentId: string, answersSoFar: { step: number; question: string; answer: string }[]) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    if (!answersSoFar.length) throw new BadRequestException('נדרשת לפחות תשובה אחת כדי להציע את השאלה הבאה');

    const client = await this.getAnthropicClient();
    const chain = answersSoFar.map(a => `שאלה ${a.step}: ${a.question}\nתשובה: ${a.answer}`).join('\n\n');
    const prompt = `אתה מנחה ניתוח שורש-בעיה בשיטת 5-Why לתקלה: "${incident.title}".

שרשרת השאלות-תשובות עד כה:
${chain}

בהתבסס על התשובה האחרונה, נסח את שאלת ה"למה" הבאה בשרשרת — שאלה אחת בלבד, ממוקדת וקצרה, שתעמיק לכיוון הגורם השורשי (לא חוזרת על שאלה קודמת). החזר רק את השאלה עצמה, ללא מספור, ללא הסבר, ללא מרכאות.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: prompt }],
    });
    const question = ((message.content[0] as any).text ?? '').trim().replace(/^["']|["']$/g, '');
    if (!question) throw new BadRequestException('ה-AI לא החזיר שאלה — נסה שוב');
    return { question };
  }

  // Synchronous Claude call — same pattern as versions.service.ts's
  // generateUnifiedCrSummary (SystemParam-stored key with env-var fallback,
  // model read directly from the request handler, no background job/queue).
  async aiAnalyze(incidentId: string, createdByName: string) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { evidence: true } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');

    let evidence = incident.evidence;
    if (!evidence.length) evidence = await this.collectEvidence(incidentId) as any;

    const { teams, scoped } = await this.getRelevantTeams(incidentId);
    const client = await this.getAnthropicClient();

    const prompt = buildAnalyzePrompt(incident, evidence, teams, scoped);
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }],
    });
    const raw = (message.content[0] as any).text ?? '{}';

    let parsed: any;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      throw new BadRequestException('תשובת ה-AI לא הייתה JSON תקין — נסה שוב');
    }

    return this.applyRcaConclusion(incidentId, parsed, createdByName);
  }

  // Shared by aiAnalyze and the chat flow below (replyChat) — both produce
  // the same parsed-JSON shape from Claude, this is what turns it into real
  // Rca/ActionItem rows and flips the incident to RCA_DONE.
  private async applyRcaConclusion(incidentId: string, parsed: any, createdByName: string) {
    // AI is instructed to pick category/rootCauseReason from the real
    // taxonomy, but isn't trusted blindly — same spirit as team names not
    // being enforced server-side elsewhere in this file. Anything that
    // doesn't match the fixed list is dropped rather than stored as a
    // free-text value pretending to be a picklist entry.
    const category = ROOT_CAUSE_CATEGORIES.includes(parsed.category) ? parsed.category : null;
    const rootCauseReason = category && ROOT_CAUSE_TAXONOMY[category]?.includes(parsed.rootCauseReason) ? parsed.rootCauseReason : null;

    const rca = await prisma.rca.upsert({
      where: { incidentId },
      create: {
        incidentId, method: 'AI', rootCause: parsed.rootCause ?? null, description: parsed.description ?? null,
        category, rootCauseReason,
        aiConfidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        aiRawResponse: parsed, createdByName,
      },
      update: {
        method: 'AI', rootCause: parsed.rootCause ?? null, description: parsed.description ?? null,
        category, rootCauseReason,
        aiConfidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        aiRawResponse: parsed,
      },
    });

    await prisma.rcaLesson.deleteMany({ where: { rcaId: rca.id } });
    const validLessons: any[] = Array.isArray(parsed.lessons) ? parsed.lessons.filter((l: any) => l?.team && l?.text) : [];
    if (validLessons.length) {
      await prisma.rcaLesson.createMany({ data: validLessons.map((l: any) => ({ rcaId: rca.id, teamName: l.team, text: l.text })) });
    }

    if (parsed.severity && ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(parsed.severity)) {
      await prisma.incident.update({ where: { id: incidentId }, data: { severity: parsed.severity, status: 'RCA_DONE' } });
    } else {
      await prisma.incident.update({ where: { id: incidentId }, data: { status: 'RCA_DONE' } });
    }

    const validActions: any[] = Array.isArray(parsed.actions) ? parsed.actions.filter((a: any) => a?.title && a?.team) : [];
    const createdActions = await Promise.all(validActions.map(a => prisma.actionItem.create({
      data: {
        incidentId, title: a.title, team: a.team,
        priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(a.priority) ? a.priority : 'MEDIUM',
        dueAt: typeof a.dueDays === 'number' ? new Date(Date.now() + a.dueDays * 86400000) : null,
        notes: 'הוצע ע"י AI',
      },
    })));

    return { rca: await prisma.rca.findUnique({ where: { incidentId }, include: { lessons: true } }), suggestedActions: createdActions };
  }

  // ── Chat-driven RCA (the whole wizard run by AI, conversationally) ─────────
  // Replaces manually picking a method and filling separate tabs: evidence is
  // collected automatically, then Claude conducts the questioning turn by
  // turn, and concludes on its own (root cause/lessons/actions) when it has
  // enough — the same conclusion pipeline as aiAnalyze (applyRcaConclusion),
  // just reached through conversation instead of one blind analyze call.
  // Concluding messages are detected via a plain-text sentinel prefix
  // (RCA_CONCLUSION:<json>) rather than always-JSON, so ordinary turns stay
  // natural chat text instead of forcing structured output on every reply.

  private buildChatSystemContext(incident: any, evidence: any[], teams: { id: string; name: string }[], teamsScoped: boolean): string {
    const evidenceText = evidence.map(e => `- [${e.type}] ${e.content}`).join('\n') || '(אין ראיות)';
    return `אתה מהנדס DevOps/Release בכיר שמנהל שיחה עם מנהל לילה כדי לבצע ניתוח שורש-בעיה (RCA) לתקלה שהתגלתה בליל גרסה. אתה מוביל את כל התהליך — שואל שאלות ממוקדות אחת בכל פעם (בסגנון "5 למה", אך לא נוקשה), ומגיע למסקנה כשיש לך מספיק מידע.

${buildIncidentContextBlock(incident)}

${buildTeamsBlock(teams, teamsScoped)}

${buildTaxonomyBlock()}

ראיות שנאספו אוטומטית:
${evidenceText}

כללי השיחה:
1. בכל תור, אם עדיין אין לך מספיק מידע לגורם שורש ברור — כתוב תגובה קצרה וטבעית (לא רשמית מדי) שמסתיימת בשאלת "למה" אחת וממוקדת. אל תשאל כמה שאלות בבת אחת.
2. ברגע שאתה בטוח בגורם השורש (בדרך כלל אחרי 3-6 סבבים, לפי שיקול דעתך) — אל תשאל עוד שאלות. במקום זאת החזר **אך ורק** את הטקסט הבא, ללא שום דבר נוסף לפניו או אחריו:
RCA_CONCLUSION:{"rootCause":"...","description":"תיאור מפורט של הסיבה לשורש התקלה, כולל ההקשר והתנאים שהובילו לה","category":"<קטגוריה בדיוק מהרשימה למעלה>","rootCauseReason":"<גורם ספציפי בדיוק מהרשימה, תחת הקטגוריה שנבחרה>","severity":"LOW|MEDIUM|HIGH|CRITICAL","lessons":[{"team":"<שם צוות מהרשימה למעלה>","text":"..."}],"actions":[{"team":"<שם צוות מהרשימה למעלה>","title":"...","priority":"LOW|MEDIUM|HIGH|CRITICAL","dueDays":3}],"confidence":0.0,"summaryForUser":"סיכום קצר וידידותי למנהל הלילה, 2-3 משפטים"}
3. lessons/actions: השתמש בשם צוות מהרשימה שסופקה למעלה בדיוק (לא לבדות שם חדש), וכלול רק צוותים שבאמת רלוונטיים. actions צריך לכלול לפחות פעולה אחת. category/rootCauseReason חייבים להיות מדויקים מרשימת הטקסונומיה שסופקה למעלה. confidence: 0 עד 1. summaryForUser הוא מה שיוצג בצ'אט למשתמש — לא ה-JSON עצמו.
4. כתוב תמיד בעברית.`;
  }

  async startChat(incidentId: string) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');

    const existing = await prisma.incidentChatMessage.findMany({ where: { incidentId }, orderBy: { createdAt: 'asc' } });
    if (existing.length) return existing;

    let evidence = await prisma.incidentEvidence.findMany({ where: { incidentId } });
    if (!evidence.length) evidence = await this.collectEvidence(incidentId) as any;

    const { teams, scoped } = await this.getRelevantTeams(incidentId);
    const client = await this.getAnthropicClient();
    const system = this.buildChatSystemContext(incident, evidence, teams, scoped);
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      system,
      messages: [{ role: 'user', content: 'התחל את השיחה: סכם בקצרה מה אתה יודע מהראיות שנאספו, ואז שאל את שאלת ה"למה" הראשונה.' }],
    });
    const content = ((message.content[0] as any).text ?? '').trim();

    return [await prisma.incidentChatMessage.create({ data: { incidentId, role: 'AI', content } })];
  }

  async replyChat(incidentId: string, userMessage: string, createdByName: string) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    if (!userMessage?.trim()) throw new BadRequestException('הודעה ריקה');

    const evidence = await prisma.incidentEvidence.findMany({ where: { incidentId } });
    const history = await prisma.incidentChatMessage.findMany({ where: { incidentId }, orderBy: { createdAt: 'asc' } });
    if (history.some(m => m.concluded)) throw new BadRequestException('ה-RCA כבר הושלם לתקלה זו');

    const userMsg = await prisma.incidentChatMessage.create({ data: { incidentId, role: 'USER', content: userMessage.trim() } });

    const { teams, scoped } = await this.getRelevantTeams(incidentId);
    const client = await this.getAnthropicClient();
    const system = this.buildChatSystemContext(incident, evidence, teams, scoped);
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system,
      messages: [...history, userMsg].map(m => ({ role: m.role === 'AI' ? 'assistant' as const : 'user' as const, content: m.content })),
    });
    const raw = ((message.content[0] as any).text ?? '').trim();

    if (raw.startsWith('RCA_CONCLUSION:')) {
      let parsed: any;
      try {
        parsed = JSON.parse(raw.slice('RCA_CONCLUSION:'.length).trim());
      } catch {
        throw new BadRequestException('ה-AI סיים אך התשובה לא הייתה JSON תקין — נסה לענות שוב');
      }
      const { rca, suggestedActions } = await this.applyRcaConclusion(incidentId, parsed, createdByName);
      const aiMsg = await prisma.incidentChatMessage.create({
        data: { incidentId, role: 'AI', content: parsed.summaryForUser || parsed.rootCause || 'הניתוח הושלם.', concluded: true },
      });
      return { messages: [userMsg, aiMsg], concluded: true, rca, actions: suggestedActions };
    }

    const aiMsg = await prisma.incidentChatMessage.create({ data: { incidentId, role: 'AI', content: raw } });
    return { messages: [userMsg, aiMsg], concluded: false };
  }

  // ── Action items ───────────────────────────────────────────────────────────

  async addAction(incidentId: string, dto: {
    title: string; team: string; // real team name (see getRelevantTeams) — no longer a fixed enum
    owner?: string; dueAt?: string; notes?: string; priority?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  }) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    return prisma.actionItem.create({
      data: {
        incidentId, title: dto.title, team: dto.team, ownerName: dto.owner ?? null,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null, notes: dto.notes ?? null,
        priority: dto.priority ?? 'MEDIUM',
      },
    });
  }

  async updateAction(actionId: string, patch: { status?: 'OPEN' | 'IN_PROGRESS' | 'DONE' | 'OVERDUE'; ownerName?: string; dueAt?: string | null; notes?: string }) {
    const action = await prisma.actionItem.findUnique({ where: { id: actionId } });
    if (!action) throw new NotFoundException('פעולה לא נמצאה');
    return prisma.actionItem.update({
      where: { id: actionId },
      data: {
        ...(patch.status ? { status: patch.status } : {}),
        ...(patch.ownerName !== undefined ? { ownerName: patch.ownerName } : {}),
        ...(patch.dueAt !== undefined ? { dueAt: patch.dueAt ? new Date(patch.dueAt) : null } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
      },
    });
  }

  // Root Cause Status — tracked independently of Incident.status/ActionStatus
  // (see RcaStatus in schema.prisma): whether the root cause's own
  // remediation was actually followed through, updatable any time after the
  // RCA exists, not tied to the incident's own close/reopen lifecycle.
  async updateRcaStatus(incidentId: string, status: 'OPEN' | 'INVESTIGATION' | 'COMPLETED' | 'CANCELLED') {
    const rca = await prisma.rca.findUnique({ where: { incidentId } });
    if (!rca) throw new NotFoundException('טרם בוצע RCA לתקלה זו');
    return prisma.rca.update({ where: { incidentId }, data: { status } });
  }

  // Marks OPEN/IN_PROGRESS actions past their dueAt as OVERDUE — runs every
  // hour, same @Cron pattern already used elsewhere in this codebase (e.g.
  // version-cr-assignments.service.ts's nightly sync).
  @Cron(CronExpression.EVERY_HOUR)
  async markOverdueActions() {
    const now = new Date();
    const result = await prisma.actionItem.updateMany({
      where: { status: { in: ['OPEN', 'IN_PROGRESS'] }, dueAt: { lt: now } },
      data: { status: 'OVERDUE' },
    });
    return result.count;
  }

  // ── Grouping ───────────────────────────────────────────────────────────────

  // Heuristic clustering — NOT ML: groups incidents in the same version whose
  // *identified root cause* shares a significant word (>=4 chars). Product
  // decision (2026-08-08): grouping only makes sense once the investigation
  // is done — before that, titles are just QC's raw defect description and
  // clustering on them conflates unrelated defects that merely read alike.
  // So this only looks at un-grouped incidents that already have an RCA
  // (status RCA_DONE/CLOSED), and clusters on rca.rootCause text instead of
  // title. Always user-editable/reversible via assignToGroup below.
  async suggestGroups(versionId: string) {
    const incidents = await prisma.incident.findMany({
      where: { versionId, groupId: null, status: { in: ['RCA_DONE', 'CLOSED'] }, rca: { isNot: null } },
      include: { rca: { select: { rootCause: true } } },
    });
    const stopWords = new Set(['שגיאה', 'תקלה', 'בעיה', 'לא', 'עם', 'של', 'את', 'error', 'issue']);
    const wordsOf = (s: string) => (s || '').split(/[\s,.\-–:]+/).map(w => w.trim()).filter(w => w.length >= 4 && !stopWords.has(w.toLowerCase()));

    const groups: { reason: string; incidentIds: string[] }[] = [];
    const used = new Set<string>();
    for (let i = 0; i < incidents.length; i++) {
      if (used.has(incidents[i].id)) continue;
      const wordsA = new Set(wordsOf(incidents[i].rca?.rootCause ?? ''));
      if (!wordsA.size) continue;
      const cluster = [incidents[i].id];
      let sharedWord = '';
      for (let j = i + 1; j < incidents.length; j++) {
        if (used.has(incidents[j].id)) continue;
        const wordsB = wordsOf(incidents[j].rca?.rootCause ?? '');
        const match = wordsB.find(w => wordsA.has(w));
        if (match) { cluster.push(incidents[j].id); sharedWord = match; }
      }
      if (cluster.length > 1) {
        cluster.forEach(id => used.add(id));
        groups.push({ reason: `גורם שורש משותף: "${sharedWord}"`, incidentIds: cluster });
      }
    }
    return groups;
  }

  async createGroupFromSuggestion(versionId: string, reason: string, incidentIds: string[]) {
    const group = await prisma.incidentGroup.create({ data: { versionId, reason } });
    await prisma.incident.updateMany({ where: { id: { in: incidentIds } }, data: { groupId: group.id } });
    return group;
  }

  async assignToGroup(incidentId: string, groupId: string | null) {
    return prisma.incident.update({ where: { id: incidentId }, data: { groupId } });
  }

  // ── Close ──────────────────────────────────────────────────────────────────

  async closeIncident(incidentId: string, approvedByName: string, noActionRationale?: string) {
    const incident = await prisma.incident.findUnique({ where: { id: incidentId }, include: { rca: true, actions: true } });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    if (incident.status !== 'RCA_DONE' || !incident.rca) {
      throw new BadRequestException('יש להשלים RCA לפני סגירת התקלה');
    }
    if (incident.actions.length === 0 && !noActionRationale?.trim()) {
      throw new BadRequestException('נדרשת לפחות פעולת מעקב אחת, או נימוק מפורש מדוע אין צורך בפעולה');
    }
    await prisma.rca.update({
      where: { incidentId },
      data: {
        approvedBy: approvedByName, approvedAt: new Date(),
        ...(noActionRationale?.trim() ? { rootCause: `${incident.rca.rootCause ?? ''}\n\n[אין פעולת מעקב — נימוק]: ${noActionRationale.trim()}` } : {}),
      },
    });
    return prisma.incident.update({ where: { id: incidentId }, data: { status: 'CLOSED' } });
  }

  // ── Metrics ────────────────────────────────────────────────────────────────

  async getMetrics(versionId?: string) {
    const where = versionId ? { versionId } : {};
    const incidents = await prisma.incident.findMany({
      where, include: { rca: true, actions: true, group: true },
    });

    const total = incidents.length;
    const closed = incidents.filter(i => i.status === 'CLOSED');
    const grouped = incidents.filter(i => i.groupId);
    const recurrenceRate = total > 0 ? Math.round((grouped.length / total) * 100) : 0;

    const rcaTimes = incidents
      .filter(i => i.rca)
      .map(i => (new Date(i.rca!.createdAt).getTime() - new Date(i.createdAt).getTime()) / 3600000); // hours
    const timeToRcaHoursAvg = rcaTimes.length ? Math.round((rcaTimes.reduce((a, b) => a + b, 0) / rcaTimes.length) * 10) / 10 : null;

    const allActions = incidents.flatMap(i => i.actions);
    const finishedActions = allActions.filter(a => a.status === 'DONE');
    const onTimeActions = finishedActions.filter(a => !a.dueAt || new Date(a.updatedAt) <= new Date(a.dueAt));
    const actionsOnTimePct = finishedActions.length > 0 ? Math.round((onTimeActions.length / finishedActions.length) * 100) : null;

    return {
      total, closed: closed.length, open: total - closed.length,
      recurrenceRate, timeToRcaHoursAvg, actionsOnTimePct,
      openActionsCount: allActions.filter(a => a.status !== 'DONE').length,
      overdueActionsCount: allActions.filter(a => a.status === 'OVERDUE').length,
    };
  }

  // "פילוח לפי קטגוריית גורם שורש" — Root Cause Category rollup with
  // linked incidents per category, the BI-over-time view from the
  // Deployment_Lessons_Learned.pptx reference deck (its slide 2 groups every
  // incident's root cause into buckets manually; this does the same thing
  // automatically from real `Rca.category` data). Cross-version by default
  // (versionId omitted) since the whole point is a trend across releases,
  // not just one — a single version rarely has enough RCA'd incidents to be
  // meaningful on its own. Only incidents with a known category are counted
  // (i.e. RCA actually submitted with a classification) — unclassified
  // incidents are silently excluded, not shown as "unknown" bucket, since
  // Fishbone/AI RCAs may not always populate category yet.
  async getCategoryBreakdown(versionId?: string) {
    const incidents = await prisma.incident.findMany({
      where: { rca: { category: { not: null } }, ...(versionId ? { versionId } : {}) },
      include: { rca: { select: { category: true, rootCauseReason: true, status: true } }, version: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const total = incidents.length;
    const byCategory = new Map<string, typeof incidents>();
    for (const inc of incidents) {
      const cat = inc.rca!.category!;
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(inc);
    }

    const categories = Array.from(byCategory.entries())
      .map(([category, incs]) => ({
        category,
        count: incs.length,
        pct: total ? Math.round((incs.length / total) * 1000) / 10 : 0,
        incidents: incs.map(inc => ({
          id: inc.id, qcDefectId: inc.qcDefectId, title: inc.title, severity: inc.severity,
          versionName: inc.version.name, rootCauseReason: inc.rca!.rootCauseReason, rcaStatus: inc.rca!.status,
        })),
      }))
      .sort((a, b) => b.count - a.count);

    return { total, categories };
  }

  async getIncident(incidentId: string) {
    const incident = await prisma.incident.findUnique({
      where: { id: incidentId },
      include: {
        evidence: true, rca: { include: { answers: true, lessons: true } }, actions: true, group: true,
        chatMessages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!incident) throw new NotFoundException('תקלה לא נמצאה');
    return incident;
  }
}
