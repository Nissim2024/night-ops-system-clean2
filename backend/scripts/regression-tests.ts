/**
 * Night-Ops Regression Test Suite
 * Run: npx ts-node scripts/regression-tests.ts
 */

import axios, { AxiosInstance } from 'axios';
import * as bcrypt from 'bcrypt';
import { PrismaClient } from '@prisma/client';

const BASE = 'http://localhost:3000';
const prisma = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string) {
  console.log(`  ✅ ${name}`);
  pass++;
}
function ko(name: string, reason: string) {
  console.error(`  ❌ ${name}: ${reason}`);
  fail++;
  failures.push(`${name}: ${reason}`);
}
async function test(name: string, fn: () => Promise<void>) {
  try { await fn(); ok(name); }
  catch (e: any) { ko(name, e.response?.data?.message ?? e.message); }
}
async function expectStatus(fn: () => Promise<any>, expected: number, name: string) {
  try {
    const r = await fn();
    if ((r.status ?? 200) === expected) ok(name);
    else ko(name, `got ${r.status}, expected ${expected}`);
  } catch (e: any) {
    const got = e.response?.status;
    if (got === expected) ok(name);
    else ko(name, `got HTTP ${got ?? '?'}, expected ${expected}: ${e.response?.data?.message ?? e.message}`);
  }
}

async function login(email: string, password: string): Promise<AxiosInstance> {
  const { data } = await axios.post(`${BASE}/auth/login`, { email, password });
  const inst = axios.create({
    baseURL: BASE,
    headers: { Authorization: `Bearer ${data.token}` },
  });
  return inst;
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function ensureUser(email: string, password: string, role: string, fullName: string) {
  const hash = await bcrypt.hash(password, 10);
  return prisma.user.upsert({
    where: { email },
    update: { password: hash, role: role as any, active: true },
    create: { email, password: hash, role: role as any, fullName, active: true },
  });
}

async function cleanupVersions() {
  await prisma.version.deleteMany({ where: { name: { startsWith: 'REG-TEST-' } } });
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function deleteVersion(id: string) {
  await prisma.teamSubmission.deleteMany({ where: { versionId: id } });
  await prisma.taskProposal.deleteMany({ where: { versionId: id } });
  await prisma.nightSummary.deleteMany({ where: { versionId: id } });
  await (prisma as any).rehearsalSummary.deleteMany({ where: { versionId: id } });
  const tasks = await prisma.task.findMany({ where: { versionId: id }, select: { id: true } });
  const taskIds = tasks.map((t: any) => t.id);
  if (taskIds.length) {
    await prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: { in: taskIds } }, { dependsOnTaskId: { in: taskIds } }] } });
    await prisma.auditLog.deleteMany({ where: { taskId: { in: taskIds } } });
    await prisma.task.deleteMany({ where: { versionId: id } });
  }
  const phases = await prisma.phase.findMany({ where: { versionId: id }, select: { id: true } });
  if (phases.length) {
    await prisma.subPhase.deleteMany({ where: { phaseId: { in: phases.map((p: any) => p.id) } } });
    await prisma.phase.deleteMany({ where: { versionId: id } });
  }
  await prisma.version.delete({ where: { id } });
}

async function resetActiveVersions() {
  await prisma.version.updateMany({
    where: { status: { in: ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'] as any } },
    data: { status: 'APPROVED' as any },
  });
}

// ─── main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  Night-Ops Regression Test Suite');
  console.log('══════════════════════════════════════════════════\n');

  // ── Setup users ─────────────────────────────────────────────────────────────
  console.log('── Setup ──');
  const adminUser  = await ensureUser('reg-admin@test.com',    'Test1234!', 'ADMIN',           'Reg Admin');
  const managerUser= await ensureUser('reg-manager@test.com',  'Test1234!', 'RELEASE_MANAGER', 'Reg Manager');
  const leadUser   = await ensureUser('reg-lead@test.com',     'Test1234!', 'TEAM_LEAD',       'Reg Lead');
  const empUser    = await ensureUser('reg-emp@test.com',      'Test1234!', 'EMPLOYEE',        'Reg Employee');
  const viewerUser = await ensureUser('reg-viewer@test.com',   'Test1234!', 'VIEWER',          'Reg Viewer');

  // Create a test team and make lead its member
  let testTeam = await prisma.team.findFirst({ where: { name: 'REG-TEST-TEAM' } });
  if (!testTeam) testTeam = await prisma.team.create({ data: { name: 'REG-TEST-TEAM', description: 'Regression test team' } });
  await prisma.teamMember.upsert({
    where: { userId_teamId: { userId: leadUser.id, teamId: testTeam.id } },
    update: { isLead: true },
    create: { userId: leadUser.id, teamId: testTeam.id, isLead: true },
  });
  await prisma.teamMember.upsert({
    where: { userId_teamId: { userId: empUser.id, teamId: testTeam.id } },
    update: { isLead: false },
    create: { userId: empUser.id, teamId: testTeam.id, isLead: false },
  });

  const admin   = await login('reg-admin@test.com',   'Test1234!');
  const manager = await login('reg-manager@test.com', 'Test1234!');
  const lead    = await login('reg-lead@test.com',    'Test1234!');
  const emp     = await login('reg-emp@test.com',     'Test1234!');
  const viewer  = await login('reg-viewer@test.com',  'Test1234!');

  ok('Setup — users and team created');

  // ══════════════════════════════════════════════════
  // SECTION 1: Authentication
  // ══════════════════════════════════════════════════
  console.log('\n── 1. Authentication ──');

  await test('Login with valid credentials returns token', async () => {
    const { data } = await axios.post(`${BASE}/auth/login`, { email: 'reg-admin@test.com', password: 'Test1234!' });
    if (!data.token) throw new Error('no token in response');
  });

  await expectStatus(
    () => axios.post(`${BASE}/auth/login`, { email: 'reg-admin@test.com', password: 'WRONG' }),
    401, 'Login with wrong password returns 401',
  );

  await expectStatus(
    () => axios.post(`${BASE}/auth/login`, { email: 'nobody@nowhere.com', password: 'Test1234!' }),
    401, 'Login with unknown email returns 401',
  );

  await expectStatus(
    () => axios.get(`${BASE}/versions`),
    401, 'Unauthenticated request returns 401',
  );

  await expectStatus(
    () => axios.get(`${BASE}/versions`, { headers: { Authorization: 'Bearer invalid.jwt.token' } }),
    401, 'Invalid JWT returns 401',
  );

  // ══════════════════════════════════════════════════
  // SECTION 2: Role-based access control
  // ══════════════════════════════════════════════════
  console.log('\n── 2. Role-based access (RBAC) ──');

  await expectStatus(
    () => emp.post('/versions', { name: 'UNAUTHORIZED' }),
    403, 'EMPLOYEE cannot create version',
  );

  await expectStatus(
    () => viewer.post('/versions', { name: 'UNAUTHORIZED' }),
    403, 'VIEWER cannot create version',
  );

  await expectStatus(
    () => lead.post('/versions', { name: 'UNAUTHORIZED' }),
    403, 'TEAM_LEAD cannot create version',
  );

  await test('RELEASE_MANAGER can create version', async () => {
    const { data } = await manager.post('/versions', { name: `RBAC-TEST-${Date.now()}` });
    await deleteVersion(data.id);
  });

  // ══════════════════════════════════════════════════
  // SECTION 3: Task validation
  // ══════════════════════════════════════════════════
  console.log('\n── 3. Task validation ──');

  await expectStatus(
    () => admin.post('/tasks', { title: '', createdBy: adminUser.id }),
    400, 'Empty task title returns 400',
  );

  await expectStatus(
    () => admin.post('/tasks', { title: '   ', createdBy: adminUser.id }),
    400, 'Whitespace-only task title returns 400',
  );

  await test('Valid task creation succeeds', async () => {
    const { data } = await admin.post('/tasks', { title: 'REG Test Task', createdBy: adminUser.id });
    await prisma.task.delete({ where: { id: data.id } });
  });

  await test('Invalid status update returns 400', async () => {
    const { data: task } = await admin.post('/tasks', { title: 'REG Status Task', createdBy: adminUser.id });
    try {
      await admin.patch(`/tasks/${task.id}/status`, { status: 'SKIPPED' });
      throw new Error('Expected 400');
    } catch (e: any) {
      if (e.response?.status !== 400) throw new Error(`Got ${e.response?.status}, expected 400`);
    } finally {
      await prisma.task.delete({ where: { id: task.id } });
    }
  });

  await test('Valid status cycle OPEN→IN_PROGRESS→DONE', async () => {
    const { data: task } = await admin.post('/tasks', { title: 'REG Cycle Task', createdBy: adminUser.id });
    await admin.patch(`/tasks/${task.id}/status`, { status: 'IN_PROGRESS' });
    const { data: updated } = await admin.patch(`/tasks/${task.id}/status`, { status: 'DONE' });
    if (updated.status !== 'DONE') throw new Error('Expected DONE');
    if (!updated.actualFinish) throw new Error('actualFinish should be set');
    await prisma.task.delete({ where: { id: task.id } });
  });

  await test('IN_PROGRESS sets actualStart automatically', async () => {
    const { data: task } = await admin.post('/tasks', { title: 'REG ActualStart Task', createdBy: adminUser.id });
    const { data: updated } = await admin.patch(`/tasks/${task.id}/status`, { status: 'IN_PROGRESS' });
    if (!updated.actualStart) throw new Error('actualStart not set');
    await prisma.task.delete({ where: { id: task.id } });
  });

  // ══════════════════════════════════════════════════
  // SECTION 4: Task cascade delete
  // ══════════════════════════════════════════════════
  console.log('\n── 4. Task cascade delete ──');

  await test('Deleting task removes its audit logs and dependency records', async () => {
    const { data: tA } = await admin.post('/tasks', { title: 'REG Del-A', createdBy: adminUser.id });
    const { data: tB } = await admin.post('/tasks', { title: 'REG Del-B', createdBy: adminUser.id });

    // Create dependency B depends on A
    await prisma.taskDependency.create({ data: { taskId: tB.id, dependsOnTaskId: tA.id } });

    // Delete A — should cascade clean deps
    await admin.delete(`/tasks/${tA.id}`);

    const deps = await prisma.taskDependency.findMany({ where: { dependsOnTaskId: tA.id } });
    if (deps.length > 0) throw new Error('dependency record not cleaned up');

    const logs = await prisma.auditLog.findMany({ where: { taskId: tA.id } });
    if (logs.length > 0) throw new Error('audit logs not cleaned up');

    await prisma.task.delete({ where: { id: tB.id } });
  });

  await test('Deleting task that has TaskProposal unlinks proposal', async () => {
    const { data: task } = await admin.post('/tasks', { title: 'REG Proposal Unlink', createdBy: adminUser.id });
    // create proposal manually
    const { data: v } = await manager.post('/versions', { name: `REG-PROP-${Date.now()}` });
    const prop = await (prisma.taskProposal as any).create({
      data: { teamId: testTeam.id, title: 'Proposal', versionId: v.id, submittedBy: adminUser.id, phase: 3, usedInTaskId: task.id },
    });
    await admin.delete(`/tasks/${task.id}`);
    const reloaded = await (prisma.taskProposal as any).findUnique({ where: { id: prop.id } });
    if (reloaded.usedInTaskId !== null) throw new Error('usedInTaskId not reset to null');
    await deleteVersion(v.id);
  });

  // ══════════════════════════════════════════════════
  // SECTION 5: Dependency auto-resolution
  // ══════════════════════════════════════════════════
  console.log('\n── 5. Dependency auto-resolution ──');

  await test('DONE on A auto-opens B that was WAITING on A', async () => {
    const { data: tA } = await admin.post('/tasks', { title: 'REG Dep-A', createdBy: adminUser.id });
    const { data: tB } = await admin.post('/tasks', { title: 'REG Dep-B', createdBy: adminUser.id });

    await prisma.taskDependency.create({ data: { taskId: tB.id, dependsOnTaskId: tA.id } });
    await prisma.task.update({ where: { id: tB.id }, data: { status: 'WAITING' } });

    await admin.patch(`/tasks/${tA.id}/status`, { status: 'DONE' });

    const bAfter = await prisma.task.findUnique({ where: { id: tB.id } });
    if (bAfter?.status !== 'OPEN') throw new Error(`Expected OPEN, got ${bAfter?.status}`);

    await prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: tA.id }, { dependsOnTaskId: tA.id }] } });
    await prisma.taskDependency.deleteMany({ where: { OR: [{ taskId: tB.id }, { dependsOnTaskId: tB.id }] } });
    await prisma.auditLog.deleteMany({ where: { taskId: { in: [tA.id, tB.id] } } });
    await prisma.task.deleteMany({ where: { id: { in: [tA.id, tB.id] } } });
  });

  await test('DONE on A does NOT open B if B has another unfinished dep', async () => {
    const { data: tA } = await admin.post('/tasks', { title: 'REG Multi-Dep-A', createdBy: adminUser.id });
    const { data: tC } = await admin.post('/tasks', { title: 'REG Multi-Dep-C', createdBy: adminUser.id }); // still OPEN
    const { data: tB } = await admin.post('/tasks', { title: 'REG Multi-Dep-B', createdBy: adminUser.id });

    await prisma.taskDependency.createMany({
      data: [
        { taskId: tB.id, dependsOnTaskId: tA.id },
        { taskId: tB.id, dependsOnTaskId: tC.id },
      ]
    });
    await prisma.task.update({ where: { id: tB.id }, data: { status: 'WAITING' } });

    await admin.patch(`/tasks/${tA.id}/status`, { status: 'DONE' });

    const bAfter = await prisma.task.findUnique({ where: { id: tB.id } });
    if (bAfter?.status !== 'WAITING') throw new Error(`Expected WAITING, got ${bAfter?.status}`);

    await prisma.taskDependency.deleteMany({ where: { taskId: { in: [tA.id, tB.id, tC.id] } } });
    await prisma.taskDependency.deleteMany({ where: { dependsOnTaskId: { in: [tA.id, tB.id, tC.id] } } });
    await prisma.auditLog.deleteMany({ where: { taskId: { in: [tA.id, tB.id, tC.id] } } });
    await prisma.task.deleteMany({ where: { id: { in: [tA.id, tB.id, tC.id] } } });
  });

  // ══════════════════════════════════════════════════
  // SECTION 6: Version lifecycle
  // ══════════════════════════════════════════════════
  console.log('\n── 6. Version lifecycle ──');

  let regVersionId = '';

  await test('Create version in DRAFT', async () => {
    const { data } = await manager.post('/versions', { name: `REG-LIFECYCLE-${Date.now()}` });
    regVersionId = data.id;
    if (data.status !== 'DRAFT') throw new Error(`Expected DRAFT, got ${data.status}`);
  });

  await test('DRAFT → COLLECTING', async () => {
    await manager.patch(`/versions/${regVersionId}/status`, { status: 'COLLECTING' });
    const { data } = await manager.get(`/versions/${regVersionId}`);
    if (data.status !== 'COLLECTING') throw new Error(`Expected COLLECTING, got ${data.status}`);
  });

  await test('EMPLOYEE cannot change version status', async () => {
    try {
      await emp.patch(`/versions/${regVersionId}/status`, { status: 'REFINING' });
      throw new Error('Expected 403');
    } catch (e: any) {
      if (e.response?.status !== 403) throw new Error(`Got ${e.response?.status}, expected 403`);
    }
  });

  await test('COLLECTING → REFINING (no involved teams = no block)', async () => {
    // No TaskProposals with crNumber → no involved teams → no block
    await manager.patch(`/versions/${regVersionId}/status`, { status: 'REFINING' });
    const { data } = await manager.get(`/versions/${regVersionId}`);
    if (data.status !== 'REFINING') throw new Error(`Expected REFINING`);
  });

  await test('REFINING → REVIEW → APPROVED', async () => {
    await manager.patch(`/versions/${regVersionId}/status`, { status: 'REVIEW' });
    await manager.patch(`/versions/${regVersionId}/status`, { status: 'APPROVED' });
    const { data } = await manager.get(`/versions/${regVersionId}`);
    if (data.status !== 'APPROVED') throw new Error(`Expected APPROVED`);
  });

  // ══════════════════════════════════════════════════
  // SECTION 7: Version lock (ACTIVE)
  // ══════════════════════════════════════════════════
  console.log('\n── 7. Version lock ──');

  await test('Task structural fields are locked when version is ACTIVE', async () => {
    const { data: task } = await admin.post('/tasks', {
      title: 'REG Lock Task',
      createdBy: adminUser.id,
      versionId: regVersionId,
    });

    // Move version to ACTIVE
    await prisma.version.update({ where: { id: regVersionId }, data: { status: 'ACTIVE' } });

    try {
      await admin.patch(`/tasks/${task.id}`, { title: 'Changed Title' });
      throw new Error('Expected 403');
    } catch (e: any) {
      if (e.response?.status !== 403) throw new Error(`Got ${e.response?.status}, expected 403`);
    }

    // Status change is allowed even during ACTIVE
    await admin.patch(`/tasks/${task.id}/status`, { status: 'IN_PROGRESS' });

    // Restore version to APPROVED for cleanup
    await prisma.version.update({ where: { id: regVersionId }, data: { status: 'APPROVED' } });
    await prisma.auditLog.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
  });

  // ══════════════════════════════════════════════════
  // SECTION 8: Submission guard (COLLECTING → REFINING)
  // ══════════════════════════════════════════════════
  console.log('\n── 8. Submission guard ──');

  let guardVersionId = '';

  await test('Setup: version with an involved team (CR proposal)', async () => {
    const { data: v } = await manager.post('/versions', { name: `REG-GUARD-${Date.now()}` });
    guardVersionId = v.id;
    await manager.patch(`/versions/${guardVersionId}/status`, { status: 'COLLECTING' });

    // Add proposal with crNumber → team becomes "involved"
    await (prisma.taskProposal as any).create({
      data: {
        teamId: testTeam.id,
        title: 'Guard Proposal',
        crNumber: 'CR-9999',
        versionId: guardVersionId,
        submittedBy: adminUser.id,
        phase: 3,
      }
    });
  });

  await test('COLLECTING → REFINING blocked when involved team has not submitted', async () => {
    try {
      await manager.patch(`/versions/${guardVersionId}/status`, { status: 'REFINING' });
      throw new Error('Expected 400');
    } catch (e: any) {
      if (e.response?.status !== 400) throw new Error(`Got ${e.response?.status}, expected 400`);
      if (!e.response.data.message.includes('טרם הגישו')) throw new Error('Wrong error message');
    }
  });

  await test('Force override allows advancement despite unsubmitted teams', async () => {
    await manager.patch(`/versions/${guardVersionId}/status`, { status: 'REFINING', force: true });
    const { data } = await manager.get(`/versions/${guardVersionId}`);
    if (data.status !== 'REFINING') throw new Error('Expected REFINING after force');
  });

  await test('Team lead can only submit their own team', async () => {
    // Create another team
    const otherTeam = await prisma.team.create({ data: { name: 'REG-OTHER-TEAM', description: 'Other test team' } });
    try {
      await lead.post(`/versions/${guardVersionId}/submit/${otherTeam.id}`);
      throw new Error('Expected 403');
    } catch (e: any) {
      if (e.response?.status !== 403) throw new Error(`Got ${e.response?.status}, expected 403`);
    } finally {
      await prisma.team.delete({ where: { id: otherTeam.id } });
    }
  });

  await test('Submission is idempotent — double submit returns same record', async () => {
    // Reset to COLLECTING
    await prisma.version.update({ where: { id: guardVersionId }, data: { status: 'COLLECTING' } });
    await lead.post(`/versions/${guardVersionId}/submit/${testTeam.id}`);
    const r1 = await lead.post(`/versions/${guardVersionId}/submit/${testTeam.id}`);
    const r2 = await lead.post(`/versions/${guardVersionId}/submit/${testTeam.id}`);
    if (new Date(r1.data.submittedAt).getTime() !== new Date(r2.data.submittedAt).getTime()) {
      throw new Error('Double submit changed submittedAt timestamp');
    }
  });

  // ══════════════════════════════════════════════════
  // SECTION 9: Summary approval guard (the fixed bug)
  // ══════════════════════════════════════════════════
  console.log('\n── 9. Summary approval guard ──');
  await resetActiveVersions();

  await test('Summary approval blocked when tasks in WAITING (rehearsal)', async () => {
    const { data: v } = await manager.post('/versions', { name: `REG-SUMMARY-${Date.now()}` });
    const sid = v.id;

    await manager.patch(`/versions/${sid}/status`, { status: 'COLLECTING' });
    await manager.patch(`/versions/${sid}/status`, { status: 'REFINING' });
    await manager.patch(`/versions/${sid}/status`, { status: 'REVIEW' });
    await manager.patch(`/versions/${sid}/status`, { status: 'APPROVED' });
    await manager.patch(`/versions/${sid}/status`, { status: 'REHEARSAL' });

    // Create a task with NO subPhase — this was the bug path
    const task = await prisma.task.create({
      data: { title: 'REG Summary Task', status: 'WAITING', versionId: sid, createdBy: adminUser.id }
    });

    try {
      await manager.post(`/summary/${sid}/rehearsal/approve`, { headline: 'test' });
      throw new Error('Expected 400 — tasks not done');
    } catch (e: any) {
      if (e.response?.status !== 400) throw new Error(`Got ${e.response?.status}, expected 400`);
    } finally {
      await deleteVersion(sid);
    }
  });

  await test('Summary approval succeeds when all tasks are DONE', async () => {
    const { data: v } = await manager.post('/versions', { name: `REG-SUMOK-${Date.now()}` });
    const sid = v.id;

    await manager.patch(`/versions/${sid}/status`, { status: 'COLLECTING' });
    await manager.patch(`/versions/${sid}/status`, { status: 'REFINING' });
    await manager.patch(`/versions/${sid}/status`, { status: 'REVIEW' });
    await manager.patch(`/versions/${sid}/status`, { status: 'APPROVED' });
    await manager.patch(`/versions/${sid}/status`, { status: 'REHEARSAL' });

    const task = await prisma.task.create({
      data: { title: 'REG Done Task', status: 'DONE', versionId: sid, createdBy: adminUser.id }
    });

    await manager.post(`/summary/${sid}/rehearsal/approve`, { headline: 'all done' });

    const vAfter = await prisma.version.findUnique({ where: { id: sid } });
    if (vAfter?.status !== 'APPROVED') throw new Error(`Expected APPROVED after rehearsal, got ${vAfter?.status}`);

    await deleteVersion(sid);
  });

  // ══════════════════════════════════════════════════
  // SECTION 10: EMPLOYEE data isolation
  // ══════════════════════════════════════════════════
  console.log('\n── 10. EMPLOYEE data isolation ──');

  await test('EMPLOYEE only sees tasks from their own team', async () => {
    // Create tasks for the test team and for an unrelated team
    const otherTeam = await prisma.team.create({ data: { name: 'REG-ISOLATION-TEAM', description: 'Isolation test team' } });
    const myTask    = await prisma.task.create({ data: { title: 'Mine', assignedTeamId: testTeam.id, createdBy: adminUser.id } });
    const theirTask = await prisma.task.create({ data: { title: 'Theirs', assignedTeamId: otherTeam.id, createdBy: adminUser.id } });

    const { data: tasks } = await emp.get('/tasks');
    const ids = tasks.map((t: any) => t.id);

    if (!ids.includes(myTask.id))    throw new Error('Team task not visible to employee');
    if ( ids.includes(theirTask.id)) throw new Error('Other team task visible to employee (data leak!)');

    await prisma.auditLog.deleteMany({ where: { taskId: { in: [myTask.id, theirTask.id] } } });
    await prisma.task.deleteMany({ where: { id: { in: [myTask.id, theirTask.id] } } });
    await prisma.team.delete({ where: { id: otherTeam.id } });
  });

  // ══════════════════════════════════════════════════
  // SECTION 11: Task duplicate
  // ══════════════════════════════════════════════════
  console.log('\n── 11. Task duplicate ──');

  await test('Duplicate task copies fields but resets status and runtime fields', async () => {
    const orig = await prisma.task.create({
      data: {
        title: 'REG Original',
        status: 'DONE',
        priority: 'HIGH',
        actualStart: new Date(),
        actualFinish: new Date(),
        blockedReason: 'some reason',
        createdBy: adminUser.id,
      }
    });

    const { data: copy } = await admin.post(`/tasks/${orig.id}/duplicate`);

    if (!copy.title.includes('עותק'))      throw new Error('Title should contain "עותק"');
    if (copy.status !== 'WAITING')          throw new Error(`Expected WAITING, got ${copy.status}`);
    if (copy.actualStart !== null)          throw new Error('actualStart should be null');
    if (copy.actualFinish !== null)         throw new Error('actualFinish should be null');
    if (copy.blockedReason !== null)        throw new Error('blockedReason should be null');
    if (copy.priority !== 'HIGH')           throw new Error('priority should be copied');

    await prisma.auditLog.deleteMany({ where: { taskId: { in: [orig.id, copy.id] } } });
    await prisma.task.deleteMany({ where: { id: { in: [orig.id, copy.id] } } });
  });

  // ══════════════════════════════════════════════════
  // SECTION 12: Teams
  // ══════════════════════════════════════════════════
  console.log('\n── 12. Teams ──');

  await test('Get teams returns list', async () => {
    const { data } = await admin.get('/teams');
    if (!Array.isArray(data)) throw new Error('Expected array');
    if (data.length === 0)    throw new Error('Expected at least one team');
  });

  await test('Create and delete team', async () => {
    const { data: team } = await admin.post('/teams', { name: 'REG-TEMP-TEAM', description: 'Temp test team' });
    if (!team.id) throw new Error('No team id');
    await admin.delete(`/teams/${team.id}`);
    const found = await prisma.team.findUnique({ where: { id: team.id } });
    if (found) throw new Error('Team not deleted');
  });

  // ══════════════════════════════════════════════════
  // SECTION 13: Push notification endpoint
  // ══════════════════════════════════════════════════
  console.log('\n── 13. Push notification API ──');

  await test('GET /push/vapid-public-key returns publicKey field', async () => {
    const { data } = await admin.get('/push/vapid-public-key');
    if (!('publicKey' in data)) throw new Error('No publicKey field in response');
  });

  await expectStatus(
    () => axios.get(`${BASE}/push/vapid-public-key`),
    401, 'Push endpoint requires authentication',
  );

  await test('Subscribe / unsubscribe round-trip', async () => {
    const fakeSub = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/fake-endpoint-for-test',
      keys: { p256dh: 'fake-p256dh-key', auth: 'fake-auth-key' },
    };
    await admin.post('/push/subscribe', fakeSub);
    await admin.delete('/push/subscribe');
  });

  // ══════════════════════════════════════════════════
  // SECTION 14: New regression — edge cases
  // ══════════════════════════════════════════════════
  console.log('\n── 14. Edge cases ──');

  await test('Getting non-existent task returns 404', async () => {
    try {
      await admin.get('/tasks/00000000-0000-0000-0000-000000000000');
      throw new Error('Expected 404');
    } catch (e: any) {
      if (e.response?.status !== 404) throw new Error(`Got ${e.response?.status}`);
    }
  });

  await test('Getting non-existent version returns 404', async () => {
    try {
      await admin.get('/versions/00000000-0000-0000-0000-000000000000');
      throw new Error('Expected 404');
    } catch (e: any) {
      if (e.response?.status !== 404) throw new Error(`Got ${e.response?.status}`);
    }
  });

  await test('Case-insensitive email login', async () => {
    const { data } = await axios.post(`${BASE}/auth/login`, {
      email: 'REG-ADMIN@TEST.COM',
      password: 'Test1234!',
    });
    if (!data.token) throw new Error('Expected token');
  });

  await test('BLOCKED status allows empty blockedReason (no validation enforced at API)', async () => {
    const { data: task } = await admin.post('/tasks', { title: 'REG Blocked Test', createdBy: adminUser.id });
    const { data: updated } = await admin.patch(`/tasks/${task.id}/status`, { status: 'BLOCKED' });
    if (updated.status !== 'BLOCKED') throw new Error('Expected BLOCKED');
    await prisma.auditLog.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
  });

  await test('ROLLED_BACK is a valid status transition', async () => {
    const { data: task } = await admin.post('/tasks', { title: 'REG Rollback Test', createdBy: adminUser.id });
    await admin.patch(`/tasks/${task.id}/status`, { status: 'IN_PROGRESS' });
    const { data: updated } = await admin.patch(`/tasks/${task.id}/status`, { status: 'ROLLED_BACK' });
    if (updated.status !== 'ROLLED_BACK') throw new Error('Expected ROLLED_BACK');
    await prisma.auditLog.deleteMany({ where: { taskId: task.id } });
    await prisma.task.delete({ where: { id: task.id } });
  });

  await test('ADMIN can delete a version', async () => {
    const { data: v } = await manager.post('/versions', { name: `REG-DEL-${Date.now()}` });
    await admin.delete(`/versions/${v.id}`);
    const found = await prisma.version.findUnique({ where: { id: v.id } });
    if (found) throw new Error('Version not deleted');
  });

  await test('RELEASE_MANAGER cannot delete a version (ADMIN only)', async () => {
    const { data: v } = await manager.post('/versions', { name: `REG-NODELETE-${Date.now()}` });
    try {
      await manager.delete(`/versions/${v.id}`);
      throw new Error('Expected 403');
    } catch (e: any) {
      if (e.response?.status !== 403) throw new Error(`Got ${e.response?.status}, expected 403`);
    } finally {
      await deleteVersion(v.id);
    }
  });

  // ── Cleanup ──────────────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──');
  if (regVersionId)   await deleteVersion(regVersionId);
  if (guardVersionId) await deleteVersion(guardVersionId);
  await prisma.teamSubmission.deleteMany({ where: { teamId: testTeam.id } });
  await (prisma.taskProposal as any).deleteMany({ where: { teamId: testTeam.id } });
  await prisma.teamMember.deleteMany({ where: { teamId: testTeam.id } });
  await prisma.team.delete({ where: { id: testTeam.id } });
  ok('Cleanup done');

  // ── Report ───────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${pass} passed, ${fail} failed`);
  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach(f => console.log(`  • ${f}`));
  }
  console.log('══════════════════════════════════════════════════\n');

  await prisma.$disconnect();
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(async e => {
  console.error('Fatal error:', e);
  await prisma.$disconnect();
  process.exit(1);
});
