import { Controller, Get, Post, Body, HttpCode } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

// Read once from package.json (present at the container's WORKDIR root per
// Dockerfile's `COPY --from=builder /app/package.json ./`) instead of a
// hardcoded literal — this drifted stale in production before (stuck at
// '2.8.1' while the app had already shipped 2.8.2), since nothing forced it
// to be bumped alongside the real version. Reading it dynamically makes that
// whole class of bug structurally impossible instead of relying on
// remembering to edit this file on every release.
const APP_VERSION: string = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8')).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
})();

async function checkOracle(): Promise<{ status: 'ok' | 'disabled' | 'error'; message?: string }> {
  const rows = await prisma.systemParam.findMany({
    where: { key: { in: ['ORACLE_ENABLED', 'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'] } },
  }).catch(() => []);
  const map = Object.fromEntries(rows.map((r: any) => [r.key, r.value]));
  if (map['ORACLE_ENABLED'] !== 'true') return { status: 'disabled' };

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const oracledb = require('oracledb');
    if (oracledb.thin === true) return { status: 'error', message: 'Thick Mode not active' };
    const conn = await oracledb.getConnection({
      user: map['ORACLE_USER'], password: map['ORACLE_PASSWORD'], connectString: map['ORACLE_CONNECT_STRING'],
    });
    await conn.execute('SELECT 1 FROM DUAL');
    await conn.close();
    return { status: 'ok' };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
}

async function checkCrList(): Promise<{ status: 'ok' | 'not_configured' | 'error'; message?: string }> {
  const row = await prisma.systemParam.findFirst({
    where: { key: { in: ['QC_RELEASES_FILE', 'EXCEL_FILE_PATH'] } },
  }).catch(() => null);
  const filePath = process.env.QC_RELEASES_FILE || row?.value || '';
  if (!filePath) return { status: 'not_configured' };
  try {
    fs.accessSync(filePath, fs.constants.R_OK);
    return { status: 'ok' };
  } catch (err: any) {
    return { status: 'error', message: err.message };
  }
}

@Controller('health')
export class HealthController {
  @Get()
  async check() {
    const [oracleResult, crListResult] = await Promise.all([checkOracle(), checkCrList()]);

    let dbStatus: 'ok' | 'error' = 'ok';
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    const overall =
      dbStatus === 'error' ? 'error' :
      oracleResult.status === 'error' ? 'degraded' :
      crListResult.status === 'error' ? 'degraded' : 'ok';

    return {
      status:    overall,
      timestamp: new Date().toISOString(),
      version:   APP_VERSION,
      database:  dbStatus,
      oracle:    oracleResult.status,
      cr_list:   crListResult.status,
      ...(oracleResult.message  ? { oracle_error:   oracleResult.message  } : {}),
      ...(crListResult.message  ? { cr_list_error:  crListResult.message  } : {}),
    };
  }

  // Test Oracle connection with provided credentials (used by AdminPanel)
  @Post('test-oracle')
  @HttpCode(200)
  async testOracle(@Body() body: { user: string; password: string; connectString: string }) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const oracledb = require('oracledb');
      if (oracledb.thin === true) {
        return { ok: false, message: 'Oracle Thick Mode not active. Set ORACLE_LIB_DIR and restart.' };
      }
      const conn = await oracledb.getConnection({
        user: body.user, password: body.password, connectString: body.connectString,
      });
      await conn.execute('SELECT 1 FROM DUAL');
      await conn.close();
      return { ok: true, message: 'חיבור Oracle הצליח' };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }

  // Test SMB / cr_list file accessibility
  @Post('test-cr-list')
  @HttpCode(200)
  async testCrList(@Body() body: { filePath?: string }) {
    const filePath = body.filePath || process.env.QC_RELEASES_FILE || '';
    if (!filePath) return { ok: false, message: 'No file path configured' };
    try {
      fs.accessSync(filePath, fs.constants.R_OK);
      const stat = fs.statSync(filePath);
      return { ok: true, message: `הקובץ נגיש (${(stat.size / 1024).toFixed(1)} KB)` };
    } catch (err: any) {
      return { ok: false, message: err.message };
    }
  }
}
