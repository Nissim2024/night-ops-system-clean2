import { PrismaClient, SkillType } from '@prisma/client';

const prisma = new PrismaClient();

// ── Skills ────────────────────────────────────────────────────────────────────

const SKILLS: { name: string; type: SkillType; weight: number }[] = [
  // Professional (14)
  { name: 'הכנת אפיון',                   type: SkillType.Professional, weight: 3 },
  { name: 'הכנת TDR',                     type: SkillType.Professional, weight: 2 },
  { name: 'כתיבת STD',                    type: SkillType.Professional, weight: 3 },
  { name: 'יכולת הצגת תקלות אפליקציות',   type: SkillType.Professional, weight: 1 },
  { name: 'מציאת תקלות איכות',            type: SkillType.Professional, weight: 3 },
  { name: 'תיעוד תקלות',                  type: SkillType.Professional, weight: 2 },
  { name: 'מעקב אחר תקלות',               type: SkillType.Professional, weight: 2 },
  { name: 'כיסוי הבדיקות',                type: SkillType.Professional, weight: 3 },
  { name: 'סימון תסריטים',                type: SkillType.Professional, weight: 3 },
  { name: 'הכנת מתודולוגיות QA',          type: SkillType.Professional, weight: 2 },
  { name: 'עמידה בזמנים',                 type: SkillType.Professional, weight: 2 },
  { name: 'באגים שברחו ליצור',            type: SkillType.Professional, weight: 4 },
  { name: 'תקלות סרק',                    type: SkillType.Professional, weight: 4 },
  { name: 'יכולת ניהול וחלוקת זמן',       type: SkillType.Professional, weight: 2 },
  // Applications (11)
  { name: 'Wizard',       type: SkillType.Applications, weight: 2 },
  { name: 'CRM',          type: SkillType.Applications, weight: 2 },
  { name: 'ZOO',          type: SkillType.Applications, weight: 2 },
  { name: 'Provisioning', type: SkillType.Applications, weight: 2 },
  { name: 'TOP',          type: SkillType.Applications, weight: 2 },
  { name: 'OSB',          type: SkillType.Applications, weight: 2 },
  { name: 'WEB',          type: SkillType.Applications, weight: 2 },
  { name: 'DWH',          type: SkillType.Applications, weight: 2 },
  { name: 'Remedy',       type: SkillType.Applications, weight: 2 },
  { name: 'IVR',          type: SkillType.Applications, weight: 2 },
  { name: 'ERP',          type: SkillType.Applications, weight: 2 },
  // Tools (6)
  { name: 'SQL',       type: SkillType.Tools, weight: 1 },
  { name: 'UNIX',      type: SkillType.Tools, weight: 1 },
  { name: 'Selenium',  type: SkillType.Tools, weight: 1 },
  { name: 'Jmeter',    type: SkillType.Tools, weight: 1 },
  { name: 'QC',        type: SkillType.Tools, weight: 1 },
  { name: 'Scripting', type: SkillType.Tools, weight: 1 },
  // Personal (10)
  { name: 'יכולת הובלת פרויקט',      type: SkillType.Personal, weight: 2 },
  { name: 'יכולת למידה עצמית',       type: SkillType.Personal, weight: 2 },
  { name: 'קבלת סמכות',              type: SkillType.Personal, weight: 2 },
  { name: 'יכולת קבלת ביקורת',       type: SkillType.Personal, weight: 3 },
  { name: 'יכולת עמידה בלחץ',        type: SkillType.Personal, weight: 3 },
  { name: 'יחסי אנוש',               type: SkillType.Personal, weight: 3 },
  { name: 'יישום ביקורת',            type: SkillType.Personal, weight: 2 },
  { name: 'מוטיבציה',                type: SkillType.Personal, weight: 2 },
  { name: 'שגר ושכח',                type: SkillType.Personal, weight: 2 },
  { name: 'מידת הנק שיגרם אם יעזוב', type: SkillType.Personal, weight: 2 },
];

// ── Skill levels per QA Team employee ────────────────────────────────────────
// 41 values in SKILLS order: [Prof×14, Apps×11, Tools×6, Personal×10]

const TESTER_DATA: { email: string; levels: number[] }[] = [
  {
    // Senior — strong Professional + Personal
    email: 'Irina.Klebansky@hot.net.il',
    levels: [4,4,4,3,5,4,4,4,4,3,4,3,3,3,  4,4,3,4,3,3,4,2,3,3,2,  4,3,3,2,4,3,  4,4,4,4,4,5,4,4,4,4],
  },
  {
    // Mid-senior — strong Tools (SQL/UNIX/Selenium)
    email: 'Stanislav.Abramyan@hot.net.il',
    levels: [3,3,3,3,4,4,3,3,3,2,3,3,3,3,  3,3,2,3,3,4,3,3,3,2,3,  5,4,4,3,4,4,  3,4,3,3,4,3,3,3,3,3],
  },
  {
    // Mid — Applications specialist (Wizard/CRM/WEB)
    email: 'Anna.Leshem@hot.net.il',
    levels: [3,2,3,3,3,3,3,3,3,2,3,2,2,3,  5,5,4,5,4,3,5,3,4,4,3,  3,2,2,1,3,2,  3,3,4,4,3,4,3,3,3,3],
  },
  {
    // Mid — balanced tester
    email: 'Evana.Raad@hot.net.il',
    levels: [3,3,3,3,3,3,3,3,3,2,3,2,3,3,  3,4,3,3,3,3,3,2,3,3,2,  3,2,2,2,3,2,  3,3,3,4,3,4,3,3,3,3],
  },
  {
    // Mid — strong in quality/documentation
    email: 'Limor.Pinhas@hot.net.il',
    levels: [3,3,4,3,4,4,4,3,3,2,3,2,3,2,  3,3,2,3,2,2,3,2,3,2,2,  3,2,3,2,3,2,  3,3,3,4,4,4,3,3,3,3],
  },
  {
    // Mid — learning, applications-focused
    email: 'Alwan.Maamon@hot.net.il',
    levels: [2,2,2,2,3,3,3,2,2,1,3,2,2,2,  3,3,3,4,3,3,3,2,3,2,3,  3,3,2,1,3,2,  2,3,3,3,3,3,3,3,3,2],
  },
  {
    // Junior-mid
    email: 'roi.vahab@hot.net.il',
    levels: [2,2,2,3,3,3,3,2,2,1,3,2,2,2,  2,3,2,2,2,2,3,1,2,2,2,  3,2,2,1,3,2,  2,3,3,3,3,3,3,3,2,2],
  },
  {
    // Mid — solid across the board
    email: 'Yakov.Chekol@hot.net.il',
    levels: [3,2,3,3,3,3,3,3,3,2,3,2,3,2,  3,3,2,3,2,2,3,2,2,3,2,  2,2,2,1,3,2,  3,3,3,3,3,4,3,3,3,3],
  },
  {
    // Mid — consistent tester
    email: 'Joseph.Abdallah@hot.net.il',
    levels: [3,3,3,3,3,3,3,3,3,2,3,3,3,2,  3,3,3,3,3,3,3,2,3,3,3,  3,2,2,2,3,2,  3,3,3,3,4,4,3,3,3,3],
  },
];

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Clearing existing QA data...');
  await prisma.testerSkill.deleteMany();
  await prisma.testerProfile.deleteMany();
  await prisma.skill.deleteMany();

  console.log(`Inserting ${SKILLS.length} skills...`);
  const created: { id: string }[] = [];
  for (const skill of SKILLS) {
    const s = await prisma.skill.create({ data: skill });
    created.push({ id: s.id });
  }

  console.log(`Adding ${TESTER_DATA.length} testers from QA Team...`);
  for (const td of TESTER_DATA) {
    const user = await prisma.user.findUnique({ where: { email: td.email } });
    if (!user) { console.warn(`  ⚠ Not found: ${td.email}`); continue; }

    await prisma.testerProfile.upsert({
      where:  { userId: user.id },
      update: { isActive: true },
      create: { userId: user.id, isActive: true },
    });

    let n = 0;
    for (let i = 0; i < created.length; i++) {
      const level = td.levels[i] ?? 0;
      if (level > 0) {
        await prisma.testerSkill.create({ data: { userId: user.id, skillId: created[i].id, level } });
        n++;
      }
    }
    console.log(`  ✅ ${user.fullName} — ${n} entries`);
  }

  console.log(`\nDone! testers=${TESTER_DATA.length}, skills=${SKILLS.length}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
