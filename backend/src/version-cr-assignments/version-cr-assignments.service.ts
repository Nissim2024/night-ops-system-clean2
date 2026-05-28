import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

// Mock CR→team distribution used when QC_ENABLED=false
// Keys are CR numbers, values are team-index assignments (round-robin by default)
const MOCK_CR_ITEMS: { id: string; label: string }[] = [
  { id: '12969', label: '12969 - דרישות חדשות מערכת תזכורות ב-CRM' },
  { id: '13072', label: '13072 - שינוי בהתנהלות של מסך AI' },
  { id: '12821', label: '12821 - שירות חשמל בכתובות ללא תשתית הוט' },
  { id: '13145', label: '13145 - שיפור ביצועי מודול ה-Addressability' },
  { id: '13201', label: '13201 - תיקון רישום כפול בממשק בנקים' },
  { id: '13312', label: '13312 - עדכון חשבוניות ודף מקדים HOTNET' },
  { id: '13387', label: '13387 - שינויים בתהליך TOP TECH' },
  { id: '13410', label: '13410 - Wizard HOTNET — תיקוני ממשק' },
  { id: '13455', label: '13455 - CRM — עדכון מסך AI בחטיבת שירות' },
  { id: '13502', label: '13502 - Web Site NEXT — עדכוני עיצוב' },
];

@Injectable()
export class VersionCrAssignmentsService {

  async findForTeam(versionId: string, user: { sub: string; role: string }) {
    if (MANAGERS.includes(user.role)) {
      return prisma.versionCrAssignment.findMany({
        where: { versionId },
        include: { team: { select: { id: true, name: true } } },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
    }
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];
    return prisma.versionCrAssignment.findMany({
      where: { versionId, teamId: membership.teamId },
      orderBy: { crNumber: 'asc' },
    });
  }

  async importFromQc(versionId: string, user: { sub: string; role: string }) {
    if (!MANAGERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');

    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new Error('גרסה לא נמצאה');

    const teams = await prisma.team.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
    if (!teams.length) throw new Error('לא נמצאו צוותים פעילים');

    // In real mode: query Oracle QC for version-specific CRs with team assignments.
    // Mock: distribute MOCK_CR_ITEMS round-robin across active teams.
    const assignments = MOCK_CR_ITEMS.map((cr, i) => ({
      versionId,
      crNumber: cr.id,
      crLabel: cr.label,
      teamId: teams[i % teams.length].id,
    }));

    let created = 0;
    for (const a of assignments) {
      const exists = await prisma.versionCrAssignment.findFirst({
        where: { versionId: a.versionId, crNumber: a.crNumber, teamId: a.teamId },
      });
      if (!exists) {
        await prisma.versionCrAssignment.create({ data: a });
        created++;
      }
    }

    return { imported: created, total: assignments.length };
  }

  async clearForVersion(versionId: string, user: { sub: string; role: string }) {
    if (!MANAGERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל');
    const { count } = await prisma.versionCrAssignment.deleteMany({ where: { versionId } });
    return { deleted: count };
  }
}
