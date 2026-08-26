import { Injectable, Logger, ForbiddenException, BadRequestException, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';
import { TEAM_COLUMNS, EXCLUDED_CR_STATUSES, TARGET_CR_PATTERN } from '../common/team-columns';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];
const LEADS_UP = ['TEAM_LEAD', 'RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'];

type LoadedSheet = {
  rows: any[][]; headerRowIdx: number; colIdx: (name: string) => number;
  crCol: number; titleCol: number; verCol: number; statusCol: number;
  appCol: number; projectCol: number; estimateCol: number; actualsCol: number;
  parseDay: (v: any) => number;
};

@Injectable()
export class VersionCrAssignmentsService {
  // In-memory cache of the parsed CR_LIST sheet, keyed by file path + mtime +
  // size. Parsing this file (XLSX.read + sheet_to_json) takes ~1.3s on the
  // real ~8k-row file — loadSheet() is called on every CR-detail open, every
  // change-history click, and every sync, so without this cache a manager
  // clicking through a CR list re-pays that cost on each click. Invalidates
  // itself automatically the moment the file on disk changes (no restart
  // needed) since mtime/size no longer match.
  private sheetCache: { filePath: string; mtimeMs: number; size: number; parsed: LoadedSheet } | null = null;
  private readonly logger = new Logger(VersionCrAssignmentsService.name);

  // Guards against firing twice within the same target minute (the tick
  // below runs every minute, so without this it would keep re-triggering
  // for the full 60s the clock matches CR_LIST_SYNC_TIME).
  private lastNightlySyncDate: string | null = null;

  // Checked every minute against the admin-configurable CR_LIST_SYNC_TIME
  // system param (HH:mm, default 00:15) rather than a fixed @Cron expression
  // — so changing the time in AdminPanel takes effect on the very next tick,
  // with no reschedule/restart needed. Same polling pattern already used by
  // runbook.service.ts's EVERY_MINUTE cron.
  @Cron(CronExpression.EVERY_MINUTE)
  async checkNightlySyncSchedule() {
    const param = await prisma.systemParam.findUnique({ where: { key: 'CR_LIST_SYNC_TIME' } });
    const target = (param?.value ?? '00:15').trim();
    const now = new Date();
    const current = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().slice(0, 10);
    if (current !== target || this.lastNightlySyncDate === today) return;
    this.lastNightlySyncDate = today;
    await this.runNightlySync();
  }

  // Re-syncs every non-terminal version's CR scope from the Excel file, so
  // nobody needs to remember to click "sync" — mirrors the existing pattern
  // in quality-hub.service.ts's scheduledImport(). Skips COMPLETED/
  // ROLLED_BACK and archived versions, since their scope is done and
  // shouldn't move.
  private async runNightlySync() {
    const versions = await prisma.version.findMany({
      where: { isArchived: false, status: { notIn: ['COMPLETED', 'ROLLED_BACK'] } },
      select: { id: true, name: true },
    });
    this.logger.log(`Running scheduled nightly CR_LIST sync for ${versions.length} version(s)...`);
    for (const v of versions) {
      try {
        const result = await this.syncApply(v.id);
        this.logger.log(`Synced ${v.name}: ${JSON.stringify(result)}`);
      } catch (err: any) {
        this.logger.error(`Nightly sync failed for ${v.name}: ${err?.message ?? err}`);
      }
    }
    this.logger.log('Scheduled nightly CR_LIST sync done.');
  }

  // `includeExempt` bypasses the requiresPlan=false exclusion below — needed
  // by callers that want the CR's real sync/removed status regardless of
  // which team it's on (QA Assignment/Work Plan screens), as opposed to the
  // CR-Plan submission-tracking callers this exclusion was built for.
  // QA Team itself is requiresPlan=false (it has its own separate QaWorkPlan
  // system instead of submitting a CrPlan), so without this, a CR whose only
  // row is on QA Team can never be seen as REMOVED by those two screens —
  // its row is silently stripped before syncStatus ever reaches them (found
  // 2026-08-02: CRs removed from CR_LIST kept showing as active forever).
  async findForVersion(versionId: string, user: { sub: string; role: string }, includeExempt = false) {
    // Exclude assignments from teams that don't require plan submission
    const exemptRows: any[] = includeExempt ? [] : await prisma.$queryRawUnsafe(
      `SELECT id FROM "Team" WHERE "requiresPlan" = false`,
    );
    const exemptTeamIds = exemptRows.map((r: any) => String(r.id));

    if (MANAGERS.includes(user.role)) {
      const all = await prisma.versionCrAssignment.findMany({
        where: { versionId },
        include: { team: { select: { id: true, name: true } } },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
      return exemptTeamIds.length > 0
        ? all.filter((a: any) => !exemptTeamIds.includes(String(a.teamId)))
        : all;
    }
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];
    return prisma.versionCrAssignment.findMany({
      where: { versionId, teamId: membership.teamId },
      orderBy: { crNumber: 'asc' },
    });
  }

  // Cross-team coordination info per CR — which OTHER teams and which systems
  // a CR touches. Purely descriptive (no plan content), so unlike findForVersion
  // it isn't restricted to the caller's own team: a team lead needs to know who
  // else to coordinate with on a shared CR, not just their own team's row.
  async getCrScope(versionId: string) {
    const rows = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      include: { team: { select: { name: true } } },
    });
    const byCr = new Map<string, { teamNames: Set<string>; systems: Set<string> }>();
    for (const r of rows) {
      let entry = byCr.get(r.crNumber);
      if (!entry) { entry = { teamNames: new Set(), systems: new Set() }; byCr.set(r.crNumber, entry); }
      if (r.team?.name) entry.teamNames.add(r.team.name);
      if (r.application) entry.systems.add(r.application);
    }
    return Array.from(byCr.entries()).map(([crNumber, e]) => ({
      crNumber, teamNames: Array.from(e.teamNames), systems: Array.from(e.systems),
    }));
  }

  // QA classification progress — how many distinct CRs already have at least
  // one of isCore/urgent/priorityTestDate set. Doesn't depend on scope
  // approval: a lead can classify a CR the moment it's synced from CR_LIST.
  async getClassificationStats(versionId: string) {
    const rows = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { crNumber: true, isCore: true, urgent: true, priorityTestDate: true },
    });
    const byCr = new Map<string, boolean>();
    for (const r of rows) {
      const classified = !!r.isCore || !!r.urgent || !!r.priorityTestDate;
      byCr.set(r.crNumber, (byCr.get(r.crNumber) ?? false) || classified);
    }
    const totalCrs = byCr.size;
    const classifiedCrs = Array.from(byCr.values()).filter(Boolean).length;
    return { totalCrs, classifiedCrs };
  }

  // ── Private: load raw CR_LIST sheet + resolved column indices (shared by
  // parseExcelAssignments and getChangeDetail) ──────────────────────────────
  private async loadSheet(): Promise<LoadedSheet> {
    const param = await prisma.systemParam.findUnique({ where: { key: 'EXCEL_FILE_PATH' } });
    const filePath = param?.value?.trim();
    if (!filePath) throw new BadRequestException('נתיב קובץ CR_LIST לא הוגדר בפרמטרי המערכת (EXCEL_FILE_PATH)');
    if (!fs.existsSync(filePath)) throw new BadRequestException(`הקובץ לא נמצא: ${filePath}`);

    const stat = fs.statSync(filePath);
    if (
      this.sheetCache &&
      this.sheetCache.filePath === filePath &&
      this.sheetCache.mtimeMs === stat.mtimeMs &&
      this.sheetCache.size === stat.size
    ) {
      return this.sheetCache.parsed;
    }

    const buffer = fs.readFileSync(filePath);
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    const REQUIRED_COLS = ['# CR', 'כותרת', 'גרסה'];
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = (rows[i] as any[]).map(h => String(h ?? '').trim());
      if (REQUIRED_COLS.every(col => row.includes(col))) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) {
      const sample = (rows[0] as any[]).slice(0, 10).map(h => String(h ?? '').trim()).join(', ');
      throw new BadRequestException(`מבנה קובץ לא תקין — עמודות חובה חסרות. נמצאו: ${sample}`);
    }

    const headers: string[] = (rows[headerRowIdx] as any[]).map(h => String(h ?? '').trim());
    const colIdx = (name: string) => headers.findIndex(h => h === name);

    const parsed: LoadedSheet = {
      rows, headerRowIdx, colIdx,
      crCol:       colIdx('# CR'),
      titleCol:    colIdx('כותרת'),
      verCol:      colIdx('גרסה'),
      statusCol:   colIdx('סטטוס'),
      appCol:      colIdx('מאפיין'),
      projectCol:  colIdx('פרויקט'),
      estimateCol: colIdx('סך כל הערכות'),
      actualsCol:  colIdx('Actuals'),
      parseDay: (v: any) => { const n = parseFloat(String(v ?? '0').replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; },
    };
    this.sheetCache = { filePath, mtimeMs: stat.mtimeMs, size: stat.size, parsed };
    return parsed;
  }

  // ── Private: parse CR_LIST Excel and return eligible assignments ──────────────
  private async parseExcelAssignments(versionId: string): Promise<{
    assignments: {
      crNumber: string; crLabel: string; teamId: string; teamName: string;
      crManager: string; crDescription: string; application: string; project: string;
      qaEffort?: number; estimateDays?: number | null; hasActual?: boolean; actualEffortDays?: number | null;
    }[];
    allTeams: { id: string; name: string }[];
  }> {
    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { name: true } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const {
      rows, headerRowIdx, colIdx, crCol, titleCol, verCol, statusCol, appCol, projectCol,
      estimateCol, actualsCol, parseDay,
    } = await this.loadSheet();
    const COL_DESCRIPTION = 5;
    const COL_MANAGER     = 9;

    const allTeams = await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true } });
    const teamIdByName: Record<string, string> = {};
    allTeams.forEach(t => { teamIdByName[t.name] = t.id; });

    // Configurable via AdminPanel → System Params (QA_EFFORT_THRESHOLD_DAYS,
    // default 0) instead of a hardcoded cutoff — any QA effort above this
    // value qualifies a CR for the version's scope.
    const thresholdParam = await prisma.systemParam.findUnique({ where: { key: 'QA_EFFORT_THRESHOLD_DAYS' } });
    const qaThreshold = Number(thresholdParam?.value ?? '0') || 0;

    // Master gate: a CR belongs to the version's scope iff its QA column > threshold.
    // That alone is enough for the QA row itself. A non-QA team's row additionally
    // requires that team's own column to be > 0.3 (checked per-row further below) —
    // it does NOT require any other non-QA team to be involved.
    const QA_TEAM_NAME = 'QA Team';
    const qaCols = TEAM_COLUMNS[QA_TEAM_NAME].map(colIdx).filter(i => i !== -1);
    const qaCRs  = new Set<string>();

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] as any[];
      if (String(row[verCol] ?? '').trim() !== version.name) continue;
      if (EXCLUDED_CR_STATUSES.has(String(row[statusCol] ?? '').trim())) continue;
      const crNumber = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
      const title    = titleCol !== -1 ? String(row[titleCol] ?? '').trim() : '';
      if (!crNumber || !title) continue;
      if (qaCols.length > 0 && parseDay(row[qaCols[0]]) > qaThreshold) qaCRs.add(crNumber);
    }

    const eligibleCRs = qaCRs;
    const crEstimateDays: Record<string, number | null> = {};
    const crHasActual:    Record<string, boolean>       = {};
    const crActualDays:   Record<string, number | null> = {};
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r] as any[];
      const crNumber = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
      if (!crNumber) continue;
      if (estimateCol !== -1 && !(crNumber in crEstimateDays)) {
        const raw = parseFloat(String(row[estimateCol] ?? '').replace(/[^\d.]/g, ''));
        crEstimateDays[crNumber] = isNaN(raw) ? null : raw;
      }
      if (actualsCol !== -1 && !crHasActual[crNumber]) {
        const cell = String(row[actualsCol] ?? '').trim().toLowerCase();
        if (['v', '✓', 'x', 'yes', 'כן'].includes(cell)) crHasActual[crNumber] = true;
      }
      // Same "Actuals" column, read as a number this time — some releases put
      // an actual-days figure there instead of a plain checkbox mark; a
      // checkbox-style cell parses to NaN → null, same as an empty cell.
      if (actualsCol !== -1 && !(crNumber in crActualDays)) {
        const raw = parseFloat(String(row[actualsCol] ?? '').replace(/[^\d.]/g, ''));
        crActualDays[crNumber] = isNaN(raw) ? null : raw;
      }
    }

    const assignments: any[] = [];
    const seen = new Set<string>();
    for (const [teamName, teamCols] of Object.entries(TEAM_COLUMNS)) {
      const teamId = teamIdByName[teamName];
      if (!teamId) continue;
      const teamColIdxs = teamCols.map(colIdx).filter(i => i !== -1);
      if (teamColIdxs.length === 0) continue;
      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] as any[];
        if (String(row[verCol] ?? '').trim() !== version.name) continue;
        if (EXCLUDED_CR_STATUSES.has(String(row[statusCol] ?? '').trim())) continue;
        const crNumber = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
        const title    = titleCol !== -1 ? String(row[titleCol] ?? '').trim() : '';
        if (!crNumber || !title || !eligibleCRs.has(crNumber)) continue;
        let qaEffortDays: number | undefined;
        let teamEstimate: number | undefined;
        if (teamName === QA_TEAM_NAME) {
          const qaDay = teamColIdxs.length > 0 ? parseDay(row[teamColIdxs[0]]) : 0;
          if (qaDay <= qaThreshold) continue;
          qaEffortDays = qaDay;
          teamEstimate = qaDay;
        } else {
          const colSum = teamColIdxs.reduce((s, ci) => s + parseDay(row[ci]), 0);
          if (colSum <= 0.3) continue;
          teamEstimate = Math.round(colSum * 100) / 100;
        }
        const key = `${crNumber}|${teamId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        assignments.push({
          crNumber, crLabel: `${crNumber} - ${title}`, teamId, teamName,
          crManager:     String(row[COL_MANAGER]     ?? '').trim(),
          crDescription: String(row[COL_DESCRIPTION] ?? '').trim(),
          application:   appCol    !== -1 ? String(row[appCol]    ?? '').trim() : '',
          project:       projectCol !== -1 ? String(row[projectCol] ?? '').trim() : '',
          ...(qaEffortDays !== undefined ? { qaEffort: qaEffortDays } : {}),
          teamEstimateDays: teamEstimate ?? null,
          estimateDays: crEstimateDays[crNumber] ?? null,
          hasActual:    crHasActual[crNumber] ?? false,
          actualEffortDays: crActualDays[crNumber] ?? null,
        });
      }
    }
    return { assignments, allTeams };
  }

  // ── Preview sync diff — no DB changes ──────────────────────────────────────
  async syncPreview(versionId: string): Promise<{
    added:     { crNumber: string; crLabel: string; teamName: string }[];
    removed:   { crNumber: string; crLabel: string; teamName: string }[];
    unchanged: number;
  }> {
    const { assignments, allTeams } = await this.parseExcelAssignments(versionId);
    const teamNameById: Record<string, string> = {};
    allTeams.forEach(t => { teamNameById[t.id] = t.name; });

    const excelKeys = new Set(assignments.map(a => `${a.crNumber}|${a.teamId}`));
    const existing = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { crNumber: true, teamId: true, crLabel: true },
    });
    const dbKeys = new Set(existing.map(e => `${e.crNumber}|${e.teamId}`));

    const added = assignments
      .filter(a => !dbKeys.has(`${a.crNumber}|${a.teamId}`))
      .map(a => ({ crNumber: a.crNumber, crLabel: a.crLabel, teamName: a.teamName }));

    const removed = existing
      .filter(e => !excelKeys.has(`${e.crNumber}|${e.teamId}`))
      .map(e => ({ crNumber: e.crNumber, crLabel: e.crLabel ?? e.crNumber, teamName: teamNameById[e.teamId] ?? e.teamId }));

    const unchanged = existing.filter(e => excelKeys.has(`${e.crNumber}|${e.teamId}`)).length;

    return { added, removed, unchanged };
  }

  // ── Apply sync: mark NEW/REMOVED, upsert new CRs ──────────────────────────
  // excludeCrNumbers lets the user drop specific CRs from the "added" preview
  // before applying — e.g. a CR that legitimately spans several teams'
  // columns in the Excel and shouldn't be picked up this round for any of them.
  async syncApply(versionId: string, excludeCrNumbers: string[] = []): Promise<{ added: number; removed: number; unchanged: number }> {
    const { assignments: allAssignments } = await this.parseExcelAssignments(versionId);

    // If scope was already approved, any add/remove from here on is a genuine
    // post-approval scope change — flag it instead of silently absorbing it.
    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { scopeApprovedAt: true } });
    const scopeAlreadyApproved = !!version?.scopeApprovedAt;

    // Existing active + new records (exclude already-REMOVED ones from diff)
    const existing = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { id: true, crNumber: true, teamId: true },
    });
    const dbKeys = new Set(existing.map(e => `${e.crNumber}|${e.teamId}`));
    const existingCrNumbers = new Set(existing.map(e => e.crNumber));

    // Only exclusions for genuinely NEW CRs take effect — this can't be used
    // to accidentally remove a CR that's already active from a prior sync.
    const excludeSet = new Set(excludeCrNumbers.filter(cr => !existingCrNumbers.has(cr)));
    const assignments = allAssignments.filter(a => !excludeSet.has(a.crNumber));
    const excelKeys = new Set(assignments.map(a => `${a.crNumber}|${a.teamId}`));

    const now = new Date();
    let added = 0;
    let unchanged = 0;

    // Upsert: new CRs get syncStatus='NEW', existing ones get syncStatus='ACTIVE'
    for (const a of assignments) {
      const isNew = !dbKeys.has(`${a.crNumber}|${a.teamId}`);
      await prisma.versionCrAssignment.upsert({
        where: { versionId_crNumber_teamId: { versionId, crNumber: a.crNumber, teamId: a.teamId } },
        create: {
          versionId, crNumber: a.crNumber, crLabel: a.crLabel, teamId: a.teamId,
          crManager: a.crManager || null, crDescription: a.crDescription || null,
          application: a.application || null, project: a.project || null,
          syncedAt: now, syncStatus: 'NEW',
          needsAttention: scopeAlreadyApproved,
          ...(a.qaEffort !== undefined ? { qaEffort: a.qaEffort } : {}),
          teamEstimateDays: (a as any).teamEstimateDays ?? null,
          estimateDays: a.estimateDays ?? null, hasActual: a.hasActual ?? false,
          actualEffortDays: (a as any).actualEffortDays ?? null,
        } as any,
        update: {
          crLabel: a.crLabel, crManager: a.crManager || null,
          crDescription: a.crDescription || null, application: a.application || null,
          project: a.project || null, syncedAt: now,
          syncStatus: 'ACTIVE',
          ...(a.qaEffort !== undefined ? { qaEffort: a.qaEffort } : {}),
          teamEstimateDays: (a as any).teamEstimateDays ?? null,
          estimateDays: a.estimateDays ?? null, hasActual: a.hasActual ?? false,
          actualEffortDays: (a as any).actualEffortDays ?? null,
        } as any,
      });
      if (isNew) added++; else unchanged++;
    }

    // Mark removed CRs — do NOT delete
    const stale = existing.filter(e => !excelKeys.has(`${e.crNumber}|${e.teamId}`));
    if (stale.length > 0) {
      const staleCrNumbers = [...new Set(stale.map(e => e.crNumber))];
      // Mark CrPlans as not needed so they don't block status transitions
      await prisma.crPlan.updateMany({
        where: { versionId, crNumber: { in: staleCrNumbers }, notNeededForPlan: false },
        data: { notNeededForPlan: true },
      });
      await prisma.versionCrAssignment.updateMany({
        where: { id: { in: stale.map(e => e.id) } },
        data: { syncStatus: 'REMOVED', needsAttention: scopeAlreadyApproved },
      });
    }

    return { added, removed: stale.length, unchanged };
  }

  // ── Explain why a CR is tagged NEW / REMOVED — reads the live CR_LIST file
  // (not a stored snapshot) so the answer reflects the file's current state,
  // and cross-checks other versions in the DB for "moved from/to" cases ──────
  async getChangeDetail(versionId: string, crNumber: string, teamId: string): Promise<{
    crNumber: string; crLabel: string; teamName: string; syncStatus: string;
    reason: string;
    detail: {
      movedToVersion?: string;
      movedFromVersion?: string;
      statusInSource?: string;
      prevDays?: number | null;
      currentDays?: number | null;
      foundInSource: boolean;
    };
  }> {
    const row = await prisma.versionCrAssignment.findUnique({
      where: { versionId_crNumber_teamId: { versionId, crNumber, teamId } },
      include: { team: { select: { name: true } } },
    });
    if (!row) throw new BadRequestException('שיוך CR לא נמצא');

    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { name: true } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

    const { rows, headerRowIdx, crCol, verCol, statusCol, colIdx, parseDay } = await this.loadSheet();
    const teamCols = (TEAM_COLUMNS[row.team.name] ?? []).map(colIdx).filter(i => i !== -1);
    // Same configurable threshold as the sync gate (QA_EFFORT_THRESHOLD_DAYS) —
    // must stay in sync with parseExcelAssignments' gate or this reason text
    // can contradict the actual syncStatus that produced the NEW/REMOVED badge.
    const thresholdParam = await prisma.systemParam.findUnique({ where: { key: 'QA_EFFORT_THRESHOLD_DAYS' } });
    const teamThreshold = row.team.name === 'QA Team' ? (Number(thresholdParam?.value ?? '0') || 0) : 0.3;

    const occurrences: { versionName: string; status: string; teamDays: number }[] = [];
    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const line = rows[r] as any[];
      if (crCol === -1 || String(line[crCol] ?? '').trim() !== crNumber) continue;
      occurrences.push({
        versionName: verCol    !== -1 ? String(line[verCol]    ?? '').trim() : '',
        status:      statusCol !== -1 ? String(line[statusCol] ?? '').trim() : '',
        teamDays:    teamCols.reduce((s, ci) => s + parseDay(line[ci]), 0),
      });
    }

    const detail: any = { foundInSource: occurrences.length > 0 };
    let reason: string;

    if (row.syncStatus === 'NEW') {
      const elsewhere = await prisma.versionCrAssignment.findFirst({
        where: { versionId: { not: versionId }, crNumber, teamId },
        orderBy: { syncedAt: 'desc' },
        include: { version: { select: { name: true } } },
      });
      if (elsewhere) {
        detail.movedFromVersion = elsewhere.version.name;
        reason = `ה-CR שויך בעבר לגרסה "${elsewhere.version.name}" ועבר לגרסה הנוכחית.`;
      } else {
        reason = 'CR חדש לגמרי — לא נמצא שיוך קודם לגרסה אחרת במערכת.';
      }
    } else {
      const sameVersion  = occurrences.find(o => o.versionName === version.name);
      const otherVersion = occurrences.find(o => o.versionName !== version.name && o.versionName !== '');
      // "Before" = last value this row was synced with; "after" = what the live
      // file shows right now. teamEstimateDays covers non-QA teams, qaEffort
      // covers the QA Team row — whichever is populated for this row's team.
      const prevDays = row.teamEstimateDays ?? row.qaEffort ?? null;

      if (sameVersion && EXCLUDED_CR_STATUSES.has(sameVersion.status)) {
        detail.statusInSource = sameVersion.status;
        detail.prevDays = prevDays;
        detail.currentDays = sameVersion.teamDays;
        reason = `הסטטוס של ה-CR בקובץ המקור שונה ל"${sameVersion.status}".`;
      } else if (sameVersion && sameVersion.teamDays <= teamThreshold) {
        detail.prevDays = prevDays;
        detail.currentDays = sameVersion.teamDays;
        reason = `ימי הפיתוח של צוות זה על ה-CR ירדו בקובץ המקור (${prevDays ?? '?'} ← ${sameVersion.teamDays}, מתחת לסף ${teamThreshold}).`;
      } else if (sameVersion && prevDays != null && Math.abs(sameVersion.teamDays - prevDays) >= 0.05) {
        // Still in scope, but the effort figure itself moved — the change that
        // triggered a re-sync even though it didn't cross the removal threshold.
        detail.prevDays = prevDays;
        detail.currentDays = sameVersion.teamDays;
        reason = `ימי הפיתוח של צוות זה על ה-CR השתנו בקובץ המקור (${prevDays} ← ${sameVersion.teamDays}) — עדיין מעל הסף, ללא השפעה על התכולה.`;
      } else if (sameVersion) {
        detail.prevDays = prevDays;
        detail.currentDays = sameVersion.teamDays;
        if (sameVersion.status) detail.statusInSource = sameVersion.status;
        // A row can carry needsAttention=true from the sync that first added it
        // (syncStatus='NEW' at the time) and then settle back to 'ACTIVE' on a
        // later sync that matches it again — needsAttention is never cleared by
        // that update path, only by an explicit review. By the time someone
        // opens this detail, syncStatus no longer says 'NEW', so the top branch
        // never fires and the row looks like it has no history at all. Without
        // this check the fallback below ("may need resync") is actively
        // misleading here — there's nothing to resync, the file and DB already
        // agree; what's missing is that nobody has acknowledged the addition.
        if (row.needsAttention) {
          reason = 'ה-CR/הצוות הזה נוסף לתכולת הגרסה לאחר אישור התכולה. מאז לא זוהה שינוי נוסף בימי המאמץ או בסטטוס — הנתונים תואמים כרגע בין המערכת לקובץ המקור, אך ההוספה המקורית עדיין מסומנת כטעונת בדיקה. לחצו "אשר שינויים" לאחר שוידאתם שזה תקין.';
        } else {
          reason = 'לא זוהה שינוי בימי המאמץ או בסטטוס בקובץ המקור מול הגרסה הנוכחית — ייתכן שנדרש סנכרון מחדש.';
        }
      } else if (otherVersion) {
        detail.movedToVersion = otherVersion.versionName;
        reason = `ה-CR עבר לגרסה "${otherVersion.versionName}" בקובץ המקור.`;
      } else {
        reason = 'ה-CR לא נמצא כלל בקובץ ה-CR_LIST הנוכחי (ייתכן שבוטל או הוסר מהמקור).';
      }
    }

    return {
      crNumber, crLabel: row.crLabel ?? crNumber, teamName: row.team.name,
      syncStatus: row.syncStatus, reason, detail,
    };
  }

  // ── Full CR detail for the "click the CR number" modal ─────────────────────
  // Descriptive fields (label/description/manager/application/estimate/notes)
  // come from the DB row (first team's row wins — they're duplicated per team
  // by the CR_LIST import). Teams involved is derived from every row sharing
  // this crNumber+versionId. Status is read live from the CR_LIST Excel, same
  // source as getChangeDetail above — non-fatal if the file is unavailable
  // (e.g. SMB not mounted), the rest of the modal still has something to show.
  //
  // Permission: leads/managers can view any CR's detail; a plain QA tester
  // (EMPLOYEE role) can only view it for a CR they're actually assigned to
  // test (via QaAssignment or a QaCycleTask) — not a blanket employee-wide
  // opening, since this can include internal QA notes.
  async getCrDetail(versionId: string, crNumber: string, user: { sub: string; role: string }) {
    if (!LEADS_UP.includes(user.role)) {
      const [assignment, task] = await Promise.all([
        prisma.qaAssignment.findFirst({ where: { versionId, crNumber, userId: user.sub } }),
        prisma.qaCycleTask.findFirst({ where: { crNumber, userId: user.sub, cycle: { workPlan: { versionId } } } as any }),
      ]);
      if (!assignment && !task) throw new ForbiddenException('אין הרשאה לצפות בפרטי CR זה');
    }

    const rows = await prisma.versionCrAssignment.findMany({
      where: { versionId, crNumber },
      include: { team: { select: { name: true } } },
      orderBy: { syncedAt: 'asc' },
    });
    if (rows.length === 0) throw new NotFoundException('CR לא נמצא בגרסה זו');
    const first = rows[0];

    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { name: true } });

    let status = '';
    try {
      const { rows: sheetRows, headerRowIdx, crCol, statusCol } = await this.loadSheet();
      if (crCol !== -1 && statusCol !== -1) {
        for (let r = headerRowIdx + 1; r < sheetRows.length; r++) {
          const line = sheetRows[r] as any[];
          if (String(line[crCol] ?? '').trim() === crNumber) {
            status = String(line[statusCol] ?? '').trim();
            break;
          }
        }
      }
    } catch { /* CR_LIST file unavailable — status stays blank */ }

    // Archive/restore history for this CR's QA work-plan tasks (see
    // qa-workplan.service.ts's archiveTask/restoreTask) — surfaced here so a
    // manager reviewing the CR can see the full trail without switching
    // screens. Empty when the version has no work plan or this CR was never
    // archived.
    let archiveHistory: {
      id: string; action: string; userEmail: string | null;
      userName: string | null; cycleType: string | null; reason: string | null;
      createdAt: Date; isCurrentlyArchived: boolean;
    }[] = [];
    try {
      const workPlan = await prisma.qaWorkPlan.findUnique({ where: { versionId }, select: { id: true } });
      if (workPlan) {
        const [logs, archivedTasks] = await Promise.all([
          prisma.qaWorkPlanChangeLog.findMany({
            where: { workPlanId: workPlan.id, crNumber, action: { in: ['TASK_ARCHIVED', 'TASK_RESTORED'] } },
            orderBy: { createdAt: 'asc' },
          }),
          prisma.qaCycleTask.findMany({
            where: { crNumber, isArchived: true, cycle: { workPlanId: workPlan.id } } as any,
            select: { id: true },
          }),
        ]);
        const archivedTaskIds = new Set(archivedTasks.map(t => t.id));
        const cycleTypeById = new Map<string, string>();
        const taskIds = [...new Set(logs.map(l => l.qaCycleTaskId).filter((id): id is string => !!id))];
        if (taskIds.length > 0) {
          const tasksWithCycle = await prisma.qaCycleTask.findMany({
            where: { id: { in: taskIds } },
            select: { id: true, cycle: { select: { cycleType: true } } },
          });
          tasksWithCycle.forEach(t => cycleTypeById.set(t.id, t.cycle.cycleType));
        }
        archiveHistory = logs.map(l => ({
          id: l.id,
          action: l.action,
          userEmail: l.userEmail,
          userName: l.userEmail,
          cycleType: l.qaCycleTaskId ? cycleTypeById.get(l.qaCycleTaskId) ?? null : null,
          reason: (l.afterData as any)?.reason ?? null,
          createdAt: l.createdAt,
          isCurrentlyArchived: l.qaCycleTaskId ? archivedTaskIds.has(l.qaCycleTaskId) : false,
        }));
      }
    } catch { /* archive history is best-effort — never blocks the CR detail view */ }

    return {
      crNumber,
      crLabel:       first.crLabel ?? crNumber,
      crDescription: first.crDescription,
      crManager:     first.crManager,
      application:   first.application,
      estimateDays:  first.estimateDays,
      notes:         first.notes,
      versionName:   version?.name ?? '',
      teams:         [...new Set(rows.map(r => r.team.name))],
      status,
      archiveHistory,
    };
  }

  // ── Delete a CR manually (MANAGERS only) ──────────────────────────────────
  async deleteCr(versionId: string, crNumber: string, user: { sub: string; role: string }): Promise<{ deleted: number }> {
    if (!MANAGERS.includes(user.role)) throw new ForbiddenException('רק מנהל גרסה יכול למחוק CR');
    const { count } = await prisma.versionCrAssignment.deleteMany({
      where: { versionId, crNumber },
    });
    return { deleted: count };
  }

  async patchCr(versionId: string, crNumber: string, patch: {
    qaEffortOverride?: number | null; isStandAlone?: boolean; reviewed?: boolean;
    isCore?: boolean; priorityTestDate?: string | null; notes?: string | null; urgent?: boolean;
    alreadyInProduction?: boolean;
    qaArrivalDate?: string | null; qaReceived?: boolean; qaReceivedAt?: string | null;
  }) {
    const data: any = {};
    if (patch.qaEffortOverride !== undefined) data.qaEffortOverride = patch.qaEffortOverride;
    if (patch.isStandAlone     !== undefined) data.isStandAlone     = patch.isStandAlone;
    if (patch.isCore           !== undefined) data.isCore           = patch.isCore;
    if (patch.priorityTestDate !== undefined) data.priorityTestDate = patch.priorityTestDate ? new Date(patch.priorityTestDate) : null;
    if (patch.notes            !== undefined) data.notes            = patch.notes;
    if (patch.urgent           !== undefined) data.urgent           = patch.urgent;
    if (patch.alreadyInProduction !== undefined) data.alreadyInProduction = patch.alreadyInProduction;
    if (patch.qaArrivalDate    !== undefined) data.qaArrivalDate    = patch.qaArrivalDate ? new Date(patch.qaArrivalDate) : null;
    if (patch.qaReceived       !== undefined) data.qaReceived       = patch.qaReceived;
    if (patch.qaReceivedAt     !== undefined) data.qaReceivedAt     = patch.qaReceivedAt ? new Date(patch.qaReceivedAt) : null;
    if (patch.reviewed         !== undefined) {
      data.reviewed = patch.reviewed;
      // marking a CR reviewed also acknowledges any pending post-approval scope-change flag
      if (patch.reviewed) data.needsAttention = false;
    }
    if (Object.keys(data).length === 0) return { ok: true };
    await prisma.versionCrAssignment.updateMany({
      where: { versionId, crNumber },
      data,
    });
    return { ok: true };
  }

  async clearForVersion(versionId: string, user: { sub: string; role: string }) {
    if (!MANAGERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');
    const { count } = await prisma.versionCrAssignment.deleteMany({ where: { versionId } });
    return { deleted: count };
  }

  async getVersionStats(versionId: string): Promise<{
    qaTaskCount: number;
    crCount: number;
    totalEstimateDays: number;
    qaFilteredEstimateDays: number;
    actualsCount: number;
    crsWithTasksCount: number;
    crsWithoutTasks: { crNumber: string; crLabel: string; reason: string }[];
    byTeam: {
      teamId: string;
      teamName: string;
      totalDays: number;
      qaFilteredDays: number;
      crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[];
    }[];
  }> {
    let rows: any[];
    try {
      rows = await (prisma.versionCrAssignment as any).findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: {
          crNumber: true, crLabel: true, teamId: true,
          qaEffort: true, teamEstimateDays: true, estimateDays: true, hasActual: true,
        },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
    } catch {
      // Fallback: teamEstimateDays column not yet migrated on this DB
      rows = await (prisma.versionCrAssignment as any).findMany({
        where: { versionId, syncStatus: { not: 'REMOVED' } },
        select: {
          crNumber: true, crLabel: true, teamId: true,
          qaEffort: true, estimateDays: true, hasActual: true,
        },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
    }

    const allTeams = await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true } });
    const teamNameById: Record<string, string> = {};
    allTeams.forEach(t => { teamNameById[t.id] = t.name; });

    const qaTeam = allTeams.find(t => t.name === 'QA Team');
    const qaTeamId = qaTeam?.id;

    // CRs where QA effort clears the configurable scope threshold (QA_EFFORT_THRESHOLD_DAYS)
    const scopeThresholdParam = await prisma.systemParam.findUnique({ where: { key: 'QA_EFFORT_THRESHOLD_DAYS' } });
    const scopeThreshold = Number(scopeThresholdParam?.value ?? '0') || 0;
    const qaCrSet = new Set<string>();
    for (const r of rows) {
      if (qaTeamId && r.teamId === qaTeamId && (r.qaEffort ?? 0) > scopeThreshold) {
        qaCrSet.add(r.crNumber);
      }
    }

    // Distinct CRs with QA effort > 0.5 (for qaTaskCount — unchanged)
    const qaTaskCrSet = new Set<string>();
    for (const r of rows) {
      if (qaTeamId && r.teamId === qaTeamId && (r.qaEffort ?? 0) > 0.5) {
        qaTaskCrSet.add(r.crNumber);
      }
    }

    // Sum teamEstimateDays across ALL teams including QA — matches
    // getScopeOverview's plannedDays definition ("sum of all team columns
    // that have investment estimates"); excluding the QA team here used to
    // make this tile's total disagree with the version-management module's
    // own overview for the same version. qaFilteredEstimateDays stays scoped
    // to non-QA teams (it feeds the separate "QA ניהול" tile's "days in CRs
    // that have QA effort" metric, not the overall investment total).
    // Falls back to summing estimateDays per distinct CR when teamEstimateDays is not yet synced.
    let totalEstimateDays = 0;
    let qaFilteredEstimateDays = 0;
    const hasTeamEstimates = rows.some(r => (r.teamEstimateDays ?? 0) > 0);

    if (hasTeamEstimates) {
      for (const r of rows) {
        const days = r.teamEstimateDays ?? 0;
        totalEstimateDays += days;
        if (r.teamId !== qaTeamId && qaCrSet.has(r.crNumber)) qaFilteredEstimateDays += days;
      }
    } else {
      // Fallback: use "סך כל הערכות" per distinct CR
      const crEstimates: Record<string, number> = {};
      for (const r of rows) {
        if (!(r.crNumber in crEstimates) && r.estimateDays != null) {
          crEstimates[r.crNumber] = r.estimateDays;
        }
      }
      totalEstimateDays        = Object.values(crEstimates).reduce((s, v) => s + v, 0);
      qaFilteredEstimateDays   = Object.entries(crEstimates)
        .filter(([cr]) => qaCrSet.has(cr))
        .reduce((s, [, v]) => s + v, 0);
    }

    // Count distinct CRs with Actuals = true
    const actualsCrSet = new Set<string>();
    for (const r of rows) {
      if (r.hasActual) actualsCrSet.add(r.crNumber);
    }

    // Pre-build CR estimate lookup (for fallback mode)
    const crEstimateMap: Record<string, number> = {};
    for (const r of rows) {
      if (!(r.crNumber in crEstimateMap) && r.estimateDays != null) {
        crEstimateMap[r.crNumber] = r.estimateDays;
      }
    }

    // Per-team breakdown (exclude QA Team — it's shown via qaEffort)
    // When teamEstimateDays is available: use per-team values.
    // Fallback: show CRs per team using the CR's total estimateDays as the display value.
    const teamMap: Record<string, {
      teamId: string; teamName: string; totalDays: number; qaFilteredDays: number;
      crs: { crNumber: string; crLabel: string; teamDays: number; hasQa: boolean }[];
    }> = {};

    for (const r of rows) {
      if (r.teamId === qaTeamId) continue;
      const teamDays = r.teamEstimateDays ?? 0;
      const displayDays = teamDays > 0 ? teamDays : (crEstimateMap[r.crNumber] ?? 0);
      if (displayDays <= 0) continue;
      const hasQa = qaCrSet.has(r.crNumber);
      if (!teamMap[r.teamId]) {
        teamMap[r.teamId] = {
          teamId: r.teamId, teamName: teamNameById[r.teamId] ?? r.teamId,
          totalDays: 0, qaFilteredDays: 0, crs: [],
        };
      }
      teamMap[r.teamId].totalDays += displayDays;
      if (hasQa) teamMap[r.teamId].qaFilteredDays += displayDays;
      teamMap[r.teamId].crs.push({
        crNumber: r.crNumber,
        crLabel:  r.crLabel ?? r.crNumber,
        teamDays: Math.round(displayDays * 100) / 100,
        hasQa,
      });
    }

    const byTeam = Object.values(teamMap)
      .map(t => ({
        ...t,
        totalDays:       Math.round(t.totalDays * 10) / 10,
        qaFilteredDays:  Math.round(t.qaFilteredDays * 10) / 10,
      }))
      .sort((a, b) => b.totalDays - a.totalDays);

    const distinctCrCount = new Set(rows.map(r => r.crNumber)).size;

    // How many of the in-scope CRs actually made it into the execution plan
    // as real Task rows yet, and — for the ones that haven't — why: no CR
    // ever converts to a Task on its own, that happens when a team's CrPlan
    // is approved and its tasks scheduled, so "no task yet" almost always
    // traces back to a specific step in that pipeline (plan not submitted /
    // not approved / approved but not yet scheduled), not a data bug.
    const crLabelByNumber: Record<string, string> = {};
    for (const r of rows) if (!(r.crNumber in crLabelByNumber)) crLabelByNumber[r.crNumber] = r.crLabel ?? r.crNumber;

    const [taskCrRows, crPlanRows] = await Promise.all([
      prisma.task.findMany({
        where: { versionId, crNumber: { not: null } },
        select: { crNumber: true },
        distinct: ['crNumber'],
      }),
      prisma.crPlan.findMany({
        where: { versionId },
        select: { crNumber: true, notNeededForPlan: true, removedByTeam: true, planApproved: true },
      }),
    ]);
    const crsWithTasks = new Set(taskCrRows.map(t => t.crNumber as string));

    const crPlansByCr = new Map<string, typeof crPlanRows>();
    for (const p of crPlanRows) {
      if (!crPlansByCr.has(p.crNumber)) crPlansByCr.set(p.crNumber, []);
      crPlansByCr.get(p.crNumber)!.push(p);
    }

    const crsWithoutTasks: { crNumber: string; crLabel: string; reason: string }[] = [];
    for (const crNumber of Array.from(new Set(rows.map(r => r.crNumber)))) {
      if (crsWithTasks.has(crNumber)) continue;
      const plans = crPlansByCr.get(crNumber) ?? [];
      let reason: string;
      if (plans.length === 0) {
        reason = 'הצוות טרם הגיש תוכנית CR';
      } else if (plans.every(p => p.notNeededForPlan || p.removedByTeam)) {
        reason = 'סומן כלא נדרש למשימה';
      } else if (plans.some(p => p.planApproved)) {
        reason = 'התוכנית אושרה — טרם שובצה לתוכנית העלייה';
      } else {
        reason = 'תוכנית הצוות טרם אושרה';
      }
      crsWithoutTasks.push({ crNumber, crLabel: crLabelByNumber[crNumber] ?? crNumber, reason });
    }

    return {
      qaTaskCount:            qaTaskCrSet.size,
      crCount:                distinctCrCount,
      totalEstimateDays:      Math.round(totalEstimateDays * 10) / 10,
      qaFilteredEstimateDays: Math.round(qaFilteredEstimateDays * 10) / 10,
      actualsCount:           actualsCrSet.size,
      crsWithTasksCount:      distinctCrCount - crsWithoutTasks.length,
      crsWithoutTasks,
      byTeam,
    };
  }

  // ── Scope & reach overview — the version-management module's landing page ──
  // Distinct from getVersionStats above (which drives the CR-plan estimate
  // breakdown by team): this is the tile-row + developments-treemap data for
  // the module's dashboard. crCount/coreCrCount/saCrCount/targetCrCount are
  // per-CR (deduplicated across teams); plannedDays sums teamEstimateDays
  // across every team-row (a CR spanning N teams contributes N estimates,
  // per the product decision to sum "all team columns that have investment
  // estimates"); actualDays sums actualEffortDays once per distinct CR (the
  // Actuals column is CR-level, not per-team, so summing per row would
  // double/triple-count a multi-team CR).
  async getScopeOverview(versionId: string) {
    const rows = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: {
        crNumber: true, crLabel: true, application: true, teamId: true,
        isStandAlone: true, needsAttention: true,
        teamEstimateDays: true, estimateDays: true,
        actualEffortDays: true,
        team: { select: { name: true } },
      } as any,
    });

    const byCr = new Map<string, (typeof rows)[number]>();
    for (const r of rows) if (!byCr.has(r.crNumber)) byCr.set(r.crNumber, r);
    const crList = Array.from(byCr.values());

    // Effective SA status must match QaAssignmentView's own logic: a tester's
    // individual QaAssignment.isStandAlone (set via the assignment screen's SA
    // toggle) overrides the CR-level VersionCrAssignment.isStandAlone default
    // whenever it's non-null — and the assignment screen writes to THAT field,
    // not the CR-level one, once an assignment exists. Reading only the CR-
    // level flag here undercounts SA (and inflates core) for any version where
    // testers are already assigned.
    const assignments = await prisma.qaAssignment.findMany({
      where: { versionId },
      select: { crNumber: true, isStandAlone: true },
    });
    const saOverrideByCr = new Map(assignments.map(a => [a.crNumber, a.isStandAlone]));
    const isEffectiveSA = (c: any): boolean => {
      const override = saOverrideByCr.get(c.crNumber);
      return override !== undefined && override !== null ? override : !!c.isStandAlone;
    };

    const crCount     = crList.length;
    // "Core" isn't its own manually-set flag — a CR is core iff it's NOT in
    // the Stand Alone cycle. Derived from effective isStandAlone rather than
    // the separate (manually-toggled, mostly unused) isCore field.
    const saCrCount   = crList.filter(isEffectiveSA).length;
    const coreCrCount = crCount - saCrCount;
    const targetCrCount = crList.filter(c => TARGET_CR_PATTERN.test(c.crLabel ?? '')).length;

    let plannedDays = 0;
    for (const r of rows) plannedDays += (r as any).teamEstimateDays ?? 0;

    let actualDays = 0;
    for (const c of crList) actualDays += (c as any).actualEffortDays ?? 0;

    const ratioPct = plannedDays > 0 ? Math.round((actualDays / plannedDays) * 10000) / 100 : null;

    // CR list for the "סה״כ CR-ים" tile's list modal — built from these same
    // rows (not a separate findForVersion call, which additionally drops CRs
    // whose only team has requiresPlan=false) so the list the tile opens
    // always matches the count printed on the tile itself.
    const teamsByCr = new Map<string, Map<string, string>>(); // crNumber -> teamId -> teamName
    for (const r of rows) {
      if (!teamsByCr.has(r.crNumber)) teamsByCr.set(r.crNumber, new Map());
      teamsByCr.get(r.crNumber)!.set((r as any).teamId, (r as any).team.name);
    }
    const crs = crList.map((c: any) => ({
      crNumber: c.crNumber,
      crLabel: c.crLabel,
      needsAttention: rows.some((r: any) => r.crNumber === c.crNumber && r.needsAttention),
      actualEffortDays: c.actualEffortDays != null ? Math.round(c.actualEffortDays * 100) / 100 : null,
      teams: Array.from((teamsByCr.get(c.crNumber) ?? new Map()).entries()).map(([teamId, teamName]) => ({ teamId, teamName })),
    }));

    return {
      crCount, coreCrCount, saCrCount, targetCrCount,
      plannedDays: Math.round(plannedDays * 100) / 100,
      actualDays:  Math.round(actualDays * 100) / 100,
      ratioPct,
      crs,
    };
  }
}
