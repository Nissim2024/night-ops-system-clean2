import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { EventsGateway } from '../events/events.gateway';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@Injectable()
export class TaskProposalsService {
  constructor(private readonly events: EventsGateway) {}

  // Fetch responsibleTeamId for proposals (new column, not in generated Prisma client)
  private async enrichResponsibleTeam(versionId: string, proposals: any[]): Promise<any[]> {
    if (!proposals.length) return proposals;
    const rows = await prisma.$queryRawUnsafe<{ id: string; responsibleTeamId: string | null }[]>(
      `SELECT id, "responsibleTeamId" FROM "TaskProposal" WHERE "versionId" = $1`,
      versionId,
    );
    const map = new Map(rows.map(r => [r.id, r.responsibleTeamId]));
    return proposals.map(p => ({ ...p, responsibleTeamId: map.get(p.id) ?? null }));
  }

  async findForVersion(versionId: string, user: { sub: string; role: string; teamId?: string }, filterTeamId?: string) {
    if (MANAGERS.includes(user.role)) {
      // Manager with explicit teamId filter — used when viewing a specific team's proposals
      if (filterTeamId) {
        const proposals = await prisma.taskProposal.findMany({
          where: { versionId, teamId: filterTeamId },
          orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
        });
        return this.enrichResponsibleTeam(versionId, proposals);
      }
      // Unfiltered — all proposals for the version
      const proposals = await prisma.taskProposal.findMany({
        where: { versionId },
        orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
      });
      return this.enrichResponsibleTeam(versionId, proposals);
    }

    // TEAM_LEAD sees only their team's proposals
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];

    const proposals = await prisma.taskProposal.findMany({
      where: { versionId, teamId: membership.teamId },
      orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
    });
    return this.enrichResponsibleTeam(versionId, proposals);
  }

  async create(
    versionId: string,
    user: { sub: string; role: string },
    dto: { title: string; phase: number; app?: string; estimatedMins?: number; crNumber?: string; crLabel?: string; notes?: string; assignedUserName?: string; teamIdOverride?: string; system?: string; actionType?: string; subPhaseId?: string; responsibleTeamId?: string },
  ) {
    const sanitize = (s?: string) => s?.replace(/<[^>]*>/g, '').trim() ?? '';
    dto.title = sanitize(dto.title);
    dto.notes = sanitize(dto.notes);
    dto.crLabel = sanitize(dto.crLabel);
    if (!dto.title) throw new BadRequestException('שדה "שם המשימה" הוא חובה');
    if (dto.phase === undefined || dto.phase === null) throw new BadRequestException('שדה "phase" הוא חובה (ערכים חוקיים: 1–4)');
    if (dto.phase < 1) throw new BadRequestException('שדה "phase" אינו תקין — ערך מינימלי: 1');

    let resolvedTeamId: string;
    if (MANAGERS.includes(user.role) && dto.teamIdOverride) {
      resolvedTeamId = dto.teamIdOverride;
    } else {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.sub },
        select: { teamId: true },
      });
      if (!membership) throw new ForbiddenException('לא שויכת לצוות');
      resolvedTeamId = membership.teamId;
    }

    const proposal = await prisma.taskProposal.create({
      data: {
        versionId,
        teamId: resolvedTeamId,
        submittedBy: user.sub,
        title: dto.title,
        phase: dto.phase,
        app: dto.app ?? null,
        estimatedMins: dto.estimatedMins ?? null,
        crNumber: dto.crNumber ?? null,
        crLabel: dto.crLabel ?? null,
        notes: dto.notes ?? null,
        assignedUserName: dto.assignedUserName ?? null,
        system: dto.system ?? null,
        actionType: dto.actionType ?? null,
        subPhaseId: dto.subPhaseId ?? null,
        status: 'DRAFT',
      },
    });
    // responsibleTeamId — new field, set via raw SQL to avoid Prisma client mismatch
    if (dto.responsibleTeamId) {
      await prisma.$executeRaw`UPDATE "TaskProposal" SET "responsibleTeamId" = ${dto.responsibleTeamId} WHERE id = ${proposal.id}`;
    }
    this.events.emitProposalCreated(versionId);
    return proposal;
  }

  async update(
    id: string,
    user: { sub: string; role: string },
    dto: Partial<{ title: string; phase: number; app: string; estimatedMins: number; crNumber: string; crLabel: string; notes: string; assignedUserName: string; status: string; system: string; actionType: string; subPhaseId: string; responsibleTeamId: string | null }>,
  ) {
    const proposal = await prisma.taskProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('הצעה לא נמצאה');

    if (!MANAGERS.includes(user.role) && proposal.submittedBy !== user.sub) {
      throw new ForbiddenException('אין הרשאה לעדכן הצעה זו');
    }

    const updated = await prisma.taskProposal.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.phase !== undefined && { phase: dto.phase }),
        ...(dto.app !== undefined && { app: dto.app }),
        ...(dto.estimatedMins !== undefined && { estimatedMins: dto.estimatedMins }),
        ...(dto.crNumber !== undefined && { crNumber: dto.crNumber }),
        ...(dto.crLabel !== undefined && { crLabel: dto.crLabel }),
        ...(dto.notes !== undefined && { notes: dto.notes }),
        ...(dto.assignedUserName !== undefined && { assignedUserName: dto.assignedUserName }),
        ...(dto.status !== undefined && { status: dto.status as any }),
        ...(dto.system !== undefined && { system: dto.system }),
        ...(dto.actionType !== undefined && { actionType: dto.actionType }),
        ...(dto.subPhaseId !== undefined && { subPhaseId: dto.subPhaseId }),
      },
    });
    // responsibleTeamId — new field, set via raw SQL to avoid Prisma client mismatch
    if (dto.responsibleTeamId !== undefined) {
      await prisma.$executeRaw`UPDATE "TaskProposal" SET "responsibleTeamId" = ${dto.responsibleTeamId} WHERE id = ${id}`;
    }
    return updated;
  }

  async remove(id: string, user: { sub: string; role: string }) {
    const proposal = await prisma.taskProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('הצעה לא נמצאה');

    if (!MANAGERS.includes(user.role) && proposal.submittedBy !== user.sub) {
      throw new ForbiddenException('אין הרשאה למחוק הצעה זו');
    }

    await prisma.taskProposal.delete({ where: { id } });
    return { ok: true };
  }

  async removeByCr(versionId: string, crNumber: string, user: { sub: string; role: string }) {
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    await prisma.taskProposal.deleteMany({
      where: {
        versionId,
        crNumber,
        ...(membership && !MANAGERS.includes(user.role) ? { teamId: membership.teamId } : {}),
      },
    });
    return { ok: true };
  }

  async markUsed(id: string, taskId: string) {
    return prisma.taskProposal.update({
      where: { id },
      data: { usedInTaskId: taskId },
    });
  }

  async review(id: string, dto: { reviewStatus: string; reviewNote?: string }) {
    const proposal = await prisma.taskProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('הצעה לא נמצאה');
    return prisma.taskProposal.update({
      where: { id },
      data: {
        reviewStatus: dto.reviewStatus as any,
        reviewNote: dto.reviewNote ?? null,
      },
    });
  }

  async countPendingApproved(versionId: string) {
    const count = await prisma.taskProposal.count({
      where: { versionId, reviewStatus: { not: 'REJECTED' as any }, usedInTaskId: null },
    });
    return { count };
  }

  async convertApprovedToTasks(versionId: string, createdBy: string, proposalIds?: string[]) {
    // When proposalIds is provided: convert only those specific proposals (manager explicitly selected them).
    // Otherwise: fall back to old behaviour — only APPROVED proposals.
    const baseWhere = proposalIds?.length
      ? { versionId, usedInTaskId: null, id: { in: proposalIds } }
      : { versionId, usedInTaskId: null };

    const allPending = await prisma.taskProposal.findMany({
      where: baseWhere,
      orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
    });

    if (!allPending.length) return { created: 0, skipped: [], message: 'אין הצעות ממתינות לשיבוץ' };

    // Enrich with responsibleTeamId (column added after Prisma client was generated)
    const enriched = await this.enrichResponsibleTeam(versionId, allPending);

    // Always enforce APPROVED status — proposalIds only narrows the set, never bypasses approval.
    const proposals = enriched.filter((p: any) => p.reviewStatus === 'APPROVED');
    const skipped: Array<{ title: string; reason: string }> = enriched
      .filter((p: any) => p.reviewStatus !== 'APPROVED')
      .map((p: any) => ({
        title: p.title,
        reason:
          p.reviewStatus === 'REJECTED'      ? 'נדחתה על ידי המנהל' :
          p.reviewStatus === 'NEEDS_REVISION' ? 'ממתינה לתיקון ראש הצוות' :
                                               'ממתינה לאישור מנהל',
      }));

    // Map phase number → phase name match in version.
    // Phase orderIndex is the authoritative key — patterns are fallback when subPhaseId is not set.
    const PHASE_PATTERN: Record<number, string[]> = {
      1: ['בוקר', 'בוקר לפני', 'בוקר גרסה', 'morning'],
      2: ['hotnet', 'הוטנט', 'לילה — hotnet'],
      3: ['hot', 'הוט', 'לילה — hot'],
      4: ['בוקר לאחר', 'morning after', 'בוקר שלאחר'],
      5: ['פיתוחים', 'הפעלות', 'production', 'ייצור'],
    };

    const phases = await prisma.phase.findMany({
      where: { versionId },
      include: { subPhases: { orderBy: { orderIndex: 'asc' } } },
      orderBy: { orderIndex: 'asc' },
    });

    // Match each phase number to an actual phase
    const phaseMap = new Map<number, { phaseId: string; subPhaseId: string }>();
    for (const [phaseNum, patterns] of Object.entries(PHASE_PATTERN)) {
      const num = parseInt(phaseNum);
      const matched = phases.find(p =>
        patterns.some(pat => p.name.toLowerCase().includes(pat.toLowerCase()))
      );
      if (matched && matched.subPhases.length) {
        // Use last subPhase (typically "משימות לפיתוחים") for phase 1, first for others
        const subPhase = num === 1
          ? matched.subPhases[matched.subPhases.length - 1]
          : matched.subPhases[0];
        phaseMap.set(num, { phaseId: matched.id, subPhaseId: subPhase.id });
      }
    }

    // Fallback: use the first available subPhase across all phases
    const fallbackSubPhase = phases[0]?.subPhases?.[0];

    let created = 0;
    const createdTasks: any[] = [];

    for (const proposal of proposals) {
      // Validate required fields before conversion
      if (!proposal.assignedUserName?.trim()) {
        skipped.push({ title: proposal.title, reason: 'חסר אחראי לביצוע' });
        continue;
      }
      if (!proposal.estimatedMins) {
        skipped.push({ title: proposal.title, reason: 'חסר משך ביצוע' });
        continue;
      }

      // Use explicitly chosen subPhase if set, otherwise use phase-matching heuristic
      let target: { phaseId: string; subPhaseId: string } | null = null;
      if (proposal.subPhaseId) {
        const parentPhase = phases.find(p => p.subPhases.some((s: any) => s.id === proposal.subPhaseId));
        if (parentPhase) target = { phaseId: parentPhase.id, subPhaseId: proposal.subPhaseId };
      }
      if (!target) target = phaseMap.get(proposal.phase ?? 1) ?? (fallbackSubPhase ? { phaseId: phases[0].id, subPhaseId: fallbackSubPhase.id } : null);

      if (!target) {
        skipped.push({ title: proposal.title, reason: `שלב ${proposal.phase} לא נמצא בתוכנית` });
        continue;
      }

      // Duplicate check — same title in same sub-phase
      const existing = await prisma.task.findFirst({
        where: { subPhaseId: target.subPhaseId, title: proposal.title },
        select: { id: true },
      });
      if (existing) {
        skipped.push({ title: proposal.title, reason: 'משימה עם שם זהה כבר קיימת בתת-שלב' });
        continue;
      }

      // Get next orderIndex + timing anchor
      const subPhaseTasks = await prisma.task.findMany({
        where: { subPhaseId: target.subPhaseId },
        orderBy: { orderIndex: 'desc' },
        select: { orderIndex: true, plannedStart: true },
      });
      const orderIndex = (subPhaseTasks[0]?.orderIndex ?? 0) + 1;

      // Use earliest plannedStart in the sub-phase (parallel model) or fall back to phase start
      const parentPhase = phases.find(p => p.id === target!.phaseId);
      const earliestStart = subPhaseTasks
        .map(t => t.plannedStart)
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      const startAnchor: Date | null = earliestStart ?? parentPhase?.plannedStart ?? null;
      const plannedStart = startAnchor ?? undefined;
      const plannedEnd =
        startAnchor && proposal.estimatedMins
          ? new Date(startAnchor.getTime() + proposal.estimatedMins * 60 * 1000)
          : undefined;

      const task = await prisma.task.create({
        data: {
          subPhaseId: target.subPhaseId,
          versionId,
          title: proposal.title,
          notes: proposal.notes ?? undefined,
          duration: proposal.estimatedMins ? `${proposal.estimatedMins} דק'` : undefined,
          application: proposal.app ?? undefined,
          crNumber: proposal.crNumber ?? undefined,
          assignedTeamId: (proposal as any).responsibleTeamId || proposal.teamId,
          assignedUserName: proposal.assignedUserName ?? undefined,
          orderIndex,
          status: 'WAITING',
          createdBy,
          createdByTeamLead: createdBy,
          ...(plannedStart && { plannedStart }),
          ...(plannedEnd   && { plannedEnd }),
        },
      });

      // Link proposal → task
      await prisma.taskProposal.update({
        where: { id: proposal.id },
        data: { usedInTaskId: task.id },
      });

      const assignedPhase = phases.find(p => p.id === target!.phaseId);
      const assignedSubPhase = assignedPhase?.subPhases.find((s: any) => s.id === target!.subPhaseId);
      createdTasks.push({
        proposalId: proposal.id,
        taskId: task.id,
        title: proposal.title,
        phaseName: assignedPhase?.name ?? '',
        subPhaseName: assignedSubPhase?.name ?? '',
      });
      created++;
    }

    return { created, skipped, tasks: createdTasks };
  }
}
