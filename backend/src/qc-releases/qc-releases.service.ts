import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import { readQcFile, resolveQcFilePath, SmbAccessError } from './smb-file-reader';

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

// Validates Oracle config and verifies Thick Mode is active before returning oracledb module.
async function getOracleDb() {
  const cfg = await getOracleConfig();
  if (!cfg.enabled) return null;

  if (!cfg.user || !cfg.password || !cfg.connectString) {
    throw new Error(
      'Configuration Error: Oracle is enabled but one or more required SystemParams are missing.\n' +
      'Required: ORACLE_USER, ORACLE_PASSWORD, ORACLE_CONNECT_STRING'
    );
  }

  // Thick Mode must already be initialized by main.ts (ORACLE_LIB_DIR).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const oracledb = require('oracledb');
  if (oracledb.thin === true) {
    throw new Error(
      'Oracle is in Thin Mode — Oracle 11g is not supported in Thin Mode (NJS-138).\n' +
      'Set ORACLE_LIB_DIR to the Oracle Client library directory and restart.'
    );
  }

  oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
  return { oracledb, cfg };
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

// Oracle date fields can arrive as strings ("2026-03-20") or Date objects.
// Prisma DateTime requires a proper Date — convert safely.
function toDateTime(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return val;
  const d = new Date(typeof val === 'string' && val.length === 10 ? `${val}T00:00:00.000Z` : val);
  return isNaN(d.getTime()) ? null : d;
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
    const oracle = await getOracleDb();
    if (!oracle) {
      this.logger.log('Oracle disabled — skipping QC releases sync');
      return { synced: 0, error: 'Oracle not enabled' };
    }

    const { oracledb, cfg } = oracle;
    let connection: any;
    try {
      connection = await oracledb.getConnection({
        user:          cfg.user,
        password:      cfg.password,
        connectString: cfg.connectString,
      });

      const result = await connection.execute(QC_RELEASES_SQL);
      const rows: OracleRow[] = result.rows || [];

      const grouped = new Map<number, ReleaseGroup>();
      for (const row of rows) {
        if (!grouped.has(row.REL_ID)) {
          grouped.set(row.REL_ID, {
            relId: row.REL_ID,
            relParentId: row.REL_PARENT_ID ?? null,
            relName: row.REL_NAME,
            relStartDate: toDateTime(row.REL_START_DATE),
            relEndDate:   toDateTime(row.REL_END_DATE),
            relTeam: row.REL_USER_01 ?? null,
            filterDate: toDateTime(row.REL_USER_03),
            goLiveCycleId: null,
            goLiveDate: null,
            rehearsalCycleId: null,
            rehearsalDate: null,
          });
        }
        const g = grouped.get(row.REL_ID)!;
        if (row.RCYC_NAME === 'Go Live') {
          g.goLiveCycleId = row.RCYC_ID;
          g.goLiveDate = toDateTime(row.RCYC_START_DATE);
        } else if (row.RCYC_NAME === 'Dress Rehearsal') {
          g.rehearsalCycleId = row.RCYC_ID;
          g.rehearsalDate = toDateTime(row.RCYC_START_DATE);
        }
      }

      for (const g of grouped.values()) {
        const fields = {
          relParentId: g.relParentId, relName: g.relName,
          relStartDate: g.relStartDate, relEndDate: g.relEndDate, relTeam: g.relTeam,
          filterDate: g.filterDate, goLiveCycleId: g.goLiveCycleId, goLiveDate: g.goLiveDate,
          rehearsalCycleId: g.rehearsalCycleId, rehearsalDate: g.rehearsalDate,
          lastSyncAt: new Date(), active: true,
        };

        // A release may already exist under a placeholder relId from the
        // Excel-based fallback sync (syncFromExcel uses a name hash, not the
        // real Oracle rel_id, and never has cycle IDs). Reconcile that row in
        // place — by relName, not relId — so versions already linked to it
        // (via qcReleaseId) get the real relId + cycle IDs instead of being
        // left pointing at a stale, cycle-less duplicate.
        const existingByRelId = await prisma.qcRelease.findUnique({ where: { relId: g.relId } });
        const placeholder = existingByRelId ? null : await prisma.qcRelease.findFirst({
          where: { relName: g.relName, relId: { not: g.relId } },
        });

        let canonicalId: string;
        if (placeholder) {
          const updated = await prisma.qcRelease.update({ where: { id: placeholder.id }, data: { relId: g.relId, ...fields } });
          canonicalId = updated.id;
        } else {
          const upserted = await prisma.qcRelease.upsert({
            where: { relId: g.relId },
            create: { relId: g.relId, ...fields },
            update: fields,
          });
          canonicalId = upserted.id;
        }

        // Older syncs (pre-2.7.3) could leave a stray duplicate behind — a
        // second row with the same relName but a different id/relId, still
        // referenced by Version.qcReleaseId, that never got reconciled above
        // because a real-relId row already existed by the time this ran.
        // Repoint any such versions to the canonical row and retire the
        // orphan, so this doesn't stay silently broken forever.
        const orphans = await prisma.qcRelease.findMany({
          where: { relName: g.relName, id: { not: canonicalId } },
        });
        for (const orphan of orphans) {
          const affected = await prisma.version.updateMany({
            where: { qcReleaseId: orphan.id },
            data: { qcReleaseId: canonicalId },
          });
          if (affected.count > 0) {
            this.logger.warn(
              `Repointed ${affected.count} version(s) from orphaned QcRelease ${orphan.id} (relId ${orphan.relId}) to canonical ${canonicalId} (relId ${g.relId})`
            );
          }
          await prisma.qcRelease.update({ where: { id: orphan.id }, data: { active: false } });
        }
      }

      this.logger.log(`QC releases synced from Oracle: ${grouped.size} releases`);
      return { synced: grouped.size };
    } catch (err: any) {
      this.logger.error(`Oracle QC sync error: ${err.message}`);
      throw err;
    } finally {
      if (connection) await connection.close().catch(() => {});
    }
  }

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
        if (r.goLiveDate && new Date(r.goLiveDate) < today) return false;
        if (r.versions.length > 0 && r.versions.every(v => ['COMPLETED', 'ROLLED_BACK'].includes(v.status))) return false;
        return true;
      })
      .map(({ versions: _v, ...r }) => r);
  }

  async findAll() {
    return prisma.qcRelease.findMany({ orderBy: { relStartDate: 'desc' } });
  }

  async toggleActive(id: string) {
    const release = await prisma.qcRelease.findUnique({ where: { id } });
    if (!release) throw new Error('לא נמצאה גרסת QC');
    return prisma.qcRelease.update({ where: { id }, data: { active: !release.active } });
  }

  private nameHash(s: string): number {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) | 0;
    return (h >>> 1) || 1;
  }

  async syncFromExcel(buffer: Buffer, fromYear = 2026): Promise<{ synced: number }> {
    const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

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

    const expectedSuffix = String(fromYear).slice(-3);
    const versionNames = new Set<string>();

    for (let r = headerRowIdx + 1; r < rows.length; r++) {
      const row = rows[r];
      const vName = String(row[verCol] ?? '').trim();
      if (!vName) continue;
      if (statusCol !== -1 && String(row[statusCol] ?? '').trim() === 'מבוטל') continue;
      if (vName.slice(-3) !== expectedSuffix) continue;
      if (vName.toUpperCase().includes('ERP')) continue;
      versionNames.add(vName);
    }

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

  // Reads the QC releases Excel from a configured file path.
  // Path resolution order: QC_RELEASES_FILE env → QC_RELEASES_FILE SystemParam → EXCEL_FILE_PATH (legacy)
  // On Linux: use a mounted SMB/CIFS path, e.g. /mnt/qc-releases/cr_list.xls
  async syncFromFilePath(fromYear = 2026): Promise<{ synced: number }> {
    let filePath: string;
    try {
      filePath = await resolveQcFilePath(prisma);
    } catch (err: any) {
      this.logger.error(`QC file path resolution failed: ${err.message}`);
      throw err;
    }

    try {
      const { buffer } = readQcFile(filePath);
      return this.syncFromExcel(buffer, fromYear);
    } catch (err: any) {
      if (err instanceof SmbAccessError) {
        this.logger.error(`SMB file read failed [${err.code}]: ${err.message}`);
      } else {
        this.logger.error(`QC file read error: ${err.message}`);
      }
      throw err;
    }
  }
}
