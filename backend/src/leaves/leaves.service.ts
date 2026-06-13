import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import axios from 'axios';

const prisma = new PrismaClient();

// ── Holiday import helpers ────────────────────────────────────────────────────

const HOLIDAY_NAME_MAP: Record<string, string> = {
  'Rosh Hashana':       'ראש השנה',
  'Yom Kippur':         'יום כיפור',
  'Sukkot':             'סוכות',
  'Shmini Atzeret':     'שמיני עצרת',
  'Simchat Torah':      'שמחת תורה',
  'Chanukah':           'חנוכה',
  'Tu BiShvat':         'ט"ו בשבט',
  'Purim':              'פורים',
  'Shushan Purim':      'שושן פורים',
  'Pesach':             'פסח',
  'Shavuot':            'שבועות',
  'Tisha B\'Av':        'תשעה באב',
  'Lag BaOmer':         'ל"ג בעומר',
  'Tu B\'Av':           'ט"ו באב',
  'Yom HaShoah':        'יום השואה',
  'Yom HaZikaron':      'יום הזיכרון',
  'Yom HaAtzmaut':      'יום העצמאות',
  'Yom Yerushalayim':   'יום ירושלים',
};

function normalizeHolidayTitle(title: string): string | null {
  let t = title.replace(/\s+[IVX]+\s*$/, '').trim();
  if (t.startsWith('Erev ')) t = t.slice(5);
  return HOLIDAY_NAME_MAP[t] ?? null;
}

// Meeus/Jones/Butcher algorithm for Western Easter
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

@Injectable()
export class LeavesService {

  // ── Seasons ──────────────────────────────────────────────────────────────────

  async getSeasons() {
    return prisma.season.findMany({
      orderBy: { sortOrder: 'asc' },
      include: {
        dates: { orderBy: { orderIndex: 'asc' } },
      },
    });
  }

  async createSeason(data: { name: string; dateRange: string; isActive?: boolean; sortOrder?: number }) {
    return prisma.season.create({ data, include: { dates: true } });
  }

  async updateSeason(id: string, data: { name?: string; dateRange?: string; isActive?: boolean; sortOrder?: number }) {
    return prisma.season.update({ where: { id }, data, include: { dates: true } });
  }

  async addSeasonDate(seasonId: string, data: { date: string; label: string; type: string; orderIndex?: number }) {
    await prisma.season.findUniqueOrThrow({ where: { id: seasonId } });
    return prisma.seasonDate.create({
      data: {
        seasonId,
        date: new Date(data.date),
        label: data.label,
        type: data.type,
        orderIndex: data.orderIndex ?? 0,
      },
    });
  }

  async importHolidays(year: number): Promise<{ created: number; skipped: number }> {
    // ── 1. Fetch Jewish / Israeli holidays from Hebcal ─────────────────────────
    const hebcalUrl =
      `https://www.hebcal.com/hebcal?v=1&cfg=json&year=${year}&maj=on&min=on&mod=on&mf=on&c=off&i=off`;
    let hebcalItems: any[] = [];
    try {
      const res = await axios.get(hebcalUrl, { timeout: 12000 });
      hebcalItems = res.data?.items ?? [];
    } catch {
      // non-fatal — continue with fixed holidays only
    }

    // ── 2. Group Hebcal items by normalized name ───────────────────────────────
    const groups = new Map<string, { date: Date; label: string }[]>();

    for (const item of hebcalItems) {
      if (!['holiday', 'minor'].includes(item.category)) continue;
      const name = normalizeHolidayTitle(item.title);
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name)!.push({ date: new Date(item.date), label: item.hebrew || item.title });
    }

    // ── 3. Fixed non-Jewish holidays ───────────────────────────────────────────
    const fixed: { name: string; date: string; label: string }[] = [
      { name: 'חג המולד',  date: `${year}-12-25`, label: 'חג המולד (נוצרי)' },
      { name: 'פסחא',      date: calcEaster(year), label: 'פסחא (נוצרי)'     },
    ];
    for (const h of fixed) {
      if (!groups.has(h.name)) groups.set(h.name, []);
      groups.get(h.name)!.push({ date: new Date(h.date), label: h.label });
    }

    // ── 4. Upsert seasons ─────────────────────────────────────────────────────
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
      if (existing) { skipped++; continue; }

      const season = await prisma.season.create({
        data: { name: seasonName, dateRange, isActive: false, sortOrder: first.getTime() },
      });

      for (const [i, d] of dates.entries()) {
        await prisma.seasonDate.create({
          data: { seasonId: season.id, date: d.date, label: d.label, type: 'holiday', orderIndex: i },
        });
      }
      created++;
    }

    return { created, skipped };
  }

  // ── Requests — employee ──────────────────────────────────────────────────────

  async getMyRequests(userId: string) {
    return prisma.leaveRequest.findMany({
      where: { userId },
      orderBy: { date: 'asc' },
      include: { season: { select: { id: true, name: true } } },
    });
  }

  async submitRequest(userId: string, data: { seasonId?: string; date: string; kind: string; reason?: string }) {
    const existing = await prisma.leaveRequest.findFirst({
      where: { userId, date: new Date(data.date) },
    });
    if (existing) {
      return prisma.leaveRequest.update({
        where: { id: existing.id },
        data: { kind: data.kind, reason: data.reason ?? null, status: 'PENDING' },
        include: { season: { select: { id: true, name: true } } },
      });
    }
    return prisma.leaveRequest.create({
      data: {
        userId,
        seasonId: data.seasonId ?? null,
        date: new Date(data.date),
        kind: data.kind,
        reason: data.reason ?? null,
        status: 'PENDING',
      },
      include: { season: { select: { id: true, name: true } } },
    });
  }

  async cancelRequest(userId: string, requestId: string) {
    const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('בקשה לא נמצאה');
    if (req.userId !== userId) throw new ForbiddenException('אין הרשאה לבטל בקשה זו');
    await prisma.leaveRequest.delete({ where: { id: requestId } });
    return { ok: true };
  }

  // ── Requests — admin ─────────────────────────────────────────────────────────

  async getAllRequests(seasonId?: string) {
    return prisma.leaveRequest.findMany({
      where: seasonId ? { seasonId } : undefined,
      orderBy: { date: 'asc' },
      include: {
        user:   { select: { id: true, fullName: true, email: true } },
        season: { select: { id: true, name: true } },
      },
    });
  }

  async updateRequestStatus(requestId: string, status: 'APPROVED' | 'DECLINED') {
    const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('בקשה לא נמצאה');
    return prisma.leaveRequest.update({
      where: { id: requestId },
      data: { status },
      include: {
        user:   { select: { id: true, fullName: true, email: true } },
        season: { select: { id: true, name: true } },
      },
    });
  }
}
