import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'path';
import { readQcFile, resolveQcFilePath, SmbAccessError } from '../qc-releases/smb-file-reader';
import { QcService, DefectDto } from '../qc/qc.service';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

interface ParsedRelease { seq: number; year: number; }

// Release names follow "ITv<seq>-<year>" (e.g. "ITv04-2026"). Older/odd
// names (e.g. "Hotnet") don't match — they sort last, not dropped.
function parseReleaseName(name: string): ParsedRelease | null {
  const m = /^ITv(\d+)-(\d{4})$/i.exec(name.trim());
  if (!m) return null;
  return { seq: Number(m[1]), year: Number(m[2]) };
}

function compareReleasesDesc(a: string, b: string): number {
  const pa = parseReleaseName(a);
  const pb = parseReleaseName(b);
  if (pa && pb) {
    if (pa.year !== pb.year) return pb.year - pa.year;
    return pb.seq - pa.seq;
  }
  if (pa && !pb) return -1;
  if (!pa && pb) return 1;
  return a.localeCompare(b);
}

function toNum(v: any): number | null {
  if (v === '' || v === undefined || v === null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string') {
    const t = v.trim();
    if (t === '-' || t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function pct(fraction: number | null | undefined): number | null {
  return fraction == null ? null : Math.round(fraction * 10000) / 100;
}

async function chunkedUpsert<T>(items: T[], size: number, fn: (item: T) => Promise<any>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export interface ReleaseSummary {
  releaseName: string;
  totalScore: number; // 0-100
  year: number | null;
}

// Same prompt-construction style as incidents.service.ts's buildAnalyzePrompt
// (Hebrew system framing, explicit "return ONLY JSON" instruction, exact
// output schema spelled out) — kept as a plain module-level function for the
// same reason: no per-request state, easy to unit-test independently later.
function buildImprovementAnalysisPrompt(kpiName: string, releaseName: string, kpiPurpose: string | null, defects: DefectDto[]): string {
  const defectsText = defects.map(d =>
    `- [${d.id}] (${d.severity}, ${d.status}, CR: ${d.crHbrNumberReference || '—'}, אחראי: ${d.responsibility || '—'}) ${d.title}${d.description ? ' — ' + d.description.slice(0, 300) : ''}`
  ).join('\n');

  return `אתה אנליסט איכות תוכנה בכיר שמנתח תקלות מתוך גרסת תוכנה, במטרה לזהות דפוסים חוזרים ולהציע שיפורים קונקרטיים לתהליך.

KPI: ${kpiName}${kpiPurpose ? ` — ${kpiPurpose}` : ''}
גרסה: ${releaseName}
מספר תקלות: ${defects.length}

רשימת התקלות:
${defectsText}

נתח את התקלות וזהה דפוסים חוזרים (למשל: ריכוז סביב CR מסוים, סוג שגיאה חוזר, שלב תהליך בעייתי). החזר אך ורק JSON תקין (ללא טקסט נוסף) במבנה הבא:
{
  "problemNotes": [ { "problemCharacteristics": "תיאור דפוס/מאפיין חוזר, כולל אזכור ה-CR-ים הרלוונטיים אם יש", "defectCount": <כמות התקלות שתומכות בדפוס הזה> } ],
  "improvementTasks": [ { "requiredImprovement": "שיפור תהליכי קונקרטי הנובע מהדפוס", "mainDevelopments": "מה נדרש לפתח/לעדכן בפועל", "responsibility": "צוות/תפקיד מוצע לאחריות" } ]
}

הנחיות: אל תמציא CR-ים או שמות תקלות שלא מופיעים ברשימה. problemNotes צריך לשקף דפוסים אמיתיים שנתמכים על ידי כמה תקלות, לא תקלה בודדת. improvementTasks צריך להיות קונקרטי וישים, לא כללי ("לשפר תהליכים"). אל תחזיר יותר מ-6 problemNotes או 6 improvementTasks.`;
}

@Injectable()
export class QualityHubService {
  private readonly logger = new Logger(QualityHubService.name);

  constructor(private readonly qcService: QcService) {}

  // ── Server-path import — same directory as cr_list.xls, refreshed daily
  // (and on-demand) instead of a one-off manual upload. File names match the
  // exact source files (see importKpiDefinitions/importKpiScores comments);
  // override via SystemParam if the real file names ever differ.
  private async resolveQualityFilePath(kind: 'scores' | 'setup'): Promise<string> {
    const paramKey = kind === 'scores' ? 'QUALITY_KPI_SCORES_FILE' : 'QUALITY_KPI_SETUP_FILE';
    const override = await prisma.systemParam.findUnique({ where: { key: paramKey } });
    if (override?.value?.trim()) return override.value.trim();

    const crListPath = await resolveQcFilePath(prisma);
    const dir = path.dirname(crListPath);
    const fileName = kind === 'scores' ? 'RELEASES_KPI_SCORES.xlsx' : 'KPI_RELEASE_SCORE_SETUP.xlsx';
    return path.join(dir, fileName);
  }

  async importFromServerPath(): Promise<{
    setup: { created: number; updated: number } | { error: string };
    scores: { created: number; updated: number; releasesAffected: number } | { error: string };
  }> {
    const [setupPath, scoresPath] = await Promise.all([
      this.resolveQualityFilePath('setup'),
      this.resolveQualityFilePath('scores'),
    ]);

    const readAndImport = async <T>(filePath: string, importFn: (buf: Buffer) => Promise<T>): Promise<T | { error: string }> => {
      try {
        const { buffer } = readQcFile(filePath);
        return await importFn(buffer);
      } catch (err: any) {
        const message = err instanceof SmbAccessError ? err.message : (err?.message ?? String(err));
        this.logger.error(`Quality Hub server-path import failed for ${filePath}: ${message}`);
        return { error: message };
      }
    };

    const [setup, scores] = await Promise.all([
      readAndImport(setupPath, buf => this.importKpiDefinitions(buf)),
      readAndImport(scoresPath, buf => this.importKpiScores(buf)),
    ]);

    return { setup, scores };
  }

  // Guards against firing twice within the same target minute — same pattern
  // as version-cr-assignments.service.ts's CR_LIST nightly sync.
  private lastScheduledImportDate: string | null = null;

  // Checked every minute against the admin-configurable QUALITY_KPI_SYNC_TIME
  // system param (HH:mm, default 06:00) rather than a fixed @Cron expression
  // — mirrors CR_LIST_SYNC_TIME's polling pattern exactly (2026-08-11,
  // explicit product decision) so the sync time is editable from AdminPanel
  // without a code change or restart, consistent with how CR_LIST already works.
  @Cron(CronExpression.EVERY_MINUTE)
  async checkScheduledImportTime() {
    const param = await prisma.systemParam.findUnique({ where: { key: 'QUALITY_KPI_SYNC_TIME' } });
    const target = (param?.value ?? '06:00').trim();
    const now = new Date();
    const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    if (current !== target || this.lastScheduledImportDate === today) return;
    this.lastScheduledImportDate = today;
    this.logger.log('Running scheduled Quality Hub import from server path...');
    const result = await this.importFromServerPath();
    this.logger.log(`Scheduled Quality Hub import done: ${JSON.stringify(result)}`);
  }

  // ── Import (Multer buffer → xlsx → Prisma upsert) ───────────────────────
  // Source: KPI_RELEASE_SCORE_SETUP.xlsx — header has METRIC_DESCRIPTION twice
  // (short "purpose" text at col 8, long description at col 10), so parsing
  // is positional (header:1 array rows), never by header-name lookup.
  async importKpiDefinitions(buffer: Buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const dataRows = rows.slice(1).filter(r => r[1]);

    const existing = await prisma.kpiDefinition.findMany({ select: { kpiName: true } });
    const existingNames = new Set(existing.map(e => e.kpiName));

    let created = 0, updated = 0;
    await chunkedUpsert(dataRows, 25, async (r) => {
      const kpiName = String(r[1]).trim();
      if (!kpiName) return;
      const data = {
        kpiOrder: Number(r[0]) || 0,
        kpiName,
        kpiType: String(r[2] ?? ''),
        target: toNum(r[3]) ?? 0,
        weight: toNum(r[6]) ?? 0,
        measuredEntity: String(r[7] ?? ''),
        purpose: String(r[8] ?? '').trim() || null,
        description: [r[9], r[10]].map(v => String(v ?? '').trim()).filter(Boolean).join(' | ') || null,
        dataSource: String(r[11] ?? '').trim() || null,
        measurementPeriod: String(r[12] ?? '').trim() || null,
        trend: String(r[13] ?? '').trim() || null,
        comments: String(r[4] || r[14] || '').trim() || null,
      };
      await prisma.kpiDefinition.upsert({ where: { kpiName }, create: data, update: data });
      if (existingNames.has(kpiName)) updated++; else created++;
    });

    return { created, updated };
  }

  // Source: RELEASES_KPI_SCORES.xlsx — REL_NAME, SegmentName(=kpiName),
  // SegmentCode, Target, Grade, Weight, Relative Score, Calc. Score, ALL,
  // "TB, SS", sev, Med, Low. A stray blank-REL_NAME row exists near the top
  // of the real file — filtered out below.
  async importKpiScores(buffer: Buffer) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    const dataRows = rows.slice(1).filter(r => r[0] && r[1]);

    const existing = await prisma.releaseKpiScore.findMany({ select: { releaseName: true, kpiName: true } });
    const existingKeys = new Set(existing.map(e => `${e.releaseName}::${e.kpiName}`));

    let created = 0, updated = 0;
    const releasesAffected = new Set<string>();
    await chunkedUpsert(dataRows, 50, async (r) => {
      const releaseName = String(r[0]).trim();
      const kpiName = String(r[1]).trim();
      if (!releaseName || !kpiName) return;
      releasesAffected.add(releaseName);
      const data = {
        releaseName,
        kpiName,
        target: toNum(r[3]) ?? 0,
        grade: toNum(r[4]),
        weight: toNum(r[5]) ?? 0,
        relativeScore: toNum(r[6]),
        calcScore: toNum(r[7]),
        allCount: toNum(r[8]),
        showStopper: toNum(r[9]),
        severe: toNum(r[10]),
        medium: toNum(r[11]),
        low: toNum(r[12]),
      };
      await prisma.releaseKpiScore.upsert({
        where: { releaseName_kpiName: { releaseName, kpiName } },
        create: data,
        update: data,
      });
      if (existingKeys.has(`${releaseName}::${kpiName}`)) updated++; else created++;
    });

    return { created, updated, releasesAffected: releasesAffected.size };
  }

  // ── Reads ─────────────────────────────────────────────────────────────
  async getReleases(): Promise<ReleaseSummary[]> {
    const rows = await prisma.releaseKpiScore.findMany({ select: { releaseName: true, calcScore: true } });
    const byRelease = new Map<string, number>();
    for (const r of rows) {
      byRelease.set(r.releaseName, (byRelease.get(r.releaseName) ?? 0) + (r.calcScore ?? 0));
    }
    const releases: ReleaseSummary[] = Array.from(byRelease.entries()).map(([releaseName, totalFraction]) => ({
      releaseName,
      totalScore: pct(totalFraction) ?? 0,
      year: parseReleaseName(releaseName)?.year ?? null,
    }));
    releases.sort((a, b) => compareReleasesDesc(a.releaseName, b.releaseName));
    return releases;
  }

  getKpiDefinitions() {
    return prisma.kpiDefinition.findMany({ orderBy: { kpiOrder: 'asc' } });
  }

  async getOverview(releaseName: string) {
    const [scoreRows, allReleases, targetParam] = await Promise.all([
      prisma.releaseKpiScore.findMany({ where: { releaseName } }),
      this.getReleases(),
      prisma.systemParam.findUnique({ where: { key: 'RELEASE_QUALITY_TARGET_SCORE' } }),
    ]);
    if (scoreRows.length === 0) throw new NotFoundException(`אין נתוני ציון עבור גרסה "${releaseName}"`);

    const totalScore = pct(scoreRows.reduce((s, r) => s + (r.calcScore ?? 0), 0)) ?? 0;
    const targetScore = Number(targetParam?.value ?? 93);
    const status = totalScore >= targetScore ? 'ABOVE_TARGET' : 'BELOW_TARGET';

    const parsed = parseReleaseName(releaseName);
    const yearReleases = parsed ? allReleases.filter(r => r.year === parsed.year) : [];
    const yearAverage = yearReleases.length
      ? Math.round((yearReleases.reduce((s, r) => s + r.totalScore, 0) / yearReleases.length) * 10) / 10
      : null;

    const idx = allReleases.findIndex(r => r.releaseName === releaseName);
    const previousRelease = idx >= 0 && idx < allReleases.length - 1 ? allReleases[idx + 1] : null;

    return { releaseName, totalScore, status, targetScore, yearAverage, previousRelease };
  }

  async getKpiMatrix(releaseName: string) {
    const [scoreRows, definitions] = await Promise.all([
      prisma.releaseKpiScore.findMany({ where: { releaseName } }),
      this.getKpiDefinitions(),
    ]);
    if (scoreRows.length === 0) throw new NotFoundException(`אין נתוני ציון עבור גרסה "${releaseName}"`);

    const scoreByKpi = new Map(scoreRows.map(r => [r.kpiName, r]));
    const rows = definitions.map(def => {
      const s = scoreByKpi.get(def.kpiName);
      const weight = s?.weight ?? def.weight;
      const contributionPct = pct(s?.calcScore);
      // Score Lost = Contribution - Weight (both as %) — matches the deck's "Score Lost" column.
      const scoreLostPct = contributionPct != null ? Math.round((contributionPct - weight * 100) * 100) / 100 : null;
      return {
        kpiName: def.kpiName,
        kpiOrder: def.kpiOrder,
        actual: s?.grade ?? null,
        target: s?.target ?? def.target,
        weight,
        relativeScorePct: pct(s?.relativeScore),
        contributionPct,
        scoreLostPct,
        severity: {
          showStopper: s?.showStopper ?? null,
          severe: s?.severe ?? null,
          medium: s?.medium ?? null,
          low: s?.low ?? null,
        },
      };
    });
    return { releaseName, rows };
  }

  async getComparison(releaseNames: string[], includeYearAverage: boolean) {
    if (releaseNames.length === 0) throw new NotFoundException('לא נבחרו גרסאות להשוואה');

    const [allScores, definitions, allReleases] = await Promise.all([
      prisma.releaseKpiScore.findMany({ where: { releaseName: { in: releaseNames } } }),
      this.getKpiDefinitions(),
      this.getReleases(),
    ]);

    const totalsByRelease = new Map<string, number>();
    for (const name of releaseNames) totalsByRelease.set(name, 0);
    for (const r of allScores) {
      totalsByRelease.set(r.releaseName, (totalsByRelease.get(r.releaseName) ?? 0) + (r.calcScore ?? 0));
    }

    let yearAverageEntry: { label: string; totalScore: number } | null = null;
    if (includeYearAverage) {
      const parsed = parseReleaseName(releaseNames[0]);
      if (parsed) {
        const yearReleases = allReleases.filter(r => r.year === parsed.year);
        if (yearReleases.length) {
          yearAverageEntry = {
            label: `ממוצע ${parsed.year}`,
            totalScore: Math.round((yearReleases.reduce((s, r) => s + r.totalScore, 0) / yearReleases.length) * 10) / 10,
          };
        }
      }
    }

    const releases = releaseNames.map(name => ({
      releaseName: name,
      totalScore: pct(totalsByRelease.get(name)) ?? 0,
    }));

    const kpiRows = definitions.map(def => {
      const perRelease: Record<string, number | null> = {};
      for (const name of releaseNames) {
        const row = allScores.find(r => r.releaseName === name && r.kpiName === def.kpiName);
        perRelease[name] = pct(row?.relativeScore);
      }
      return { kpiName: def.kpiName, kpiOrder: def.kpiOrder, perRelease };
    });

    return { releases, yearAverage: yearAverageEntry, kpiRows };
  }

  async getTimeline(opts: { releaseNames?: string[]; years?: number[]; kpiName?: string; valueField?: 'relativeScore' | 'grade' }) {
    const allReleases = await this.getReleases();
    let filtered = allReleases;
    if (opts.releaseNames?.length) {
      const set = new Set(opts.releaseNames);
      filtered = filtered.filter(r => set.has(r.releaseName));
    }
    if (opts.years?.length) {
      const set = new Set(opts.years);
      filtered = filtered.filter(r => r.year != null && set.has(r.year));
    }
    // chronological ascending (oldest first) for a trend chart
    filtered = [...filtered].sort((a, b) => compareReleasesDesc(b.releaseName, a.releaseName));

    if (!opts.kpiName) {
      return { metric: 'TOTAL_SCORE', points: filtered.map(r => ({ releaseName: r.releaseName, value: r.totalScore })) };
    }

    const scoreRows = await prisma.releaseKpiScore.findMany({
      where: { kpiName: opts.kpiName, releaseName: { in: filtered.map(r => r.releaseName) } },
    });
    const field = opts.valueField ?? 'relativeScore';
    const byRelease = new Map(scoreRows.map(r => [r.releaseName, field === 'grade' ? r.grade : r.relativeScore]));
    return {
      metric: opts.kpiName,
      points: filtered.map(r => ({
        releaseName: r.releaseName,
        value: field === 'grade' ? (byRelease.get(r.releaseName) ?? null) : pct(byRelease.get(r.releaseName)),
      })),
    };
  }

  // Bulk variant of getTimeline for the "show all KPIs" overlay — one parallel
  // batch instead of 12 sequential client requests.
  async getTimelineAll(opts: { releaseNames?: string[]; years?: number[] }) {
    const definitions = await this.getKpiDefinitions();
    return Promise.all(
      definitions.map(async def => {
        const t = await this.getTimeline({ ...opts, kpiName: def.kpiName });
        return { kpiName: def.kpiName, kpiOrder: def.kpiOrder, points: t.points };
      }),
    );
  }

  // Bar-chart data for the Overview screen (matches the deck's per-release score bar chart).
  // No filter given → defaults to the most recent 12 releases (the deck's rolling window).
  async getOverviewChart(opts: { releaseNames?: string[]; years?: number[]; count?: number } = {}) {
    const allReleases = await this.getReleases();
    let filtered = allReleases;
    if (opts.releaseNames?.length) {
      const set = new Set(opts.releaseNames);
      filtered = filtered.filter(r => set.has(r.releaseName));
    }
    if (opts.years?.length) {
      const set = new Set(opts.years);
      filtered = filtered.filter(r => r.year != null && set.has(r.year));
    }
    if (!opts.releaseNames?.length && !opts.years?.length) {
      const count = opts.count && opts.count > 0 ? opts.count : 12;
      filtered = filtered.slice(0, count); // already sorted newest-first by getReleases()
    }
    // chronological ascending for the bar chart's left-to-right reading order
    return [...filtered].sort((a, b) => compareReleasesDesc(b.releaseName, a.releaseName));
  }

  // Single-KPI drill-down (matches the deck's per-KPI detail slide): current
  // metrics for one release + that KPI's raw-Grade trend across releases.
  async getKpiDetail(kpiName: string, releaseName: string, timelineOpts: { releaseNames?: string[]; years?: number[] } = {}) {
    const [scoreRow, def, allReleases] = await Promise.all([
      prisma.releaseKpiScore.findUnique({ where: { releaseName_kpiName: { releaseName, kpiName } } }),
      prisma.kpiDefinition.findUnique({ where: { kpiName } }),
      this.getReleases(),
    ]);
    if (!scoreRow || !def) throw new NotFoundException(`אין נתונים עבור "${kpiName}" בגרסה "${releaseName}"`);

    const parsed = parseReleaseName(releaseName);
    let yearAverageGrade: number | null = null;
    if (parsed) {
      const yearReleaseNames = allReleases.filter(r => r.year === parsed.year).map(r => r.releaseName);
      const yearRows = await prisma.releaseKpiScore.findMany({
        where: { kpiName, releaseName: { in: yearReleaseNames } },
      });
      const grades = yearRows.map(r => r.grade).filter((g): g is number => g != null);
      yearAverageGrade = grades.length ? Math.round((grades.reduce((s, g) => s + g, 0) / grades.length) * 1000) / 1000 : null;
    }

    const contributionPct = pct(scoreRow.calcScore);
    const scoreLostPct = contributionPct != null ? Math.round((contributionPct - scoreRow.weight * 100) * 100) / 100 : null;
    const trend = await this.getTimeline({ ...timelineOpts, kpiName, valueField: 'grade' });
    const liveSeverity = await this.computeLiveSeverity(kpiName, releaseName);

    return {
      kpiName,
      releaseName,
      definition: def,
      target: scoreRow.target,
      grade: scoreRow.grade,
      weight: scoreRow.weight,
      relativeScorePct: pct(scoreRow.relativeScore),
      contributionPct,
      scoreLostPct,
      yearAverageGrade,
      severity: {
        showStopper: scoreRow.showStopper,
        severe: scoreRow.severe,
        medium: scoreRow.medium,
        low: scoreRow.low,
      },
      // Computed live from the real, current QC defect list (same filter the
      // "🐛 צפה בתקלות" drill-down uses) — shown alongside `severity` (the
      // as-imported RELEASES_KPI_SCORES.xlsx columns) so the two can be
      // compared release-by-release before deciding to retire the imported
      // one. See kpiDefectFilters' investigation notes (2026-08-29): the
      // imported columns were found to be an even 4-way split of some total
      // for several KPIs, unrelated to the real per-severity breakdown.
      liveSeverity,
      trend: trend.points,
      qualitativeNote: scoreRow.qualitativeNote,
    };
  }

  // null when there's no real QC data to compute from (most of the 124
  // historical releases predate this app entirely) or the KPI has no
  // defect-list concept at all (the two time-based KPIs — see
  // QcService.KPI_WITHOUT_DEFECT_LIST).
  private async computeLiveSeverity(kpiName: string, releaseName: string): Promise<{ showStopper: number; severe: number; medium: number; low: number } | null> {
    if (this.qcService.KPI_WITHOUT_DEFECT_LIST.has(kpiName)) return null;
    const link = await this.getQcLinkForRelease(releaseName);
    if (!link || !link.hasQcData) return null;

    const defects = await this.qcService.getDefectsForKpi(link.versionId, kpiName);
    const out = { showStopper: 0, severe: 0, medium: 0, low: 0 };
    for (const d of defects) {
      if (d.severity === 'Show Stopper') out.showStopper++;
      else if (d.severity === 'Severe') out.severe++;
      else if (d.severity === 'Medium') out.medium++;
      else if (d.severity === 'Low') out.low++;
    }
    return out;
  }

  // Manually-entered per-release analysis (אחריות / שיפורים נדרשים / מאפייני
  // הבעיות) — unlike KpiDefinition's purpose/description, this is specific to
  // one release's instance of the KPI, not the KPI in general.
  // Superseded 2026-08-29 by KpiImprovementItem (multi-row, structured) — kept
  // as a legacy column/method, no longer written or read from the UI.
  async updateQualitativeNote(releaseName: string, kpiName: string, note: string | null) {
    const row = await prisma.releaseKpiScore.findUnique({ where: { releaseName_kpiName: { releaseName, kpiName } } });
    if (!row) throw new NotFoundException(`אין נתוני ציון עבור "${kpiName}" בגרסה "${releaseName}"`);
    return prisma.releaseKpiScore.update({
      where: { releaseName_kpiName: { releaseName, kpiName } },
      data: { qualitativeNote: note?.trim() || null },
    });
  }

  // ── KpiProblemNote — point-in-time problem observation for one release+KPI ─
  // (replaces the single qualitativeNote free-text field). Split from the
  // improvement task 2026-08-29 — a problem characterization is a fact about
  // one release, not a long-lived, status-tracked thing.
  async listProblemNotes(releaseName?: string, kpiName?: string) {
    return prisma.kpiProblemNote.findMany({
      where: { ...(releaseName ? { releaseName } : {}), ...(kpiName ? { kpiName } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createProblemNote(data: {
    releaseName: string; kpiName: string;
    problemCharacteristics?: string | null; defectCount?: number | null;
  }) {
    if (!data.releaseName?.trim() || !data.kpiName?.trim()) {
      throw new BadRequestException('חובה לציין גרסה ו-KPI');
    }
    return prisma.kpiProblemNote.create({
      data: {
        releaseName: data.releaseName.trim(),
        kpiName: data.kpiName.trim(),
        problemCharacteristics: data.problemCharacteristics?.trim() || null,
        defectCount: data.defectCount ?? null,
      },
    });
  }

  async updateProblemNote(id: string, patch: { problemCharacteristics?: string | null; defectCount?: number | null }) {
    const row = await prisma.kpiProblemNote.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('רשומת האבחון לא נמצאה');
    return prisma.kpiProblemNote.update({
      where: { id },
      data: {
        ...(patch.problemCharacteristics !== undefined ? { problemCharacteristics: patch.problemCharacteristics?.trim() || null } : {}),
        ...(patch.defectCount !== undefined ? { defectCount: patch.defectCount } : {}),
      },
    });
  }

  async deleteProblemNote(id: string) {
    const row = await prisma.kpiProblemNote.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('רשומת האבחון לא נמצאה');
    await prisma.kpiProblemNote.delete({ where: { id } });
    return { success: true };
  }

  // ── KpiImprovementTask — longer-lived, status-tracked action item ──────────
  // per release+KPI; feeds the cross-release Improvement Tracking screen (spec
  // confirmed 2026-08-29). No FK to KpiProblemNote — tagged by the same
  // releaseName+kpiName only, kept deliberately simple.
  async listImprovementTasks(releaseName?: string, kpiName?: string) {
    return prisma.kpiImprovementTask.findMany({
      where: { ...(releaseName ? { releaseName } : {}), ...(kpiName ? { kpiName } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createImprovementTask(data: {
    releaseName: string; kpiName: string;
    responsibility?: string | null; requiredImprovement?: string | null;
    mainDevelopments?: string | null; status?: string;
  }) {
    if (!data.releaseName?.trim() || !data.kpiName?.trim()) {
      throw new BadRequestException('חובה לציין גרסה ו-KPI');
    }
    return prisma.kpiImprovementTask.create({
      data: {
        releaseName: data.releaseName.trim(),
        kpiName: data.kpiName.trim(),
        responsibility: data.responsibility?.trim() || null,
        requiredImprovement: data.requiredImprovement?.trim() || null,
        mainDevelopments: data.mainDevelopments?.trim() || null,
        status: data.status ?? 'OPEN',
      },
    });
  }

  async updateImprovementTask(id: string, patch: {
    responsibility?: string | null; requiredImprovement?: string | null;
    mainDevelopments?: string | null; status?: string;
  }) {
    const row = await prisma.kpiImprovementTask.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('משימת השיפור לא נמצאה');
    return prisma.kpiImprovementTask.update({
      where: { id },
      data: {
        ...(patch.responsibility !== undefined ? { responsibility: patch.responsibility?.trim() || null } : {}),
        ...(patch.requiredImprovement !== undefined ? { requiredImprovement: patch.requiredImprovement?.trim() || null } : {}),
        ...(patch.mainDevelopments !== undefined ? { mainDevelopments: patch.mainDevelopments?.trim() || null } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
      },
    });
  }

  async deleteImprovementTask(id: string) {
    const row = await prisma.kpiImprovementTask.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('משימת השיפור לא נמצאה');
    await prisma.kpiImprovementTask.delete({ where: { id } });
    return { success: true };
  }

  // Same SystemParam-lookup + env-var-fallback pattern as incidents.service.ts
  // (getAnthropicClient) / versions.service.ts (generateUnifiedCrSummary).
  private async getAnthropicClient() {
    const apiKeyParam = await prisma.systemParam.findUnique({ where: { key: 'ANTHROPIC_API_KEY' } });
    const apiKey = apiKeyParam?.value?.trim() || process.env.ANTHROPIC_API_KEY || '';
    if (!apiKey) throw new BadRequestException('מפתח ANTHROPIC_API_KEY לא מוגדר בפרמטרי המערכת');
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    return new Anthropic({ apiKey });
  }

  // Returns suggested problem notes / improvement tasks WITHOUT writing them
  // — the caller (UI) shows them for review and creates only the ones the
  // user accepts via the existing createProblemNote/createImprovementTask
  // endpoints (2026-08-29 product decision: suggest, don't auto-commit,
  // unlike RCA's aiAnalyze which writes directly — this table is newer and
  // less battle-tested).
  async suggestImprovementAnalysis(kpiName: string, releaseName: string): Promise<{
    problemNotes: { problemCharacteristics: string; defectCount: number | null }[];
    improvementTasks: { requiredImprovement: string; mainDevelopments: string | null; responsibility: string | null }[];
  }> {
    const link = await this.getQcLinkForRelease(releaseName);
    if (!link || !link.hasQcData) throw new BadRequestException('אין נתוני תקלות אמיתיים לגרסה זו — לא ניתן לנתח');

    const defects = await this.qcService.getDefectsForKpi(link.versionId, kpiName);
    if (defects.length === 0) throw new BadRequestException('אין תקלות התואמות KPI זה בגרסה זו');

    const def = await prisma.kpiDefinition.findUnique({ where: { kpiName } });
    const client = await this.getAnthropicClient();
    const prompt = buildImprovementAnalysisPrompt(kpiName, releaseName, def?.purpose ?? null, defects);
    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
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

    // Not trusted blindly — same spirit as incidents.service.ts's
    // applyRcaConclusion: malformed entries are dropped rather than stored.
    const problemNotes = Array.isArray(parsed.problemNotes)
      ? parsed.problemNotes
          .filter((n: any) => typeof n?.problemCharacteristics === 'string' && n.problemCharacteristics.trim())
          .map((n: any) => ({
            problemCharacteristics: n.problemCharacteristics.trim(),
            defectCount: typeof n.defectCount === 'number' ? n.defectCount : null,
          }))
      : [];
    const improvementTasks = Array.isArray(parsed.improvementTasks)
      ? parsed.improvementTasks
          .filter((t: any) => typeof t?.requiredImprovement === 'string' && t.requiredImprovement.trim())
          .map((t: any) => ({
            requiredImprovement: t.requiredImprovement.trim(),
            mainDevelopments: typeof t.mainDevelopments === 'string' ? t.mainDevelopments.trim() : null,
            responsibility: typeof t.responsibility === 'string' ? t.responsibility.trim() : null,
          }))
      : [];

    return { problemNotes, improvementTasks };
  }

  // Defect-level drill-down is only possible for releases that have a real
  // linked QC/Oracle release (via Version.qcRelease) — most of the 124
  // historical releases in RELEASES_KPI_SCORES.xlsx go back to 2017 and only
  // ever existed as aggregate Excel rows, with no corresponding Version/QC
  // release in this app at all.
  async getQcLinkForRelease(releaseName: string): Promise<{ versionId: string; hasQcData: boolean } | null> {
    const version = await prisma.version.findFirst({
      where: { name: releaseName },
      include: { qcRelease: true },
    });
    if (!version) return null;
    const rel = (version as any).qcRelease;
    const hasQcData = !!(rel && (rel.goLiveCycleId ?? rel.rehearsalCycleId));
    return { versionId: version.id, hasQcData };
  }
}
