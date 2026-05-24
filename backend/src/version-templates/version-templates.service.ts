import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

@Injectable()
export class VersionTemplatesService {
  async findAll() {
    return prisma.versionTemplate.findMany({
      include: { creator: { select: { id: true, fullName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async create(versionId: string, name: string, description: string | undefined, createdBy: string) {
    const version = await prisma.version.findUnique({
      where: { id: versionId },
      include: {
        phases: {
          orderBy: { orderIndex: 'asc' },
          include: {
            subPhases: {
              orderBy: { orderIndex: 'asc' },
              include: {
                tasks: {
                  orderBy: { orderIndex: 'asc' },
                  select: {
                    id: true,
                    title: true, description: true, notes: true, dependencyNote: true,
                    duration: true, application: true, environment: true, priority: true,
                    orderIndex: true,
                    isCritical: true, isCriticalForGo: true, morningFollowup: true,
                    assignedUserName: true, assignedUserId: true, assignedTeamId: true,
                    dependencies: { select: { dependsOnTaskId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!version) throw new NotFoundException('Version not found');

    // Build taskId → [phaseIdx, subIdx, taskIdx] for dependency mapping
    const taskIdToIndex = new Map<string, [number, number, number]>();
    version.phases.forEach((phase, pi) =>
      phase.subPhases.forEach((sub, si) =>
        sub.tasks.forEach((t, ti) => taskIdToIndex.set(t.id, [pi, si, ti]))
      )
    );

    const structure = version.phases.map((phase, _pi) => ({
      name: phase.name,
      orderIndex: phase.orderIndex,
      environment: phase.environment,
      teamId: phase.teamId ?? null,
      subPhases: phase.subPhases.map(sub => ({
        name: sub.name,
        orderIndex: sub.orderIndex,
        tasks: sub.tasks.map(t => ({
          title: t.title,
          description: t.description,
          notes: t.notes,
          dependencyNote: t.dependencyNote,
          duration: t.duration,
          application: t.application,
          environment: t.environment,
          priority: t.priority,
          orderIndex: t.orderIndex,
          isCritical: t.isCritical,
          isCriticalForGo: t.isCriticalForGo,
          morningFollowup: t.morningFollowup,
          assignedUserName: t.assignedUserName ?? null,
          assignedUserId: t.assignedUserId ?? null,
          assignedTeamId: t.assignedTeamId ?? null,
          // deps stored as index triplets so they survive ID changes
          deps: t.dependencies
            .map(d => taskIdToIndex.get(d.dependsOnTaskId))
            .filter((x): x is [number, number, number] => x !== undefined),
        })),
      })),
    }));

    // Upsert by name: update structure if a template with this name already exists
    const existing = await prisma.versionTemplate.findFirst({ where: { name } });
    if (existing) {
      return prisma.versionTemplate.update({
        where: { id: existing.id },
        data: { structure, description: description ?? existing.description, updatedAt: new Date() },
        include: { creator: { select: { id: true, fullName: true } } },
      });
    }
    return prisma.versionTemplate.create({
      data: { name, description, structure, createdBy },
      include: { creator: { select: { id: true, fullName: true } } },
    });
  }

  async applyToVersion(templateId: string, versionId: string, createdBy: string) {
    const template = await prisma.versionTemplate.findUnique({ where: { id: templateId } });
    if (!template) throw new NotFoundException('Template not found');

    const version = await prisma.version.findUnique({ where: { id: versionId } });
    if (!version) throw new NotFoundException('Version not found');

    const structure = template.structure as any[];
    let taskCount = 0;

    // Collect all user/team IDs referenced in the template and verify they still exist
    const allUserIds = new Set<string>();
    const allTeamIds = new Set<string>();
    for (const p of structure) {
      for (const s of p.subPhases ?? []) {
        for (const t of s.tasks ?? []) {
          if (t.assignedUserId) allUserIds.add(t.assignedUserId);
          if (t.assignedTeamId) allTeamIds.add(t.assignedTeamId);
        }
      }
    }
    const [validUsers, validTeams] = await Promise.all([
      allUserIds.size > 0
        ? prisma.user.findMany({ where: { id: { in: Array.from(allUserIds) }, active: true }, select: { id: true } })
        : Promise.resolve([]),
      allTeamIds.size > 0
        ? prisma.team.findMany({ where: { id: { in: Array.from(allTeamIds) }, active: true }, select: { id: true } })
        : Promise.resolve([]),
    ]);
    const validUserSet = new Set(validUsers.map(u => u.id));
    const validTeamSet = new Set(validTeams.map(t => t.id));

    // taskIndexMap[pi][si][ti] = newly-created task ID
    const taskIndexMap: string[][][] = [];

    for (let pi = 0; pi < structure.length; pi++) {
      const phaseData = structure[pi];
      const phase = await prisma.phase.create({
        data: {
          versionId,
          name: phaseData.name,
          orderIndex: phaseData.orderIndex,
          environment: phaseData.environment,
          ...(phaseData.teamId ? { teamId: phaseData.teamId } : {}),
        },
      });

      taskIndexMap[pi] = [];
      for (let si = 0; si < (phaseData.subPhases ?? []).length; si++) {
        const subData = phaseData.subPhases[si];
        const sub = await prisma.subPhase.create({
          data: { phaseId: phase.id, name: subData.name, orderIndex: subData.orderIndex },
        });

        taskIndexMap[pi][si] = [];
        for (let ti = 0; ti < (subData.tasks ?? []).length; ti++) {
          const td = subData.tasks[ti];
          const task = await prisma.task.create({
            data: {
              title: td.title,
              description: td.description ?? null,
              notes: td.notes ?? null,
              dependencyNote: td.dependencyNote ?? null,
              duration: td.duration ?? null,
              application: td.application ?? null,
              environment: td.environment ?? 'BOTH',
              priority: td.priority ?? 'MEDIUM',
              orderIndex: td.orderIndex ?? ti,
              crNumber: td.crNumber ?? null,
              isCritical: td.isCritical ?? false,
              isCriticalForGo: td.isCriticalForGo ?? false,
              morningFollowup: td.morningFollowup ?? false,
              assignedUserName: td.assignedUserName ?? null,
              assignedUserId: td.assignedUserId && validUserSet.has(td.assignedUserId) ? td.assignedUserId : null,
              assignedTeamId: td.assignedTeamId && validTeamSet.has(td.assignedTeamId) ? td.assignedTeamId : null,
              subPhaseId: sub.id,
              versionId,
              status: 'WAITING',
              createdBy,
              createdByTeamLead: createdBy,
            },
          });
          taskIndexMap[pi][si][ti] = task.id;
          taskCount++;
        }
      }
    }

    // Recreate TaskDependency rows using the index map
    let depCount = 0;
    for (let pi = 0; pi < structure.length; pi++) {
      for (let si = 0; si < (structure[pi].subPhases ?? []).length; si++) {
        for (let ti = 0; ti < (structure[pi].subPhases[si].tasks ?? []).length; ti++) {
          const td = structure[pi].subPhases[si].tasks[ti];
          const taskId = taskIndexMap[pi]?.[si]?.[ti];
          if (!taskId) continue;
          for (const dep of (td.deps ?? [])) {
            const [dpi, dsi, dti] = dep as [number, number, number];
            const depTaskId = taskIndexMap[dpi]?.[dsi]?.[dti];
            if (depTaskId) {
              await prisma.taskDependency.create({
                data: { taskId, dependsOnTaskId: depTaskId },
              });
              depCount++;
            }
          }
        }
      }
    }

    return { message: 'תבנית הוחלה בהצלחה', taskCount, depCount };
  }

  async update(id: string, data: { name?: string; description?: string }) {
    const template = await prisma.versionTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    return prisma.versionTemplate.update({ where: { id }, data });
  }

  async remove(id: string) {
    const template = await prisma.versionTemplate.findUnique({ where: { id } });
    if (!template) throw new NotFoundException('Template not found');
    await prisma.versionTemplate.delete({ where: { id } });
    return { message: 'תבנית נמחקה' };
  }
}
