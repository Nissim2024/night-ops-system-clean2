import { Injectable, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

// Excel column headers per DB team name — same map as import.service
const TEAM_COLUMNS: Record<string, string[]> = {
  'CAWA Team':               ['CAWA'],
  'CRM Dev Team':            ['CRM'],
  'Cyber Security Team':     ['CYBER', 'Cyber PT', 'אבט"מ'],
  'DBA Team':                ['DBA'],
  'EAI Team':                ['EAI'],
  'ERP Team':                ['ERP'],
  'ETL Team':                ['ETL'],
  'IVR Team':                ['IVR'],
  'NC Team':                 ['NC'],
  'NETCOL Team':             ['NETCOL'],
  'OSS Team':                ['OSS'],
  'PrintBoss Team':          ['PRINTBOS'],
  'Provisioning Team':       ['PROV'],
  'PT Team':                 ['PT'],
  'QA Team':                 ['QA', 'QA BI', 'QA מוצרים'],
  'BI Team':                 ['BI'],
  'Setup Team':              ['SETUP', 'Setup יש'],
  'TV Team':                 ['TV'],
  'Web Dev Team':            ['WEB'],
  'NETC Team':               ['WIZ'],
  'Billing Operations Team': ['תפעול בילינג'],
};

@Injectable()
export class VersionCrAssignmentsService {

  async findForVersion(versionId: string, user: { sub: string; role: string }) {
    // Exclude assignments from teams that don't require plan submission
    const exemptRows: any[] = await prisma.$queryRawUnsafe(
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

  async syncFromExcel(versionId: string): Promise<{ synced: number; teamsUpdated: number; skipped: string }> {
    const param = await prisma.systemParam.findUnique({ where: { key: 'EXCEL_FILE_PATH' } });
    const filePath = param?.value?.trim();
    if (!filePath) throw new BadRequestException('נתיב קובץ CR_LIST לא הוגדר בפרמטרי המערכת (EXCEL_FILE_PATH)');
    if (!fs.existsSync(filePath)) throw new BadRequestException(`הקובץ לא נמצא: ${filePath}`);

    const version = await prisma.version.findUnique({ where: { id: versionId }, select: { name: true } });
    if (!version) throw new BadRequestException('גרסה לא נמצאה');

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

    const crCol          = colIdx('# CR');
    const titleCol       = colIdx('כותרת');
    const verCol         = colIdx('גרסה');
    const statusCol      = colIdx('סטטוס');
    const appCol         = colIdx('מאפיין');
    const projectCol     = colIdx('פרויקט');
    const estimateCol    = colIdx('סך כל הערכות');
    const actualsCol     = colIdx('Actuals');
    const COL_DESCRIPTION = 5;
    const COL_MANAGER     = 9;

    // Get all active teams for ID resolution
    const allTeams = await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true } });
    const teamIdByName: Record<string, string> = {};
    allTeams.forEach(t => { teamIdByName[t.name] = t.id; });

    const QA_TEAM_NAME = 'QA Team';
    const parseDay = (v: any) => { const n = parseFloat(String(v ?? '0').replace(/[^\d.]/g, '')); return isNaN(n) ? 0 : n; };

    // ── Pass 1: determine eligible CRs (must have BOTH QA effort AND non-QA team effort) ──
    // A CR is a "mixed team CR" only when QA is involved AND at least one other team has work days.
    const qaCRs    = new Set<string>(); // CRs with QA effort >= 1 day
    const nonQaCRs = new Set<string>(); // CRs with at least one non-QA team effort > 0.3 days

    for (const [teamName, teamCols] of Object.entries(TEAM_COLUMNS)) {
      const teamColIdxs = teamCols.map(colIdx).filter(i => i !== -1);
      if (teamColIdxs.length === 0) continue;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] as any[];
        if (String(row[verCol] ?? '').trim() !== version.name) continue;
        if (String(row[statusCol] ?? '').trim() === 'מבוטל') continue;

        const crNumber = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
        const title    = titleCol !== -1 ? String(row[titleCol] ?? '').trim() : '';
        if (!crNumber || !title) continue;

        if (teamName === QA_TEAM_NAME) {
          const qaDay = teamColIdxs.length > 0 ? parseDay(row[teamColIdxs[0]]) : 0;
          if (qaDay >= 1) qaCRs.add(crNumber);
        } else {
          const involved = teamColIdxs.some(ci => parseDay(row[ci]) > 0.3);
          if (involved) nonQaCRs.add(crNumber);
        }
      }
    }

    // Only CRs appearing in BOTH sets enter the version scope
    const eligibleCRs = new Set([...qaCRs].filter(cr => nonQaCRs.has(cr)));

    // Pre-compute per-CR values from non-team-specific columns (same for all teams)
    const crEstimateDays: Record<string, number | null> = {};
    const crHasActual:    Record<string, boolean>       = {};
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
        if (cell === 'v' || cell === '✓' || cell === 'x' || cell === 'yes' || cell === 'כן') {
          crHasActual[crNumber] = true;
        }
      }
    }

    // ── Pass 2: collect assignments for eligible CRs only ──
    type Assignment = {
      crNumber: string; crLabel: string; teamId: string;
      crManager: string; crDescription: string; application: string; project: string;
      qaEffort?: number;    // DAYS — only for QA Team rows
      estimateDays?: number | null;
      hasActual?: boolean;
    };
    const assignments: Assignment[] = [];
    const seen = new Set<string>(); // "crNumber|teamId"

    for (const [teamName, teamCols] of Object.entries(TEAM_COLUMNS)) {
      const teamId = teamIdByName[teamName];
      if (!teamId) continue;
      const teamColIdxs = teamCols.map(colIdx).filter(i => i !== -1);
      if (teamColIdxs.length === 0) continue;

      for (let r = headerRowIdx + 1; r < rows.length; r++) {
        const row = rows[r] as any[];
        if (String(row[verCol] ?? '').trim() !== version.name) continue;
        if (String(row[statusCol] ?? '').trim() === 'מבוטל') continue;

        const crNumber = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
        const title    = titleCol !== -1 ? String(row[titleCol] ?? '').trim() : '';
        if (!crNumber || !title) continue;

        // Skip CRs that don't satisfy the mixed-team condition
        if (!eligibleCRs.has(crNumber)) continue;

        let qaEffortDays: number | undefined;

        if (teamName === QA_TEAM_NAME) {
          const qaDay = teamColIdxs.length > 0 ? parseDay(row[teamColIdxs[0]]) : 0;
          if (qaDay < 1) continue;
          qaEffortDays = qaDay;
        } else {
          const involved = teamColIdxs.some(ci => parseDay(row[ci]) > 0.3);
          if (!involved) continue;
        }

        const key = `${crNumber}|${teamId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        assignments.push({
          crNumber,
          crLabel:       `${crNumber} - ${title}`,
          teamId,
          crManager:     String(row[COL_MANAGER]     ?? '').trim(),
          crDescription: String(row[COL_DESCRIPTION] ?? '').trim(),
          application:   appCol     !== -1 ? String(row[appCol]     ?? '').trim() : '',
          project:       projectCol !== -1 ? String(row[projectCol] ?? '').trim() : '',
          ...(qaEffortDays !== undefined ? { qaEffort: qaEffortDays } : {}),
          estimateDays: crEstimateDays[crNumber] ?? null,
          hasActual:    crHasActual[crNumber] ?? false,
        });
      }
    }

    // Upsert — update existing records, insert new ones (no delete of existing data)
    const now = new Date();
    let synced = 0;
    const teamsTouched = new Set<string>();

    for (const a of assignments) {
      await prisma.versionCrAssignment.upsert({
        where: { versionId_crNumber_teamId: { versionId, crNumber: a.crNumber, teamId: a.teamId } },
        create: {
          versionId,
          crNumber:      a.crNumber,
          crLabel:       a.crLabel,
          teamId:        a.teamId,
          crManager:     a.crManager || null,
          crDescription: a.crDescription || null,
          application:   a.application || null,
          ...(a.project ? { project: a.project } : {}),
          syncedAt:      now,
          ...(a.qaEffort !== undefined ? { qaEffort: a.qaEffort } : {}),
          estimateDays:  a.estimateDays ?? null,
          hasActual:     a.hasActual ?? false,
        } as any,
        update: {
          crLabel:       a.crLabel,
          crManager:     a.crManager || null,
          crDescription: a.crDescription || null,
          application:   a.application || null,
          ...(a.project ? { project: a.project } : {}),
          syncedAt:      now,
          ...(a.qaEffort !== undefined ? { qaEffort: a.qaEffort } : {}),
          estimateDays:  a.estimateDays ?? null,
          hasActual:     a.hasActual ?? false,
        } as any,
      });
      synced++;
      teamsTouched.add(a.teamId);
    }

    // Remove assignments no longer in file.
    // If a CrPlan exists for a stale CR, auto-mark it notNeededForPlan so it no longer
    // blocks status transitions — instead of keeping the VCA alive (which caused ghost CRs
    // to permanently block CR_REVIEW→REFINING even after the CR was removed from Excel).
    const currentKeys = new Set(assignments.map(a => `${a.crNumber}|${a.teamId}`));
    const existing = await prisma.versionCrAssignment.findMany({ where: { versionId }, select: { id: true, crNumber: true, teamId: true } });
    const staleIds = existing.filter(e => !currentKeys.has(`${e.crNumber}|${e.teamId}`)).map(e => e.id);
    let autoMarked = 0;
    if (staleIds.length > 0) {
      const staleCrNumbers = existing.filter(e => staleIds.includes(e.id)).map(e => e.crNumber);
      const result = await prisma.crPlan.updateMany({
        where: { versionId, crNumber: { in: staleCrNumbers }, notNeededForPlan: false },
        data: { notNeededForPlan: true },
      });
      autoMarked = result.count;
      await prisma.versionCrAssignment.deleteMany({ where: { id: { in: staleIds } } });
    }

    return {
      synced,
      teamsUpdated: teamsTouched.size,
      skipped: staleIds.length > 0
        ? `הוסרו ${staleIds.length} CR שבוטלו / נמחקו מהקובץ${autoMarked > 0 ? ` (${autoMarked} תוכניות סומנו כ"לא נדרש")` : ''}`
        : '',
    };
  }

  async patchCr(versionId: string, crNumber: string, patch: { qaEffortOverride?: number | null; isStandAlone?: boolean }) {
    const data: any = {};
    if (patch.qaEffortOverride !== undefined) data.qaEffortOverride = patch.qaEffortOverride;
    if (patch.isStandAlone     !== undefined) data.isStandAlone     = patch.isStandAlone;
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
    totalEstimateDays: number;
    actualsCount: number;
  }> {
    const rows: any[] = await (prisma.versionCrAssignment as any).findMany({
      where: { versionId },
      select: { crNumber: true, teamId: true, qaEffort: true, estimateDays: true, hasActual: true },
    });

    const allTeams = await prisma.team.findMany({ where: { name: 'QA Team' }, select: { id: true } });
    const qaTeamId = allTeams[0]?.id;

    // Distinct CRs with QA effort > 0.5
    const qaCrSet = new Set<string>();
    for (const r of rows) {
      if (qaTeamId && r.teamId === qaTeamId && (r.qaEffort ?? 0) > 0.5) {
        qaCrSet.add(r.crNumber);
      }
    }

    // Sum estimate days per distinct CR (avoid double-counting across teams)
    const crEstimates: Record<string, number> = {};
    for (const r of rows) {
      if (!(r.crNumber in crEstimates) && r.estimateDays != null) {
        crEstimates[r.crNumber] = r.estimateDays;
      }
    }
    const totalEstimateDays = Object.values(crEstimates).reduce((s, v) => s + v, 0);

    // Count distinct CRs with Actuals = true
    const actualsCrSet = new Set<string>();
    for (const r of rows) {
      if (r.hasActual) actualsCrSet.add(r.crNumber);
    }

    return {
      qaTaskCount: qaCrSet.size,
      totalEstimateDays: Math.round(totalEstimateDays * 10) / 10,
      actualsCount: actualsCrSet.size,
    };
  }
}
