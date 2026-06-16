import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS     = ['RELEASE_MANAGER', 'ADMIN'];
const CR_APPROVERS = ['RELEASE_MANAGER', 'ADMIN', 'CR_MANAGER'];

@Injectable()
export class CrPlansService {
  async findForVersion(versionId: string, user: { sub: string; role: string }, filterTeamId?: string) {
    const exemptTeams = await prisma.team.findMany({
      where: { requiresPlan: false },
      select: { id: true },
    });
    const exemptTeamIds = new Set(exemptTeams.map(t => t.id));

    if (CR_APPROVERS.includes(user.role)) {
      const plans = await prisma.crPlan.findMany({
        where: { versionId, ...(filterTeamId ? { teamId: filterTeamId } : {}) },
        include: { crDeps: true, team: { select: { id: true, name: true } } },
        orderBy: [{ teamId: 'asc' }, { crNumber: 'asc' }],
      });
      return plans.filter((p: any) => !exemptTeamIds.has(p.teamId));
    }
    const membership = await prisma.teamMember.findFirst({
      where: { userId: user.sub },
      select: { teamId: true },
    });
    if (!membership) return [];
    // If this team lead's team is exempt, return empty array
    if (exemptTeamIds.has(membership.teamId)) return [];
    return prisma.crPlan.findMany({
      where: { versionId, teamId: membership.teamId },
      include: { crDeps: true, team: { select: { id: true, name: true } } },
      orderBy: { crNumber: 'asc' },
    });
  }

  async upsert(
    versionId: string,
    user: { sub: string; role: string },
    dto: {
      crNumber: string;
      crLabel?: string;
      crManager?: string;
      crDescription?: string;
      crType?: string;
      riskLevel?: string;
      systems?: string[];
      workPlan?: string;
      scripts?: string;
      runTimes?: string;
      rollbackPlan?: string;
      gradualRollout?: boolean;
      gradualDetails?: string;
      nightTestingNotes?: string;
      morningMonitoring?: string;
      dependsOnCrs?: string[];
      notNeededForPlan?: boolean;
      teamIdOverride?: string;
    },
  ) {
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

    const { dependsOnCrs = [], teamIdOverride: _removed, ...fields } = dto;

    const existing = await prisma.crPlan.findFirst({
      where: { versionId, crNumber: dto.crNumber, teamId: resolvedTeamId },
    });

    if (existing) {
      await prisma.crDependency.deleteMany({ where: { crPlanId: existing.id } });
      return prisma.crPlan.update({
        where: { id: existing.id },
        data: {
          ...fields,
          crDeps: { create: dependsOnCrs.map(cr => ({ dependsOnCr: cr })) },
        },
        include: { crDeps: true },
      });
    }

    return prisma.crPlan.create({
      data: {
        versionId,
        teamId: resolvedTeamId,
        ...fields,
        crDeps: { create: dependsOnCrs.map(cr => ({ dependsOnCr: cr })) },
      },
      include: { crDeps: true },
    });
  }

  async approveCr(versionId: string, crNumber: string) {
    await prisma.crPlan.updateMany({
      where: { versionId, crNumber },
      data: { planApproved: true, planApprovedAt: new Date() },
    });
    return { ok: true, crNumber };
  }

  async unapproveCr(versionId: string, crNumber: string) {
    await prisma.crPlan.updateMany({
      where: { versionId, crNumber },
      data: { planApproved: false, planApprovedAt: null },
    });
    return { ok: true, crNumber };
  }

  // ── Implementation Plan lifecycle ──────────────────────────────────────────

  async submitPlan(id: string, user: { sub: string; role: string; fullName?: string }) {
    const plan = await prisma.crPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('תוכנית לא נמצאה');
    if (!MANAGERS.includes(user.role)) {
      const membership = await prisma.teamMember.findFirst({ where: { userId: user.sub, teamId: plan.teamId } });
      if (!membership) throw new NotFoundException('תוכנית לא שייכת לצוות שלך');
    }
    const submitter = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    return prisma.crPlan.update({
      where: { id },
      data: {
        submissionStatus: 'SUBMITTED' as any,
        submittedAt: new Date(),
        submittedByName: submitter?.fullName ?? null,
        returnReason: null,
      },
    });
  }

  async returnPlan(id: string, dto: { returnReason: string }, user: { sub: string; role: string }) {
    if (!CR_APPROVERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR');
    const plan = await prisma.crPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('תוכנית לא נמצאה');
    return prisma.crPlan.update({
      where: { id },
      data: {
        submissionStatus: 'RETURNED' as any,
        returnReason: dto.returnReason,
        returnedAt: new Date(),
      },
    });
  }

  async approvePlan(id: string, user: { sub: string; role: string }) {
    if (!CR_APPROVERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR');
    const plan = await prisma.crPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('תוכנית לא נמצאה');
    const approver = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    return prisma.crPlan.update({
      where: { id },
      data: {
        submissionStatus: 'APPROVED' as any,
        planApproved: true,
        planApprovedAt: new Date(),
        approvedByName: approver?.fullName ?? null,
      },
    });
  }

  async addReviewNote(id: string, dto: { reviewNote: string }, user: { sub: string; role: string }) {
    if (!CR_APPROVERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR');
    return prisma.crPlan.update({ where: { id }, data: { reviewNote: dto.reviewNote } });
  }

  async getDashboardStats(versionId: string) {
    const plans = await prisma.crPlan.findMany({ where: { versionId }, select: { submissionStatus: true, notNeededForPlan: true } });
    const crNumbers = await prisma.crPlan.findMany({ where: { versionId }, select: { crNumber: true }, distinct: ['crNumber'] });
    const total    = crNumbers.length;
    const draft    = plans.filter((p: any) => p.submissionStatus === 'DRAFT' && !p.notNeededForPlan).length;
    const submitted = plans.filter((p: any) => p.submissionStatus === 'SUBMITTED').length;
    const returned  = plans.filter((p: any) => p.submissionStatus === 'RETURNED').length;
    const approved  = plans.filter((p: any) => p.submissionStatus === 'APPROVED' || p.notNeededForPlan).length;
    return { total, draft, submitted, returned, approved };
  }

  // ── CR Manager approval (per-CR, before REVIEW stage) ─────────────────────

  async getManagerDashboard() {
    const versions = await prisma.version.findMany({
      where: { status: { in: ['COLLECTING', 'REFINING', 'REVIEW'] as any }, isArchived: false },
      select: { id: true, name: true, status: true, plannedStart: true, plannedEnd: true },
      orderBy: { plannedStart: 'asc' },
    });

    const result: any[] = [];
    for (const version of versions) {
      const [plans, proposals] = await Promise.all([
        (prisma.crPlan as any).findMany({
          where: { versionId: version.id },
          include: { team: { select: { id: true, name: true } } },
          orderBy: { crNumber: 'asc' },
        }),
        (prisma.taskProposal as any).findMany({
          where: { versionId: version.id },
          orderBy: [{ phase: 'asc' }, { createdAt: 'asc' }],
        }),
      ]);
      if (plans.length === 0) continue;

      const crMap = new Map<string, any>();
      for (const plan of plans) {
        if (!crMap.has(plan.crNumber)) {
          crMap.set(plan.crNumber, {
            crNumber: plan.crNumber,
            crLabel: plan.crLabel,
            crManager: plan.crManager,
            crDescription: plan.crDescription,
            crManagerApproved: plan.crManagerApproved,
            crManagerApprovedAt: plan.crManagerApprovedAt,
            crManagerApprovedBy: plan.crManagerApprovedBy,
            crManagerNote: plan.crManagerNote,
            teams: [],
            proposals: proposals.filter((p: any) => p.crNumber === plan.crNumber),
          });
        }
        const cr = crMap.get(plan.crNumber);
        if (plan.crManagerApproved) {
          cr.crManagerApproved = true;
          cr.crManagerApprovedAt = plan.crManagerApprovedAt;
          cr.crManagerApprovedBy = plan.crManagerApprovedBy;
        }
        cr.teams.push({
          teamId: plan.teamId,
          teamName: plan.team.name,
          planId: plan.id,
          submissionStatus: plan.submissionStatus,
          notNeededForPlan: plan.notNeededForPlan,
          crManagerNote: plan.crManagerNote,
          workPlan: plan.workPlan,
          nightTestingNotes: plan.nightTestingNotes,
          morningMonitoring: plan.morningMonitoring,
          rollbackPlan: plan.rollbackPlan,
          gradualRollout: plan.gradualRollout,
          gradualDetails: plan.gradualDetails,
          riskLevel: plan.riskLevel,
          scripts: plan.scripts,
          submittedAt: plan.submittedAt,
          submittedByName: plan.submittedByName,
          returnReason: plan.returnReason,
        });
      }

      const crs = Array.from(crMap.values()).map(cr => ({
        ...cr,
        allTeamsSubmitted: cr.teams.every((t: any) =>
          t.submissionStatus === 'SUBMITTED' || t.submissionStatus === 'APPROVED' || t.notNeededForPlan,
        ),
      }));

      result.push({
        ...version,
        crs,
        pendingApprovalCount: crs.filter(c => c.allTeamsSubmitted && !c.crManagerApproved).length,
      });
    }
    return result;
  }

  async crManagerApproveCr(versionId: string, crNumber: string, user: { sub: string; role: string }) {
    if (!CR_APPROVERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR');
    const plans = await (prisma.crPlan as any).findMany({ where: { versionId, crNumber } });
    if (!plans.length) throw new NotFoundException('לא נמצאו תוכניות לCR זה');
    const allSubmitted = plans.every((p: any) =>
      p.submissionStatus === 'SUBMITTED' || p.submissionStatus === 'APPROVED' || p.notNeededForPlan,
    );
    if (!allSubmitted) throw new ForbiddenException('לא כל הצוותים הגישו את התוכנית — לא ניתן לאשר');
    const approver = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    await (prisma.crPlan as any).updateMany({
      where: { versionId, crNumber },
      data: { crManagerApproved: true, crManagerApprovedAt: new Date(), crManagerApprovedBy: approver?.fullName ?? null },
    });
    return { ok: true };
  }

  async crManagerReturnPlan(planId: string, dto: { note: string }, user: { sub: string; role: string }) {
    if (!CR_APPROVERS.includes(user.role)) throw new ForbiddenException('נדרשת הרשאת מנהל CR');
    const plan = await (prisma.crPlan as any).findUnique({ where: { id: planId } });
    if (!plan) throw new NotFoundException('תוכנית לא נמצאה');
    return (prisma.crPlan as any).update({
      where: { id: planId },
      data: {
        submissionStatus: 'RETURNED',
        returnReason: dto.note,
        returnedAt: new Date(),
        crManagerApproved: false,
        crManagerApprovedAt: null,
        crManagerApprovedBy: null,
        crManagerNote: dto.note,
      },
    });
  }

  async remove(id: string, user: { sub: string; role: string }) {
    const plan = await prisma.crPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('CrPlan לא נמצא');
    if (!MANAGERS.includes(user.role)) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.sub, teamId: plan.teamId },
      });
      if (!membership) throw new ForbiddenException('אין הרשאה');
    }
    await prisma.crDependency.deleteMany({ where: { crPlanId: id } });
    await prisma.crPlan.delete({ where: { id } });
    return { ok: true };
  }
}
