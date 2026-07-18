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

    const include = {
      crDeps: true,
      team: { select: { id: true, name: true } },
      actions: { orderBy: { orderIndex: 'asc' as const } },
      monitoringPoints: { orderBy: { orderIndex: 'asc' as const } },
    };

    if (CR_APPROVERS.includes(user.role)) {
      const plans = await prisma.crPlan.findMany({
        where: { versionId, removedByTeam: false, ...(filterTeamId ? { teamId: filterTeamId } : {}) },
        include,
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
      where: { versionId, teamId: membership.teamId, removedByTeam: false },
      include,
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
      dependencyNotes?: Record<string, string>;
      notNeededForPlan?: boolean;
      teamIdOverride?: string;
      // Set only by the background/auto CR-list sync — never overwrite or resurrect
      // a plan the team explicitly deleted, and never touch fields the sync call
      // doesn't actually carry (see reconciliation below).
      syncOnly?: boolean;
      // ── טופס CR מובנה (exception-first) ──
      gateAnswered?: boolean;
      changeTypes?: string[];
      prerequisites?: string[];
      prerequisitesNote?: string;
      nightTestNeeded?: boolean;
      nextDayTestNeeded?: boolean;
      nextDayTestNotes?: string;
      rollbackType?: string;
      actions?: {
        id?: string; actionType: string; description: string; phase: number; subPhaseId?: string; system?: string;
        estimatedMins?: number; dependsOnTaskId?: string; dependencyNote?: string;
        ownerName?: string;
      }[];
      monitoringPoints?: { id?: string; type: string; name: string; note?: string; phase?: number; assignedTeamId?: string; assignedUserName?: string }[];
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

    const {
      dependsOnCrs, dependencyNotes = {}, teamIdOverride: _removed, syncOnly,
      actions, monitoringPoints, ...fields
    } = dto;

    const include = {
      crDeps: true,
      actions: { orderBy: { orderIndex: 'asc' as const } },
      monitoringPoints: { orderBy: { orderIndex: 'asc' as const } },
    };

    const existing = await prisma.crPlan.findFirst({
      where: { versionId, crNumber: dto.crNumber, teamId: resolvedTeamId },
      include,
    });

    if (existing) {
      // The team explicitly deleted this CR — the auto-sync must leave it alone.
      // (A real, explicit edit — e.g. reopening via "יש השפעה בכל זאת" — is not
      // syncOnly, so it clears the tombstone and proceeds normally below.)
      if (existing.removedByTeam && syncOnly) return existing;

      if (actions !== undefined) await this.reconcileActions(existing.id, actions);
      if (monitoringPoints !== undefined) await this.reconcileMonitoringPoints(existing.id, monitoringPoints);
      if (dependsOnCrs !== undefined) await prisma.crDependency.deleteMany({ where: { crPlanId: existing.id } });
      // Reverting "no special impact" back to "has impact" (notNeededForPlan true→false)
      // must also reopen the submission — otherwise the plan keeps the SUBMITTED status
      // it got when it was auto-submitted as not-needed, and the form stays locked even
      // though the gate was reopened and there's no real content to have been submitted.
      const revertingNotNeeded = dto.notNeededForPlan === false && existing.notNeededForPlan === true;
      return prisma.crPlan.update({
        where: { id: existing.id },
        data: {
          ...fields,
          ...(revertingNotNeeded ? { submissionStatus: 'DRAFT' as any } : {}),
          ...(existing.removedByTeam ? { removedByTeam: false } : {}),
          ...(dependsOnCrs !== undefined
            ? { crDeps: { create: dependsOnCrs.map(cr => ({ dependsOnCr: cr, note: dependencyNotes[cr] || undefined })) } }
            : {}),
        },
        include,
      });
    }

    return prisma.crPlan.create({
      data: {
        versionId,
        teamId: resolvedTeamId,
        ...fields,
        ...(dependsOnCrs !== undefined
          ? { crDeps: { create: dependsOnCrs.map(cr => ({ dependsOnCr: cr, note: dependencyNotes[cr] || undefined })) } }
          : {}),
        ...(actions !== undefined
          ? { actions: { create: actions.map((a, i) => ({
              actionType: a.actionType, description: a.description, phase: a.phase,
              subPhaseId: a.subPhaseId || null, system: a.system || null, estimatedMins: a.estimatedMins ?? null,
              dependsOnTaskId: a.dependsOnTaskId || null,
              dependencyNote: a.dependencyNote || null, ownerName: a.ownerName || null, orderIndex: i,
            })) } }
          : {}),
        ...(monitoringPoints !== undefined
          ? { monitoringPoints: { create: monitoringPoints.map((m, i) => ({
              type: m.type, name: m.name, note: m.note || null, phase: m.phase ?? 4,
              assignedTeamId: m.assignedTeamId || null, assignedUserName: m.assignedUserName || null,
              orderIndex: i,
            })) } }
          : {}),
      },
      include,
    });
  }

  // Reconciles CrPlanAction rows by id (update existing / create new / delete removed)
  // instead of a blanket delete-then-recreate — action ids must stay stable across saves
  // so `derivedProposalId` keeps pointing at the same auto-generated TaskProposal.
  private async reconcileActions(
    planId: string,
    incoming: {
      id?: string; actionType: string; description: string; phase: number; subPhaseId?: string; system?: string;
      estimatedMins?: number; dependsOnTaskId?: string; dependencyNote?: string;
      ownerName?: string;
    }[],
  ) {
    const existingRows = await prisma.crPlanAction.findMany({ where: { crPlanId: planId } });
    const existingIds = new Set(existingRows.map(r => r.id));
    const incomingIds = new Set(incoming.filter(a => a.id).map(a => a.id));
    const removed = existingRows.filter(r => !incomingIds.has(r.id));

    for (const row of removed) {
      // Only clean up the derived proposal if it hasn't already become a real Task.
      if (row.derivedProposalId) {
        await prisma.taskProposal.deleteMany({ where: { id: row.derivedProposalId, usedInTaskId: null } });
      }
    }
    if (removed.length) {
      await prisma.crPlanAction.deleteMany({ where: { id: { in: removed.map(r => r.id) } } });
    }

    for (let i = 0; i < incoming.length; i++) {
      const a = incoming[i];
      const data = {
        actionType: a.actionType, description: a.description, phase: a.phase,
        subPhaseId: a.subPhaseId || null, system: a.system || null, estimatedMins: a.estimatedMins ?? null,
        dependsOnTaskId: a.dependsOnTaskId || null,
        dependencyNote: a.dependencyNote || null, ownerName: a.ownerName || null, orderIndex: i,
      };
      if (a.id && existingIds.has(a.id)) {
        await prisma.crPlanAction.update({ where: { id: a.id }, data });
      } else {
        await prisma.crPlanAction.create({ data: { crPlanId: planId, ...data } });
      }
    }
  }

  // Same id-stable reconciliation as reconcileActions, for monitoring points.
  private async reconcileMonitoringPoints(
    planId: string,
    incoming: { id?: string; type: string; name: string; note?: string; phase?: number; assignedTeamId?: string; assignedUserName?: string }[],
  ) {
    const existingRows = await prisma.crPlanMonitoringPoint.findMany({ where: { crPlanId: planId } });
    const existingIds = new Set(existingRows.map(r => r.id));
    const incomingIds = new Set(incoming.filter(m => m.id).map(m => m.id));
    const removed = existingRows.filter(r => !incomingIds.has(r.id));

    for (const row of removed) {
      if (row.derivedProposalId) {
        await prisma.taskProposal.deleteMany({ where: { id: row.derivedProposalId, usedInTaskId: null } });
      }
    }
    if (removed.length) {
      await prisma.crPlanMonitoringPoint.deleteMany({ where: { id: { in: removed.map(r => r.id) } } });
    }

    for (let i = 0; i < incoming.length; i++) {
      const m = incoming[i];
      const data = {
        type: m.type, name: m.name, note: m.note || null, phase: m.phase ?? 4,
        assignedTeamId: m.assignedTeamId || null, assignedUserName: m.assignedUserName || null,
        orderIndex: i,
      };
      if (m.id && existingIds.has(m.id)) {
        await prisma.crPlanMonitoringPoint.update({ where: { id: m.id }, data });
      } else {
        await prisma.crPlanMonitoringPoint.create({ data: { crPlanId: planId, ...data } });
      }
    }
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
    const plan = await prisma.crPlan.findUnique({ where: { id }, include: { actions: true, monitoringPoints: true } });
    if (!plan) throw new NotFoundException('תוכנית לא נמצאה');
    if (!MANAGERS.includes(user.role)) {
      const membership = await prisma.teamMember.findFirst({ where: { userId: user.sub, teamId: plan.teamId } });
      if (!membership) throw new NotFoundException('תוכנית לא שייכת לצוות שלך');
    }
    const submitter = await prisma.user.findUnique({ where: { id: user.sub }, select: { fullName: true } });

    const derivedTasks = !plan.notNeededForPlan
      ? await this.syncDerivedProposals(plan, user.sub)
      : { created: 0, updated: 0 };

    const updated = await prisma.crPlan.update({
      where: { id },
      data: {
        submissionStatus: 'SUBMITTED' as any,
        submittedAt: new Date(),
        submittedByName: submitter?.fullName ?? null,
        returnReason: null,
      },
    });
    return { ...updated, derivedTasks };
  }

  // Auto-derives a DRAFT TaskProposal per exceptional action, and per monitoring point that
  // has an assigned employee, so they land directly in the team's existing "משימות נגזרות"
  // tab — reusing the same review/approve/convert-to-task pipeline as manually-added tasks,
  // rather than creating a parallel path. Re-running this (e.g. after a RETURNED plan is
  // re-submitted) updates already-derived proposals in place instead of duplicating them,
  // and never touches one already converted into a real Task.
  private async syncDerivedProposals(
    plan: {
      id: string; versionId: string; teamId: string; crNumber: string; crLabel: string | null;
      actions: { id: string; actionType: string; description: string; phase: number; subPhaseId: string | null; system: string | null; estimatedMins: number | null; dependsOnTaskId: string | null; dependencyNote: string | null; ownerName: string | null; derivedProposalId: string | null }[];
      monitoringPoints: { id: string; type: string; name: string; note: string | null; phase: number; assignedTeamId: string | null; assignedUserName: string | null; derivedProposalId: string | null }[];
    },
    submittedBy: string,
  ) {
    let created = 0, updated = 0;

    // Resolve dependsOnTaskId → real task titles in one query, for readable notes.
    // A dependency is always "must complete first" — there's no before/after choice.
    const taskIds = plan.actions.map(a => a.dependsOnTaskId).filter((id): id is string => !!id);
    const tasks = taskIds.length
      ? await prisma.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, title: true } })
      : [];
    const taskTitleMap = new Map(tasks.map(t => [t.id, t.title]));

    for (const action of plan.actions) {
      const title = `${action.actionType}: ${action.description}`.trim().slice(0, 500);
      const depParts: string[] = [];
      if (action.dependsOnTaskId) {
        depParts.push(`תלות: אחרי "${taskTitleMap.get(action.dependsOnTaskId) ?? 'משימה שנמחקה'}"`);
      }
      if (action.dependencyNote) depParts.push(`הערה: ${action.dependencyNote}`);
      const notes = depParts.length ? depParts.join(' · ') : undefined;

      const result = await this.upsertDerivedProposal(action.derivedProposalId, {
        versionId: plan.versionId, teamId: plan.teamId, submittedBy, title,
        phase: action.phase, subPhaseId: action.subPhaseId, app: action.system, estimatedMins: action.estimatedMins,
        crNumber: plan.crNumber, crLabel: plan.crLabel, assignedUserName: action.ownerName, notes,
        responsibleTeamId: undefined,
      });
      if (result === 'updated') {
        updated++;
      } else {
        await prisma.crPlanAction.update({ where: { id: action.id }, data: { derivedProposalId: result.id } });
        created++;
      }
    }

    // Monitoring points only become real tasks once someone specific is on the hook for them.
    for (const point of plan.monitoringPoints) {
      if (!point.assignedUserName) continue;
      const title = `בקרה — ${point.type}: ${point.name}`.trim().slice(0, 500);
      const notes = point.note ? `לוודא: ${point.note}` : undefined;

      const result = await this.upsertDerivedProposal(point.derivedProposalId, {
        versionId: plan.versionId, teamId: plan.teamId, submittedBy, title,
        phase: point.phase, subPhaseId: null, app: null, estimatedMins: null,
        crNumber: plan.crNumber, crLabel: plan.crLabel, assignedUserName: point.assignedUserName, notes,
        responsibleTeamId: point.assignedTeamId,
      });
      if (result === 'updated') {
        updated++;
      } else {
        await prisma.crPlanMonitoringPoint.update({ where: { id: point.id }, data: { derivedProposalId: result.id } });
        created++;
      }
    }

    return { created, updated };
  }

  // Shared create-or-update-in-place logic for a single derived TaskProposal. Returns
  // 'updated' if an existing (not-yet-converted-to-Task) proposal was refreshed, 'created'
  // is never returned directly — instead the newly-created proposal object is returned so
  // the caller can write its id back onto the owning CrPlanAction/CrPlanMonitoringPoint row.
  private async upsertDerivedProposal(
    derivedProposalId: string | null,
    fields: {
      versionId: string; teamId: string; submittedBy: string; title: string; phase: number;
      subPhaseId: string | null; app: string | null; estimatedMins: number | null; crNumber: string; crLabel: string | null;
      assignedUserName: string | null; notes: string | undefined; responsibleTeamId: string | null | undefined;
    },
  ): Promise<'updated' | { id: string }> {
    if (derivedProposalId) {
      const existingProposal = await prisma.taskProposal.findUnique({ where: { id: derivedProposalId } });
      if (existingProposal) {
        if (!existingProposal.usedInTaskId) {
          await prisma.taskProposal.update({
            where: { id: derivedProposalId },
            data: {
              title: fields.title, phase: fields.phase, subPhaseId: fields.subPhaseId ?? undefined,
              app: fields.app ?? undefined, estimatedMins: fields.estimatedMins ?? undefined,
              assignedUserName: fields.assignedUserName ?? undefined,
              notes: fields.notes, crNumber: fields.crNumber, crLabel: fields.crLabel ?? undefined,
              ...(fields.responsibleTeamId !== undefined ? { responsibleTeamId: fields.responsibleTeamId } : {}),
            },
          });
          return 'updated';
        }
        return 'updated'; // already converted to a real Task — leave it alone
      }
      // proposal was deleted independently since — fall through and recreate it below
    }

    // Defense-in-depth against a concurrent double-submit (e.g. two browser tabs)
    // racing this same action before either write-back of derivedProposalId lands:
    // reuse an unlinked proposal with identical content instead of creating a
    // second one. The frontend now holds its confirm button disabled for the
    // whole save+submit round trip specifically to avoid needing this path, but
    // it's a cheap, safe fallback rather than relying on that alone.
    const duplicate = await prisma.taskProposal.findFirst({
      where: {
        versionId: fields.versionId, teamId: fields.teamId, crNumber: fields.crNumber,
        title: fields.title, phase: fields.phase, usedInTaskId: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (duplicate) return { id: duplicate.id };

    const proposal = await prisma.taskProposal.create({
      data: {
        versionId: fields.versionId, teamId: fields.teamId, submittedBy: fields.submittedBy,
        title: fields.title, phase: fields.phase, subPhaseId: fields.subPhaseId ?? undefined,
        app: fields.app ?? undefined, estimatedMins: fields.estimatedMins ?? undefined,
        crNumber: fields.crNumber, crLabel: fields.crLabel ?? undefined,
        assignedUserName: fields.assignedUserName ?? undefined, notes: fields.notes, status: 'DRAFT',
      },
    });
    if (fields.responsibleTeamId) {
      await prisma.taskProposal.update({ where: { id: proposal.id }, data: { responsibleTeamId: fields.responsibleTeamId } });
    }
    return { id: proposal.id };
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

  async getTeamStatus(versionId: string) {
    const plans = await prisma.crPlan.findMany({
      where: { versionId },
      select: {
        teamId: true,
        submissionStatus: true,
        notNeededForPlan: true,
        team: { select: { name: true } },
      },
    });

    // Seed from every team actually assigned CRs on this version — not just
    // teams that already have a CrPlan row. A team that never opened the
    // screen at all previously vanished from this list entirely, making
    // "all teams done" true the moment the one team that DID engage finished.
    const exemptRows: any[] = await prisma.$queryRawUnsafe(`SELECT id FROM "Team" WHERE "requiresPlan" = false`);
    const exemptTeamIds = new Set(exemptRows.map((r: any) => String(r.id)));
    const assignmentRows = await prisma.versionCrAssignment.findMany({
      where: { versionId, syncStatus: { not: 'REMOVED' } },
      select: { teamId: true },
      distinct: ['teamId'],
    });
    const expectedTeamIds = assignmentRows.map(r => r.teamId).filter(id => !exemptTeamIds.has(id));
    const missingTeamIds = expectedTeamIds.filter(id => !plans.some(p => p.teamId === id));
    const missingTeams = missingTeamIds.length > 0
      ? await prisma.team.findMany({ where: { id: { in: missingTeamIds } }, select: { id: true, name: true } })
      : [];

    const map = new Map<string, { teamId: string; teamName: string; total: number; draft: number; submitted: number; returned: number; approved: number }>();
    for (const t of missingTeams) {
      map.set(t.id, { teamId: t.id, teamName: t.name, total: 0, draft: 0, submitted: 0, returned: 0, approved: 0 });
    }
    for (const p of plans) {
      if (!map.has(p.teamId)) {
        map.set(p.teamId, { teamId: p.teamId, teamName: (p.team as any).name, total: 0, draft: 0, submitted: 0, returned: 0, approved: 0 });
      }
      const row = map.get(p.teamId)!;
      row.total++;
      if (p.notNeededForPlan || (p.submissionStatus as string) === 'APPROVED') row.approved++;
      else if ((p.submissionStatus as string) === 'SUBMITTED') row.submitted++;
      else if ((p.submissionStatus as string) === 'RETURNED') row.returned++;
      else row.draft++;
    }

    return Array.from(map.values()).map(r => ({
      ...r,
      allDone: r.total > 0 && r.draft === 0 && r.returned === 0,
    })).sort((a, b) => a.teamName.localeCompare(b.teamName, 'he'));
  }

  // Soft-delete (tombstone) rather than a hard delete — if the CR is still present
  // in the import source, the background sync would otherwise silently re-create a
  // fresh plan for it on the next reload, undoing the team's explicit deletion.
  async remove(id: string, user: { sub: string; role: string }) {
    const plan = await prisma.crPlan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('CrPlan לא נמצא');
    if (!MANAGERS.includes(user.role)) {
      const membership = await prisma.teamMember.findFirst({
        where: { userId: user.sub, teamId: plan.teamId },
      });
      if (!membership) throw new ForbiddenException('אין הרשאה');
    }
    await prisma.crPlan.update({ where: { id }, data: { removedByTeam: true } });
    return { ok: true };
  }
}
