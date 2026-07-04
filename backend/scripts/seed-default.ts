/**
 * DeployCenter — Default Seed for Fresh Installations
 * Creates an initial admin user when no users exist in the database.
 * Also seeds default RolePermissions and SystemParams.
 *
 * Usage (run after prisma migrate deploy on a fresh server):
 *   ADMIN_EMAIL=admin@company.com ADMIN_PASSWORD=ChangeMe123! \
 *     npx ts-node scripts/seed-default.ts
 *
 * Environment variables:
 *   ADMIN_EMAIL    — email for the initial admin (default: nissim@test.com)
 *   ADMIN_PASSWORD — password for the initial admin (required)
 *   ADMIN_NAME     — display name for the initial admin (default: Admin)
 *
 * Safe to run multiple times — skips if admin already exists.
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'prod'}`), override: true });

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

const DEFAULT_ROLE_PERMISSIONS: Record<string, string[]> = {
  ADMIN:           ['screen:prep','screen:handoff','screen:timeline','screen:night','screen:summary','screen:admin','action:import','action:gonogo','action:task_status','action:open_task_for_execution','action:user_manage','action:override_version_edit','action:select_all_tasks','action:template_delete'],
  RELEASE_MANAGER: ['screen:prep','screen:handoff','screen:timeline','screen:night','screen:summary','action:import','action:gonogo','action:task_status','action:open_task_for_execution','action:override_version_edit','action:select_all_tasks'],
  CR_MANAGER:      [],
  TEAM_LEAD:       ['screen:handoff','screen:timeline','screen:night','screen:summary','action:task_status'],
  EMPLOYEE:        ['action:task_status'],
  VIEWER:          ['screen:timeline','screen:night','screen:summary'],
};

async function main() {
  const adminEmail    = process.env.ADMIN_EMAIL    ?? 'nissim@test.com';
  const adminPassword = process.env.ADMIN_PASSWORD;
  const adminName     = process.env.ADMIN_NAME     ?? 'Admin';

  console.log('DeployCenter Default Seed');
  console.log(`  DB    : ${(process.env.DATABASE_URL ?? '').replace(/:\/\/.*@/, '://***@')}`);
  console.log(`  Admin : ${adminEmail}`);
  console.log('');

  const userCount = await prisma.user.count();

  if (userCount > 0) {
    console.log(`✅ Database already has ${userCount} users — skipping user seed.`);
  } else {
    if (!adminPassword) {
      console.error('ADMIN_PASSWORD environment variable is required for initial seed.');
      console.error('Example: ADMIN_PASSWORD=ChangeMe123! npx ts-node scripts/seed-default.ts');
      process.exit(1);
    }

    const hashed = await bcrypt.hash(adminPassword, 10);
    await prisma.user.create({
      data: {
        fullName: adminName,
        email:    adminEmail,
        password: hashed,
        role:     'ADMIN',
        active:   true,
      },
    });
    console.log(`✅ Admin user created: ${adminEmail}`);
    console.log('   ⚠️  Change the password immediately after first login!');
  }

  // ── RolePermissions ─────────────────────────────────────────────────────
  let permSeeded = 0;
  for (const [role, permissions] of Object.entries(DEFAULT_ROLE_PERMISSIONS)) {
    const exists = await prisma.rolePermissions.findUnique({ where: { role: role as any } });
    if (!exists) {
      await prisma.rolePermissions.create({ data: { role: role as any, permissions } });
      permSeeded++;
    }
  }
  console.log(`✅ RolePermissions: ${permSeeded} seeded (${Object.keys(DEFAULT_ROLE_PERMISSIONS).length - permSeeded} already exist)`);

  await prisma.$disconnect();
  console.log('\nSeed complete. Login with the admin credentials above.');
}

main().catch(err => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
