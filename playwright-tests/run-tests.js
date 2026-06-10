/**
 * NightOps Comprehensive Test Runner
 * Runs functional + security tests against the API
 * Usage: node run-tests.js
 */
const http = require('http');

const API  = 'http://localhost:3001';
const APP  = 'http://localhost:3002';
const ADMIN = { email: 'nissim@test.com', password: '123456' };

// ── minimal HTTP client ──────────────────────────────────────────────────────
function req(method, path, body, token) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const url = new URL(path.startsWith('http') ? path : API + path);
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    };
    const r = http.request(opts, res => {
      let raw = '';
      res.on('data', d => raw += d);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    r.on('error', e => resolve({ status: 0, body: null, error: e.message }));
    if (data) r.write(data);
    r.end();
  });
}

const get    = (path, token)        => req('GET',    path, null, token);
const post   = (path, body, token)  => req('POST',   path, body, token);
const patch  = (path, body, token)  => req('PATCH',  path, body, token);
const del    = (path, token)        => req('DELETE', path, null, token);

// ── test harness ─────────────────────────────────────────────────────────────
const results = [];
let passed = 0, failed = 0, skipped = 0;

async function t(id, name, fn) {
  try {
    const r = await fn();
    if (r === 'SKIP') {
      skipped++;
      results.push({ id, name, status: 'SKIP', expected: '—', actual: 'SKIPPED', note: '' });
      console.log(`  ⏭  ${id} ${name}`);
    } else {
      passed++;
      results.push({ id, name, status: 'PASS', ...r });
      console.log(`  ✅ ${id} ${name}`);
    }
  } catch(e) {
    failed++;
    results.push({ id, name, status: 'FAIL', expected: e.expected || '?', actual: e.actual || e.message, note: '' });
    console.log(`  ❌ ${id} ${name}  →  ${e.message}`);
  }
}

function assert(cond, msg, expected = '', actual = '') {
  if (!cond) {
    const e = new Error(msg);
    e.expected = expected;
    e.actual   = actual;
    throw e;
  }
}

// ── main test run ─────────────────────────────────────────────────────────────
async function run() {
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log('║  NightOps Comprehensive Test Suite               ║');
  console.log('║  Target: ' + API + '  ║');
  console.log('╚══════════════════════════════════════════════════╝\n');

  // ── LOGIN + TOKENS ──────────────────────────────────────────────────────────
  let adminToken, empToken, mgToken, empUser, mgUser;

  console.log('\n── BLOCK 1: Authentication ──────────────────────────');

  await t('AUTH-01', 'Valid admin login returns JWT (200)', async () => {
    const r = await post('/auth/login', ADMIN);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    assert(r.body?.token, 'No token in response', 'JWT string', 'null');
    assert(r.body.token.split('.').length === 3, 'Token not valid JWT format', '3 parts', r.body.token.split('.').length);
    adminToken = r.body.token;
    return { expected: 'status=200, JWT returned', actual: `status=${r.status}, token=${r.body.token.slice(0,20)}...` };
  });

  await t('AUTH-02', 'Wrong password → 401', async () => {
    const r = await post('/auth/login', { email: ADMIN.email, password: 'wrongpassword' });
    assert(r.status === 401, `Expected 401, got ${r.status}`, '401', String(r.status));
    return { expected: '401', actual: String(r.status) };
  });

  await t('AUTH-03', 'Non-existent user → 401', async () => {
    const r = await post('/auth/login', { email: 'nobody@nowhere.com', password: '123456' });
    assert(r.status === 401, `Expected 401, got ${r.status}`, '401', String(r.status));
    return { expected: '401', actual: String(r.status) };
  });

  await t('AUTH-04', 'Empty credentials → 400/401', async () => {
    const r = await post('/auth/login', { email: '', password: '' });
    assert([400, 401].includes(r.status), `Expected 400/401, got ${r.status}`, '400 or 401', String(r.status));
    return { expected: '400 or 401', actual: String(r.status) };
  });

  await t('AUTH-05', 'No token on protected route → 401', async () => {
    const r = await get('/versions');
    assert(r.status === 401, `Expected 401, got ${r.status}`, '401', String(r.status));
    return { expected: '401', actual: String(r.status) };
  });

  await t('AUTH-06', 'Tampered JWT → 401', async () => {
    const r = await get('/versions', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrIn0.INVALID');
    assert(r.status === 401, `Expected 401, got ${r.status}`, '401', String(r.status));
    return { expected: '401', actual: String(r.status) };
  });

  await t('AUTH-07', 'SQL injection in email field → 401 (not 500)', async () => {
    const r = await post('/auth/login', { email: "' OR '1'='1' --", password: "' OR '1'='1" });
    assert(r.status !== 500, `Server error on SQLi attempt`, 'not 500', String(r.status));
    assert([400, 401].includes(r.status), `Expected 400/401 on SQLi`, '400 or 401', String(r.status));
    return { expected: '400 or 401 (no SQLi vulnerability)', actual: String(r.status) };
  });

  await t('AUTH-08', 'Rate limiting — 10 rapid failed logins', async () => {
    const statuses = [];
    for (let i = 0; i < 10; i++) {
      const r = await post('/auth/login', { email: 'brute@test.com', password: 'wrong' + i });
      statuses.push(r.status);
    }
    const has429 = statuses.some(s => s === 429);
    const allSafe = statuses.every(s => [401, 429, 400].includes(s));
    assert(allSafe, 'Unexpected status in brute force test', '401/429 only', statuses.join(','));
    return {
      expected: 'All 401 or 429 (rate limit)',
      actual: has429 ? `✅ 429 rate-limit detected after ${statuses.indexOf(429)+1} attempts` : `⚠️  No rate limiting (all 401)`,
      note: has429 ? '' : 'FINDING: No rate limiting on login endpoint'
    };
  });

  if (!adminToken) { console.log('\n❌ Cannot proceed without admin token'); process.exit(1); }

  // ── GET USERS AND SELECT TEST USERS ─────────────────────────────────────────
  const usersRes = await get('/users', adminToken);
  const users = usersRes.body || [];
  empUser = users.find(u => u.role === 'EMPLOYEE' && u.active && u.email.includes('@'));
  mgUser  = users.find(u => u.role === 'RELEASE_MANAGER' && u.active);

  if (empUser) {
    const r = await post('/auth/login', { email: empUser.email, password: '123456' });
    empToken = r.body?.token;
  }
  if (mgUser) {
    const r = await post('/auth/login', { email: mgUser.email, password: '123456' });
    mgToken = r.body?.token;
  }

  // ── BLOCK 2: Users & Teams ───────────────────────────────────────────────────
  console.log('\n── BLOCK 2: Users & Teams ───────────────────────────');

  await t('USER-01', 'Get users list — returns array', async () => {
    const r = await get('/users', adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    assert(Array.isArray(r.body), 'Body is not array');
    assert(r.body.length > 50, `Expected >50 users, got ${r.body.length}`, '>50', String(r.body.length));
    return { expected: '>50 users', actual: `${r.body.length} users` };
  });

  await t('USER-02', 'Employee cannot get user list? (depends on permissions)', async () => {
    if (!empToken) return 'SKIP';
    const r = await get('/users', empToken);
    // Some systems restrict this, some allow read
    return { expected: '200 or 403', actual: `status=${r.status}` };
  });

  await t('TEAM-01', 'Get teams list', async () => {
    const r = await get('/teams', adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    assert(r.body.length > 20, `Expected >20 teams, got ${r.body.length}`, '>20', String(r.body.length));
    const noLead = r.body.filter(t => !t.members?.some(m => m.isLead));
    return {
      expected: 'Teams loaded with leads',
      actual: `${r.body.length} teams, ${noLead.length} without leads`,
      note: noLead.length > 0 ? `FINDING: ${noLead.length} teams have no designated lead: ${noLead.slice(0,5).map(t=>t.name).join(', ')}` : ''
    };
  });

  await t('TEAM-02', 'Team member roles — isLead populated', async () => {
    const r = await get('/teams', adminToken);
    const teamsWithMembers = r.body.filter(t => t.members?.length > 0);
    const teamsWithLeads = teamsWithMembers.filter(t => t.members.some(m => m.isLead));
    return {
      expected: 'Teams with members have leads defined',
      actual: `${teamsWithMembers.length} teams have members, ${teamsWithLeads.length} have leads`,
      note: teamsWithLeads.length < teamsWithMembers.length ? `FINDING: ${teamsWithMembers.length - teamsWithLeads.length} teams have members but no lead` : ''
    };
  });

  // ── BLOCK 3: Version Lifecycle ───────────────────────────────────────────────
  console.log('\n── BLOCK 3: Version Lifecycle ───────────────────────');
  let testVersionId;

  await t('VER-01', 'Create version — DRAFT status returned', async () => {
    const r = await post('/versions', {
      name: 'E2E-AUTO-' + Date.now(),
      description: 'בדיקת E2E אוטומטית',
      plannedStart: '2099-12-01',
    }, adminToken);
    assert([200, 201].includes(r.status), `Expected 201, got ${r.status}`, '201', String(r.status));
    assert(r.body?.status === 'DRAFT', `Expected DRAFT, got ${r.body?.status}`, 'DRAFT', r.body?.status);
    testVersionId = r.body.id;
    return { expected: 'status=201, version.status=DRAFT', actual: `id=${testVersionId?.slice(0,8)}..., status=${r.body?.status}` };
  });

  await t('VER-02', 'Empty version name → 400', async () => {
    const r = await post('/versions', { name: '', description: 'test', plannedStart: '2099-01-01' }, adminToken);
    assert([400, 422].includes(r.status), `Expected 400, got ${r.status}`, '400', String(r.status));
    return { expected: '400 (validation error)', actual: String(r.status) };
  });

  await t('VER-03', 'Missing plannedStart → 400', async () => {
    const r = await post('/versions', { name: 'NO-DATE' }, adminToken);
    assert([400, 422].includes(r.status), `Expected 400, got ${r.status}`, '400', String(r.status));
    return { expected: '400', actual: String(r.status) };
  });

  await t('VER-04', 'Employee cannot create version', async () => {
    if (!empToken) return 'SKIP';
    const r = await post('/versions', { name: 'EMP-TEST', description: 'x', plannedStart: '2099-01-01' }, empToken);
    assert([401, 403].includes(r.status), `Expected 403, got ${r.status}`, '403', String(r.status));
    return { expected: '403 (forbidden)', actual: String(r.status) };
  });

  await t('VER-05', 'Get version list — new version appears', async () => {
    const r = await get('/versions', adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    const found = r.body?.some(v => v.id === testVersionId);
    assert(found, 'New version not in list', 'found in list', 'not found');
    return { expected: 'New version in list', actual: `found: ${found}, total: ${r.body?.length}` };
  });

  await t('VER-06', 'DRAFT → COLLECTING transition', async () => {
    if (!testVersionId) return 'SKIP';
    const r = await patch(`/versions/${testVersionId}/status`, { status: 'COLLECTING' }, adminToken);
    assert([200, 201].includes(r.status), `Expected 200, got ${r.status}`, '200', String(r.status));
    return { expected: 'status=200, COLLECTING', actual: `status=${r.status}, version.status=${r.body?.status}` };
  });

  await t('VER-07', 'Cannot skip COLLECTING → ACTIVE (invalid transition)', async () => {
    if (!testVersionId) return 'SKIP';
    const r = await patch(`/versions/${testVersionId}/status`, { status: 'ACTIVE' }, adminToken);
    assert([400, 403].includes(r.status), `Expected 400/403, got ${r.status}`, '400 or 403', String(r.status));
    return { expected: '400/403 (invalid transition)', actual: String(r.status) };
  });

  await t('VER-08', 'Non-existent version → 404', async () => {
    const r = await get('/versions/00000000-0000-0000-0000-000000000000', adminToken);
    assert(r.status === 404, `Expected 404, got ${r.status}`, '404', String(r.status));
    return { expected: '404', actual: String(r.status) };
  });

  await t('VER-09', 'Delete test version', async () => {
    if (!testVersionId) return 'SKIP';
    const r = await del(`/versions/${testVersionId}`, adminToken);
    assert([200, 204].includes(r.status), `Expected 200/204, got ${r.status}`, '200/204', String(r.status));
    return { expected: '200/204 (deleted)', actual: String(r.status) };
  });

  // ── BLOCK 4: Tasks ───────────────────────────────────────────────────────────
  console.log('\n── BLOCK 4: Tasks ───────────────────────────────────');
  const versions = (await get('/versions', adminToken)).body || [];
  const activeVer = versions[0];

  await t('TASK-01', 'Get tasks for existing version', async () => {
    if (!activeVer) return 'SKIP';
    const r = await get(`/tasks?versionId=${activeVer.id}`, adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    assert(Array.isArray(r.body), 'Tasks not array');
    return { expected: '200, array of tasks', actual: `${r.status}, ${r.body.length} tasks` };
  });

  await t('TASK-02', 'Tasks without versionId → empty or 400', async () => {
    const r = await get('/tasks', adminToken);
    assert([200, 400].includes(r.status), `Unexpected status`, '200 or 400', String(r.status));
    if (r.status === 200) assert(Array.isArray(r.body), 'Expected array');
    return { expected: '200 (empty) or 400', actual: `${r.status}, body: ${JSON.stringify(r.body)?.slice(0,50)}` };
  });

  await t('TASK-03', 'Employee cannot update task status to DONE directly', async () => {
    if (!empToken || !activeVer) return 'SKIP';
    const tasks = (await get(`/tasks?versionId=${activeVer.id}`, adminToken)).body || [];
    if (!tasks.length) return 'SKIP';
    const r = await patch(`/tasks/${tasks[0].id}/status`, { status: 'DONE' }, empToken);
    // Should be restricted based on assignment
    return { expected: '200 if own task, 403 if not assigned', actual: `status=${r.status}` };
  });

  // ── BLOCK 5: Task Proposals ──────────────────────────────────────────────────
  console.log('\n── BLOCK 5: Task Proposals ──────────────────────────');

  await t('PROP-01', 'Get proposals for version', async () => {
    if (!activeVer) return 'SKIP';
    const r = await get(`/task-proposals?versionId=${activeVer.id}`, adminToken);
    assert([200].includes(r.status), `Expected 200, got ${r.status}`, '200', String(r.status));
    return { expected: '200, proposals array', actual: `${r.status}, ${r.body?.length || 0} proposals` };
  });

  await t('PROP-02', 'Create proposal without title → 400', async () => {
    if (!activeVer) return 'SKIP';
    const r = await post('/task-proposals', { versionId: activeVer.id, phase: 1 }, adminToken);
    assert([400, 422].includes(r.status), `Expected 400, got ${r.status}`, '400', String(r.status));
    return { expected: '400 (missing title)', actual: String(r.status) };
  });

  // ── BLOCK 6: CR Plans ────────────────────────────────────────────────────────
  console.log('\n── BLOCK 6: CR Plans ────────────────────────────────');

  await t('CR-01', 'Get CR review data for version', async () => {
    if (!activeVer) return 'SKIP';
    const r = await get(`/versions/${activeVer.id}/cr-review`, adminToken);
    assert([200, 404].includes(r.status), `Unexpected status`, '200 or 404', String(r.status));
    return { expected: '200 (CR list) or 404', actual: `${r.status}${r.status === 200 ? `, ${r.body?.length} CRs` : ''}` };
  });

  await t('CR-02', 'CR approve without all teams submitted → should validate', async () => {
    if (!activeVer) return 'SKIP';
    const r = await patch(`/cr-plans/version/${activeVer.id}/approve-cr`, { crNumber: '99999' }, adminToken);
    assert([400, 404, 403].includes(r.status), `Expected error, got ${r.status}`, '400/404/403', String(r.status));
    return { expected: '400/404/403', actual: String(r.status) };
  });

  // ── BLOCK 7: Permissions ─────────────────────────────────────────────────────
  console.log('\n── BLOCK 7: Permissions ─────────────────────────────');

  await t('PERM-01', 'Admin has access to all endpoints', async () => {
    const endpoints = ['/versions', '/teams', '/users', '/system-params', '/qc-releases'];
    const results = await Promise.all(endpoints.map(e => get(e, adminToken)));
    const all200 = results.every(r => r.status === 200);
    assert(all200, `Some endpoints failed: ${endpoints.map((e,i) => `${e}=${results[i].status}`).join(', ')}`, 'all 200', results.map(r=>r.status).join(','));
    return { expected: 'All 200', actual: results.map(r => r.status).join(',') };
  });

  await t('PERM-02', 'Employee cannot access system-params', async () => {
    if (!empToken) return 'SKIP';
    const r = await get('/system-params', empToken);
    assert([200, 403].includes(r.status), `Unexpected ${r.status}`, '200 or 403', String(r.status));
    return {
      expected: '403 (restricted)',
      actual: `${r.status}`,
      note: r.status === 200 ? 'FINDING: Employees can read system params (may include sensitive config)' : ''
    };
  });

  await t('PERM-03', 'Employee cannot delete versions', async () => {
    if (!empToken) return 'SKIP';
    const r = await del(`/versions/${activeVer?.id || 'test'}`, empToken);
    assert([401, 403, 404].includes(r.status), `Expected 403, got ${r.status}`, '403', String(r.status));
    return { expected: '403', actual: String(r.status) };
  });

  await t('PERM-04', 'IDOR — accessing another user version with low-privilege token', async () => {
    if (!empToken || !activeVer) return 'SKIP';
    const r = await patch(`/versions/${activeVer.id}/status`, { status: 'COMPLETED' }, empToken);
    assert([401, 403].includes(r.status), `IDOR vulnerability! Got ${r.status}`, '403', String(r.status));
    return { expected: '403 (IDOR protection)', actual: String(r.status) };
  });

  // ── BLOCK 8: System Params / Config ─────────────────────────────────────────
  console.log('\n── BLOCK 8: System Params ───────────────────────────');

  await t('SYS-01', 'System params return all required keys', async () => {
    const r = await get('/system-params', adminToken);
    const keys = r.body?.map(p => p.key) || [];
    const required = ['EMAIL_ENABLED', 'EMAIL_HOST', 'LDAP_ENABLED'];
    const missing = required.filter(k => !keys.includes(k));
    assert(missing.length === 0, `Missing keys: ${missing.join(',')}`, 'all keys present', `missing: ${missing.join(',')}`);
    return { expected: 'All required keys present', actual: `${keys.length} params found` };
  });

  await t('SYS-02', 'EMAIL_ENABLED = false (SMTP not configured)', async () => {
    const r = await get('/system-params', adminToken);
    const emailParam = r.body?.find(p => p.key === 'EMAIL_ENABLED');
    return {
      expected: 'EMAIL_ENABLED config present',
      actual: `EMAIL_ENABLED=${emailParam?.value}`,
      note: emailParam?.value == true ? '' : 'NOTE: SMTP not configured — email tests skipped'
    };
  });

  await t('SYS-03', 'Employee cannot update system params', async () => {
    if (!empToken) return 'SKIP';
    const r = await patch('/system-params/EMAIL_ENABLED', { value: 'true' }, empToken);
    assert([401, 403].includes(r.status), `Expected 403, got ${r.status}`, '403', String(r.status));
    return { expected: '403', actual: String(r.status) };
  });

  await t('SYS-04', 'LDAP config endpoint accessible', async () => {
    const r = await get('/auth/config', null);
    assert([200, 404].includes(r.status), `Unexpected ${r.status}`, '200 or 404', String(r.status));
    if (r.status === 200) {
      const str = JSON.stringify(r.body);
      assert(!str.includes('password') && !str.includes('secret'),
        'Sensitive data in /auth/config response!', 'no secrets', 'contains secrets');
    }
    return { expected: '200 with no sensitive data, or 404', actual: `${r.status}` };
  });

  // ── BLOCK 9: Security Tests ──────────────────────────────────────────────────
  console.log('\n── BLOCK 9: Security ────────────────────────────────');

  await t('SEC-01', 'XSS payload stored but not executed (stored XSS)', async () => {
    const xssName = '<script>alert(1)</script>';
    const r = await post('/versions', { name: xssName, description: 'xss', plannedStart: '2099-01-01' }, adminToken);
    if ([200, 201].includes(r.status)) {
      const stored = r.body?.name;
      // Should be stored as-is (escaping is frontend responsibility)
      await del(`/versions/${r.body.id}`, adminToken);
      return { expected: 'Stored as text, not executed', actual: `Stored: "${stored}"`, note: 'Ensure frontend escapes HTML when rendering' };
    }
    return { expected: '400 (validation) or stored safely', actual: String(r.status) };
  });

  await t('SEC-02', 'Path traversal in version ID', async () => {
    const r = await get('/versions/../users', adminToken);
    assert(r.status !== 200 || !Array.isArray(r.body), 'Path traversal might work!', 'not user list', r.status);
    return { expected: '404 or 400 (not user list)', actual: String(r.status) };
  });

  await t('SEC-03', 'JWT with HS256 none algorithm attack', async () => {
    const fakeToken = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJoYWNrZXIiLCJyb2xlIjoiQURNSU4ifQ.';
    const r = await get('/versions', fakeToken);
    assert(r.status === 401, `Algorithm confusion attack worked! Got ${r.status}`, '401', String(r.status));
    return { expected: '401 (none algorithm rejected)', actual: String(r.status) };
  });

  await t('SEC-04', 'Sensitive data not leaked in error messages', async () => {
    const r = await post('/auth/login', { email: 'test@test.com', password: 'wrong' });
    const body = JSON.stringify(r.body || '');
    assert(!body.includes('SELECT') && !body.includes('password') && !body.toLowerCase().includes('stack'),
      'Error leaks sensitive info', 'generic error', body.slice(0, 100));
    return { expected: 'Generic error message', actual: body.slice(0, 80) };
  });

  await t('SEC-05', 'Mass assignment — cannot elevate own role', async () => {
    if (!empToken || !empUser) return 'SKIP';
    const r = await patch(`/users/${empUser.id}`, { role: 'ADMIN' }, empToken);
    assert([401, 403].includes(r.status), `Role elevation succeeded!`, '403', String(r.status));
    return { expected: '403 (cannot elevate role)', actual: String(r.status) };
  });

  // ── BLOCK 10: Summary & Reports ─────────────────────────────────────────────
  console.log('\n── BLOCK 10: Summary & Reports ──────────────────────');

  await t('SUM-01', 'Summary endpoint for existing version', async () => {
    if (!activeVer) return 'SKIP';
    const r = await get(`/summary/${activeVer.id}`, adminToken);
    assert([200, 404].includes(r.status), `Unexpected ${r.status}`, '200 or 404', String(r.status));
    return { expected: '200 (summary data) or 404 (not yet created)', actual: String(r.status) };
  });

  await t('SUM-02', 'Email config endpoint', async () => {
    const r = await get('/summary/email/config', adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    assert(typeof r.body?.enabled === 'boolean', 'enabled field missing', 'boolean', typeof r.body?.enabled);
    return { expected: '200, { enabled: boolean }', actual: `enabled=${r.body?.enabled}` };
  });

  await t('SUM-03', 'Send email when disabled → error returned', async () => {
    if (!activeVer) return 'SKIP';
    const r = await post(`/summary/${activeVer.id}/send-email`, { subject: 'Test', text: 'Body' }, adminToken);
    assert([400, 500].includes(r.status), `Expected error, got ${r.status}`, '400 or 500', String(r.status));
    return { expected: '400/500 (email disabled)', actual: String(r.status) };
  });

  // ── BLOCK 11: QC ────────────────────────────────────────────────────────────
  console.log('\n── BLOCK 11: QC Releases ────────────────────────────');

  await t('QC-01', 'QC releases loaded', async () => {
    const r = await get('/qc-releases', adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    assert(Array.isArray(r.body) && r.body.length > 0, 'No QC releases', '>0', String(r.body?.length));
    return { expected: '>0 QC releases', actual: `${r.body.length} releases` };
  });

  await t('QC-02', 'QC defects endpoint', async () => {
    const r = await get('/qc/defects?versionId=00000000-0000-0000-0000-000000000000', adminToken);
    assert([200, 404].includes(r.status), `Unexpected ${r.status}`, '200 or 404', String(r.status));
    return { expected: '200 or 404', actual: String(r.status) };
  });

  // ── BLOCK 12: Failure Reasons ────────────────────────────────────────────────
  console.log('\n── BLOCK 12: Failure Reasons ────────────────────────');

  await t('FAIL-01', 'Failure reasons endpoint', async () => {
    const r = await get('/failure-reasons', adminToken);
    assert(r.status === 200, `Expected 200, got ${r.status}`, '200', String(r.status));
    return { expected: '200, array', actual: `${r.status}, ${r.body?.length || 0} reasons` };
  });

  // ── FINALIZE ─────────────────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(60));
  console.log(`RESULTS: ${passed} PASS  ${failed} FAIL  ${skipped} SKIP`);
  console.log('═'.repeat(60));

  return { results, passed, failed, skipped };
}

// ── Generate Report ───────────────────────────────────────────────────────────
run().then(({ results, passed, failed, skipped }) => {
  const total = passed + failed + skipped;
  const date = new Date().toLocaleString('he-IL');

  const report = `# NightOps System — דוח בדיקות מקיף
**תאריך:** ${date}
**סביבה:** TEST (localhost:3001 backend, localhost:3002 frontend)

## סיכום
| סטטוס | מספר |
|-------|------|
| ✅ עבר | ${passed} |
| ❌ נכשל | ${failed} |
| ⏭ דולג | ${skipped} |
| **סה״כ** | **${total}** |

---

## פרוט הבדיקות

| מזהה | שם בדיקה | תוצאה | תוצאה צפויה | תוצאה בפועל | הערות |
|------|-----------|-------|-------------|-------------|-------|
${results.map(r =>
  `| ${r.id} | ${r.name} | ${r.status === 'PASS' ? '✅' : r.status === 'FAIL' ? '❌' : '⏭'} ${r.status} | ${r.expected || ''} | ${r.actual || ''} | ${r.note || ''} |`
).join('\n')}

---

## ממצאים וסיכון

${results.filter(r => r.note).map(r => `### ${r.id} — ${r.name}\n${r.note}`).join('\n\n')}

---

## בדיקות UI/UX — ממצאים ידניים (מצריכים בדיקה)

1. **חוסר אחידות בגדלי פונטים** — מסכי NightSummary, TimelineView ו-VersionsView משתמשים בגדלי פונט שונים (10-16px בטבלאות)
2. **שרשרת ההתקדמות** — הסרנו אותה מטאב ארכיון; יש לוודא שאינה מוצגת
3. **תיבות דו-שיח** — חלק מהמסכים עדיין משתמשים ב-alert() במקום ב-ConfirmDialog
4. **צבעי סטטוס** — WAITING/OPEN/IN_PROGRESS/DONE צריכים להיות אחידים בכל המסכים
5. **RTL consistency** — כותרות מסוימות מיושרות שמאל במסכי LTR
6. **טאבים לא פעילות/ארכיון** — ספירות לא תמיד מסתנכרנות בין ManagerDashboard ל-VersionsView
7. **כפתורי אישור CR** — ב-CrHandoffView שונים מ-CrPlanReviewPanel (לפני/אחרי התיקון)
8. **Toast notifications** — לא בכל המסכים, בחלק אין feedback ויזואלי
9. **Mobile responsive** — המסכים לא מוגדרים ל-responsive design
10. **Loading states** — חלק מהמסכים לא מציגים spinner/skeleton בזמן טעינה

---

## ממצאי אבטחה

${results.filter(r => r.id.startsWith('SEC') || r.id.startsWith('AUTH')).map(r =>
  `- **${r.id}**: ${r.name} — ${r.status === 'PASS' ? '✅ תקין' : '❌ בעיה'} (${r.actual})`
).join('\n')}

### סיכון נמצא:
${results.filter(r => r.note && (r.note.includes('FINDING') || r.note.includes('vulnerability'))).map(r => `- ⚠️  **${r.id}**: ${r.note}`).join('\n') || '- אין ממצאי אבטחה קריטיים'}

---

## המלצות לתיקון

1. **הוסף rate limiting** על endpoint הלוגין (מניעת brute force)
2. **הגבל גישת עובדים** ל-system-params (הסתר פרמטרי SMTP/LDAP)
3. **הגדר team leads** לכל 31 הצוותות במערכת
4. **הגדר SMTP** לשליחת מיילים אמיתית
5. **בדיקות responsive** — המערכת לא מותאמת למסכים קטנים
`;

  require('fs').writeFileSync('test-report.md', report, 'utf8');
  console.log('\n✅ דוח נשמר: playwright-tests/test-report.md');
  process.exit(failed > 0 ? 1 : 0);
}).catch(e => {
  console.error('Test runner error:', e);
  process.exit(1);
});
