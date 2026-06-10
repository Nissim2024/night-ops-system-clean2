import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Clean existing seasons to avoid duplicates on re-run
  await prisma.leaveRequest.deleteMany({});
  await prisma.seasonDate.deleteMany({});
  await prisma.season.deleteMany({});

  const tishrei = await prisma.season.create({
    data: {
      name:      "חגי תשרי תשפ\"ז",
      dateRange: 'ספטמבר – אוקטובר 2026',
      isActive:  true,
      sortOrder: 1,
      dates: {
        create: [
          { date: new Date('2026-09-22'), label: "ראש השנה א'",  type: 'holiday',     orderIndex: 1 },
          { date: new Date('2026-09-23'), label: "ראש השנה ב'",  type: 'holiday',     orderIndex: 2 },
          { date: new Date('2026-09-24'), label: 'יום כיפור',    type: 'holiday',     orderIndex: 3 },
          { date: new Date('2026-09-29'), label: "סוכות א'",     type: 'holiday',     orderIndex: 4 },
          { date: new Date('2026-09-30'), label: "סוכות ב'",     type: 'holiday',     orderIndex: 5 },
          { date: new Date('2026-10-01'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 6 },
          { date: new Date('2026-10-02'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 7 },
          { date: new Date('2026-10-05'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 8 },
          { date: new Date('2026-10-06'), label: 'הושענא רבה',   type: 'chol_hamoed', orderIndex: 9 },
          { date: new Date('2026-10-07'), label: "שמחת תורה",    type: 'holiday',     orderIndex: 10 },
        ],
      },
    },
  });

  await prisma.season.create({
    data: {
      name:      "פסח תשפ\"ז",
      dateRange: 'אפריל 2027',
      isActive:  false,
      sortOrder: 2,
      dates: {
        create: [
          { date: new Date('2027-04-01'), label: "פסח א'",       type: 'holiday',     orderIndex: 1 },
          { date: new Date('2027-04-02'), label: "פסח ב'",       type: 'holiday',     orderIndex: 2 },
          { date: new Date('2027-04-03'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 3 },
          { date: new Date('2027-04-04'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 4 },
          { date: new Date('2027-04-05'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 5 },
          { date: new Date('2027-04-06'), label: 'חול המועד',    type: 'chol_hamoed', orderIndex: 6 },
          { date: new Date('2027-04-07'), label: "פסח ז'",       type: 'holiday',     orderIndex: 7 },
          { date: new Date('2027-04-08'), label: "פסח ח'",       type: 'holiday',     orderIndex: 8 },
        ],
      },
    },
  });

  await prisma.season.create({
    data: {
      name:      "שבועות תשפ\"ז",
      dateRange: 'מאי 2027',
      isActive:  false,
      sortOrder: 3,
      dates: {
        create: [
          { date: new Date('2027-05-22'), label: "שבועות א'",    type: 'holiday',     orderIndex: 1 },
          { date: new Date('2027-05-23'), label: "שבועות ב'",    type: 'holiday',     orderIndex: 2 },
        ],
      },
    },
  });

  console.log(`✅ Seeded 3 seasons (tishrei id: ${tishrei.id})`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
