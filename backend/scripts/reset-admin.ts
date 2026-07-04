/**
 * DeployCenter — Emergency Admin Recovery
 *
 * Resets a user's password OR creates a new ADMIN user.
 * Safe to run while the app is running — no restart needed.
 *
 * Usage (in Docker container):
 *   node /app/dist/scripts/reset-admin.js --email admin@company.com --password NewPass123!
 *   node /app/dist/scripts/reset-admin.js --email admin@company.com --password NewPass123! --create
 *
 * Usage (dev with ts-node):
 *   npx ts-node scripts/reset-admin.ts --email admin@company.com --password NewPass123!
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), `.env.${process.env.NODE_ENV || 'prod'}`), override: true });

import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const email    = arg('email');
  const password = arg('password');
  const create   = process.argv.includes('--create');
  const name     = arg('name') ?? 'Admin';

  if (!email || !password) {
    console.error('Usage: reset-admin --email <email> --password <password> [--create] [--name <name>]');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);

  const existing = await prisma.user.findUnique({ where: { email } });

  if (existing) {
    await prisma.user.update({
      where: { email },
      data: { password: hash, role: 'ADMIN', active: true },
    });
    console.log(`✅ Password reset for ${email} (role set to ADMIN)`);
  } else if (create) {
    await prisma.user.create({
      data: { email, fullName: name, password: hash, role: 'ADMIN', active: true },
    });
    console.log(`✅ Admin user created: ${email}`);
  } else {
    console.error(`User not found: ${email}`);
    console.error('To create a new admin user, add the --create flag.');
    process.exit(1);
  }
}

main()
  .catch(err => { console.error(err.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
