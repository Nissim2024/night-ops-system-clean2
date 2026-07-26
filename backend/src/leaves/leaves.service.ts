import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
  'Tish\'a B\'Av':      'תשעה באב', // hebcal spells this with an apostrophe after "Tish"
  'Lag BaOmer':         'ל"ג בעומר',
  'Tu B\'Av':           'ט"ו באב',
  'Yom HaShoah':        'יום השואה',
  'Yom HaZikaron':      'יום הזיכרון',
  'Yom HaAtzmaut':      'יום העצמאות',
  'Yom HaAtzma\'ut':    'יום העצמאות', // hebcal spells this with an apostrophe before "ut"
  'Yom Yerushalayim':   'יום ירושלים',
};

// Umbrella seasons: multiple holidays grouped under one season name
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
// Holidays not in HOLIDAY_GROUP_MAP each become their own season.

function normalizeHolidayTitle(title: string): string | null {
  let t = title
    .replace(/:\s*\d+(st|nd|rd|th)?\s*(Candles?|Day)\s*$/i, '') // "Chanukah: 1 Candle" / "Chanukah: 8th Day" → "Chanukah"
    .replace(/\s*\(CH.?.?M\)\s*$/i, '')  // "Sukkot III (CH''M)" → "Sukkot III"
    .replace(/\s+\d{4}\s*$/, '')         // "Rosh Hashana 5787" → "Rosh Hashana"
    .replace(/\s+[IVX]+\s*$/, '')        // "Sukkot II" → "Sukkot"
    .trim();
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
      orderBy: { sortOrder: 'desc' },
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
    // ── 1. Compute Jewish / Israeli holidays locally ───────────────────────────
    // Uses @hebcal/core (offline Hebrew-calendar math, no network call) instead of
    // the hebcal.com REST API — the production server is air-gapped and has no
    // outbound internet access, so the previous fetch silently failed every time
    // and only the "fixed" (non-Jewish) holidays below ever got imported.
    let hebcalItems: { date: string; title: string }[] = [];
    try {
      const { HebrewCalendar } = await import('@hebcal/core');
      const events = HebrewCalendar.calendar({ year, isHebrewYear: false, il: false });
      hebcalItems = events
        .filter(ev => (ev.getCategories?.() ?? []).includes('holiday'))
        .map(ev => {
          const g = ev.getDate().greg();
          const utcMidnight = new Date(Date.UTC(g.getFullYear(), g.getMonth(), g.getDate()));
          return { date: utcMidnight.toISOString().slice(0, 10), title: ev.getDesc() };
        });
    } catch {
      // non-fatal — continue with fixed holidays only
    }

    // ── 2. Group Hebcal items by umbrella season name ─────────────────────────
    const groups = new Map<string, { date: Date; label: string }[]>();

    for (const item of hebcalItems) {
      const name = normalizeHolidayTitle(item.title);
      if (!name) continue;
      const groupName = HOLIDAY_GROUP_MAP[name] ?? name;
      if (!groups.has(groupName)) groups.set(groupName, []);
      // Use the specific holiday name as the date label
      groups.get(groupName)!.push({ date: new Date(item.date), label: name });
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

    // ── 3b. חופשת קייץ (יולי–אוגוסט) ─────────────────────────────────────────
    groups.set('חופשת קייץ', [
      { date: new Date(`${year}-07-01`), label: 'יולי' },
      { date: new Date(`${year}-08-31`), label: 'אוגוסט' },
    ]);

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
        data: { name: seasonName, dateRange, isActive: false, sortOrder: Math.floor(first.getTime() / 86400000) },
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

  async submitRequest(userId: string, data: { seasonId?: string; date: string; kind: string; reason?: string; groupId?: string }) {
    const existing = await prisma.leaveRequest.findFirst({
      where: { userId, date: new Date(data.date) },
    });
    // Resubmitting (e.g. after a decline or a self-cancel) starts a fresh
    // approval cycle — clear out the previous decision/cancellation trail
    // so it doesn't read as if it belonged to this new request.
    if (existing) {
      return prisma.leaveRequest.update({
        where: { id: existing.id },
        data: {
          kind: data.kind, reason: data.reason ?? null, status: 'PENDING', groupId: data.groupId ?? null,
          decidedByName: null, decidedAt: null, cancelledByName: null, cancelledAt: null, cancelReason: null,
        },
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
        groupId: data.groupId ?? null,
      },
      include: { season: { select: { id: true, name: true } } },
    });
  }

  // Employee cancelling their own request — allowed regardless of current
  // status (including an already-APPROVED leave), per product decision:
  // the employee may change their mind after approval, but the cancellation
  // must be visible to the manager (status + cancelledByName/At/reason),
  // not silently deleted.
  async cancelRequest(userId: string, requestId: string, reason?: string) {
    const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('בקשה לא נמצאה');
    if (req.userId !== userId) throw new ForbiddenException('אין הרשאה לבטל בקשה זו');
    if (req.status === 'CANCELLED') throw new ForbiddenException('הבקשה כבר בוטלה');
    const actor = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
    await this.applyCancellation(req, actor?.fullName ?? 'עובד', reason);
    return { ok: true };
  }

  // Shared by employee self-cancel and manager-initiated cancel: cascades to
  // every day sharing the same groupId (a range submitted together), same
  // as the existing approve/decline cascade below.
  private async applyCancellation(req: { id: string; userId: string; groupId: string | null }, actorName: string, reason?: string) {
    const data = {
      status: 'CANCELLED' as const,
      cancelledByName: actorName,
      cancelledAt: new Date(),
      cancelReason: reason ?? null,
    };
    if (req.groupId) {
      await prisma.leaveRequest.updateMany({ where: { groupId: req.groupId, userId: req.userId }, data });
    } else {
      await prisma.leaveRequest.update({ where: { id: req.id }, data });
    }
  }

  // ── Requests — admin / team lead ─────────────────────────────────────────────

  // TEAM_LEAD only sees/approves requests from members of team(s) they lead (TeamMember.isLead).
  // ADMIN sees everything, unscoped.
  private async scopedUserIds(actingUserId: string, actingRole: string): Promise<string[] | null> {
    if (actingRole === 'ADMIN') return null; // null = no filter
    const ledTeams = await prisma.teamMember.findMany({ where: { userId: actingUserId, isLead: true }, select: { teamId: true } });
    if (ledTeams.length === 0) return [];
    const members = await prisma.teamMember.findMany({
      where: { teamId: { in: ledTeams.map(t => t.teamId) } },
      select: { userId: true },
    });
    return members.map(m => m.userId);
  }

  async getAllRequests(seasonId: string | undefined, actingUserId: string, actingRole: string) {
    const scoped = await this.scopedUserIds(actingUserId, actingRole);
    if (scoped !== null && scoped.length === 0) return [];
    return prisma.leaveRequest.findMany({
      where: {
        ...(seasonId ? { seasonId } : {}),
        ...(scoped !== null ? { userId: { in: scoped } } : {}),
      },
      orderBy: { date: 'asc' },
      include: {
        user:   { select: { id: true, fullName: true, email: true } },
        season: { select: { id: true, name: true } },
      },
    });
  }

  async getPendingCount(actingUserId: string, actingRole: string): Promise<number> {
    const scoped = await this.scopedUserIds(actingUserId, actingRole);
    if (scoped !== null && scoped.length === 0) return 0;
    return prisma.leaveRequest.count({
      where: {
        status: 'PENDING',
        ...(scoped !== null ? { userId: { in: scoped } } : {}),
      },
    });
  }

  async updateRequestStatus(
    requestId: string,
    status: 'APPROVED' | 'DECLINED' | 'CANCELLED',
    actingUserId: string,
    actingRole: string,
    reason?: string,
  ) {
    const req = await prisma.leaveRequest.findUnique({ where: { id: requestId } });
    if (!req) throw new NotFoundException('בקשה לא נמצאה');
    if (actingRole !== 'ADMIN') {
      const scoped = await this.scopedUserIds(actingUserId, actingRole);
      if (scoped === null || !scoped.includes(req.userId)) {
        throw new ForbiddenException('אין הרשאה לטפל בבקשה של עובד מחוץ לצוות שלך');
      }
    }
    const actor = await prisma.user.findUnique({ where: { id: actingUserId }, select: { fullName: true } });
    const actorName = actor?.fullName ?? 'מנהל';

    if (status === 'CANCELLED') {
      // Manager-initiated cancel — allowed on a request in any status,
      // including one already APPROVED, same as the employee self-cancel path.
      await this.applyCancellation(req, actorName, reason);
    } else {
      // A request submitted as part of a date range shares one groupId across every
      // day — approving/declining any one of them applies to the whole range in a
      // single manager action, not day-by-day.
      const data = { status, decidedByName: actorName, decidedAt: new Date() };
      if (req.groupId) {
        await prisma.leaveRequest.updateMany({ where: { groupId: req.groupId, userId: req.userId }, data });
      } else {
        await prisma.leaveRequest.update({ where: { id: requestId }, data });
      }
    }
    return prisma.leaveRequest.findUnique({
      where: { id: requestId },
      include: {
        user:   { select: { id: true, fullName: true, email: true } },
        season: { select: { id: true, name: true } },
      },
    });
  }
}
