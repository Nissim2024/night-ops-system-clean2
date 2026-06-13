import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
}

@Injectable()
export class ActivityBoardService {

  async getBoard(versionId: string) {
    return prisma.activityBoardEntry.findMany({
      where: { versionId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async saveBoard(versionId: string, entries: EntryInput[]) {
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
      })),
    });
    return prisma.activityBoardEntry.findMany({
      where: { versionId },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async patchEntry(entryId: string, patch: EntryPatch) {
    const entry = await prisma.activityBoardEntry.findUnique({ where: { id: entryId } });
    if (!entry) throw new NotFoundException('רשומה לא נמצאה');
    return prisma.activityBoardEntry.update({
      where: { id: entryId },
      data: patch,
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
