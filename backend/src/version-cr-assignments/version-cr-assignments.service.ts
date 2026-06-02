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
    if (MANAGERS.includes(user.role)) {
      return prisma.versionCrAssignment.findMany({
        where: { versionId },
        include: { team: { select: { id: true, name: true } } },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
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

    const crCol     = colIdx('# CR');
    const titleCol  = colIdx('כותרת');
    const verCol    = colIdx('גרסה');
    const statusCol = colIdx('סטטוס');
    const appCol    = colIdx('מאפיין');
    const COL_DESCRIPTION = 5;
    const COL_MANAGER     = 9;

    // Get all active teams for ID resolution
    const allTeams = await prisma.team.findMany({ where: { active: true }, select: { id: true, name: true } });
    const teamIdByName: Record<string, string> = {};
    allTeams.forEach(t => { teamIdByName[t.name] = t.id; });

    // Collect assignments: { crNumber, crLabel, teamId, crManager, crDescription, application }
    type Assignment = {
      crNumber: string; crLabel: string; teamId: string;
      crManager: string; crDescription: string; application: string;
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

        const involved = teamColIdxs.some(ci => {
          const val = parseFloat(String(row[ci] ?? '0').replace(/[^\d.]/g, ''));
          return !isNaN(val) && val > 0.3;
        });
        if (!involved) continue;

        const crNumber = crCol !== -1 ? String(row[crCol] ?? '').trim() : '';
        const title    = titleCol !== -1 ? String(row[titleCol] ?? '').trim() : '';
        if (!crNumber || !title) continue;

        const key = `${crNumber}|${teamId}`;
        if (seen.has(key)) continue;
        seen.add(key);

        assignments.push({
          crNumber,
          crLabel:       `${crNumber} - ${title}`,
          teamId,
          crManager:     String(row[COL_MANAGER]     ?? '').trim(),
          crDescription: String(row[COL_DESCRIPTION] ?? '').trim(),
          application:   appCol !== -1 ? String(row[appCol] ?? '').trim() : '',
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
          syncedAt:      now,
        },
        update: {
          crLabel:       a.crLabel,
          crManager:     a.crManager || null,
          crDescription: a.crDescription || null,
          application:   a.application || null,
          syncedAt:      now,
        },
      });
      synced++;
      teamsTouched.add(a.teamId);
    }

    // Remove assignments that are no longer in the file (CR removed or cancelled)
    const currentKeys = new Set(assignments.map(a => `${a.crNumber}|${a.teamId}`));
    const existing = await prisma.versionCrAssignment.findMany({ where: { versionId }, select: { id: true, crNumber: true, teamId: true } });
    const toDelete = existing.filter(e => !currentKeys.has(`${e.crNumber}|${e.teamId}`));
    if (toDelete.length > 0) {
      await prisma.versionCrAssignment.deleteMany({ where: { id: { in: toDelete.map(e => e.id) } } });
    }

    return {
      synced,
      teamsUpdated: teamsTouched.size,
      skipped: toDelete.length > 0 ? `הוסרו ${toDelete.length} CR שבוטלו / נמחקו מהקובץ` : '',
    };
  }

  async clearForVersion(versionId: string, user: { sub: string; role: string }) {
    if (!MANAGERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');
    const { count } = await prisma.versionCrAssignment.deleteMany({ where: { versionId } });
    return { deleted: count };
  }
}
