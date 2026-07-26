import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'dev'}`), override: true });

// ── Oracle Thick Mode must be initialized before any import that uses oracledb ──
// This runs synchronously before NestJS boots so no connection can be opened in Thin mode.
const ORACLE_LIB_DIR  = process.env.ORACLE_LIB_DIR?.trim();
const ORACLE_HOME     = process.env.ORACLE_HOME?.trim();
const LD_LIBRARY_PATH = process.env.LD_LIBRARY_PATH?.trim();

if (ORACLE_LIB_DIR) {
  // Warn about missing ORACLE_HOME (needed for timezone files, ORA-01804)
  if (!ORACLE_HOME) {
    console.warn('  [WARN] ORACLE_HOME is not set — Oracle timezone errors (ORA-01804) may occur.');
    console.warn('         Set ORACLE_HOME=/oracle/client in the container environment.');
  }
  if (!LD_LIBRARY_PATH) {
    console.warn('  [WARN] LD_LIBRARY_PATH is not set — Oracle libs may not load (DPI-1047).');
    console.warn('         Set LD_LIBRARY_PATH to same path as ORACLE_LIB_DIR.');
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const oracledb = require('oracledb');
  try {
    oracledb.initOracleClient({ libDir: ORACLE_LIB_DIR });
    if (oracledb.thin === true) {
      console.error('FATAL: Oracle Thick Mode initialization failed — still in Thin Mode');
      console.error(`ORACLE_LIB_DIR=${ORACLE_LIB_DIR}`);
      process.exit(1);
    }
    console.log(`   Oracle Mode   : THICK`);
    console.log(`   Oracle Client : ${oracledb.oracleClientVersionString ?? 'unknown'}`);
    console.log(`   Oracle LibDir : ${ORACLE_LIB_DIR}`);
    console.log(`   Oracle Home   : ${ORACLE_HOME ?? '(not set)'}`);
  } catch (err: any) {
    console.error(`FATAL: Oracle Thick Mode initialization failed: ${err.message}`);
    console.error(`ORACLE_LIB_DIR=${ORACLE_LIB_DIR}`);
    console.error(`LD_LIBRARY_PATH=${LD_LIBRARY_PATH ?? '(not set)'}`);
    console.error('Verify that libclntsh.so exists in that directory and libaio is installed.');
    process.exit(1);
  }
} else {
  console.log(`   Oracle Mode   : (ORACLE_LIB_DIR not set — Thick Mode disabled)`);
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { SystemParamsService } from './system-params/system-params.service';
import { PrismaClient } from '@prisma/client';
import helmet from 'helmet';

async function validateStartup(): Promise<void> {
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  // ── 1. PostgreSQL connectivity ──────────────────────────────────────────────
  try {
    await prisma.$queryRaw`SELECT 1`;
    console.log('   DB            : PostgreSQL OK');
  } catch (err: any) {
    console.error(`FATAL: PostgreSQL connectivity failed: ${err.message}`);
    console.error(`DATABASE_URL: ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }

  // ── 2. Schema consistency — all 2.7.1 columns must exist ──────────────────
  const requiredColumns: Array<{ table: string; column: string }> = [
    { table: 'Version',              column: 'workPlanMeetingTime'  },
    { table: 'Version',              column: 'integrationStart'     },
    { table: 'Version',              column: 'integrationEnd'       },
    { table: 'Version',              column: 'qaStart'              },
    { table: 'Version',              column: 'qaEnd'                },
    { table: 'Version',              column: 'submissionDeadline'   },
    { table: 'Version',              column: 'approvalDeadline'     },
    { table: 'VersionCrAssignment',  column: 'estimateDays'         },
    { table: 'VersionCrAssignment',  column: 'teamEstimateDays'     },
    { table: 'VersionCrAssignment',  column: 'syncStatus'           },
    { table: 'QaAssignment',         column: 'secondaryTesterId'    },
    { table: 'QaAssignment',         column: 'secondarySkillLevel'  },
  ];
  try {
    const missing: string[] = [];
    for (const { table, column } of requiredColumns) {
      const rows: any[] = await prisma.$queryRaw`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = ${table} AND column_name = ${column}
      `;
      if (rows.length === 0) missing.push(`${table}.${column}`);
    }
    if (missing.length > 0) {
      console.error(`FATAL: Missing migration columns: ${missing.join(', ')}`);
      console.error('Run: prisma migrate deploy');
      await prisma.$disconnect().catch(() => {});
      process.exit(1);
    }
    console.log('   Migrations    : OK');
  } catch (err: any) {
    console.error(`FATAL: Schema validation failed: ${err.message}`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }

  // ── 3. Oracle SystemParam validation ───────────────────────────────────────
  try {
    const oracleParams = await prisma.systemParam.findMany({
      where: { key: { in: ['ORACLE_ENABLED', 'ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'] } },
    });
    const paramMap = Object.fromEntries(oracleParams.map(p => [p.key, p.value]));
    const oracleEnabled = paramMap['ORACLE_ENABLED'] === 'true';

    if (oracleEnabled) {
      // Validate required Oracle params exist and are non-empty
      const required = ['ORACLE_USER', 'ORACLE_PASSWORD', 'ORACLE_CONNECT_STRING'];
      for (const key of required) {
        if (!paramMap[key]?.trim()) {
          console.error(`Configuration Error: Missing ${key} in SystemParam`);
          await prisma.$disconnect().catch(() => {});
          process.exit(1);
        }
      }

      // Validate Oracle Thick Mode is initialized when Oracle 11g is required
      if (!ORACLE_LIB_DIR) {
        console.error('Configuration Error: ORACLE_ENABLED=true but ORACLE_LIB_DIR is not set.');
        console.error('Oracle 11g requires Thick Mode. Set ORACLE_LIB_DIR in environment.');
        await prisma.$disconnect().catch(() => {});
        process.exit(1);
      }

      console.log('   Oracle        : ENABLED (Thick Mode) OK');
    } else {
      console.log('   Oracle        : DISABLED (ORACLE_ENABLED=false)');
    }
  } catch (err: any) {
    console.error(`FATAL: SystemParam validation failed: ${err.message}`);
    await prisma.$disconnect().catch(() => {});
    process.exit(1);
  }

  await prisma.$disconnect().catch(() => {});
}

async function bootstrap() {
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start.');
    process.exit(1);
  }

  const env  = process.env.NODE_ENV ?? 'dev';
  const port = process.env.PORT ?? '3000';
  const db   = (process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@');

  console.log(`\nDeployCenter Backend v2.8.0`);
  console.log(`   ENV           : ${env}`);
  console.log(`   PORT          : ${port}`);
  console.log(`   DB            : ${db}`);
  console.log(`   PID           : ${process.pid}`);

  // ── Startup validation — fail fast with clear errors ──────────────────────
  await validateStartup();

  const app = await NestFactory.create(AppModule);

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const extraOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map(o => o.trim())
    : [];
  app.enableCors({
    origin: [
      'http://localhost:3002',
      'http://localhost:3003',
      'http://localhost:3011',
      'http://localhost:3013',
      ...extraOrigins,
    ],
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  const systemParams = app.get(SystemParamsService);
  await systemParams.seed();

  await app.listen(port);
  console.log(`\n   READY on port ${port}\n`);
}

bootstrap();
