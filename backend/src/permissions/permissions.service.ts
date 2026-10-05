import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { ALL_CATALOG_KEYS, MODULE_KEYS, PERMISSION_CATALOG, expandGrants, normalizeGrants } from './permission-catalog';

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

// Kept for existing importers: every grantable key (module + component).
export const ALL_PERMISSIONS = ALL_CATALOG_KEYS;

const screens = (id: string) => PERMISSION_CATALOG.find(m => m.id === id)!.items.filter(i => i.kind === 'screen').map(i => i.key);

// Defaults for a fresh install, in catalog keys (same reach as the old
// per-role defaults; RELEASE_MANAGER gains ניהול גרסה, which it already had
// through a hardcoded role check).
const DEFAULTS: Record<string, string[]> = {
  ADMIN:           [...MODULE_KEYS],
  RELEASE_MANAGER: ['module:version-management', ...screens('deployments'), 'action:import', 'action:gonogo', 'action:task_status',
                    'action:open_task_for_execution', 'action:override_version_edit', 'action:select_all_tasks', 'defects:view',
                    'action:qa_leave_request'],
  CR_MANAGER:      ['defects:view', 'action:qa_leave_request', 'deploy:hub', 'deploy:board', 'deploy:overview', 'deploy:implementation-plans', 'deploy:cr-manager'],
  TEAM_LEAD:       ['deploy:hub', 'screen:prep', 'deploy:proposals', 'deploy:implementation-plans', 'screen:night', 'deploy:board', 'deploy:overview',
                    'screen:timeline', 'deploy:summary-rehearsal', 'screen:summary', 'action:task_status', 'action:qa_leave_request', 'defects:view'],
  EMPLOYEE:        ['action:task_status', 'action:qc_defect_create', 'action:qc_attachment_upload', 'defects:view', 'action:qa_leave_request',
                    'deploy:hub', 'deploy:board', 'deploy:overview'],
  VIEWER:          ['screen:timeline', 'screen:night', 'screen:summary', 'deploy:summary-rehearsal', 'action:qa_leave_request',
                    'deploy:hub', 'deploy:board', 'deploy:overview'],
};

// Six actions that used to be decided by hardcoded role lists in the
// controllers, not by this table (2026-10-05, user chose to make the table
// the single source of truth). Grants are set ONCE to exactly what those
// hardcoded rules allowed, so nothing changes until an admin edits them.
const WIRED_ACTIONS_V3: Record<string, string[]> = {
  'action:import':          ['RELEASE_MANAGER'],                               // was MANAGERS
  'action:task_status':     ['EMPLOYEE', 'TEAM_LEAD', 'RELEASE_MANAGER'],      // was TASK_EXECUTORS
  'action:user_manage':     [],                                                // was ADMIN only
  'action:template_delete': [],                                                // was ADMIN only
  'action:qa_manage':       [],                                                // was ADMIN + QA team lead (team grant below)
  'action:qa_leave_request': ['RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'VIEWER'], // was open to all
};
const ACTIONS_MIGRATED_KEY = 'PERMISSIONS_ACTIONS_V3_MIGRATED';

// הטמעות menu screens (2026-10-05): every screen of the module got its own
// permission. Set ONCE to exactly what each role could open before, when
// these screens were gated by role lists in ManagerDashboard (or not at all):
// hub / board / overview were open to every role; proposals to TEAM_LEAD +
// screen:prep holders; CR review / plan assignment / merged plan to RM;
// implementation plans to RM, CR_MANAGER and TEAM_LEAD (via the version hub);
// the CR manager board to RM + CR_MANAGER; rehearsal summary to screen:summary
// holders. Templates were ADMIN-only (AdminPanel).
const DEPLOY_SCREENS_MIGRATED_KEY = 'PERMISSIONS_DEPLOY_SCREENS_V4_MIGRATED';
const DEPLOY_SCREENS_V4: { key: string; roles?: string[]; ifHas?: string; always?: boolean }[] = [
  { key: 'deploy:hub', always: true },
  { key: 'deploy:board', always: true },
  { key: 'deploy:overview', always: true },
  { key: 'deploy:proposals', roles: ['TEAM_LEAD'], ifHas: 'screen:prep' },
  { key: 'deploy:cr-review', roles: ['RELEASE_MANAGER'] },
  { key: 'deploy:release-assignment', roles: ['RELEASE_MANAGER'] },
  { key: 'deploy:unified-plan', roles: ['RELEASE_MANAGER'] },
  { key: 'deploy:implementation-plans', roles: ['RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD'] },
  { key: 'deploy:cr-manager', roles: ['RELEASE_MANAGER', 'CR_MANAGER'] },
  { key: 'deploy:summary-rehearsal', ifHas: 'screen:summary' },
];

// Team grants (user ask 2026-10-05: "לפי צוות ולפי תפקיד"): per team, keys for
// all its members, for its leads only, and for non-lead members only. A
// user's effective permissions = their role's + every team's they belong to.
// Replaces the hardcoded "member of a QA team sees QA + ניהול בדיקות" rule,
// which the one-time migration below turns into ordinary team grants.
export interface TeamGrant { ALL: string[]; LEAD: string[]; MEMBER: string[] }
export type TeamGrants = Record<string, TeamGrant>;
const TEAM_GRANTS_KEY = 'PERMISSIONS_TEAM_GRANTS';
const MIGRATED_KEY = 'PERMISSIONS_CATALOG_V2_MIGRATED';
const emptyGrant = (): TeamGrant => ({ ALL: [], LEAD: [], MEMBER: [] });

// ModuleAccessGuard asks on every request - cache each user's effective set
// briefly; any permissions change clears it.
const EFFECTIVE_TTL_MS = 30_000;
const effectiveCache = new Map<string, { keys: string[]; at: number }>();
const clearEffectiveCache = () => effectiveCache.clear();

@Injectable()
export class PermissionsService {
  private ready: Promise<void> | null = null;

  catalog() {
    return PERMISSION_CATALOG;
  }

  async getAll(): Promise<Record<string, string[]>> {
    await this.ensureReady();
    const rows = await prisma.rolePermissions.findMany();
    return rows.reduce((acc, row) => {
      acc[row.role] = normalizeGrants(row.permissions as string[]);
      return acc;
    }, {} as Record<string, string[]>);
  }

  async getTeamGrants(): Promise<TeamGrants> {
    await this.ensureReady();
    return this.readTeamGrants();
  }

  async setTeamGrants(body: TeamGrants): Promise<TeamGrants> {
    const teams = await prisma.team.findMany({ select: { id: true } });
    const known = new Set(teams.map(t => t.id));
    const clean: TeamGrants = {};
    for (const [teamId, g] of Object.entries(body ?? {})) {
      if (!known.has(teamId)) continue;
      const grant: TeamGrant = {
        ALL: normalizeGrants((g as any)?.ALL ?? []),
        LEAD: normalizeGrants((g as any)?.LEAD ?? []),
        MEMBER: normalizeGrants((g as any)?.MEMBER ?? []),
      };
      if (grant.ALL.length + grant.LEAD.length + grant.MEMBER.length > 0) clean[teamId] = grant;
    }
    clearEffectiveCache();
    await prisma.systemParam.upsert({
      where: { key: TEAM_GRANTS_KEY },
      update: { value: JSON.stringify(clean) },
      create: { key: TEAM_GRANTS_KEY, label: 'הרשאות לפי צוות', value: JSON.stringify(clean), type: 'text' },
    });
    return clean;
  }

  // A user's effective keys, expanded (module key -> all its components,
  // plus `partial:module:x` whenever any part of module x is granted).
  async getEffective(user: { sub: string; role: string }): Promise<string[]> {
    if (user.role === 'ADMIN') return expandGrants(MODULE_KEYS);
    const cacheKey = `${user.sub}|${user.role}`;
    const hit = effectiveCache.get(cacheKey);
    if (hit && Date.now() - hit.at < EFFECTIVE_TTL_MS) return hit.keys;
    await this.ensureReady();
    const [row, memberships, teamGrants] = await Promise.all([
      prisma.rolePermissions.findUnique({ where: { role: user.role as Role } }),
      prisma.teamMember.findMany({ where: { userId: user.sub }, select: { teamId: true, isLead: true } }),
      this.readTeamGrants(),
    ]);
    const keys = [...((row?.permissions as string[]) ?? [])];
    for (const m of memberships) {
      const g = teamGrants[m.teamId];
      if (!g) continue;
      keys.push(...g.ALL, ...(m.isLead ? g.LEAD : g.MEMBER));
    }
    const expanded = expandGrants(keys);
    effectiveCache.set(cacheKey, { keys: expanded, at: Date.now() });
    return expanded;
  }

  // Effective check for a real user (role + teams). ADMIN always passes.
  async userHas(user: { sub: string; role: string }, key: string): Promise<boolean> {
    if (user.role === 'ADMIN') return true;
    return (await this.getEffective(user)).includes(key);
  }

  // Role-only check, kept for callers without a user object.
  async hasPermission(role: Role, key: string): Promise<boolean> {
    if (role === 'ADMIN') return true;
    await this.ensureReady();
    const row = await prisma.rolePermissions.findUnique({ where: { role } });
    return expandGrants((row?.permissions as string[] | undefined) ?? []).includes(key);
  }

  async updateRole(role: Role, permissions: string[]) {
    const VALID_ROLES = ['ADMIN', 'RELEASE_MANAGER', 'CR_MANAGER', 'TEAM_LEAD', 'EMPLOYEE', 'VIEWER'];
    if (!VALID_ROLES.includes(role as string)) {
      throw new BadRequestException(`תפקיד לא חוקי: "${role}". תפקידים מותרים: ${VALID_ROLES.join(', ')}`);
    }
    const valid = normalizeGrants(permissions);
    clearEffectiveCache();
    return prisma.rolePermissions.upsert({
      where: { role },
      update: { permissions: valid },
      create: { role, permissions: valid },
    });
  }

  private async readTeamGrants(): Promise<TeamGrants> {
    const row = await prisma.systemParam.findUnique({ where: { key: TEAM_GRANTS_KEY } });
    if (!row?.value) return {};
    try {
      const parsed = JSON.parse(row.value) as TeamGrants;
      const out: TeamGrants = {};
      for (const [teamId, g] of Object.entries(parsed ?? {})) out[teamId] = { ...emptyGrant(), ...g };
      return out;
    } catch { return {}; }
  }

  private ensureReady(): Promise<void> {
    if (!this.ready) this.ready = this.init().catch(err => { this.ready = null; throw err; });
    return this.ready;
  }

  private async init() {
    for (const [role, permissions] of Object.entries(DEFAULTS)) {
      const exists = await prisma.rolePermissions.findUnique({ where: { role: role as Role } });
      if (!exists) await prisma.rolePermissions.create({ data: { role: role as Role, permissions } });
    }
    await this.migrateToCatalogOnce();
    await this.migrateWiredActionsOnce();
    await this.migrateDeployScreensOnce();
  }

  private async migrateDeployScreensOnce() {
    const done = await prisma.systemParam.findUnique({ where: { key: DEPLOY_SCREENS_MIGRATED_KEY } });
    if (done?.value === 'true') return;
    const rows = await prisma.rolePermissions.findMany();
    for (const row of rows) {
      if (row.role === 'ADMIN') continue;
      const keys = new Set(normalizeGrants(row.permissions as string[]));
      const before = new Set(keys);
      for (const g of DEPLOY_SCREENS_V4) {
        if (g.always || g.roles?.includes(row.role) || (g.ifHas && before.has(g.ifHas))) keys.add(g.key);
      }
      await prisma.rolePermissions.update({ where: { role: row.role }, data: { permissions: Array.from(keys) } });
    }
    await prisma.systemParam.upsert({
      where: { key: DEPLOY_SCREENS_MIGRATED_KEY },
      update: { value: 'true' },
      create: { key: DEPLOY_SCREENS_MIGRATED_KEY, label: 'מסכי הטמעות הועברו להרשאות', value: 'true', type: 'text' },
    });
    clearEffectiveCache();
  }

  // See WIRED_ACTIONS_V3. Also: attachment upload used to ride on
  // qc_defect_create - whoever had that gets qc_attachment_upload; QA team
  // leads ("qa" in the team name, same rule QaAdminGuard used) get qa_manage
  // as a team LEAD grant.
  private async migrateWiredActionsOnce() {
    const done = await prisma.systemParam.findUnique({ where: { key: ACTIONS_MIGRATED_KEY } });
    if (done?.value === 'true') return;
    const rows = await prisma.rolePermissions.findMany();
    for (const row of rows) {
      if (row.role === 'ADMIN') continue;
      const keys = new Set(normalizeGrants(row.permissions as string[]));
      for (const [action, roles] of Object.entries(WIRED_ACTIONS_V3)) {
        if (roles.includes(row.role)) keys.add(action); else keys.delete(action);
      }
      if (keys.has('action:qc_defect_create')) keys.add('action:qc_attachment_upload');
      await prisma.rolePermissions.update({ where: { role: row.role }, data: { permissions: Array.from(keys) } });
    }
    const grants = await this.readTeamGrants();
    const teams = await prisma.team.findMany({ select: { id: true, name: true } });
    for (const t of teams) {
      const g = grants[t.id] ?? emptyGrant();
      for (const bucket of ['ALL', 'LEAD', 'MEMBER'] as const) {
        if (g[bucket].includes('action:qc_defect_create') && !g[bucket].includes('action:qc_attachment_upload')) g[bucket].push('action:qc_attachment_upload');
      }
      if (String(t.name ?? '').toLowerCase().includes('qa') && !g.LEAD.includes('action:qa_manage')) g.LEAD.push('action:qa_manage');
      if (g.ALL.length + g.LEAD.length + g.MEMBER.length > 0) grants[t.id] = g;
    }
    await prisma.systemParam.upsert({
      where: { key: TEAM_GRANTS_KEY },
      update: { value: JSON.stringify(grants) },
      create: { key: TEAM_GRANTS_KEY, label: 'הרשאות לפי צוות', value: JSON.stringify(grants), type: 'text' },
    });
    await prisma.systemParam.upsert({
      where: { key: ACTIONS_MIGRATED_KEY },
      update: { value: 'true' },
      create: { key: ACTIONS_MIGRATED_KEY, label: 'פעולות הועברו לטבלת ההרשאות', value: 'true', type: 'text' },
    });
    clearEffectiveCache();
  }

  // One-time move of existing grants onto the catalog (2026-10-05), keeping
  // who-sees-what unchanged:
  // - old screen:* module keys -> that module's screens (never its actions);
  // - RELEASE_MANAGER gets ניהול גרסה (was a hardcoded role check);
  // - ADMIN gets every module;
  // - teams that counted as "QA" ("qa" in the team name) get the
  //   QA screens + ניהול בדיקות for all members (was a hardcoded check).
  private async migrateToCatalogOnce() {
    const done = await prisma.systemParam.findUnique({ where: { key: MIGRATED_KEY } });
    if (done?.value === 'true') return;
    const rows = await prisma.rolePermissions.findMany();
    for (const row of rows) {
      let keys = normalizeGrants(row.permissions as string[]);
      if (row.role === 'RELEASE_MANAGER' && !keys.includes('module:version-management')) keys.push('module:version-management');
      if (row.role === 'ADMIN') keys = [...MODULE_KEYS];
      await prisma.rolePermissions.update({ where: { role: row.role }, data: { permissions: keys } });
    }
    const existing = await this.readTeamGrants();
    const teams = await prisma.team.findMany({ select: { id: true, name: true } });
    for (const t of teams) {
      // exactly the old ManagerDashboard rule ("qa" in the team name) - no one
      // gains access they didn't already have
      const isQa = String(t.name ?? '').toLowerCase().includes('qa');
      if (!isQa) continue;
      const g = existing[t.id] ?? emptyGrant();
      g.ALL = Array.from(new Set([...g.ALL, ...screens('qa'), 'module:release-intelligence']));
      existing[t.id] = g;
    }
    await prisma.systemParam.upsert({
      where: { key: TEAM_GRANTS_KEY },
      update: { value: JSON.stringify(existing) },
      create: { key: TEAM_GRANTS_KEY, label: 'הרשאות לפי צוות', value: JSON.stringify(existing), type: 'text' },
    });
    await prisma.systemParam.upsert({
      where: { key: MIGRATED_KEY },
      update: { value: 'true' },
      create: { key: MIGRATED_KEY, label: 'הרשאות הועברו למבנה מודולים', value: 'true', type: 'text' },
    });
  }
}
