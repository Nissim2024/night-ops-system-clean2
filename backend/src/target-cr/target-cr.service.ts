import { Injectable, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { QcService } from '../qc/qc.service';

const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
const MANAGERS = ['RELEASE_MANAGER', 'ADMIN'];

// Reason a defect was marked "requires special implementation" → which kind
// of derived plan item it becomes, and a sensible default phase for it.
const REASON_TO_ACTION: Record<string, { actionType: string; phase: number } | 'MONITORING'> = {
  'Script':            { actionType: 'הרצת סקריפט', phase: 2 },
  'Data Migration':    { actionType: 'הסבת נתונים', phase: 2 },
  'בדיקת לקוח ראשון':  { actionType: 'בדיקה ידנית', phase: 4 },
  'ניטור מיוחד':       'MONITORING',
  'אחר':               { actionType: 'אחר', phase: 2 },
};

@Injectable()
export class TargetCrService {
  constructor(private qcService: QcService) {}

  private async resolveTeamId(crNumber: string, teamId: string | undefined, user: { sub: string; role: string }): Promise<string> {
    if (MANAGERS.includes(user.role) && teamId) return teamId;
    const membership = await prisma.teamMember.findFirst({ where: { userId: user.sub }, select: { teamId: true } });
    if (!membership) throw new ForbiddenException('לא שויכת לצוות');
    return membership.teamId;
  }

  async getReview(versionId: string, crNumber: string, teamIdParam: string, user: { sub: string; role: string }) {
    const teamId = await this.resolveTeamId(crNumber, teamIdParam, user);
    const team = await prisma.team.findUnique({ where: { id: teamId }, select: { name: true } });
    if (!team) throw new NotFoundException('צוות לא נמצא');

    const oracleDefects = await this.qcService.getTargetCrDefects(versionId, crNumber, team.name);

    let review = await prisma.targetCrReview.findUnique({
      where: { versionId_crNumber_teamId: { versionId, crNumber, teamId } },
      include: { defects: true },
    });
    if (!review) {
      review = await prisma.targetCrReview.create({
        data: { versionId, crNumber, teamId },
        include: { defects: true },
      });
    }

    // Ensure a local row exists for every defect Oracle currently returns —
    // new defects added to the CR after the team lead's first visit still show up.
    const existingIds = new Set(review.defects.map(d => d.defectId));
    const missing = oracleDefects.filter(d => !existingIds.has(d.id));
    if (missing.length) {
      await prisma.targetCrDefect.createMany({
        data: missing.map(d => ({ reviewId: review!.id, defectId: d.id, description: d.title })),
        skipDuplicates: true,
      });
      review = await prisma.targetCrReview.findUnique({
        where: { id: review.id },
        include: { defects: true },
      });
    }

    const localByDefectId = new Map(review!.defects.map(d => [d.defectId, d]));
    const defects = oracleDefects.map(od => {
      const local = localByDefectId.get(od.id);
      return {
        id: local?.id ?? null,
        defectId: od.id,
        title: od.title,
        status: od.status,
        severity: od.severity,
        assignedTo: od.assignedTo,
        requiresSpecialImplementation: local?.requiresSpecialImplementation ?? false,
        implementationReason: local?.implementationReason ?? null,
        importantToManagement: local?.importantToManagement ?? false,
      };
    });

    return {
      review: {
        id: review!.id,
        gateChecklist1: review!.gateChecklist1,
        gateChecklist2: review!.gateChecklist2,
        gateChecklist3: review!.gateChecklist3,
        approved: review!.approved,
        approvedByName: review!.approvedByName,
        approvedAt: review!.approvedAt,
      },
      teamName: team.name,
      defects,
    };
  }

  // Lightweight bulk read for a team's own TARGET-CR list (e.g. TeamLeadProposalView's
  // "done" status per CR) — approval lives on TargetCrReview, entirely separate from
  // CrPlan.submissionStatus, so the regular submitted/approved check never reflects
  // a TARGET CR's real state. No Oracle calls, no row creation — just what already exists.
  async getStatusForTeam(versionId: string, teamId: string): Promise<Record<string, boolean>> {
    const reviews = await prisma.targetCrReview.findMany({
      where: { versionId, teamId },
      select: { crNumber: true, approved: true },
    });
    return Object.fromEntries(reviews.map(r => [r.crNumber, r.approved]));
  }

  // Cross-team rollup for the Consolidated CR Review screen — one row per
  // team that has actually opened this TARGET CR (a team assigned to it but
  // never visited yet simply has no TargetCrReview row and isn't counted here;
  // CrReviewView already shows "not started" per team via the regular CrPlan data).
  async getSummary(versionId: string, crNumber: string) {
    const reviews = await prisma.targetCrReview.findMany({
      where: { versionId, crNumber },
      include: { defects: true, },
    });
    const teams = await prisma.team.findMany({ where: { id: { in: reviews.map(r => r.teamId) } }, select: { id: true, name: true } });
    const teamName = new Map(teams.map(t => [t.id, t.name]));

    const allDefects = reviews.flatMap(r => r.defects);
    return {
      teams: reviews.map(r => ({
        teamId: r.teamId,
        teamName: teamName.get(r.teamId) ?? r.teamId,
        approved: r.approved,
        defectCount: r.defects.length,
        specialCount: r.defects.filter(d => d.requiresSpecialImplementation).length,
        managementCount: r.defects.filter(d => d.importantToManagement).length,
      })),
      totalDefects: allDefects.length,
      totalSpecial: allDefects.filter(d => d.requiresSpecialImplementation).length,
      totalManagement: allDefects.filter(d => d.importantToManagement).length,
    };
  }

  async updateGate(reviewId: string, patch: { gateChecklist1?: boolean; gateChecklist2?: boolean; gateChecklist3?: boolean }) {
    return prisma.targetCrReview.update({ where: { id: reviewId }, data: patch });
  }

  async approve(reviewId: string, user: { sub: string; fullName?: string }) {
    const review = await prisma.targetCrReview.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException('לא נמצאה סקירת TARGET CR');
    if (!review.gateChecklist1 || !review.gateChecklist2 || !review.gateChecklist3) {
      throw new BadRequestException('יש לאשר את כל שלושת התנאים לפני אישור ה-CR');
    }
    const approver = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });
    return prisma.targetCrReview.update({
      where: { id: reviewId },
      data: { approved: true, approvedByName: approver?.fullName ?? null, approvedAt: new Date() },
    });
  }

  async updateDefect(
    defectRowId: string,
    patch: { requiresSpecialImplementation?: boolean; implementationReason?: string | null; importantToManagement?: boolean },
    user: { sub: string; fullName?: string },
  ) {
    const row = await prisma.targetCrDefect.findUnique({ where: { id: defectRowId }, include: { review: true } });
    if (!row) throw new NotFoundException('תקלה לא נמצאה');

    const nextRequires = patch.requiresSpecialImplementation ?? row.requiresSpecialImplementation;
    const nextReason = patch.implementationReason !== undefined ? patch.implementationReason : row.implementationReason;

    // Turning the flag off (or clearing the reason) — remove whatever was derived.
    if (!nextRequires || !nextReason) {
      if (row.derivedActionId) {
        const action = await prisma.crPlanAction.findUnique({ where: { id: row.derivedActionId } });
        if (action?.derivedProposalId) {
          await prisma.taskProposal.deleteMany({ where: { id: action.derivedProposalId, usedInTaskId: null } });
        }
        await prisma.crPlanAction.deleteMany({ where: { id: row.derivedActionId } });
      }
      if (row.derivedMonitoringPointId) {
        const point = await prisma.crPlanMonitoringPoint.findUnique({ where: { id: row.derivedMonitoringPointId } });
        if (point?.derivedProposalId) {
          await prisma.taskProposal.deleteMany({ where: { id: point.derivedProposalId, usedInTaskId: null } });
        }
        await prisma.crPlanMonitoringPoint.deleteMany({ where: { id: row.derivedMonitoringPointId } });
      }
      return prisma.targetCrDefect.update({
        where: { id: defectRowId },
        data: {
          requiresSpecialImplementation: nextRequires,
          implementationReason: nextReason ?? null,
          importantToManagement: patch.importantToManagement ?? row.importantToManagement,
          derivedActionId: null,
          derivedMonitoringPointId: null,
        },
      });
    }

    // Turning the flag on with a reason — derive (or refresh) the plan item.
    if (nextRequires && nextReason && !row.derivedActionId && !row.derivedMonitoringPointId) {
      const crPlan = await this.findOrCreateCrPlan(row.review.versionId, row.review.crNumber, row.review.teamId);
      const mapping = REASON_TO_ACTION[nextReason] ?? REASON_TO_ACTION['אחר'];
      const description = `${nextReason} בעקבות DEF-${row.defectId}${row.description ? `: ${row.description}` : ''}`;

      if (mapping === 'MONITORING') {
        const point = await prisma.crPlanMonitoringPoint.create({
          data: { crPlanId: crPlan.id, type: 'Other', name: `DEF-${row.defectId}`, note: description, phase: 4 },
        });
        return prisma.targetCrDefect.update({
          where: { id: defectRowId },
          data: {
            requiresSpecialImplementation: true, implementationReason: nextReason,
            importantToManagement: patch.importantToManagement ?? row.importantToManagement,
            derivedMonitoringPointId: point.id,
          },
        });
      }
      const action = await prisma.crPlanAction.create({
        data: { crPlanId: crPlan.id, actionType: mapping.actionType, description, phase: mapping.phase },
      });
      return prisma.targetCrDefect.update({
        where: { id: defectRowId },
        data: {
          requiresSpecialImplementation: true, implementationReason: nextReason,
          importantToManagement: patch.importantToManagement ?? row.importantToManagement,
          derivedActionId: action.id,
        },
      });
    }

    // Only importantToManagement changed — no derivation to touch.
    return prisma.targetCrDefect.update({
      where: { id: defectRowId },
      data: { importantToManagement: patch.importantToManagement ?? row.importantToManagement },
    });
  }

  private async findOrCreateCrPlan(versionId: string, crNumber: string, teamId: string) {
    const existing = await prisma.crPlan.findFirst({ where: { versionId, crNumber, teamId } });
    if (existing) return existing;
    return prisma.crPlan.create({ data: { versionId, crNumber, teamId, crType: 'TARGET' } });
  }
}
