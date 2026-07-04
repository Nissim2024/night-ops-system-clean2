/**
 * DeployCenter — Production Validation Script
 * Verifies all required components are functional before going live.
 *
 * Usage:
 *   npx ts-node scripts/validate-production.ts
 *
 * Returns exit code 0 if all checks pass, 1 if any check fails.
 *
 * Run after deployment and before marking the release as ready.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'prod'}`), override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

interface CheckResult {
  name: string;
  passed: boolean;
  detail: string;
}

const results: CheckResult[] = [];

function check(name: string, passed: boolean, detail: string) {
  results.push({ name, passed, detail });
  const icon = passed ? '✅' : '❌';
  console.log(`  ${icon} ${name.padEnd(40)} ${detail}`);
}

async function main() {
  console.log('');
  console.log('=================================================');
  console.log('  DeployCenter 2.7.1 — Production Validation');
  console.log('=================================================');
  console.log(`  DB  : ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);
  console.log('');

  // ── 1. PostgreSQL connectivity ──────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    check('PostgreSQL connectivity', true, 'OK');
  } catch (err: any) {
    check('PostgreSQL connectivity', false, err.message.split('\n')[0]);
  }

  // ── 2. Required DB tables ───────────────────────────────────────────────
  const requiredTables = ['User', 'Team', 'Version', 'Phase', 'Task', 'QcRelease', 'SystemParam', 'RolePermissions'];
  for (const table of requiredTables) {
    try {
      const rows: any[] = await prisma.$queryRaw`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ${table}
      `;
      check(`Table exists: ${table}`, rows.length > 0, rows.length > 0 ? 'OK' : 'MISSING');
    } catch (err: any) {
      check(`Table exists: ${table}`, false, err.message.split('\n')[0]);
    }
  }

  // ── 3. Required columns — all 2.7.1 schema columns ───────────────────────
  const requiredColumns: Array<{ table: string; column: string }> = [
    { table: 'Version',             column: 'workPlanMeetingTime' },
    { table: 'Version',             column: 'integrationStart'    },
    { table: 'Version',             column: 'integrationEnd'      },
    { table: 'Version',             column: 'qaStart'             },
    { table: 'Version',             column: 'qaEnd'               },
    { table: 'Version',             column: 'submissionDeadline'  },
    { table: 'Version',             column: 'approvalDeadline'    },
    { table: 'VersionCrAssignment', column: 'estimateDays'        },
    { table: 'VersionCrAssignment', column: 'teamEstimateDays'    },
    { table: 'VersionCrAssignment', column: 'syncStatus'          },
    { table: 'QaAssignment',        column: 'secondaryTesterId'   },
    { table: 'QaAssignment',        column: 'secondarySkillLevel' },
  ];

  for (const { table, column } of requiredColumns) {
    try {
      const rows: any[] = await prisma.$queryRaw`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}
      `;
      check(
        `Column: ${table}.${column}`,
        rows.length > 0,
        rows.length > 0 ? 'OK' : 'MISSING — run prisma migrate deploy',
      );
    } catch (err: any) {
      check(`Column: ${table}.${column}`, false, err.message.split('\n')[0]);
    }
  }

  // ── 4. Users and teams exist ────────────────────────────────────────────
  try {
    const userCount = await prisma.user.count();
    check('Users exist', userCount > 0, userCount > 0 ? `${userCount} users` : 'No users — run seed-default.ts or import-data.ts');
  } catch (err: any) {
    check('Users exist', false, err.message.split('\n')[0]);
  }

  try {
    const teamCount = await prisma.team.count();
    check('Teams exist', teamCount > 0, teamCount > 0 ? `${teamCount} teams` : 'No teams');
  } catch (err: any) {
    check('Teams exist', false, err.message.split('\n')[0]);
  }

  // ── 5. Admin user exists ────────────────────────────────────────────────
  try {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    check('Admin user exists', adminCount > 0, adminCount > 0 ? `${adminCount} admin(s)` : 'No admin user — create one via AdminPanel or seed');
  } catch (err: any) {
    check('Admin user exists', false, err.message.split('\n')[0]);
  }

  // ── 6. RolePermissions seeded ───────────────────────────────────────────
  try {
    const permCount = await prisma.rolePermissions.count();
    check('RolePermissions seeded', permCount > 0, permCount > 0 ? `${permCount} roles` : 'No permissions — login once to trigger auto-seed');
  } catch (err: any) {
    check('RolePermissions seeded', false, err.message.split('\n')[0]);
  }

  // ── 7. SystemParams ─────────────────────────────────────────────────────
  const requiredParams = ['ORACLE_ENABLED', 'ORACLE_CONNECT_STRING'];
  for (const key of requiredParams) {
    try {
      const param = await prisma.systemParam.findUnique({ where: { key } });
      check(`SystemParam: ${key}`, !!param, param ? `= "${param.value}"` : 'MISSING');
    } catch (err: any) {
      check(`SystemParam: ${key}`, false, err.message.split('\n')[0]);
    }
  }

  // ── 8. Oracle Thick Mode ────────────────────────────────────────────────
  const oracleLibDir = process.env.ORACLE_LIB_DIR?.trim();
  if (oracleLibDir) {
    const libExists = fs.existsSync(oracleLibDir);
    check('ORACLE_LIB_DIR exists', libExists, libExists ? oracleLibDir : `NOT FOUND: ${oracleLibDir}`);

    if (libExists) {
      const libclntsh = path.join(oracleLibDir, 'libclntsh.so');
      const hasSo = fs.existsSync(libclntsh) ||
                    fs.readdirSync(oracleLibDir).some(f => f.startsWith('libclntsh'));
      check('libclntsh.so present', hasSo, hasSo ? 'OK' : `Not found in ${oracleLibDir}`);
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const oracledb = require('oracledb');
      try {
        oracledb.initOracleClient({ libDir: oracleLibDir });
      } catch (_) { /* may already be initialized */ }

      const isThick = oracledb.thin === false;
      check('Oracle Thick Mode active', isThick, isThick ? `Client: ${oracledb.oracleClientVersionString}` : 'Still in Thin Mode');
    } catch (err: any) {
      check('Oracle Thick Mode active', false, err.message.split('\n')[0]);
    }
  } else {
    check('Oracle Thick Mode', false, 'ORACLE_LIB_DIR not set — Oracle 11g will not work');
  }

  // ── 9. Oracle connectivity ──────────────────────────────────────────────
  try {
    const params = await prisma.systemParam.findMany({
      where: { key: { in: ['ORACLE_ENABLED', 'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'] } },
    });
    const pm = Object.fromEntries(params.map(p => [p.key, p.value]));

    if (pm['ORACLE_ENABLED'] === 'true') {
      if (!pm['ORACLE_USER'] || !pm['ORACLE_CONNECT_STRING']) {
        check('Oracle connectivity', false, 'Missing ORACLE_USER or ORACLE_CONNECT_STRING in SystemParam');
      } else if (!oracleLibDir) {
        check('Oracle connectivity', false, 'ORACLE_LIB_DIR not set — cannot test');
      } else {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const oracledb = require('oracledb');
          const conn = await oracledb.getConnection({
            user:          pm['ORACLE_USER'],
            password:      pm['ORACLE_PASSWORD'],
            connectString: pm['ORACLE_CONNECT_STRING'],
          });
          await conn.execute('SELECT 1 FROM DUAL');
          await conn.close();
          check('Oracle connectivity', true, `OK — ${pm['ORACLE_CONNECT_STRING']}`);
        } catch (err: any) {
          check('Oracle connectivity', false, err.message.split('\n')[0]);
        }
      }
    } else {
      check('Oracle connectivity', true, 'ORACLE_ENABLED=false — skipped');
    }
  } catch (err: any) {
    check('Oracle connectivity', false, err.message.split('\n')[0]);
  }

  // ── 10. QC Releases file path ───────────────────────────────────────────
  const qcFile = process.env.QC_RELEASES_FILE?.trim();
  if (qcFile) {
    const exists = fs.existsSync(qcFile);
    check('QC Releases file', exists, exists ? `OK: ${qcFile}` : `NOT FOUND: ${qcFile} — check SMB mount`);
  } else {
    check('QC Releases file', false, 'QC_RELEASES_FILE not set — file sync from path not available');
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log('');
  console.log('=================================================');
  console.log(`  RESULT: ${passed} passed, ${failed} failed`);
  console.log(failed === 0 ? '  STATUS: ✅ PASS — Ready for production' : '  STATUS: ❌ FAIL — Fix issues above');
  console.log('=================================================');
  console.log('');

  await prisma.$disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error(`Validation script error: ${err.message}`);
  process.exit(1);
});
