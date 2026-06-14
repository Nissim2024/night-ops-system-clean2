import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

const HOLIDAY_NAME_MAP: Record<string, string> = {
  'Rosh Hashana':     'ראש השנה',
  'Yom Kippur':       'יום כיפור',
  'Sukkot':           'סוכות',
  'Shmini Atzeret':   'שמיני עצרת',
  'Simchat Torah':    'שמחת תורה',
  'Chanukah':         'חנוכה',
  'Tu BiShvat':       'ט"ו בשבט',
  'Purim':            'פורים',
  'Shushan Purim':    'שושן פורים',
  'Pesach':           'פסח',
  'Shavuot':          'שבועות',
  "Tisha B'Av":       'תשעה באב',
  'Lag BaOmer':       'ל"ג בעומר',
  "Tu B'Av":          'ט"ו באב',
  'Yom HaShoah':      'יום השואה',
  'Yom HaZikaron':    'יום הזיכרון',
  'Yom HaAtzmaut':    'יום העצמאות',
  'Yom Yerushalayim': 'יום ירושלים',
};

const HOLIDAY_GROUP_MAP: Record<string, string> = {
  'ראש השנה':   'חגי תשרי',
  'יום כיפור':  'חגי תשרי',
  'סוכות':      'חגי תשרי',
  'שמיני עצרת': 'חגי תשרי',
  'שמחת תורה':  'חגי תשרי',
  'פורים':      'פורים',
  'שושן פורים': 'פורים',
  'פסח':        'פסח',
};

function normalizeHolidayTitle(title: string): string | null {
  let t = title.replace(/\s+[IVX]+\s*$/, '').trim();
  if (t.startsWith('Erev ')) t = t.slice(5);
  return HOLIDAY_NAME_MAP[t] ?? null;
}

function calcEaster(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day   = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}

function fmt(d: Date): string {
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

async function main() {
  const year = 2026;
  const hebcalUrl = `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&maj=on&min=on&mod=on&mf=on&c=off&i=off`;

  console.log('Fetching holidays from Hebcal...');
  const res = await axios.get(hebcalUrl, { timeout: 12000 });
  const hebcalItems: any[] = res.data?.items ?? [];
  console.log(`Fetched ${hebcalItems.length} items`);

  const groups = new Map<string, { date: Date; label: string }[]>();

  for (const item of hebcalItems) {
    if (!['holiday', 'minor'].includes(item.category)) continue;
    const name = normalizeHolidayTitle(item.title);
    if (!name) continue;
    const groupName = HOLIDAY_GROUP_MAP[name] ?? name;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName)!.push({ date: new Date(item.date), label: name });
  }

  // Fixed holidays
  groups.set('חג המולד', [{ date: new Date(`${year}-12-25`), label: 'חג המולד (נוצרי)' }]);
  groups.set('פסחא',     [{ date: new Date(calcEaster(year)), label: 'פסחא (נוצרי)' }]);

  // Summer vacation
  groups.set('חופשת קייץ', [
    { date: new Date(`${year}-07-01`), label: 'יולי' },
    { date: new Date(`${year}-08-31`), label: 'אוגוסט' },
  ]);

  let created = 0, skipped = 0;

  for (const [name, dates] of groups) {
    if (!dates.length) continue;
    dates.sort((a, b) => a.date.getTime() - b.date.getTime());

    const seasonName = `${name} ${year}`;
    const first = dates[0].date, last = dates[dates.length - 1].date;
    const dateRange = first.getTime() === last.getTime()
      ? fmt(first)
      : `${fmt(first)} — ${fmt(last)}`;

    const existing = await prisma.season.findFirst({ where: { name: seasonName } });
    if (existing) {
      console.log(`⏭  Skipping (exists): ${seasonName}`);
      skipped++;
      continue;
    }

    const season = await prisma.season.create({
      data: { name: seasonName, dateRange, isActive: false, sortOrder: Math.floor(first.getTime() / 86400000) },
    });

    for (const [i, d] of dates.entries()) {
      await prisma.seasonDate.create({
        data: { seasonId: season.id, date: d.date, label: d.label, type: 'holiday', orderIndex: i },
      });
    }
    console.log(`✅ Created: ${seasonName} (${dates.length} dates)`);
    created++;
  }

  console.log(`\nDone: ${created} created, ${skipped} skipped`);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
