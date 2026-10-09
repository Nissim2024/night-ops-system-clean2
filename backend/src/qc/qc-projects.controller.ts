import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Put, Request, UseGuards } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { JwtGuard } from '../auth/jwt/jwt.guard';
import { QcRestService } from './qc-rest.service';
import { getOracleConfig, testQcProjectOracle } from './qc.service';
import { invalidateQcProjects, isValidOracleSchema, listQcProjects, runWithQcProject } from './qc-project-context';

const prisma = new PrismaClient();

// QC projects admin (2026-10-09, multi-project): AdminPanel → אינטגרציות →
// פרויקטי QC. ADMIN only. `displayName` is DeployCenter's own name for a
// project — nothing here ever changes QC.
@Controller('qc-projects')
@UseGuards(JwtGuard)
export class QcProjectsController {
  constructor(private readonly qcRest: QcRestService) {}

  private admin(req: any) {
    if (req.user?.role !== 'ADMIN') throw new ForbiddenException('רק מנהל מערכת יכול לנהל פרויקטי QC');
  }

  /** run fn as if the request were logged in to that project */
  private async asProject<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const p = (await listQcProjects(true)).find(r => r.id === id);
    if (!p) throw new BadRequestException('פרויקט לא נמצא');
    return runWithQcProject(p.isDefault ? null : p.key, fn);
  }

  @Get()
  async list(@Request() req: any) {
    this.admin(req);
    const rows = await prisma.qcProject.findMany({ orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }], include: { access: true } });
    return rows;
  }

  private clean(body: any, creating: boolean) {
    const str = (v: any) => (typeof v === 'string' ? v.trim() : undefined);
    const data: any = {};
    for (const k of ['key', 'displayName', 'domain', 'restProject']) if (str(body?.[k]) !== undefined) data[k] = str(body[k]);
    if (body?.oracleSchema !== undefined) {
      const sch = str(body.oracleSchema) || null;
      if (sch && !isValidOracleSchema(sch)) throw new BadRequestException('שם סכמה לא תקין (אותיות, ספרות ו-_ בלבד)');
      data.oracleSchema = sch;
    }
    for (const k of ['active', 'isDefault', 'writeEnabled']) if (typeof body?.[k] === 'boolean') data[k] = body[k];
    if (typeof body?.sortOrder === 'number') data.sortOrder = body.sortOrder;
    if (creating) {
      if (!data.restProject || !data.domain) throw new BadRequestException('חובה למלא Domain ושם פרויקט ב-QC');
      data.key = data.key || data.restProject;
      data.displayName = data.displayName || data.restProject;
      if (data.writeEnabled === undefined) data.writeEnabled = false;   // new project: read-only until verified
    }
    if (data.key !== undefined && !/^[A-Za-z0-9_.\-]{1,80}$/.test(data.key)) throw new BadRequestException('מזהה פרויקט לא תקין');
    return data;
  }

  @Post()
  async create(@Request() req: any, @Body() body: any) {
    this.admin(req);
    const data = this.clean(body, true);
    if (data.isDefault) await prisma.qcProject.updateMany({ data: { isDefault: false } });
    const row = await prisma.qcProject.create({ data });
    invalidateQcProjects();
    return row;
  }

  @Patch(':id')
  async update(@Request() req: any, @Param('id') id: string, @Body() body: any) {
    this.admin(req);
    const data = this.clean(body, false);
    delete data.key;   // the key is in every issued token — fixed once created
    const current = await prisma.qcProject.findUnique({ where: { id } });
    if (!current) throw new BadRequestException('פרויקט לא נמצא');
    if (data.isDefault === false && current.isDefault) throw new BadRequestException('חייב להיות פרויקט ברירת מחדל — סמן פרויקט אחר כברירת מחדל');
    if (current.isDefault && data.active === false) throw new BadRequestException('לא ניתן להשבית את פרויקט ברירת המחדל');
    if (data.isDefault) await prisma.qcProject.updateMany({ where: { id: { not: id } }, data: { isDefault: false } });
    const row = await prisma.qcProject.update({ where: { id }, data });
    invalidateQcProjects();
    return row;
  }

  @Delete(':id')
  async remove(@Request() req: any, @Param('id') id: string) {
    this.admin(req);
    const current = await prisma.qcProject.findUnique({ where: { id } });
    if (current?.isDefault) throw new BadRequestException('לא ניתן למחוק את פרויקט ברירת המחדל');
    await prisma.qcProject.delete({ where: { id } });
    invalidateQcProjects();
    return { ok: true };
  }

  // who may log in to the project: users and/or teams (replaces the list)
  @Put(':id/access')
  async setAccess(@Request() req: any, @Param('id') id: string, @Body() body: { userIds?: string[]; teamIds?: string[] }) {
    this.admin(req);
    const userIds = Array.from(new Set((body?.userIds ?? []).filter(x => typeof x === 'string' && x)));
    const teamIds = Array.from(new Set((body?.teamIds ?? []).filter(x => typeof x === 'string' && x)));
    await prisma.$transaction([
      prisma.qcProjectAccess.deleteMany({ where: { projectId: id } }),
      prisma.qcProjectAccess.createMany({ data: [...userIds.map(userId => ({ projectId: id, userId })), ...teamIds.map(teamId => ({ projectId: id, teamId }))] }),
    ]);
    return { ok: true, users: userIds.length, teams: teamIds.length };
  }

  // the projects QC itself has in a domain (the acting admin's QC session)
  @Get('discover/:domain')
  async discover(@Request() req: any, @Param('domain') domain: string) {
    this.admin(req);
    const known = new Set((await listQcProjects(true)).map(p => `${p.domain}|${p.restProject}`.toLowerCase()));
    const r = await this.qcRest.listDomainProjects(req.user.sub, domain);
    return { domain: r.domain, projects: r.projects.map(name => ({ name, configured: known.has(`${r.domain}|${name}`.toLowerCase()) })) };
  }

  // Oracle (the project's schema) + QC REST, each reported separately
  @Post(':id/test')
  async test(@Request() req: any, @Param('id') id: string) {
    this.admin(req);
    return this.asProject(id, async () => {
      const { enabled } = await getOracleConfig();
      const oracle = enabled ? await testQcProjectOracle() : { ok: false, message: 'Oracle לא מוגדר בסביבה הזו' };
      const rest = await this.qcRest.testProjectConnection(req.user.sub)
        .catch((e: any) => ({ ok: false, message: e?.response?.message || e.message }));
      return { oracle, rest };
    });
  }

  // The project's defect fields vs the default project's: a project's QC
  // writes should be turned on only when these match (2026-10-09).
  @Get(':id/field-compare')
  async fieldCompare(@Request() req: any, @Param('id') id: string) {
    this.admin(req);
    const projects = await listQcProjects(true);
    const def = projects.find(p => p.isDefault);
    if (!def) throw new BadRequestException('אין פרויקט ברירת מחדל');
    const base = await runWithQcProject(null, () => this.qcRest.probeEntityFields('defects', req.user.sub));
    const other = await this.asProject(id, () => this.qcRest.probeEntityFields('defects', req.user.sub));
    const listOf = (raw: any) => {
      if (!raw || typeof raw !== 'object') return '';
      const k = Object.keys(raw).find(x => /list[-_ ]?id/i.test(x));
      return k ? String(raw[k]) : '';
    };
    const byName = (rows: typeof base) => new Map(rows.map(f => [f.name, f]));
    const a = byName(base);
    const b = byName(other);
    const names = Array.from(new Set([...a.keys(), ...b.keys()])).sort();
    const rows = names.map(name => {
      const x = a.get(name);
      const y = b.get(name);
      const diffs: string[] = [];
      if (!x) diffs.push('קיים רק בפרויקט זה');
      if (!y) diffs.push(`חסר בפרויקט זה (קיים ב-${def.displayName})`);
      if (x && y) {
        if (x.label !== y.label) diffs.push('תווית שונה');
        if (x.type !== y.type) diffs.push('סוג שונה');
        if (x.required !== y.required) diffs.push('חובה שונה');
        // list ids are per project — compare only whether the field is a value list
        if (!!listOf(x.raw) !== !!listOf(y.raw)) diffs.push('רשימת ערכים בפרויקט אחד בלבד');
      }
      return { name, baseLabel: x?.label ?? null, label: y?.label ?? null, baseType: x?.type ?? null, type: y?.type ?? null, diffs };
    });
    return { base: def.displayName, total: rows.length, different: rows.filter(r => r.diffs.length > 0).length, rows };
  }
}
