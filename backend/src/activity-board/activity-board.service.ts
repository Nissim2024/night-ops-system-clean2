import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EmailService } from '../email/email.service';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

export interface EntryInput {
  activityKey:   string;
  label:         string;
  owner:         string;
  ownerEmployee: string;
  notes:         string;
  attendees:     string[];
  category:      string;
  dateStart:     string | null;
  dateEnd:       string | null;
  sortOrder:     number;
  isRelevant:    boolean;
  isCustom:      boolean;
}

export interface EntryPatch {
  label?:         string;
  owner?:         string;
  ownerEmployee?: string;
  notes?:         string;
  attendees?:     string[];
  category?:      string;
  isRelevant?:    boolean;
  dateStart?:     string | null;
  dateEnd?:       string | null;
}

@Injectable()
export class ActivityBoardService {
  constructor(private readonly email: EmailService) {}

  // Sends a real calendar meeting invite (ICS) for this activity to the chosen
  // recipients, and remembers them on the entry's own `attendees` field so the
  // picker is pre-filled next time (re-sending updates the same calendar entry
  // rather than duplicating it, via the stable uid).
  async sendInvite(entryId: string, attendees: string[]) {
    const entry = await prisma.activityBoardEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('פעילות לא נמצאה');
    if (!entry.dateStart) throw new BadRequestException('לא הוגדר תאריך התחלה לפעילות זו');

    const start = entry.dateStart;
    const end = entry.dateEnd && entry.dateEnd > start ? entry.dateEnd : new Date(start.getTime() + 30 * 60000);

    try {
      await this.email.sendCalendarInvite({
        uid: `activity-${entryId}@deploycenter`,
        subject: entry.label,
        description: [entry.notes, entry.owner ? `אחראי: ${entry.owner}${entry.ownerEmployee ? ` · ${entry.ownerEmployee}` : ''}` : '']
          .filter(Boolean).join('\n'),
        start, end,
        attendees,
      });
    } catch (err: any) {
      throw new BadRequestException(err.message || 'שגיאה בשליחת הזימון');
    }

    await prisma.activityBoardEntry.update({ where: { id: entryId }, data: { attendees } });
    return { ok: true };
  }

  async getBoard(versionId: string) {
    return prisma.activityBoardEntry.findMany({
      where: { versionId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // Deletes every activity-board entry for this version — the granular
  // counterpart to Version.delete() (which used to be the only way to clear
  // this data, by deleting the whole version). Recoverable only by rebuilding
  // the board from scratch — there is no undo.
  async deleteBoard(versionId: string) {
    await prisma.activityBoardEntry.deleteMany({ where: { versionId } });
    return { ok: true };
  }

  async saveBoard(versionId: string, entries: EntryInput[]) {
    // The board is saved by delete+recreate — carry each activity's "בוצע"
    // mark over by activityKey, or every save would silently un-done it.
    const prevDone = new Map(
      (await prisma.activityBoardEntry.findMany({ where: { versionId, doneAt: { not: null } }, select: { activityKey: true, doneAt: true, doneBy: true } }))
        .map(e => [e.activityKey, e]),
    );
    await prisma.activityBoardEntry.deleteMany({ where: { versionId } });
    if (entries.length === 0) return [];
    await prisma.activityBoardEntry.createMany({
      data: entries.map(e => ({
        versionId,
        activityKey:   e.activityKey,
        label:         e.label,
        owner:         e.owner,
        ownerEmployee: e.ownerEmployee ?? '',
        notes:         e.notes,
        attendees:     e.attendees,
        category:      e.category,
        dateStart:     e.dateStart ? new Date(e.dateStart) : null,
        dateEnd:       e.dateEnd   ? new Date(e.dateEnd)   : null,
        sortOrder:     e.sortOrder,
        isRelevant:    e.isRelevant,
        isCustom:      e.isCustom,
        doneAt:        prevDone.get(e.activityKey)?.doneAt ?? null,
        doneBy:        prevDone.get(e.activityKey)?.doneBy ?? null,
      })),
    });
    return prisma.activityBoardEntry.findMany({
      where: { versionId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  // Mark / unmark an activity as done. Allowed for the activity's own
  // assigned employee (matched by full name — that's what OwnerPicker
  // stores in ownerEmployee) or anyone the controller already cleared as a
  // board manager.
  async setDone(entryId: string, done: boolean, user: { sub: string }, isBoardManager: boolean) {
    const entry = await prisma.activityBoardEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('פעילות לא נמצאה');
    const me = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    const isOwner = !!me?.fullName && !!entry.ownerEmployee
      && me.fullName.trim().toLowerCase() === entry.ownerEmployee.trim().toLowerCase();
    if (!isOwner && !isBoardManager) throw new ForbiddenException('רק העובד האחראי או מנהל לוח הפעילויות יכולים לסמן ביצוע');
    return prisma.activityBoardEntry.update({
      where: { id: entryId },
      data: done ? { doneAt: new Date(), doneBy: me?.fullName ?? null } : { doneAt: null, doneBy: null },
    });
  }

  async patchEntry(entryId: string, patch: EntryPatch) {
    const entry = await prisma.activityBoardEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('רשומה לא נמצאה');
    // doneAt/doneBy only change through setDone() (ownership-checked)
    const { dateStart, dateEnd, doneAt: _da, doneBy: _db, ...rest } = patch as EntryPatch & { doneAt?: unknown; doneBy?: unknown };
    return prisma.activityBoardEntry.update({
      where: { id: entryId },
      data: {
        ...rest,
        ...(dateStart !== undefined && { dateStart: dateStart ? new Date(dateStart) : null }),
        ...(dateEnd   !== undefined && { dateEnd:   dateEnd   ? new Date(dateEnd)   : null }),
      },
    });
  }

  async patchByKey(versionId: string, activityKey: string, patch: EntryPatch) {
    const entry = await prisma.activityBoardEntry.findFirst({ where: { versionId, activityKey } });
    if (!entry) return null;
    const { dateStart, dateEnd, doneAt: _da, doneBy: _db, ...rest } = patch as EntryPatch & { doneAt?: unknown; doneBy?: unknown };
    return prisma.activityBoardEntry.update({
      where: { id: entry.id },
      data: {
        ...rest,
        ...(dateStart !== undefined && { dateStart: dateStart ? new Date(dateStart) : null }),
        ...(dateEnd   !== undefined && { dateEnd:   dateEnd   ? new Date(dateEnd)   : null }),
      },
    });
  }

  async bulkReplace(versionId: string, from: string, to: string) {
    const entries = await prisma.activityBoardEntry.findMany({ where: { versionId } });
    let updated = 0;
    for (const e of entries) {
      const newOwner     = e.owner.includes(from) ? e.owner.replace(new RegExp(from, 'g'), to) : e.owner;
      const newAttendees = e.attendees.map(a => a.replace(new RegExp(from, 'g'), to));
      const ownerChanged     = newOwner !== e.owner;
      const attendeesChanged = newAttendees.some((a, i) => a !== e.attendees[i]);
      if (ownerChanged || attendeesChanged) {
        await prisma.activityBoardEntry.update({
          where: { id: e.id },
          data: { owner: newOwner, attendees: newAttendees },
        });
        updated++;
      }
    }
    return { updated };
  }
}
