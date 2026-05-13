import { Injectable } from '@nestjs/common';
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

  async generateSummary(versionId: string, headline: string, morningNotes: string) {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: { creator: { select: { fullName: true } } },
    });

    const tasks = await prisma.task.findMany({
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
            children: [new TextRun({ text: `סיכום גרסת ${version?.name}`, bold: true, size: 48, font: 'Arial', color: '1E3A5F' })],
          }),
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
}