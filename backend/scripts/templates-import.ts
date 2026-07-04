/**
 * DeployCenter — Templates Import (Deliverable #3)
 *
 * מייבא תבניות גרסה (VersionTemplate) מ-DEV/TEST ל-PROD.
 * בטוח לריצה חוזרת — משתמש ב-UPSERT (לא DELETE + INSERT).
 *
 * Usage:
 *   npx ts-node scripts/templates-import.ts [input-file]
 *   node /app/dist/scripts/templates-import.js /tmp/templates-export.json
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'prod'}`), override: true });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

interface MigrationResult {
  name: string;
  id: string;
  action: 'created' | 'updated' | 'skipped';
  reason?: string;
}

async function main() {
  const inputFile = process.argv[2] ?? './templates-export.json';
  const resolvedPath = path.resolve(inputFile);

  console.log('DeployCenter Templates Import');
  console.log(`  DB   : ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);
  console.log(`  File : ${resolvedPath}`);
  console.log('');

  if (!fs.existsSync(resolvedPath)) {
    console.error(`Import file not found: ${resolvedPath}`);
    process.exit(1);
  }

  let data: any;
  try {
    data = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (err: any) {
    console.error(`Failed to parse file: ${err.message}`);
    process.exit(1);
  }

  const { versionTemplates = [] } = data;
  const results: MigrationResult[] = [];

  // Find a fallback admin to use as createdBy when original creator doesn't exist
  const fallbackAdmin = await prisma.user.findFirst({
    where: { role: 'ADMIN', active: true },
    select: { id: true, email: true },
  });

  if (!fallbackAdmin) {
    console.error('FATAL: לא נמצא משתמש ADMIN ב-DB — לא ניתן לייבא תבניות.');
    console.error('הרץ תחילה: node /app/dist/scripts/reset-admin.js --email admin@company.com --password Pass --create');
    process.exit(1);
  }
  console.log(`  Fallback Admin: ${fallbackAdmin.email}`);
  console.log('');

  try {
    for (const vt of versionTemplates) {
      // Resolve createdBy — use original if exists, fallback to admin
      const creatorId = vt.createdBy ?? vt.creator?.id;
      const creatorExists = creatorId
        ? await prisma.user.findUnique({ where: { id: creatorId }, select: { id: true } })
        : null;
      const resolvedCreatedBy = creatorExists ? creatorId : fallbackAdmin.id;

      const existing = await prisma.versionTemplate.findUnique({ where: { id: vt.id } });

      if (existing) {
        await prisma.versionTemplate.update({
          where: { id: vt.id },
          data: {
            name:        vt.name,
            description: vt.description ?? null,
            structure:   vt.structure,
          },
        });
        results.push({ name: vt.name, id: vt.id, action: 'updated' });
      } else {
        await prisma.versionTemplate.create({
          data: {
            id:          vt.id,
            name:        vt.name,
            description: vt.description ?? null,
            structure:   vt.structure,
            createdBy:   resolvedCreatedBy,
            createdAt:   vt.createdAt ? new Date(vt.createdAt) : new Date(),
            updatedAt:   vt.updatedAt ? new Date(vt.updatedAt) : new Date(),
          },
        });
        results.push({ name: vt.name, id: vt.id, action: 'created' });
      }
    }
  } catch (err: any) {
    console.error(`Import failed: ${err.message}`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }

  // ── Migration Report ────────────────────────────────────
  const created = results.filter(r => r.action === 'created').length;
  const updated = results.filter(r => r.action === 'updated').length;
  const skipped = results.filter(r => r.action === 'skipped').length;

  console.log('✅ Import complete — Migration Report:');
  console.log('');
  console.log(`   סה"כ תבניות      : ${versionTemplates.length}`);
  console.log(`   נוצרו (חדשות)    : ${created}`);
  console.log(`   עודכנו (קיימות) : ${updated}`);
  console.log(`   דולגו            : ${skipped}`);
  console.log('');
  console.log('   פירוט:');
  results.forEach(r => {
    const icon = r.action === 'created' ? '➕' : r.action === 'updated' ? '✏️ ' : '⏭️ ';
    console.log(`   ${icon} [${r.id.slice(0, 8)}] ${r.name} — ${r.action}`);
  });
  console.log('');

  // Save report to file
  const reportPath = resolvedPath.replace(/\.json$/, '-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    importedAt: new Date().toISOString(),
    summary: { total: versionTemplates.length, created, updated, skipped },
    results,
  }, null, 2), 'utf8');
  console.log(`   דוח מלא: ${reportPath}`);
}

main().catch(err => { console.error(err.message); process.exit(1); });
