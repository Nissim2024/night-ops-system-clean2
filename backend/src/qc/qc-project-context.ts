import { AsyncLocalStorage } from 'async_hooks';
import { ForbiddenException } from '@nestjs/common';
import { prisma } from '../prisma-client';

// ── Which QC project this request belongs to (2026-10-09) ───────────────────
// The project is chosen at login and carried in the JWT (`qcProject`). A
// middleware (main.ts) runs every request inside runWithQcProject(), so any
// code below — Oracle reads, QC REST calls, caches, per-project settings —
// can ask currentQcProject() without passing it through every signature.
// Background jobs (no request) get the default project, exactly as before.


export interface QcProjectRow {
  id: string; key: string; displayName: string; domain: string; restProject: string;
  oracleSchema: string | null; active: boolean; isDefault: boolean; writeEnabled: boolean; sortOrder: number;
}

const store = new AsyncLocalStorage<{ projectKey: string | null }>();

export function runWithQcProject<T>(projectKey: string | null, fn: () => T): T {
  return store.run({ projectKey }, fn);
}

/** the project key of this request's login, or null (background job / old token) */
export function currentQcProjectKey(): string | null {
  return store.getStore()?.projectKey ?? null;
}

let cache: { at: number; rows: QcProjectRow[] } | null = null;
const CACHE_MS = 30_000;

export async function listQcProjects(force = false): Promise<QcProjectRow[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.rows;
  const rows = await prisma.qcProject.findMany({ orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }] });
  cache = { at: Date.now(), rows };
  return rows;
}

export function invalidateQcProjects(): void { cache = null; }

/** the request's project; the default project when none / unknown */
export async function currentQcProject(): Promise<QcProjectRow | null> {
  const rows = await listQcProjects();
  const key = currentQcProjectKey();
  return (key ? rows.find(r => r.key === key) : undefined) ?? rows.find(r => r.isDefault) ?? null;
}

export async function isDefaultQcProject(): Promise<boolean> {
  const p = await currentQcProject();
  return !p || p.isDefault;
}

/** Per-project setting: the default project keeps the plain SystemParam key
 *  (nothing changes for it); another project uses KEY@PROJECT. */
export async function projectParamKey(key: string): Promise<string> {
  const p = await currentQcProject();
  return !p || p.isDefault ? key : `${key}@${p.key}`;
}

/** cache-key prefix, so two projects never share cached QC data */
export function projectCacheKey(key: string): string {
  return `${currentQcProjectKey() ?? ''}|${key}`;
}

/** Every write to QC goes through this: a project starts read-only until an
 *  admin turns writes on (after its field map was verified). */
export async function assertQcProjectWritable(): Promise<void> {
  const p = await currentQcProject();
  if (p && !p.writeEnabled) {
    throw new ForbiddenException(`הכתיבה ל-QC בפרויקט ${p.displayName} עדיין לא הופעלה — מנהל מערכת מפעיל אותה בניהול → אינטגרציות → פרויקטי QC, אחרי אימות השדות.`);
  }
}

/** Oracle schema names are put into ALTER SESSION — only plain identifiers. */
export function isValidOracleSchema(s: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_$#]{0,127}$/.test(s);
}

/** First start with this feature: the existing single-project settings
 *  (QC_REST_DOMAIN / QC_REST_PROJECT) become the default project, writable as
 *  before — nothing changes for current users. */
export async function ensureDefaultQcProject(): Promise<void> {
  if ((await prisma.qcProject.count()) > 0) return;
  const params = await prisma.systemParam.findMany({ where: { key: { in: ['QC_REST_DOMAIN', 'QC_REST_PROJECT'] } } });
  const get = (k: string) => (params.find(p => p.key === k)?.value ?? '').trim();
  const restProject = get('QC_REST_PROJECT') || 'HOT_Wizard_IRB_Main';
  await prisma.qcProject.create({
    data: { key: restProject, displayName: restProject, domain: get('QC_REST_DOMAIN'), restProject, isDefault: true, writeEnabled: true, active: true },
  });
  invalidateQcProjects();
}

/** Can this user log in to this project? Default project: everyone. Others:
 *  ADMIN, or listed directly, or a member of a listed team. */
export async function userMayUseQcProject(user: { id: string; role: string }, project: QcProjectRow): Promise<boolean> {
  if (!project.active) return false;
  if (project.isDefault || user.role === 'ADMIN') return true;
  const access = await prisma.qcProjectAccess.findMany({ where: { projectId: project.id } });
  if (access.some(a => a.userId === user.id)) return true;
  const teamIds = access.map(a => a.teamId).filter((t): t is string => !!t);
  if (teamIds.length === 0) return false;
  return (await prisma.teamMember.count({ where: { userId: user.id, teamId: { in: teamIds } } })) > 0;
}
