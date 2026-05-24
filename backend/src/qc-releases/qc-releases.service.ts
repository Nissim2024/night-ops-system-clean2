import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const ORACLE_ENABLED = process.env.ORACLE_ENABLED === 'true';

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
    if (!ORACLE_ENABLED) {
      this.logger.log('Oracle disabled (ORACLE_ENABLED!=true) — skipping QC releases sync');
      return { synced: 0, error: 'Oracle not enabled' };
    }

    let connection: any;
    try {
      const oracledb = await import('oracledb');
      oracledb.default.outFormat = oracledb.default.OUT_FORMAT_OBJECT;

      connection = await oracledb.default.getConnection({
        user: process.env.ORACLE_USER,
        password: process.env.ORACLE_PASSWORD,
        connectString: process.env.ORACLE_CONNECT_STRING,
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

  // Returns current + future releases (filterDate >= 30 days ago) for the dropdown
  async findActive() {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    cutoff.setHours(0, 0, 0, 0);
    return prisma.qcRelease.findMany({
      where: {
        active: true,
        filterDate: { not: null, gte: cutoff },
      },
      orderBy: { filterDate: 'asc' },
    });
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
}
