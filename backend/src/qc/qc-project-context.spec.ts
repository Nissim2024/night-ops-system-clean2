// Multi-project (2026-10-09): every request runs as its login's QC project.
const projects = [
  { id: 'p1', key: 'HOT_Wizard_IRB_Main', displayName: 'Main', domain: 'hot', restProject: 'HOT_Wizard_IRB_Main', oracleSchema: null, active: true, isDefault: true, writeEnabled: true, sortOrder: 0 },
  { id: 'p2', key: 'HOTAPPS', displayName: 'אפליקציות HOT', domain: 'hot', restProject: 'HOTAPPS', oracleSchema: 'HOTAPPS_DB', active: true, isDefault: false, writeEnabled: false, sortOrder: 1 },
];
const access = [{ projectId: 'p2', userId: 'u-direct', teamId: null }, { projectId: 'p2', userId: null, teamId: 't-apps' }];
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    qcProject: { findMany: jest.fn(async () => projects) },
    qcProjectAccess: { findMany: jest.fn(async () => access) },
    teamMember: { count: jest.fn(async ({ where }: any) => (where.userId === 'u-team' && where.teamId.in.includes('t-apps') ? 1 : 0)) },
  })),
}));

import {
  runWithQcProject, currentQcProject, projectParamKey, projectCacheKey, assertQcProjectWritable, userMayUseQcProject, isValidOracleSchema,
} from './qc-project-context';

describe('QC project context', () => {
  it('no project (background job / default login) = the default project, plain keys', async () => {
    await runWithQcProject(null, async () => {
      expect((await currentQcProject())?.key).toBe('HOT_Wizard_IRB_Main');
      expect(await projectParamKey('QC_DEFECT_FIELD_LIST_MAP')).toBe('QC_DEFECT_FIELD_LIST_MAP');
      await expect(assertQcProjectWritable()).resolves.toBeUndefined();
    });
  });

  it('another project: its own settings / cache keys, and read-only until enabled', async () => {
    await runWithQcProject('HOTAPPS', async () => {
      expect((await currentQcProject())?.oracleSchema).toBe('HOTAPPS_DB');
      expect(await projectParamKey('QC_DEFECT_FIELD_LIST_MAP')).toBe('QC_DEFECT_FIELD_LIST_MAP@HOTAPPS');
      expect(projectCacheKey('release-cycle-options')).toBe('HOTAPPS|release-cycle-options');
      await expect(assertQcProjectWritable()).rejects.toThrow('אפליקציות HOT');
    });
    expect(projectCacheKey('release-cycle-options')).toBe('|release-cycle-options');
  });

  it('access: default = everyone; other = ADMIN, listed user, member of a listed team', async () => {
    const [main, apps] = projects;
    expect(await userMayUseQcProject({ id: 'anyone', role: 'EMPLOYEE' }, main)).toBe(true);
    expect(await userMayUseQcProject({ id: 'anyone', role: 'ADMIN' }, apps)).toBe(true);
    expect(await userMayUseQcProject({ id: 'u-direct', role: 'EMPLOYEE' }, apps)).toBe(true);
    expect(await userMayUseQcProject({ id: 'u-team', role: 'TEAM_LEAD' }, apps)).toBe(true);
    expect(await userMayUseQcProject({ id: 'someone-else', role: 'RELEASE_MANAGER' }, apps)).toBe(false);
    expect(await userMayUseQcProject({ id: 'u-direct', role: 'EMPLOYEE' }, { ...apps, active: false })).toBe(false);
  });

  it('only plain identifiers go into ALTER SESSION', () => {
    expect(isValidOracleSchema('HOTAPPS_DB')).toBe(true);
    expect(isValidOracleSchema('x; DROP TABLE BUG')).toBe(false);
    expect(isValidOracleSchema('1abc')).toBe(false);
  });
});
