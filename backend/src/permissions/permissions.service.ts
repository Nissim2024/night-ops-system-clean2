import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

export const ALL_PERMISSIONS = [
  'screen:prep', 'screen:handoff', 'screen:timeline',
  'screen:night', 'screen:summary', 'screen:admin', 'screen:qa', 'screen:release-intelligence', 'screen:quality-hub',
  'action:import', 'action:gonogo', 'action:task_status', 'action:open_task_for_execution',
  'action:user_manage', 'action:override_version_edit', 'action:select_all_tasks', 'action:template_delete',
  'action:qa_leave_request', 'action:qa_manage', 'action:qc_write',
  // Split out of action:qc_write (docs/spec-defects-module.md §9, 2026-09-18)
  // — "can append a comment / change status" is a materially smaller blast
  // radius than "can open a new defect in QC" or "can edit arbitrary
  // fields", so each gets its own grantable permission.
  'action:qc_defect_create', 'action:qc_defect_edit_extended', 'action:qc_attachment_upload',
];

const DEFAULTS: Record<string, string[]> = {
  ADMIN:           [...ALL_PERMISSIONS],
  RELEASE_MANAGER: ['screen:prep','screen:handoff','screen:timeline','screen:night','screen:summary','action:import','action:gonogo','action:task_status','action:open_task_for_execution','action:override_version_edit','action:select_all_tasks'],
  CR_MANAGER:      [],
  // screen:qa / screen:release-intelligence deliberately excluded here — a team
  // lead who isn't on the QA team shouldn't see those modules by default; actual
  // QA-team members still get them via the isQaTeamMember check in ManagerDashboard
  // regardless of this role-level grant (see canAccessQa/canAccessReleaseIntelligence).
  TEAM_LEAD:       ['screen:handoff','screen:timeline','screen:night','screen:summary','screen:prep','action:task_status','action:qa_leave_request','action:qa_manage'],
  // action:qc_defect_create granted here by default — user's explicit call
  // (2026-09-18): "every QA" can open a new defect, and QA testers are
  // EMPLOYEE-role users (per QaAssignment.userId) in this app's role model,
  // not a distinct "QA" role. Still adjustable per-role at runtime in
  // AdminPanel like every other permission here.
  EMPLOYEE:        ['action:task_status', 'action:qc_defect_create'],
  VIEWER:          ['screen:timeline','screen:night','screen:summary'],
};

@Injectable()
export class PermissionsService {
  async getAll(): Promise<Record<string, string[]>> {
    await this.ensureDefaults();
    const rows = await prisma.rolePermissions.findMany();
    return rows.reduce((acc, row) => {
      acc[row.role] = row.permissions as string[];
      return acc;
    }, {} as Record<string, string[]>);
  }

  // ADMIN always passes regardless of its stored row (matches DEFAULTS.ADMIN
  // spreading ALL_PERMISSIONS) — a role-level check other controllers can
  // reuse instead of a hardcoded requireRole(['ADMIN']) allowlist (spec
  // confirmed 2026-09-02, first consumer: QC REST write-back).
  async hasPermission(role: Role, key: string): Promise<boolean> {
    if (role === 'ADMIN') return true;
    await this.ensureDefaults();
    const row = await prisma.rolePermissions.findUnique({ where: { role } });
    return (row?.permissions as string[] | undefined)?.includes(key) ?? false;
  }

  async updateRole(role: Role, permissions: string[]) {
    const VALID_ROLES = ['ADMIN', 'RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'VIEWER'];
    if (!VALID_ROLES.includes(role as string)) {
      throw new BadRequestException(`תפקיד לא חוקי: "${role}". תפקידים מותרים: ${VALID_ROLES.join(', ')}`);
    }
    const valid = permissions.filter(p => ALL_PERMISSIONS.includes(p));
    return prisma.rolePermissions.upsert({
      where: { role },
      update: { permissions: valid },
      create: { role, permissions: valid },
    });
  }

  private async ensureDefaults() {
    for (const [role, permissions] of Object.entries(DEFAULTS)) {
      const exists = await prisma.rolePermissions.findUnique({ where: { role: role as Role } });
      if (!exists) {
        await prisma.rolePermissions.create({ data: { role: role as Role, permissions } });
      }
    }
  }
}
