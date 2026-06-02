import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

@Injectable()
export class TaskProposalsService {

  async findForVersion(versionId: string, user: { sub: string; role: string; teamId?: string }, filterTeamId?: string) {
    if (MANAGERS.includes(user.role)) {
      // Manager with explicit teamId filter — used when viewing a specific team's proposals
      if (filterTeamId) {
        return prisma.taskProposal.findMany({
          where: { versionId, teamId: filterTeamId },
          orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
        });
      }
      // Unfiltered — all proposals for the version
      return prisma.taskProposal.findMany({
        where: { versionId },
        orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
      });
    }

    // TEAM_LEAD sees only their team's proposals
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];

    return prisma.taskProposal.findMany({
      where: { versionId, teamId: membership.teamId },
      orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async create(
    versionId: string,
    user: { sub: string; role: string },
    dto: { title: string; phase: number; app?: string; estimatedMins?: number; crNumber?: string; crLabel?: string; notes?: string; assignedUserName?: string; teamIdOverride?: string; system?: string; actionType?: string; subPhaseId?: string },
  ) {
    if (!dto.title?.trim()) throw new BadRequestException('שדה "שם המשימה" הוא חובה');
    if (!dto.phase || dto.phase < 1 || dto.phase > 4) throw new BadRequestException('שלב חייב להיות בין 1 ל-4');

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

    return prisma.taskProposal.create({
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
  }

  async update(
    id: string,
    user: { sub: string; role: string },
    dto: Partial<{ title: string; phase: number; app: string; estimatedMins: number; crNumber: string; crLabel: string; notes: string; assignedUserName: string; status: string; system: string; actionType: string; subPhaseId: string }>,
  ) {
    const proposal = await prisma.taskProposal.findUnique({ where: { id } });
    if (!proposal) throw new NotFoundException('הצעה לא נמצאה');

    if (!MANAGERS.includes(user.role) && proposal.submittedBy !== user.sub) {
      throw new ForbiddenException('אין הרשאה לעדכן הצעה זו');
    }

    return prisma.taskProposal.update({
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

  async convertApprovedToTasks(versionId: string, createdBy: string) {
    // Find all APPROVED proposals that haven't been converted yet
    const proposals = await prisma.taskProposal.findMany({
      where: { versionId, reviewStatus: 'APPROVED' as any, usedInTaskId: null },
      orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
    });

    if (!proposals.length) return { created: 0, message: 'אין הצעות מאושרות להמרה' };

    // Map phase number → phase name match in version
    const PHASE_PATTERN: Record<number, string[]> = {
      1: ['בוקר', 'בוקר לפני', 'בוקר גרסה', 'morning'],
      2: ['hotnet', 'הוטנט', 'לילה — hotnet'],
      3: ['hot', 'הוט', 'לילה — hot'],
      4: ['בוקר לאחר', 'morning after', 'בוקר שלאחר'],
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
    const results: any[] = [];

    for (const proposal of proposals) {
      // Use explicitly chosen subPhase if set, otherwise use phase-matching heuristic
      let target: { phaseId: string; subPhaseId: string } | null = null;
      if (proposal.subPhaseId) {
        const parentPhase = phases.find(p => p.subPhases.some((s: any) => s.id === proposal.subPhaseId));
        if (parentPhase) target = { phaseId: parentPhase.id, subPhaseId: proposal.subPhaseId };
      }
      if (!target) target = phaseMap.get(proposal.phase ?? 1) ?? (fallbackSubPhase ? { phaseId: phases[0].id, subPhaseId: fallbackSubPhase.id } : null);
      if (!target) continue;

      // Get next orderIndex in the subPhase
      const lastTask = await prisma.task.findFirst({
        where: { subPhaseId: target.subPhaseId },
        orderBy: { orderIndex: 'desc' },
        select: { orderIndex: true },
      });
      const orderIndex = (lastTask?.orderIndex ?? 0) + 1;

      const task = await prisma.task.create({
        data: {
          subPhaseId: target.subPhaseId,
          versionId,
          title: proposal.title,
          notes: proposal.notes ?? undefined,
          duration: proposal.estimatedMins ? `${proposal.estimatedMins} דק'` : undefined,
          application: proposal.app ?? undefined,
          crNumber: proposal.crNumber ?? undefined,
          assignedUserName: proposal.assignedUserName ?? undefined,
          orderIndex,
          status: 'WAITING',
          createdBy,
          createdByTeamLead: createdBy,
        },
      });

      // Link proposal → task
      await prisma.taskProposal.update({
        where: { id: proposal.id },
        data: { usedInTaskId: task.id },
      });

      results.push({ proposalId: proposal.id, taskId: task.id, title: proposal.title });
      created++;
    }

    return { created, tasks: results };
  }
}
