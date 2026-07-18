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
  'action:qa_leave_request', 'action:qa_manage',
];

const DEFAULTS: Record<string, string[]> = {
  ADMIN:           [...ALL_PERMISSIONS],
  RELEASE_MANAGER: ['screen:prep','screen:handoff','screen:timeline','screen:night','screen:summary','action:import','action:gonogo','action:task_status','action:open_task_for_execution','action:override_version_edit','action:select_all_tasks'],
  CR_MANAGER:      [],
  TEAM_LEAD:       ['screen:handoff','screen:timeline','screen:night','screen:summary','screen:prep','screen:qa','screen:release-intelligence','action:task_status','action:qa_leave_request','action:qa_manage'],
  EMPLOYEE:        ['action:task_status'],
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
