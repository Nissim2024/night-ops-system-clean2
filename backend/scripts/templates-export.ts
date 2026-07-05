/**
 * DeployCenter — Templates Export (Deliverable #3)
 *
 * מייצא תבניות גרסה (VersionTemplate) מסביבת DEV/TEST לייבוא ב-PROD.
 *
 * Usage:
 *   npx ts-node scripts/templates-export.ts [output-file]
 *   NODE_ENV=dev npx ts-node scripts/templates-export.ts ./templates-export.json
 *
 * Output: JSON הכולל VersionTemplates ו-Migration Report
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'dev'}`), override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

async function main() {
  const outputFile = process.argv[2] ?? './templates-export.json';

  console.log('DeployCenter Templates Export');
  console.log(`  DB  : ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);
  console.log(`  Out : ${path.resolve(outputFile)}`);
  console.log('');

  try {
    const versionTemplates = await prisma.versionTemplate.findMany({
      orderBy: { createdAt: 'asc' },
      include: { creator: { select: { id: true, email: true, fullName: true } } },
    });

    const data = {
      exportedAt:      new Date().toISOString(),
      sourceVersion:   '2.7.4',
      sourceEnv:       process.env.NODE_ENV ?? 'dev',
      versionTemplates,
      report: {
        total:   versionTemplates.length,
        byCreator: versionTemplates.reduce((acc: Record<string, number>, t: any) => {
          const key = t.creator?.email ?? t.createdBy;
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {} as Record<string, number>),
        names: versionTemplates.map((t: any) => ({ id: t.id, name: t.name, createdAt: t.createdAt })),
      },
    };

    fs.writeFileSync(outputFile, JSON.stringify(data, null, 2), 'utf8');

    console.log(`✅ Export complete:`);
    console.log(`   Version Templates : ${versionTemplates.length}`);
    console.log('');
    console.log('   תבניות שיוצאו:');
    versionTemplates.forEach((t: any) => {
      console.log(`   • [${t.id.slice(0, 8)}] ${t.name} (${t.creator?.email ?? t.createdBy})`);
    });
    console.log('');
    console.log(`   קובץ: ${path.resolve(outputFile)}`);
    console.log('');
    console.log('השלב הבא: העתק את הקובץ לשרת ה-PROD והרץ:');
    console.log('  npx ts-node scripts/templates-import.ts templates-export.json');
    console.log('  # או בDocker:');
    console.log('  # docker cp templates-export.json dc-api:/tmp/');
    console.log('  # docker exec dc-api node /app/dist/scripts/templates-import.js /tmp/templates-export.json');
  } catch (err: any) {
    console.error(`Export failed: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
