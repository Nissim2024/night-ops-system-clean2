import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as fs from 'fs';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function getOracleConfig() {
  const keys = ['ORACLE_ENABLED', 'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'];
  const rows = await prisma.systemParam.findMany({ where: { key: { in: keys } } });
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]));
  return {
    enabled:       map['ORACLE_ENABLED'] === 'true',
    user:          map['ORACLE_USER']          || process.env.ORACLE_USER          || '',
    password:      map['ORACLE_PASSWORD']      || process.env.ORACLE_PASSWORD      || '',
    connectString: map['ORACLE_CONNECT_STRING'] || process.env.ORACLE_CONNECT_STRING || '',
  };
}

const QC_RELEASES_SQL = `
  select rr.rel_id, rr.rel_parent_id, rr.rel_name, rr.rel_start_date, rr.rel_end_date, rr.rel_user_01,
         rc.rcyc_id, rc.rcyc_name, rc.rcyc_start_date, rr.rel_user_03
  from releases rr, release_cycles rc
  where rr.rel_id=rc.rcyc_parent_id
    and rc.rcyc_name in ('Dress Rehearsal','Go Live')
    and rr.rel_start_date>sysdate-360
  order by rc.rcyc_start_date desc
`;

interface OracleRow {
  REL_ID: number;
  REL_PARENT_ID: number | null;
  REL_NAME: string;
  REL_START_DATE: Date | null;
  REL_END_DATE: Date | null;
  REL_USER_01: string | null;
  RCYC_ID: number;
  RCYC_NAME: string;
  RCYC_START_DATE: Date | null;
  REL_USER_03: Date | null;
}

interface ReleaseGroup {
  relId: number;
  relParentId: number | null;
  relName: string;
  relStartDate: Date | null;
  relEndDate: Date | null;
  relTeam: string | null;
  filterDate: Date | null;
  goLiveCycleId: number | null;
  goLiveDate: Date | null;
  rehearsalCycleId: number | null;
  rehearsalDate: Date | null;
}

@Injectable()
export class QcReleasesService implements OnModuleInit {
  private readonly logger = new Logger(QcReleasesService.name);

  async onModuleInit() {
    await this.sync().catch(err => {
      this.logger.warn(`Startup QC sync skipped: ${err.message}`);
    });
  }

  async sync(): Promise<{ synced: number; error?: string }> {
    const cfg = await getOracleConfig();
    if (!cfg.enabled) {
      this.logger.log('Oracle disabled — skipping QC releases sync');
      return { synced: 0, error: 'Oracle not enabled' };
    }

    let connection: any;
    try {
      const oracledb = await import('oracledb');
      oracledb.default.outFormat = oracledb.default.OUT_FORMAT_OBJECT;

      connection = await oracledb.default.getConnection({
        user:          cfg.user,
        password:      cfg.password,
        connectString: cfg.connectString,
      });

      const result = await connection.execute(QC_RELEASES_SQL);
      const rows: OracleRow[] = result.rows || [];

      // Group two cycle rows per release into one record
      const grouped = new Map<number, ReleaseGroup>();
      for (const row of rows) {
        if (!grouped.has(row.REL_ID)) {
          grouped.set(row.REL_ID, {
            relId: row.REL_ID,
            relParentId: row.REL_PARENT_ID ?? null,
            relName: row.REL_NAME,
            relStartDate: row.REL_START_DATE ?? null,
            relEndDate: row.REL_END_DATE ?? null,
            relTeam: row.REL_USER_01 ?? null,
            filterDate: row.REL_USER_03 ?? null,
            goLiveCycleId: null,
            goLiveDate: null,
            rehearsalCycleId: null,
            rehearsalDate: null,
          });
        }
        const g = grouped.get(row.REL_ID)!;
        if (row.RCYC_NAME === 'Go Live') {
          g.goLiveCycleId = row.RCYC_ID;
          g.goLiveDate = row.RCYC_START_DATE ?? null;
        } else if (row.RCYC_NAME === 'Dress Rehearsal') {
          g.rehearsalCycleId = row.RCYC_ID;
          g.rehearsalDate = row.RCYC_START_DATE ?? null;
        }
      }

      for (const g of grouped.values()) {
        await prisma.qcRelease.upsert({
          where: { relId: g.relId },
          create: {
            relId: g.relId,
            relParentId: g.relParentId,
            relName: g.relName,
            relStartDate: g.relStartDate,
            relEndDate: g.relEndDate,
            relTeam: g.relTeam,
            filterDate: g.filterDate,
            goLiveCycleId: g.goLiveCycleId,
            goLiveDate: g.goLiveDate,
            rehearsalCycleId: g.rehearsalCycleId,
            rehearsalDate: g.rehearsalDate,
            lastSyncAt: new Date(),
          },
          update: {
            relParentId: g.relParentId,
            relName: g.relName,
            relStartDate: g.relStartDate,
            relEndDate: g.relEndDate,
            relTeam: g.relTeam,
            filterDate: g.filterDate,
            goLiveCycleId: g.goLiveCycleId,
            goLiveDate: g.goLiveDate,
            rehearsalCycleId: g.rehearsalCycleId,
            rehearsalDate: g.rehearsalDate,
            lastSyncAt: new Date(),
            active: true,
          },
        });
      }

      this.logger.log(`QC releases synced: ${grouped.size} releases`);
      return { synced: grouped.size };
    } catch (err: any) {
      this.logger.error(`Oracle sync error: ${err.message}`);
      throw err;
    } finally {
      if (connection) await connection.close().catch(() => {});
    }
  }

  // Returns only future/active releases for the new-version dropdown.
  // Hides a release when ANY of these is true:
  //   1. goLiveDate exists and is in the past (already went live)
  //   2. Every linked Version is COMPLETED or ROLLED_BACK (fully done)
  async findActive() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const releases = await prisma.qcRelease.findMany({
      where: { active: true, filterDate: { not: null } },
      include: { versions: { select: { status: true } } },
      orderBy: [
        { goLiveDate: { sort: 'asc', nulls: 'last' } },
        { relName: 'asc' },
      ],
    });

    return releases
      .filter(r => {
        // Rule 1: goLiveDate already passed → hide
        if (r.goLiveDate && new Date(r.goLiveDate) < today) return false;
        // Rule 2: all linked versions are done → hide
        if (r.versions.length > 0 && r.versions.every(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status))) return false;
        return true;
      })
      .map(({ versions: _v, ...r }) => r);
  }

  // Returns all releases (for admin view)
  async findAll() {
    return prisma.qcRelease.findMany({
      orderBy: { relStartDate: 'desc' },
    });
  }

  async toggleActive(id: string) {
    const release = await prisma.qcRelease.findUnique({ where: { id } });
    if (!release) throw new Error('לא נמצאה גרסת QC');
    return prisma.qcRelease.update({ where: { id }, data: { active: !release.active } });
  }

  // Deterministic integer hash for a version name (used as synthetic relId for CR_LIST imports)
  private nameHash(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0;
    return (h >>> 1) || 1; // logical right-shift → always in [1, 2^31-1], within PostgreSQL INT range
  }

  // Reads unique version names from the CR_LIST Excel (column 'גרסה'), filters by year suffix,
  // and upserts each as a QcRelease — only adds delta, never deletes existing records.
  async syncFromExcel(buffer: Buffer, fromYear = 2026): Promise<{ synced: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

    // Find header row (same pattern as import.service.ts)
    const REQUIRED_COLS = ['# CR', 'כותרת', 'גרסה'];
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(10, rows.length); i++) {
      const row = rows[i].map((h: any) => String(h ?? '').trim());
      if (REQUIRED_COLS.every(col => row.includes(col))) { headerRowIdx = i; break; }
    }
    if (headerRowIdx === -1) {
      const sample = rows[0]?.slice(0, 8).map((h: any) => String(h ?? '').trim()).join(', ') ?? '';
      throw new Error(`מבנה הקובץ אינו תקין — עמודות "# CR", "כותרת", "גרסה" חסרות. עמודות שנמצאו: ${sample}`);
    }

    const headers: string[] = rows[headerRowIdx].map((h: any) => String(h ?? '').trim());
    const colIdx = (name: string) => headers.findIndex(h => h === name);
    const verCol    = colIdx('גרסה');
    const statusCol = colIdx('סטטוס');

    // Filter versions by year: last 3 chars of name must match last 3 digits of fromYear (e.g. "026")
    const expectedSuffix = String(fromYear).slice(-3);
    const versionNames = new Set<string>();

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const vName = String(row[verCol] ?? '').trim();
      if (!vName) continue;
      if (statusCol !== -1 && String(row[statusCol] ?? '').trim() === 'מבוטל') continue;
      if (vName.slice(-3) !== expectedSuffix) continue;
      versionNames.add(vName);
    }

    // Upsert each unique version name — delta only (never deletes existing)
    // filterDate = Dec 31 of the year so the release stays active in the dropdown until year end
    const yearEnd = new Date(fromYear, 11, 31);

    let synced = 0;
    for (const relName of versionNames) {
      const relId = this.nameHash(relName);
      await prisma.qcRelease.upsert({
        where: { relId },
        create: { relId, relName, filterDate: yearEnd, lastSyncAt: new Date() },
        update: { relName, lastSyncAt: new Date(), active: true },
      });
      synced++;
    }

    this.logger.log(`QC releases synced from CR_LIST: ${synced} versions for year ${fromYear}`);
    return { synced };
  }

  async syncFromFilePath(fromYear = 2026): Promise<{ synced: number }> {
    const param = await prisma.systemParam.findUnique({ where: { key: 'EXCEL_FILE_PATH' } });
    const filePath = param?.value?.trim();
    if (!filePath) throw new Error('נתיב קובץ Excel לא הוגדר בפרמטרי המערכת (EXCEL_FILE_PATH)');
    if (!fs.existsSync(filePath)) throw new Error(`הקובץ לא נמצא: ${filePath}`);
    const buffer = fs.readFileSync(filePath);
    return this.syncFromExcel(buffer, fromYear);
  }
}
