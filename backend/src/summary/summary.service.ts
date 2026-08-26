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
          new Paragraph({ spacing: { before: 400 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: `הופק אוטומטית ע"י DeployCenter`, size: 18, color: '999999', font: 'Arial' })] }),
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

  // Same report, built from a frozen RehearsalRunArchive row instead of the
  // version's own (single-slot, always-latest) lastRehearsalSnapshot — the
  // one way to get back the first rehearsal's report after a second run.
  async generateArchivedRehearsalSummary(archiveId: string) {
    const archive = await (prisma as any).rehearsalRunArchive.findUnique({ where: { id: archiveId } });
    if (!archive) throw new Error('Archive not found');
    const tasks: any[] = archive.tasksSnapshot ?? [];
    return this.generateSummary(archive.versionId, archive.headline || '', archive.morningNotes || '', true, tasks);
  }

  async findByVersion(versionId: string) {
    return prisma.nightSummary.findUnique({ where: { versionId } });
  }

  async updateApproved(versionId: string, headline?: string, morningNotes?: string, crData?: any) {
    const existing = await prisma.nightSummary.findUnique({ where: { versionId } });
    if (!existing) throw new BadRequestException('הסיכום טרם אושר — אין מה לעדכן');
    return prisma.nightSummary.update({
      where: { versionId },
      data: {
        ...(headline !== undefined && { headline }),
        ...(morningNotes !== undefined && { morningNotes }),
        ...(crData !== undefined && { crData }),
      },
    });
  }

  async updateApprovedRehearsal(versionId: string, headline?: string, morningNotes?: string, crData?: any) {
    const existing = await (prisma as any).rehearsalSummary.findUnique({ where: { versionId } });
    if (!existing) throw new BadRequestException('הסיכום טרם אושר — אין מה לעדכן');
    return (prisma as any).rehearsalSummary.update({
      where: { versionId },
      data: {
        ...(headline !== undefined && { headline }),
        ...(morningNotes !== undefined && { morningNotes }),
        ...(crData !== undefined && { crData }),
      },
    });
  }

  async approve(versionId: string, userId: string, headline?: string, morningNotes?: string, crData?: any, force = false) {
    // Always find the GoNoGo phase — needed for both force and non-force paths.
    const goNogoPhase = await prisma.phase.findFirst({
      where: { versionId, isGoNoGo: true },
      select: { orderIndex: true },
    });

    // ── 1. Deployment-phase check (ALWAYS enforced — even with force) ──
    // Tasks in phases up to and including the GoNoGo phase MUST be terminal.
    // 'force' only waives the morning-after requirement — never the deployment itself.
    if (goNogoPhase) {
      const deploymentOpenCount = await prisma.task.count({
        where: {
          versionId,
          status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
          OR: [
            { subPhase: { phase: { versionId, orderIndex: { lte: goNogoPhase.orderIndex } } } },
            { subPhaseId: null },
          ],
        },
      });
      if (deploymentOpenCount > 0) {
        throw new BadRequestException(
          `לא ניתן לאשר סיכום — ${deploymentOpenCount} משימות הטמעה (שלבים עד GO/NO GO) שטרם הושלמו. ` +
          `אישור בעקיפה אפשרי רק כשמשימות הבוקר שלאחר ה-GO לא הושלמו`
        );
      }
    }

    // ── 2. Rollback-required failures check (ALWAYS enforced — even with force) ──
    // If any FAILED task has a reason that requires rollback → cannot approve, must rollback first.
    const failedTasks = await prisma.task.findMany({
      where: { versionId, status: 'FAILED', failedReason: { not: null } },
      select: { id: true, title: true, failedReason: true },
    });
    if (failedTasks.length > 0) {
      const rollbackReasons = await (prisma as any).failureReason.findMany({
        where: { requiresRollback: true, isActive: true },
        select: { reason: true },
      });
      const rollbackReasonSet = new Set(rollbackReasons.map((r: any) => r.reason));
      const mustRollback = failedTasks.filter(t => rollbackReasonSet.has(t.failedReason!));
      if (mustRollback.length > 0) {
        const names = mustRollback.map(t => `"${t.title}" (${t.failedReason})`).join(', ');
        throw new BadRequestException(
          `לא ניתן לאשר סיכום — המשימות הבאות נכשלו עם סיבה שמחייבת Rollback לגרסה: ${names}. ` +
          `יש לבצע Rollback לפני אישור הסיכום`
        );
      }
    }

    // ── 3. Phase overrun delay-reason check (ALWAYS enforced) ──
    // If a phase overran by more than the configured threshold, a delay reason is required.
    const thresholdParam = await prisma.systemParam.findUnique({
      where: { key: 'SUMMARY_OVERRUN_THRESHOLD_MINS' },
    });
    const thresholdMins = parseInt(thresholdParam?.value ?? '30', 10);

    const phases = await prisma.phase.findMany({
      where: { versionId },
      include: {
        subPhases: {
          include: { tasks: { select: { plannedEnd: true, actualFinish: true } } },
        },
      },
      orderBy: { orderIndex: 'asc' },
    });

    const missingReasonPhases: string[] = [];
    for (const phase of phases) {
      const phaseTasks = phase.subPhases.flatMap((s: any) => s.tasks);
      const plannedEnds = phaseTasks.filter((t: any) => t.plannedEnd).map((t: any) => new Date(t.plannedEnd).getTime());
      const actualEnds  = phaseTasks.filter((t: any) => t.actualFinish).map((t: any) => new Date(t.actualFinish).getTime());
      if (!plannedEnds.length || !actualEnds.length) continue;

      const plannedEndMs = Math.max(...plannedEnds);
      const actualEndMs  = Math.max(...actualEnds);
      const overrunMins  = Math.round((actualEndMs - plannedEndMs) / 60000);

      if (overrunMins > thresholdMins) {
        const providedReason = crData?.phaseDelayReasons?.[phase.id] ?? crData?.phaseDelayReasons?.[phase.name];
        if (!providedReason?.trim()) {
          missingReasonPhases.push(`"${phase.name}" (חריגה של ${overrunMins} דק')`);
        }
      }
    }
    if (missingReasonPhases.length > 0) {
      throw new BadRequestException(
        `נדרשת סיבת חריגת זמן (מעל ${thresholdMins} דק') לשלבים הבאים: ${missingReasonPhases.join(', ')}`
      );
    }

    // ── 4. Morning-after check (waivable with force for ADMIN / RELEASE_MANAGER) ──
    if (!force) {
      let morningOpenCount: number;
      if (goNogoPhase) {
        morningOpenCount = await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK', 'WAITING'] as any },
            subPhase: { phase: { versionId, orderIndex: { gt: goNogoPhase.orderIndex } } },
          },
        });
      } else {
        morningOpenCount = await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK', 'WAITING'] as any },
          },
        });
      }
      if (morningOpenCount > 0) {
        throw new BadRequestException(
          `לא ניתן לאשר סיכום — ${morningOpenCount} משימות בוקר שטרם הושלמו. מנהל מוסמך יכול לאשר בעקיפה`
        );
      }
    }

    const version = await prisma.version.findUnique({ where: { id: versionId } });
    const now = new Date();

    // ── 5. Save the summary ──
    const ops: Promise<any>[] = [
      prisma.nightSummary.upsert({
        where: { versionId },
        update: {
          sentAt: now,
          sentBy: userId,
          headline: headline ?? null,
          morningNotes: morningNotes ?? null,
          crData: crData ?? null,
          ...(force && { forceApprovedBy: userId, forceApprovedAt: now }),
        },
        create: {
          versionId,
          sentAt: now,
          sentBy: userId,
          headline: headline ?? null,
          morningNotes: morningNotes ?? null,
          crData: crData ?? null,
          ...(force && { forceApprovedBy: userId, forceApprovedAt: now }),
        },
      }),
    ];

    // Advance to COMPLETED when all activated tasks are terminal.
    // WAITING tasks (never started) are excluded — they don't block completion.
    if (version?.status === 'MORNING_AFTER') {
      const anyOpenTask = await prisma.task.count({
        where: { versionId, status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK', 'WAITING'] as any } },
      });
      if (anyOpenTask === 0) {
        ops.push(prisma.version.update({ where: { id: versionId }, data: { status: 'COMPLETED' as any } }));
      }
    }

    const [summary] = await Promise.all(ops);
    return summary;
  }

  async canDownload(versionId: string, userRole: string): Promise<{ allowed: boolean; reason?: string }> {
    const isManager = ['RELEASE_MANAGER', 'ADMIN'].includes(userRole);
    const summary = await prisma.nightSummary.findUnique({ where: { versionId } });

    // Already approved — anyone with LEADS_UP role can download
    if (summary?.sentAt) return { allowed: true };

    // Not yet approved — check if deployment tasks are all terminal (isGoNogo equivalent)
    const goNogoPhase = await prisma.phase.findFirst({
      where: { versionId, isGoNoGo: true },
      select: { orderIndex: true },
    });

    const openDeploymentCount = goNogoPhase
      ? await prisma.task.count({
          where: {
            versionId,
            status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK'] as any },
            OR: [
              { subPhase: { phase: { versionId, orderIndex: { lte: goNogoPhase.orderIndex } } } },
              { subPhaseId: null },
            ],
          },
        })
      : await prisma.task.count({
          where: { versionId, status: { notIn: ['DONE', 'FAILED', 'ROLLED_BACK', 'WAITING'] as any } },
        });

    if (openDeploymentCount === 0) return { allowed: true };

    if (isManager) return { allowed: true };

    return {
      allowed: false,
      reason: `הדוח זמין להורדה רק לאחר השלמת כל משימות ההטמעה או לאחר אישור מנהל לילה`,
    };
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

  async getNightStats(versionId: string) {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      select: {
        name: true, plannedStart: true, plannedEnd: true,
        actualStart: true, status: true,
        phases: {
          orderBy: { orderIndex: 'asc' },
          select: {
            id: true, name: true, plannedStart: true, plannedEnd: true,
            subPhases: { select: { id: true, name: true } },
          },
        },
      },
    });
    if (!version) throw new Error('Version not found');

    const tasks = await prisma.task.findMany({
      where: { versionId },
      select: {
        id: true, title: true, status: true, crNumber: true,
        assignedTeamId: true,
        assignedTeam: { select: { name: true } },
        plannedStart: true, plannedEnd: true,
        actualStart: true, actualFinish: true,
        blockedReason: true, delayReason: true, failedReason: true,
        subPhaseId: true,
      },
      orderBy: { orderIndex: 'asc' },
    });

    // ── Overview ──────────────────────────────────────────────────
    const done       = tasks.filter(t => t.status === 'DONE').length;
    const failed     = tasks.filter(t => t.status === 'FAILED').length;
    const rolledBack = tasks.filter(t => t.status === 'ROLLED_BACK').length;
    const blocked    = tasks.filter(t => t.status === 'BLOCKED').length;
    const inProgress = tasks.filter(t => t.status === 'IN_PROGRESS').length;

    const crNumbers = [...new Set(tasks.filter(t => t.crNumber).map(t => t.crNumber!))];
    const doneCrs   = [...new Set(tasks.filter(t => t.crNumber && t.status === 'DONE').map(t => t.crNumber!))];

    // Actual end = latest actualFinish across all tasks
    const finishes = tasks.map(t => t.actualFinish).filter(Boolean) as Date[];
    const actualEnd = finishes.length ? new Date(Math.max(...finishes.map(d => d.getTime()))) : null;

    const overview = {
      versionName:   version.name,
      status:        version.status,
      plannedStart:  version.plannedStart,
      plannedEnd:    version.plannedEnd,
      actualStart:   version.actualStart,
      actualEnd,
      totalTasks:    tasks.length,
      done, failed, rolledBack, blocked, inProgress,
      open: tasks.length - done - failed - rolledBack - blocked - inProgress,
      totalCrs: crNumbers.length,
      doneCrs:  doneCrs.length,
    };

    // ── Per Team ─────────────────────────────────────────────────
    const teamMap = new Map<string, { teamId: string; teamName: string; total: number; done: number; failed: number; rolledBack: number; delayMins: number[]; }>();
    for (const t of tasks) {
      if (!t.assignedTeamId) continue;
      if (!teamMap.has(t.assignedTeamId)) {
        teamMap.set(t.assignedTeamId, { teamId: t.assignedTeamId, teamName: t.assignedTeam?.name ?? t.assignedTeamId, total: 0, done: 0, failed: 0, rolledBack: 0, delayMins: [] });
      }
      const row = teamMap.get(t.assignedTeamId)!;
      row.total++;
      if (t.status === 'DONE')        row.done++;
      if (t.status === 'FAILED')      row.failed++;
      if (t.status === 'ROLLED_BACK') row.rolledBack++;
      if (t.plannedStart && t.actualStart) {
        const delay = Math.round((t.actualStart.getTime() - t.plannedStart.getTime()) / 60000);
        if (Math.abs(delay) < 600) row.delayMins.push(delay);
      }
    }
    const byTeam = [...teamMap.values()].map(r => ({
      ...r,
      avgDelayMins: r.delayMins.length ? Math.round(r.delayMins.reduce((a, b) => a + b, 0) / r.delayMins.length) : 0,
      delayMins: undefined,
    })).sort((a, b) => b.total - a.total);

    // ── Per CR ───────────────────────────────────────────────────
    const crMap = new Map<string, { crNumber: string; total: number; done: number; failed: number; teamNames: Set<string>; }>();
    for (const t of tasks.filter(t => t.crNumber)) {
      const cr = t.crNumber!;
      if (!crMap.has(cr)) crMap.set(cr, { crNumber: cr, total: 0, done: 0, failed: 0, teamNames: new Set() });
      const row = crMap.get(cr)!;
      row.total++;
      if (t.status === 'DONE')   row.done++;
      if (t.status === 'FAILED') row.failed++;
      if (t.assignedTeam?.name) row.teamNames.add(t.assignedTeam.name);
    }
    const byCr = [...crMap.values()].map(r => ({
      crNumber: r.crNumber,
      total: r.total, done: r.done, failed: r.failed,
      teams: [...r.teamNames].join(', '),
      statusLabel: r.failed > 0 ? 'נכשל' : r.done === r.total ? 'הושלם' : 'חלקי',
    })).sort((a, b) => a.crNumber.localeCompare(b.crNumber));

    // ── By Phase ─────────────────────────────────────────────────
    const subPhaseToPhase = new Map<string, string>();
    for (const ph of version.phases) {
      for (const sp of ph.subPhases) subPhaseToPhase.set(sp.id, ph.id);
    }
    const phaseTaskMap = new Map<string, { total: number; done: number; starts: Date[]; finishes: Date[] }>();
    for (const t of tasks) {
      const phId = t.subPhaseId ? subPhaseToPhase.get(t.subPhaseId) : null;
      if (!phId) continue;
      if (!phaseTaskMap.has(phId)) phaseTaskMap.set(phId, { total: 0, done: 0, starts: [], finishes: [] });
      const row = phaseTaskMap.get(phId)!;
      row.total++;
      if (t.status === 'DONE') row.done++;
      if (t.actualStart)  row.starts.push(t.actualStart);
      if (t.actualFinish) row.finishes.push(t.actualFinish);
    }
    const byPhase = version.phases.map(ph => {
      const counts = phaseTaskMap.get(ph.id) ?? { total: 0, done: 0, starts: [], finishes: [] };
      const phActualStart  = counts.starts.length   ? new Date(Math.min(...counts.starts.map(d => d.getTime())))   : null;
      const phActualEnd    = counts.finishes.length  ? new Date(Math.max(...counts.finishes.map(d => d.getTime()))) : null;
      const plannedDur = ph.plannedStart && ph.plannedEnd
        ? Math.round((ph.plannedEnd.getTime() - ph.plannedStart.getTime()) / 60000) : null;
      const actualDur = phActualStart && phActualEnd
        ? Math.round((phActualEnd.getTime() - phActualStart.getTime()) / 60000) : null;
      return {
        phaseName: ph.name,
        plannedStart: ph.plannedStart, plannedEnd: ph.plannedEnd,
        actualStart: phActualStart,    actualEnd: phActualEnd,
        plannedDurMins: plannedDur,
        actualDurMins: actualDur,
        delayMins: (plannedDur !== null && actualDur !== null) ? actualDur - plannedDur : null,
        total: counts.total, done: counts.done,
      };
    });

    // ── Anomalies ─────────────────────────────────────────────────
    const anomalies = tasks
      .filter(t => {
        if (['FAILED', 'ROLLED_BACK'].includes(t.status)) return true;
        if (t.plannedStart && t.actualStart) {
          const delay = Math.round((t.actualStart.getTime() - t.plannedStart.getTime()) / 60000);
          if (delay > 30) return true;
        }
        return false;
      })
      .map(t => {
        const delaySecs = t.plannedStart && t.actualStart
          ? Math.round((t.actualStart.getTime() - t.plannedStart.getTime()) / 60000) : null;
        return {
          taskId: t.id, title: t.title, status: t.status,
          teamName: t.assignedTeam?.name ?? '—',
          plannedStart: t.plannedStart, actualStart: t.actualStart,
          delayMins: delaySecs,
          reason: t.blockedReason ?? t.delayReason ?? t.failedReason ?? null,
        };
      });

    return { overview, byTeam, byCr, byPhase, anomalies };
  }
}