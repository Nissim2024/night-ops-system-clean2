import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL || 'postgresql://nightops_user:nightops_pass@localhost:5432/nightops' } },
});

async function main() {
  const admins = [
    { email: 'nissim@test.com', fullName: 'ניסים פרץ', password: '123456' },
    { email: 'nisim@dev.com',   fullName: 'Dev Admin',  password: '123456' },
    { email: 'hay@dev.com',     fullName: 'Hay Admin',  password: '123456' },
  ];

  for (const admin of admins) {
    const hash = await bcrypt.hash(admin.password, 10);
    const existing = await prisma.user.findUnique({ where: { email: admin.email } });

    if (existing) {
      await prisma.user.update({
        where: { email: admin.email },
        data: { password: hash, active: true, role: 'ADMIN' },
      });
      console.log(`✅ עודכן: ${admin.email}`);
    } else {
      await prisma.user.create({
        data: {
          email: admin.email,
          fullName: admin.fullName,
          password: hash,
          role: 'ADMIN',
          active: true,
        },
      });
      console.log(`✅ נוצר: ${admin.email}`);
    }
  }

  const all = await prisma.user.findMany({ select: { email: true, role: true, active: true } });
  console.log('\nכל המשתמשים במערכת:');
  all.forEach(u => console.log(` - ${u.email} | ${u.role} | active=${u.active}`));
}

main().catch(console.error).finally(() => prisma.$disconnect());
