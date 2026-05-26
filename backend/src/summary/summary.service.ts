import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, BorderStyle, WidthType, ShadingType,
  LevelFormat,
} from 'docx';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const border = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' };
const borders = { top: border, bottom: border, left: border, right: border };

@Injectable()
export class SummaryService {

  async generateSummary(versionId: string, headline: string, morningNotes: string, isRehearsal = false, preloadedTasks?: any[]) {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { creator: { select: { fullName: true } } },
    });

    const tasks = preloadedTasks ?? await prisma.task.findMany({
      where: { versionId },
      include: { assignedTeam: { select: { name: true } } },
      orderBy: { orderIndex: 'asc' },
    });

    const doneTasks = tasks.filter(t => t.status === 'DONE');
    const blockedTasks = tasks.filter(t => t.status === 'BLOCKED' || t.status === 'FAILED');
    const tasksWithCR = tasks.filter(t => t.crNumber && t.status === 'DONE');
    const morningFollowup = tasks.filter(t => t.morningFollowup);

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } },
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
          },
        },
        children: [
          // כותרת
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 200 },
            children: [new TextRun({ text: isRehearsal ? `סיכום חזרה גנרלית — גרסת ${version?.name}` : `סיכום גרסת ${version?.name}`, bold: true, size: 48, font: 'Arial', color: isRehearsal ? '8B4000' : '1E3A5F' })],
          }),
          ...(isRehearsal ? [new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 100 },
            children: [new TextRun({ text: '⚠ מסמך זה הופק מחזרה גנרלית ואינו משקף לילה אמיתי', bold: true, size: 22, font: 'Arial', color: 'C0392B' })],
          })] : []),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 400 },
            children: [new TextRun({ text: new Date().toLocaleDateString('he-IL'), size: 22, color: '666666', font: 'Arial' })],
          }),

          // עיקרי הדברים
          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 }, children: [new TextRun({ text: 'עיקרי הדברים', bold: true, size: 28, color: '1E3A5F', font: 'Arial' })] }),
          new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: headline || 'הגרסה הסתיימה', size: 22, font: 'Arial', color: '333333' })] }),

          // סטטוס כללי
          new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 }, children: [new TextRun({ text: 'סטטוס כללי', bold: true, size: 28, color: '1E3A5F', font: 'Arial' })] }),
          new Paragraph({ spacing: { after: 300 }, children: [new TextRun({ text: `הושלמו ${doneTasks.length} מתוך ${tasks.length} משימות.`, size: 22, font: 'Arial' })] }),

          // תקלות
          ...(blockedTasks.length > 0 ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 }, children: [new TextRun({ text: `תקלות (${blockedTasks.length})`, bold: true, size: 28, color: '7B0000', font: 'Arial' })] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: [3000, 2000, 2000, 2360],
              rows: [
                new TableRow({
                  children: ['משימה', 'צוות', 'סטטוס', 'סיבה'].map(h =>
                    new TableCell({ borders, shading: { fill: 'D6E4F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: '1E3A5F' })] })] })
                  ),
                }),
                ...blockedTasks.map((task, i) => new TableRow({
                  children: [
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.title, size: 19, font: 'Arial' })] })] }),
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.assignedTeam?.name || '—', size: 19, font: 'Arial' })] })] }),
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.status === 'DONE' ? 'נפתרה' : 'פתוחה', size: 19, font: 'Arial', color: task.status === 'DONE' ? '27ae60' : 'e74c3c' })] })] }),
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.blockedReason || '—', size: 19, font: 'Arial' })] })] }),
                  ],
                })),
              ],
            }),
          ] : []),

          // CRים
          ...(tasksWithCR.length > 0 ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 }, children: [new TextRun({ text: `תכולה שנבדקה (${tasksWithCR.length} CRים)`, bold: true, size: 28, color: '1E3A5F', font: 'Arial' })] }),
            new Table({
              width: { size: 9360, type: WidthType.DXA },
              columnWidths: [3500, 1500, 2000, 2360],
              rows: [
                new TableRow({
                  children: ['כותרת', 'CR#', 'צוות', 'עובד'].map(h =>
                    new TableCell({ borders, shading: { fill: 'D6E4F0', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 20, font: 'Arial', color: '1E3A5F' })] })] })
                  ),
                }),
                ...tasksWithCR.map((task, i) => new TableRow({
                  children: [
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.title, size: 19, font: 'Arial' })] })] }),
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.crNumber || '', size: 19, font: 'Arial', color: '2980b9', bold: true })] })] }),
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.assignedTeam?.name || '—', size: 19, font: 'Arial' })] })] }),
                    new TableCell({ borders, shading: { fill: i % 2 === 0 ? 'FFFFFF' : 'F5F5F5', type: ShadingType.CLEAR }, margins: { top: 80, bottom: 80, left: 120, right: 120 }, children: [new Paragraph({ children: [new TextRun({ text: task.assignedUserName || '—', size: 19, font: 'Arial' })] })] }),
                  ],
                })),
              ],
            }),
          ] : []),

          // הערות לצוות הבוקר
          ...(morningNotes ? [
            new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 }, children: [new TextRun({ text: 'לתשומת לב צוות הבוקר', bold: true, size: 28, color: '8B4000', font: 'Arial' })] }),
            new Paragraph({ spacing: { after: 200 }, children: [new TextRun({ text: morningNotes, size: 22, font: 'Arial', color: '333333' })] }),
          ] : []),

          // חתימה
          new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `הופק אוטומטית ע"י NightOps Platform`, size: 18, color: '999999', font: 'Arial' })] }),
        ],
      }],
    });

    return Packer.toBuffer(doc);
  }

  async generateRehearsalSummary(versionId: string, headline: string, morningNotes: string) {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { creator: { select: { fullName: true } } },
    }) as any;
    if (!version) throw new Error('Version not found');

    const tasks: any[] = version.lastRehearsalSnapshot ?? [];
    return this.generateSummary(versionId, headline, morningNotes, true, tasks);
  }

  async findByVersion(versionId: string) {
    return prisma.nightSummary.findUnique({ where: { versionId } });
  }

  async approve(versionId: string, userId: string, headline?: string, morningNotes?: string, crData?: any, force = false) {
    if (!force) {
      // Tasks in phases after the isGoNoGo phase (morning-after phases) must not block approval.
      // Find the goNogo phase; if none set, fall back to excluding WAITING status.
      const goNogoPhase = await prisma.phase.findFirst({
        where: { versionId, isGoNoGo: true },
        select: { orderIndex: true },
      });

      let openCount: number;
      if (goNogoPhase) {
        // Count tasks in phases up to (and including) the isGoNoGo phase.
        // OR tasks with no subPhase — they are not morning-after tasks so they must block.
        openCount = await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
            OR: [
              { subPhase: { phase: { versionId, orderIndex: { lte: goNogoPhase.orderIndex } } } },
              { subPhaseId: null },
            ],
          },
        });
      } else {
        openCount = await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK', 'WAITING'] as any },
          },
        });
      }

      if (openCount > 0) {
        throw new BadRequestException(
          `לא ניתן לאשר סיכום — ${openCount} משימות לילה שטרם הושלמו`
        );
      }
    }

    const version = await prisma.version.findUnique({ where: { id: versionId } });

    const ops: Promise<any>[] = [
      prisma.nightSummary.upsert({
        where: { versionId },
        update: { sentAt: new Date(), sentBy: userId, headline: headline ?? null, morningNotes: morningNotes ?? null, crData: crData ?? null },
        create: { versionId, sentAt: new Date(), sentBy: userId, headline: headline ?? null, morningNotes: morningNotes ?? null, crData: crData ?? null },
      }),
    ];

    // Only advance to COMPLETED if currently MORNING_AFTER — not for already-COMPLETED or ROLLED_BACK
    if (version?.status === 'MORNING_AFTER') {
      ops.push(prisma.version.update({ where: { id: versionId }, data: { status: 'COMPLETED' as any } }));
    }

    const [summary] = await Promise.all(ops);
    return summary;
  }

  async findRehearsalByVersion(versionId: string) {
    return (prisma as any).rehearsalSummary.findUnique({ where: { versionId } });
  }

  async approveRehearsal(versionId: string, userId: string, headline?: string, morningNotes?: string, crData?: any) {
    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new Error('Version not found');

    // If still in REHEARSAL: validate tasks before approving (same phase-aware logic)
    if ((version as any).status === 'REHEARSAL') {
      const goNogoPhase = await prisma.phase.findFirst({
        where: { versionId, isGoNoGo: true },
        select: { orderIndex: true },
      });

      let openCount: number;
      if (goNogoPhase) {
        openCount = await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
            OR: [
              { subPhase: { phase: { versionId, orderIndex: { lte: goNogoPhase.orderIndex } } } },
              { subPhaseId: null },
            ],
          },
        });
      } else {
        openCount = await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
          },
        });
      }

      if (openCount > 0) {
        throw new BadRequestException(
          `לא ניתן לאשר סיכום חזרה — ${openCount} משימות עדיין לא הושלמו`
        );
      }
    }

    // If still in REHEARSAL: save snapshot, reset tasks, return to APPROVED
    if ((version as any).status === 'REHEARSAL') {
      const tasks = await prisma.task.findMany({
        where: { versionId },
        include: { assignedTeam: { select: { id: true, name: true } } },
        orderBy: { orderIndex: 'asc' },
      });

      await prisma.task.updateMany({
        where: { versionId },
        data: {
          status: 'WAITING',
          actualStart: null,
          actualFinish: null,
          startedAt: null,
          completedAt: null,
          blockedReason: null,
          delayReason: null,
          followupNotes: null,
          morningFollowup: false,
        },
      });

      await prisma.version.update({
        where: { id: versionId },
        data: {
          status: 'APPROVED',
          actualStart: null,
          lastRehearsalSnapshot: tasks as any,
          lastRehearsalAt: new Date(),
        } as any,
      });
    }

    return (prisma as any).rehearsalSummary.upsert({
      where: { versionId },
      update: { sentAt: new Date(), sentBy: userId, headline: headline ?? null, morningNotes: morningNotes ?? null, crData: crData ?? null },
      create: { versionId, sentAt: new Date(), sentBy: userId, headline: headline ?? null, morningNotes: morningNotes ?? null, crData: crData ?? null },
    });
  }

  async generateNightSummary(versionId: string, headline: string, morningNotes: string) {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { creator: { select: { fullName: true } } },
    }) as any;
    if (!version) throw new Error('Version not found');

    const tasks: any[] = version.lastNightSnapshot ?? [];
    return this.generateSummary(versionId, headline, morningNotes, false, tasks);
  }
}