import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { ReleaseIntelligenceService, defectCr } from './release-intelligence.service';
import { QcService } from '../qc/qc.service';
import { TEAM_COLUMNS } from '../common/team-columns';

const prisma = new PrismaClient();

// ── תובנות גרסה — the version SUMMARY page (user, 2026-10-06) ───────────────
// Shown at the version's summary meeting, behind its own permission
// (ri:insights, explicit grant only). Turns the testing module's numbers
// (readiness, defects, testing SLA, risks, coverage, forecast, effort, quality
// KPI targets, scope removals) into short managerial findings, each with a
// drill-down to the data behind it. Auto findings are computed on every load
// (never stale) and can't be edited — only hidden for this version with a
// reason, and a hidden one comes back by itself if its level gets worse.
// Manual findings are fully editable. Thresholds are fixed here for now.

export type InsightLevel = 'CRITICAL' | 'WARNING' | 'INFO' | 'POSITIVE';
const LEVEL_RANK: Record<InsightLevel, number> = { CRITICAL: 0, WARNING: 1, INFO: 2, POSITIVE: 3 };

export type InsightDrill =
  | { kind: 'defects'; ids: string[]; title: string }
  | { kind: 'crDefects'; crNumber: string; title: string }
  | { kind: 'crs'; crs: { crNumber: string; label: string; days: number | null }[]; title: string }
  | { kind: 'screen'; module: 'release-intelligence' | 'quality-hub' | 'version-management'; view: string };

export interface Insight {
  key: string;
  source: 'AUTO' | 'MANUAL';
  id?: string;                 // MANUAL row id
  level: InsightLevel;
  category: string;
  title: string;
  text: string;
  drill?: InsightDrill;
  hidden?: { reason: string; by: string | null; at: Date };
  createdBy?: string | null;
}

const LEVELS: InsightLevel[] = ['CRITICAL', 'WARNING', 'INFO', 'POSITIVE'];
const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0);
const OPEN = (status: string) => !['Closed', 'Canceled'].includes(status ?? '');

@Injectable()
export class ReleaseInsightsService {
  private readonly logger = new Logger(ReleaseInsightsService.name);
  private qc = new QcService();

  constructor(private readonly ri: ReleaseIntelligenceService) {}

  async getInsights(versionId: string) {
    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { id: true, name: true } });
    if (!version) throw new NotFoundException('גרסה לא נמצאה');

    const [auto, manualRows, hides] = await Promise.all([
      this.autoInsights(versionId, version.name),
      prisma.releaseInsight.findMany({ where: { versionId, source: 'MANUAL' }, orderBy: { createdAt: 'desc' } }),
      prisma.releaseInsightHide.findMany({ where: { versionId } }),
    ]);
    const manual: Insight[] = manualRows.map(r => ({
      key: `MANUAL:${r.id}`, source: 'MANUAL', id: r.id,
      level: (LEVELS.includes(r.level as InsightLevel) ? r.level : 'INFO') as InsightLevel,
      category: r.category, title: r.title ?? '', text: r.message, createdBy: r.createdBy,
      drill: manualDrill(r.linkType, r.linkValue),
    }));

    const hideByKey = new Map(hides.map(h => [h.insightKey, h]));
    const all = [...auto, ...manual].map(i => {
      const h = hideByKey.get(i.key);
      // a hidden auto finding resurfaces when its level got worse since it was hidden
      if (h && !(i.source === 'AUTO' && LEVEL_RANK[i.level] < LEVEL_RANK[h.levelAtHide as InsightLevel])) {
        return { ...i, hidden: { reason: h.reason, by: h.hiddenBy, at: h.hiddenAt } };
      }
      return i;
    });
    all.sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
    const visible = all.filter(i => !i.hidden);
    const count = (l: InsightLevel) => visible.filter(i => i.level === l).length;
    return {
      versionName: version.name,
      generatedAt: new Date(),
      summary: { total: visible.length, critical: count('CRITICAL'), warning: count('WARNING'), info: count('INFO'), positive: count('POSITIVE'), hidden: all.length - visible.length },
      insights: all,
    };
  }

  // ── automatic findings ──────────────────────────────────────────────────
  private async autoInsights(versionId: string, versionName: string): Promise<Insight[]> {
    const safe = <T>(p: Promise<T>, label: string): Promise<T | null> =>
      p.catch(err => { this.logger.warn(`insights: ${label} failed: ${err.message}`); return null; });
    const [ov, bd, defects, risks, vcas, kpis, kpiDefs] = await Promise.all([
      safe(this.ri.getOverview(versionId), 'overview'),
      safe(this.qc.getBugDashboard(versionId), 'bug dashboard'),
      safe(this.ri.getTestingDefects(versionId), 'defects'),
      prisma.releaseRisk.findMany({ where: { versionId }, select: { status: true, severity: true } }),
      prisma.versionCrAssignment.findMany({
        where: { versionId },
        select: { crNumber: true, crLabel: true, estimateDays: true, teamEstimateDays: true, syncStatus: true, manuallyRemoved: true, removedReason: true, removedDefectCount: true, team: { select: { name: true } } },
      }),
      prisma.releaseKpiScore.findMany({ where: { releaseName: versionName } }),
      prisma.kpiDefinition.findMany({ select: { kpiName: true, trend: true } }),
    ]);
    const out: Insight[] = [];
    const add = (i: Omit<Insight, 'source'>) => out.push({ ...i, source: 'AUTO' });

    // 1. readiness — what blocks GO
    if (ov) {
      const rec = ov.healthRecommendation;
      const reasons = (ov.readinessReasons ?? []).map((r: string) => r.replace(/^⛔\s*/, '')).join(' · ');
      if (rec === 'NO_GO') add({ key: 'READINESS', level: 'CRITICAL', category: 'מוכנות', title: `NO-GO — מדד מוכנות ${ov.healthScore}`, text: reasons || 'מדד המוכנות מתחת לסף העלייה', drill: { kind: 'screen', module: 'release-intelligence', view: 'home' } });
      else if (rec === 'CONDITIONAL_GO') add({ key: 'READINESS', level: 'WARNING', category: 'מוכנות', title: `GO בתנאים — מדד מוכנות ${ov.healthScore}`, text: reasons || 'הגרסה קרובה לסף — נדרש מעקב', drill: { kind: 'screen', module: 'release-intelligence', view: 'home' } });
      else if (ov.testingStarted) add({ key: 'READINESS', level: 'POSITIVE', category: 'מוכנות', title: `GO — מדד מוכנות ${ov.healthScore}`, text: 'הגרסה עומדת בתנאי המוכנות', drill: { kind: 'screen', module: 'release-intelligence', view: 'home' } });
    }

    // 2. open critical defects
    const open = (defects ?? []).filter(d => OPEN(d.status));
    const ss = open.filter(d => d.severity === 'Show Stopper');
    const severe = open.filter(d => d.severity === 'Severe');
    if (ss.length > 0) add({ key: 'DEF_SS', level: 'CRITICAL', category: 'תקלות', title: `${ss.length} תקלות Show Stopper פתוחות`, text: 'הגרסה אינה עומדת בתנאי השחרור כל עוד הן פתוחות', drill: { kind: 'defects', ids: ss.map(d => d.id), title: 'Show Stopper פתוחות' } });
    if (severe.length > 0) {
      const qgFail = ov && ov.qgPass === false;
      add({ key: 'DEF_SEVERE', level: qgFail ? 'CRITICAL' : 'WARNING', category: 'תקלות', title: `${severe.length} תקלות Severe פתוחות`, text: qgFail ? 'הגרסה אינה עומדת בתנאי השחרור (Quality Gate)' : 'בתוך סף ה-Quality Gate — נדרש מעקב', drill: { kind: 'defects', ids: severe.map(d => d.id), title: 'Severe פתוחות' } });
    }
    const heavy = ss.length + severe.length;
    if (open.length >= 5 && pct(heavy, open.length) >= 50) {
      add({ key: 'DEF_SEVERITY_MIX', level: 'WARNING', category: 'תקלות', title: `${pct(heavy, open.length)}% מהתקלות הפתוחות הן Show Stopper / Severe`, text: `${heavy} מתוך ${open.length} תקלות פתוחות`, drill: { kind: 'defects', ids: [...ss, ...severe].map(d => d.id), title: 'Show Stopper / Severe פתוחות' } });
    }
    if (ov?.testingStarted && open.length === 0 && (defects ?? []).length > 0) {
      add({ key: 'DEF_ALL_CLOSED', level: 'POSITIVE', category: 'תקלות', title: 'אין תקלות פתוחות', text: `כל ${(defects ?? []).length} התקלות שדווחו נסגרו` });
    }

    // 3. testing-phase fix SLA (SS 24h / Severe 2d / Medium 3d / Low 4d)
    if (bd?.agingOpen && bd.testingSlaHours) {
      const late = bd.agingOpen.filter(a => bd.testingSlaHours![a.severity] != null && a.ageHours >= bd.testingSlaHours![a.severity]);
      if (late.length > 0) {
        const ssLate = late.filter(a => a.severity === 'Show Stopper').length;
        add({ key: 'SLA', level: ssLate > 0 ? 'CRITICAL' : 'WARNING', category: 'תקלות', title: `${late.length} תקלות בחריגה מ-SLA התיקון`, text: `SLA שלב הבדיקות: SS 24 שעות, Severe יומיים, Medium 3 ימים, Low 4 ימים${ssLate ? ` — מתוכן ${ssLate} Show Stopper` : ''}`, drill: { kind: 'defects', ids: late.map(a => a.id), title: 'חריגות SLA' } });
      }
    }

    // 4. reopen
    if (bd && bd.reported >= 10 && pct(bd.reopen, bd.reported) >= 10) {
      add({ key: 'REOPEN', level: 'WARNING', category: 'תקלות', title: `${pct(bd.reopen, bd.reported)}% מהתקלות נפתחו מחדש`, text: `${bd.reopen} מתוך ${bd.reported} — מצביע על איכות תיקונים`, drill: { kind: 'screen', module: 'release-intelligence', view: 'bug-dashboard' } });
    }

    // 5. risks
    if (risks.length > 0) {
      const openRisks = risks.filter(r => r.status !== 'CLOSED');
      const critical = openRisks.filter(r => r.severity === 'CRITICAL' && r.status !== 'MITIGATED').length;
      if (openRisks.length === 0) add({ key: 'RISKS', level: 'POSITIVE', category: 'סיכונים', title: 'כל הסיכונים נסגרו', text: `${risks.length} סיכונים הוגדרו לגרסה — כולם סגורים`, drill: { kind: 'screen', module: 'release-intelligence', view: 'risks' } });
      else add({ key: 'RISKS', level: critical > 0 ? 'CRITICAL' : 'WARNING', category: 'סיכונים', title: `${openRisks.length} מתוך ${risks.length} סיכונים עדיין פתוחים (${pct(openRisks.length, risks.length)}%)`, text: critical > 0 ? `${critical} מהם קריטיים ללא מיתון` : 'ללא סיכון קריטי לא ממותן', drill: { kind: 'screen', module: 'release-intelligence', view: 'risks' } });
    }

    // 6. test execution / coverage
    if (ov?.testingStarted) {
      const notRun = Math.round((100 - (ov.coveragePct ?? 0)) * 100) / 100;
      if (notRun > 0) add({ key: 'COVERAGE', level: notRun >= 30 ? 'WARNING' : 'INFO', category: 'כיסוי בדיקות', title: `${notRun}% מהבדיקות טרם בוצעו`, text: `בוצעו ${ov.coveragePct}% מהתרחישים בסבבי הליבה, אחוז הצלחה ${ov.passedPct}%`, drill: { kind: 'screen', module: 'release-intelligence', view: 'coverage-readiness' } });
      else add({ key: 'COVERAGE', level: 'POSITIVE', category: 'כיסוי בדיקות', title: 'כל הבדיקות בוצעו', text: `אחוז הצלחה ${ov.passedPct}%`, drill: { kind: 'screen', module: 'release-intelligence', view: 'coverage-readiness' } });
      if ((ov.overdueUnstartedCrs ?? []).length > 0) {
        const crs = ov.overdueUnstartedCrs as { crNumber: string; crLabel: string }[];
        add({ key: 'CR_NOT_STARTED', level: 'WARNING', category: 'כיסוי בדיקות', title: `${crs.length} CR-ים שהגיעו ל-QA ועדיין לא החלה בדיקתם`, text: 'מועד הבדיקה המתוכנן עבר', drill: { kind: 'crs', crs: crs.map(c => ({ crNumber: c.crNumber, label: c.crLabel, days: null })), title: 'CR-ים שבדיקתם לא החלה' } });
      }
      if ((ov.blockedCrs ?? []).length > 0) {
        const crs = ov.blockedCrs as { crNumber: string; crLabel: string; blockedCount: number }[];
        add({ key: 'CR_BLOCKED', level: 'WARNING', category: 'כיסוי בדיקות', title: `${new Set(crs.map(c => c.crNumber)).size} CR-ים עם תרחישים חסומים`, text: `${crs.reduce((s, c) => s + c.blockedCount, 0)} תרחישים חסומים`, drill: { kind: 'screen', module: 'release-intelligence', view: 'coverage-readiness' } });
      }
    }

    // 7. schedule forecast
    if (ov && ov.forecastStatus === 'BEHIND_PLAN') {
      add({ key: 'FORECAST', level: 'WARNING', category: 'לוח זמנים', title: 'התחזית מצביעה על חריגה מלוח הזמנים', text: (ov.forecastWarnings ?? []).join(' · ') || 'קצב הביצוע נמוך מהנדרש', drill: { kind: 'screen', module: 'release-intelligence', view: 'daily-qa' } });
    }

    // 8. effort concentration — by CR and by team ("מערכת" = the team's CR_LIST effort column)
    const active = vcas.filter(v => v.syncStatus !== 'REMOVED');
    const crEffort = new Map<string, { label: string; days: number }>();
    for (const v of active) {
      const d = v.estimateDays ?? 0;
      const cur = crEffort.get(v.crNumber);
      if (!cur || d > cur.days) crEffort.set(v.crNumber, { label: v.crLabel ?? v.crNumber, days: d });
    }
    const totalEffort = [...crEffort.values()].reduce((s, c) => s + c.days, 0);
    if (crEffort.size >= 5 && totalEffort > 0) {
      const top = [...crEffort.entries()].sort((a, b) => b[1].days - a[1].days).slice(0, 3);
      const share = pct(top.reduce((s, [, c]) => s + c.days, 0), totalEffort);
      if (share >= 40) add({ key: 'EFFORT_TOP_CRS', level: 'INFO', category: 'מאמץ', title: `3 ה-CR הגדולים מהווים ${share}% ממאמץ הגרסה`, text: top.map(([n, c]) => `${n} (${c.days} י׳)`).join(' · '), drill: { kind: 'crs', crs: top.map(([n, c]) => ({ crNumber: n, label: c.label, days: c.days })), title: 'ה-CR-ים הגדולים בגרסה' } });
    }
    const teamEffort = new Map<string, number>();
    for (const v of active) {
      if (!v.team?.name || v.team.name === 'QA Team') continue;
      teamEffort.set(v.team.name, (teamEffort.get(v.team.name) ?? 0) + (v.teamEstimateDays ?? 0));
    }
    const teamTotal = [...teamEffort.values()].reduce((s, d) => s + d, 0);
    if (teamTotal > 0 && teamEffort.size >= 2) {
      const [topTeam, topDays] = [...teamEffort.entries()].sort((a, b) => b[1] - a[1])[0];
      const share = pct(topDays, teamTotal);
      if (share >= 40) {
        const alias = (TEAM_COLUMNS[topTeam] ?? [])[0];
        const crsOfTeam = active.filter(v => v.team?.name === topTeam);
        add({ key: 'EFFORT_TEAM', level: 'INFO', category: 'מאמץ', title: `${share}% ממאמץ הפיתוח מרוכז ב-${alias ? `${alias} (${topTeam})` : topTeam}`, text: `${Math.round(topDays * 10) / 10} מתוך ${Math.round(teamTotal * 10) / 10} ימי פיתוח, ${crsOfTeam.length} CR-ים`, drill: { kind: 'crs', crs: crsOfTeam.map(v => ({ crNumber: v.crNumber, label: v.crLabel ?? v.crNumber, days: v.teamEstimateDays })), title: `CR-ים של ${topTeam}` } });
      }
    }

    // 9. development removed but defects were opened on it
    const removedWithDefects = new Map<string, { label: string; reason: string | null; count: number }>();
    for (const v of vcas) {
      if (v.manuallyRemoved && (v.removedDefectCount ?? 0) > 0) removedWithDefects.set(v.crNumber, { label: v.crLabel ?? v.crNumber, reason: v.removedReason, count: v.removedDefectCount ?? 0 });
    }
    for (const [cr, r] of removedWithDefects) {
      const openOfCr = open.filter(d => defectCr(d) === cr).length;
      add({ key: `CR_REMOVED_DEFECTS:${cr}`, level: openOfCr > 0 ? 'WARNING' : 'INFO', category: 'תכולה', title: `CR ${cr} הוסר מהגרסה אך נפתחו עליו ${r.count} תקלות`, text: `${r.reason ? `סיבת ההסרה: ${r.reason}. ` : ''}${openOfCr > 0 ? `${openOfCr} מהן עדיין פתוחות — ` : ''}התקלות נשארות בספרייה ובמדדים`, drill: { kind: 'crDefects', crNumber: cr, title: `תקלות CR ${cr}` } });
    }

    // 10. quality KPI targets (איכות גרסה)
    const trendOf = new Map(kpiDefs.map(k => [k.kpiName, k.trend ?? '']));
    const graded = kpis.filter(k => k.grade != null);
    if (graded.length > 0) {
      const met = graded.filter(k => (trendOf.get(k.kpiName) ?? '').includes('מינימום') ? (k.grade as number) <= k.target : (k.grade as number) >= k.target);
      const share = pct(met.length, graded.length);
      add({ key: 'KPI_TARGETS', level: share >= 75 ? 'POSITIVE' : share < 50 ? 'WARNING' : 'INFO', category: 'יעדי איכות', title: `${share}% מיעדי ה-KPI לגרסה הושגו`, text: `${met.length} מתוך ${graded.length} מדדים עומדים ביעד`, drill: { kind: 'screen', module: 'quality-hub', view: 'kpi-matrix' } });
    }

    return out;
  }

  // ── manual findings + hiding ────────────────────────────────────────────
  async createManual(versionId: string, body: ManualBody, user: { sub: string }) {
    const data = await this.validate(body);
    const actor = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true, email: true } });
    return prisma.releaseInsight.create({
      data: { versionId, source: 'MANUAL', ...data, createdBy: actor?.fullName ?? actor?.email ?? user.sub, severity: 'MEDIUM' as any },
    });
  }

  async updateManual(versionId: string, id: string, body: ManualBody) {
    const row = await prisma.releaseInsight.findFirst({ where: { id, versionId, source: 'MANUAL' } });
    if (!row) throw new NotFoundException('תובנה לא נמצאה');
    const data = await this.validate(body);
    return prisma.releaseInsight.update({ where: { id }, data });
  }

  async hide(versionId: string, body: { key: string; level: string; reason: string }, user: { sub: string }) {
    const reason = (body?.reason ?? '').trim();
    if (!body?.key) throw new BadRequestException('חסר מזהה תובנה');
    if (reason.length < 2) throw new BadRequestException('יש לפרט סיבה / הערה להסתרה');
    const actor = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true, email: true } });
    const level = LEVELS.includes(body.level as InsightLevel) ? body.level : 'INFO';
    const by = actor?.fullName ?? actor?.email ?? user.sub;
    return prisma.releaseInsightHide.upsert({
      where: { versionId_insightKey: { versionId, insightKey: body.key } },
      create: { versionId, insightKey: body.key, reason, hiddenBy: by, levelAtHide: level },
      update: { reason, hiddenBy: by, levelAtHide: level, hiddenAt: new Date() },
    });
  }

  async unhide(versionId: string, key: string) {
    await prisma.releaseInsightHide.deleteMany({ where: { versionId, insightKey: key } });
    return { ok: true };
  }

  private async validate(body: ManualBody) {
    const title = (body?.title ?? '').trim();
    const message = (body?.text ?? '').trim();
    if (!title) throw new BadRequestException('חסרה כותרת');
    if (!LEVELS.includes(body.level as InsightLevel)) throw new BadRequestException('רמת חומרה לא חוקית');
    return {
      title, message, level: body.level, category: (body.category ?? '').trim() || 'כללי',
      linkType: body.linkType || null, linkValue: (body.linkValue ?? '').trim() || null,
    };
  }
}

export interface ManualBody { title: string; text: string; category?: string; level: string; linkType?: string | null; linkValue?: string | null }

// optional link to an entity, picked when the manual finding is written
function manualDrill(type: string | null, value: string | null): InsightDrill | undefined {
  if (!type) return undefined;
  if (type === 'cr' && value) return { kind: 'crDefects', crNumber: value, title: `תקלות CR ${value}` };
  if (type === 'defect' && value) return { kind: 'defects', ids: value.split(/[\s,]+/).filter(Boolean), title: 'תקלות' };
  if (['risks', 'coverage-readiness', 'bug-dashboard', 'daily-qa', 'home'].includes(type)) return { kind: 'screen', module: 'release-intelligence', view: type };
  if (type === 'kpi') return { kind: 'screen', module: 'quality-hub', view: 'kpi-matrix' };
  return undefined;
}
