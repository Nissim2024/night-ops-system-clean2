import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const NEW_PASSWORD = 'Test1234!';

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, fullName: true, email: true, role: true, active: true },
    orderBy: [{ role: 'asc' }, { fullName: 'asc' }],
  });

  console.log('\n=== USERS ===');
  for (const u of users) {
    console.log(`${u.role.padEnd(16)} | ${u.email.padEnd(30)} | ${u.fullName} | active=${u.active}`);
  }

  // Reset passwords for all active users
  const hash = await bcrypt.hash(NEW_PASSWORD, 10);
  await prisma.user.updateMany({ where: { active: true }, data: { password: hash } });
  console.log(`\n✓ Passwords reset to: "${NEW_PASSWORD}" for all active users`);

  // Teams and members
  const teams = await prisma.team.findMany({
    where: { active: true },
    include: {
      members: {
        include: { user: { select: { email: true, fullName: true, role: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });

  console.log('\n=== TEAMS & MEMBERS ===');
  for (const t of teams) {
    console.log(`\nTeam: ${t.name} (id=${t.id})`);
    for (const m of t.members) {
      console.log(`  ${m.isLead ? '[LEAD] ' : '       '} ${m.user.email.padEnd(30)} — ${m.user.fullName} (${m.user.role})`);
    }
  }

  // Active versions
  const versions = await prisma.version.findMany({
    where: { isArchived: false },
    select: { id: true, name: true, status: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log('\n=== ACTIVE VERSIONS ===');
  for (const v of versions) {
    console.log(`  ${v.status.padEnd(16)} | ${v.name} | ${v.id}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
