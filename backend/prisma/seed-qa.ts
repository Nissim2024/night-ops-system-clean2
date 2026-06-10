import { PrismaClient, SkillType } from '@prisma/client';

const prisma = new PrismaClient();

const SKILLS: { name: string; type: SkillType; weight: number }[] = [
  // ── מקצועיות (Professional) — sum = 36 ──────────────────────────────────
  { name: 'הכנת אפיון',                         type: SkillType.Professional, weight: 3 },
  { name: 'הכנת TDR',                           type: SkillType.Professional, weight: 2 },
  { name: 'כתיבת STD',                          type: SkillType.Professional, weight: 3 },
  { name: 'יכולת הצגת תקלות אפליקציות',         type: SkillType.Professional, weight: 1 },
  { name: 'מציאת תקלות איכות',                  type: SkillType.Professional, weight: 3 },
  { name: 'תיעוד תקלות',                        type: SkillType.Professional, weight: 2 },
  { name: 'מעקב אחר תקלות',                     type: SkillType.Professional, weight: 2 },
  { name: 'כיסוי הבדיקות',                      type: SkillType.Professional, weight: 3 },
  { name: 'סימון תסריטים',                      type: SkillType.Professional, weight: 3 },
  { name: 'הכנת מתודולוגיות QA',                type: SkillType.Professional, weight: 2 },
  { name: 'עמידה בזמנים',                       type: SkillType.Professional, weight: 2 },
  { name: 'באגים שברחו ליצור',                  type: SkillType.Professional, weight: 4 },
  { name: 'תקלות סרק',                          type: SkillType.Professional, weight: 4 },
  { name: 'יכולת ניהול וחלוקת זמן',             type: SkillType.Professional, weight: 2 },

  // ── ידע - נשיאים (Applications) — sum = 22 ──────────────────────────────
  { name: 'Wizard',                              type: SkillType.Applications, weight: 2 },
  { name: 'CRM',                                 type: SkillType.Applications, weight: 2 },
  { name: 'ZOO',                                 type: SkillType.Applications, weight: 2 },
  { name: 'Provisioning',                        type: SkillType.Applications, weight: 2 },
  { name: 'TOP',                                 type: SkillType.Applications, weight: 2 },
  { name: 'OSB',                                 type: SkillType.Applications, weight: 2 },
  { name: 'WEB',                                 type: SkillType.Applications, weight: 2 },
  { name: 'DWH',                                 type: SkillType.Applications, weight: 2 },
  { name: 'Remedy',                              type: SkillType.Applications, weight: 2 },
  { name: 'IVR',                                 type: SkillType.Applications, weight: 2 },
  { name: 'ERP',                                 type: SkillType.Applications, weight: 2 },

  // ── כלים (Tools) — sum = 6 ──────────────────────────────────────────────
  { name: 'SQL',                                 type: SkillType.Tools, weight: 1 },
  { name: 'UNIX',                                type: SkillType.Tools, weight: 1 },
  { name: 'Selenium',                            type: SkillType.Tools, weight: 1 },
  { name: 'Jmeter',                              type: SkillType.Tools, weight: 1 },
  { name: 'QC',                                  type: SkillType.Tools, weight: 1 },
  { name: 'Scripting',                           type: SkillType.Tools, weight: 1 },

  // ── אישי (Personal) — sum = 23 ──────────────────────────────────────────
  { name: 'יכולת הובלת פרויקט',                 type: SkillType.Personal, weight: 2 },
  { name: 'יכולת למידה עצמית',                  type: SkillType.Personal, weight: 2 },
  { name: 'קבלת סמכות',                         type: SkillType.Personal, weight: 2 },
  { name: 'יכולת קבלת ביקורת',                  type: SkillType.Personal, weight: 3 },
  { name: 'יכולת עמידה בלחץ',                   type: SkillType.Personal, weight: 3 },
  { name: 'יחסי אנוש',                          type: SkillType.Personal, weight: 3 },
  { name: 'יישום ביקורת',                       type: SkillType.Personal, weight: 2 },
  { name: 'מוטיבציה',                           type: SkillType.Personal, weight: 2 },
  { name: 'שגר ושכח',                           type: SkillType.Personal, weight: 2 },
  { name: 'מידת הנק שיגרם אם יעזוב',            type: SkillType.Personal, weight: 2 },
];

async function main() {
  console.log('Clearing existing QA data...');
  await prisma.testerSkill.deleteMany();
  await prisma.testerProfile.deleteMany();
  await prisma.skill.deleteMany();

  console.log(`Inserting ${SKILLS.length} skills...`);
  for (const skill of SKILLS) {
    await prisma.skill.create({ data: skill });
  }

  const counts = {
    Professional: SKILLS.filter(s => s.type === SkillType.Professional).length,
    Applications: SKILLS.filter(s => s.type === SkillType.Applications).length,
    Tools:        SKILLS.filter(s => s.type === SkillType.Tools).length,
    Personal:     SKILLS.filter(s => s.type === SkillType.Personal).length,
  };
  console.log('Done!', counts);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
