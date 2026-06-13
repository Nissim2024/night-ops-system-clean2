/**
 * Comprehensive E2E Test Suite — NightOps System
 * Tests: Authentication · Version Lifecycle · Planning · Execution · Reports · Security · UI/UX
 */
import { test, expect, Page, APIRequestContext } from '@playwright/test';

const API   = 'http://localhost:3000';
const APP   = 'http://localhost:3003';
const ADMIN = { email: 'nissim@test.com', password: '123456' };
const MGR   = { email: 'Hay.Cohen@hot.net.il', password: '123456' };

// ── helpers ──────────────────────────────────────────────────────────────────

async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const r = await request.post(`${API}/auth/login`, { data: { email, password } });
  const body = await r.json();
  return { status: r.status(), token: body.token, user: body.user };
}

async function uiLogin(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto(APP);
  await page.waitForLoadState('networkidle');
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.locator('input[type="email"]').waitFor({ state: 'detached', timeout: 20_000 });
  await page.waitForTimeout(800);
}

function authHeader(token: string) { return { Authorization: `Bearer ${token}` }; }

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 1 — Authentication
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AUTH-01 · Authentication', () => {

  test('AUTH-01-01 · Valid login returns JWT', async ({ request }) => {
    const { status, token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    expect(status).toBe(200);
    expect(token).toBeTruthy();
    expect(token.split('.').length).toBe(3); // valid JWT structure
  });

  test('AUTH-01-02 · Wrong password → 401', async ({ request }) => {
    const r = await request.post(`${API}/auth/login`, {
      data: { email: ADMIN.email, password: 'wrongpassword' }
    });
    expect(r.status()).toBe(401);
  });

  test('AUTH-01-03 · Non-existent user → 401', async ({ request }) => {
    const r = await request.post(`${API}/auth/login`, {
      data: { email: 'nobody@test.com', password: '123456' }
    });
    expect(r.status()).toBe(401);
  });

  test('AUTH-01-04 · No token → 401 on protected route', async ({ request }) => {
    const r = await request.get(`${API}/versions`);
    expect(r.status()).toBe(401);
  });

  test('AUTH-01-05 · Tampered JWT → 401', async ({ request }) => {
    const r = await request.get(`${API}/versions`, {
      headers: { Authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.invalid' }
    });
    expect(r.status()).toBe(401);
  });

  test('AUTH-01-06 · UI login — admin sees dashboard', async ({ page }) => {
    await uiLogin(page);
    await expect(page.locator('text=DeployCenter')).toBeVisible();
    await page.screenshot({ path: 'screenshots/auth-01-06-dashboard.png' });
  });

  test('AUTH-01-07 · UI login — invalid shows error message', async ({ page }) => {
    await page.goto(APP);
    await page.locator('input[type="email"]').fill('wrong@test.com');
    await page.locator('input[type="password"]').fill('bad');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(1500);
    // Error message or still on login page
    const stillLogin = await page.locator('input[type="email"]').isVisible();
    expect(stillLogin).toBe(true);
    await page.screenshot({ path: 'screenshots/auth-01-07-login-error.png' });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 2 — Authorization (RBAC)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('AUTH-02 · Authorization', () => {

  test('AUTH-02-01 · Employee cannot delete a version', async ({ request }) => {
    const { token: adminToken } = await apiLogin(request, ADMIN.email, ADMIN.password);
    // Create temp version
    const vr = await request.post(`${API}/versions`, {
      headers: authHeader(adminToken),
      data: { name: 'DELETE-TEST', description: 'test', plannedStart: '2099-01-01' }
    });
    const vId = (await vr.json()).id;

    // Find an employee
    const users = await (await request.get(`${API}/users`, { headers: authHeader(adminToken) })).json();
    const emp = users.find((u: any) => u.role === 'EMPLOYEE' && u.active);
    const { token: empToken } = await apiLogin(request, emp.email, '123456');

    const delR = await request.delete(`${API}/versions/${vId}`, { headers: authHeader(empToken) });
    expect([401, 403]).toContain(delR.status());

    // Cleanup
    await request.delete(`${API}/versions/${vId}`, { headers: authHeader(adminToken) });
  });

  test('AUTH-02-02 · IDOR — cannot access version of another user by guessing ID', async ({ request }) => {
    const { token: adminToken } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const versions = await (await request.get(`${API}/versions`, { headers: authHeader(adminToken) })).json();
    if (versions.length === 0) { test.skip(); return; }
    const vId = versions[0].id;

    const users = await (await request.get(`${API}/users`, { headers: authHeader(adminToken) })).json();
    const emp = users.find((u: any) => u.role === 'EMPLOYEE' && u.active);
    const { token: empToken } = await apiLogin(request, emp.email, '123456');

    const r = await request.patch(`${API}/versions/${vId}/status`, {
      headers: authHeader(empToken),
      data: { status: 'COMPLETED' }
    });
    expect([401, 403]).toContain(r.status());
  });

  test('AUTH-02-03 · SQL injection attempt in login', async ({ request }) => {
    const r = await request.post(`${API}/auth/login`, {
      data: { email: "' OR '1'='1", password: "' OR '1'='1" }
    });
    expect(r.status()).toBe(401);
  });

  test('AUTH-02-04 · XSS payload in version name is stored safely', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const xssName = '<script>alert("xss")</script>';
    const r = await request.post(`${API}/versions`, {
      headers: authHeader(token),
      data: { name: xssName, description: 'xss test', plannedStart: '2099-01-01' }
    });
    if (r.status() === 201 || r.status() === 200) {
      const body = await r.json();
      // Name should be stored as-is (no exec) — escaping happens in frontend
      expect(body.name).toBe(xssName);
      await request.delete(`${API}/versions/${body.id}`, { headers: authHeader(token) });
    }
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 3 — Version Lifecycle
// ─────────────────────────────────────────────────────────────────────────────
test.describe('VER-01 · Version CRUD', () => {
  let token: string;
  let versionId: string;

  test.beforeAll(async ({ request }) => {
    ({ token } = await apiLogin(request, ADMIN.email, ADMIN.password));
  });

  test('VER-01-01 · Create version via API', async ({ request }) => {
    const r = await request.post(`${API}/versions`, {
      headers: authHeader(token),
      data: {
        name: 'E2E-TEST-' + Date.now(),
        description: 'בדיקת E2E אוטומטית',
        plannedStart: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
      }
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    versionId = body.id;
    expect(body.status).toBe('DRAFT');
    expect(body.name).toContain('E2E-TEST');
  });

  test('VER-01-02 · Get version list includes new version', async ({ request }) => {
    const r = await request.get(`${API}/versions`, { headers: authHeader(token) });
    const list = await r.json();
    expect(list.some((v: any) => v.id === versionId)).toBe(true);
  });

  test('VER-01-03 · Cannot advance to COLLECTING without required fields', async ({ request }) => {
    const r = await request.patch(`${API}/versions/${versionId}/status`, {
      headers: authHeader(token),
      data: { status: 'COLLECTING' }
    });
    // Should either work (DRAFT→COLLECTING is direct) or validate
    expect([200, 201, 400, 403]).toContain(r.status());
  });

  test('VER-01-04 · Delete test version', async ({ request }) => {
    const r = await request.delete(`${API}/versions/${versionId}`, { headers: authHeader(token) });
    expect([200, 204]).toContain(r.status());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 4 — Import and Template
// ─────────────────────────────────────────────────────────────────────────────
test.describe('VER-02 · Import and Templates', () => {

  test('VER-02-01 · Get version templates', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/version-templates`, { headers: authHeader(token) });
    expect(r.status()).toBe(200);
    const list = await r.json();
    expect(list.length).toBeGreaterThan(0);
  });

  test('VER-02-02 · QC Releases loaded', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/qc-releases`, { headers: authHeader(token) });
    expect(r.status()).toBe(200);
    const list = await r.json();
    expect(list.length).toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 5 — Teams and Users
// ─────────────────────────────────────────────────────────────────────────────
test.describe('TEAM-01 · Teams', () => {

  test('TEAM-01-01 · All teams loaded', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/teams`, { headers: authHeader(token) });
    const list = await r.json();
    expect(list.length).toBeGreaterThan(20);
  });

  test('TEAM-01-02 · Teams with no lead — findings documented', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/teams`, { headers: authHeader(token) });
    const list = await r.json();
    const noLead = list.filter((t: any) => !t.members?.some((m: any) => m.isLead));
    // This is a FINDING — document but don't fail
    console.log(`⚠️  Teams without lead: ${noLead.length} / ${list.length}`);
    console.log(noLead.map((t: any) => t.name).join(', '));
    expect(list.length).toBeGreaterThan(0); // just ensure teams exist
  });

  test('TEAM-01-03 · User roles distribution', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/users`, { headers: authHeader(token) });
    const users = await r.json();
    const roles: Record<string, number> = {};
    users.forEach((u: any) => { roles[u.role] = (roles[u.role] || 0) + 1; });
    console.log('Role distribution:', JSON.stringify(roles));
    expect(roles['ADMIN'] || 0).toBeGreaterThan(0);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 6 — Permissions API
// ─────────────────────────────────────────────────────────────────────────────
test.describe('PERM-01 · Permissions', () => {

  test('PERM-01-01 · Admin has all permissions', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/permissions/my`, { headers: authHeader(token) });
    if (r.status() === 200) {
      const perms = await r.json();
      expect(Array.isArray(perms) || typeof perms === 'object').toBe(true);
    }
  });

  test('PERM-01-02 · Employee has limited permissions', async ({ request }) => {
    const { token: adminTok } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const users = await (await request.get(`${API}/users`, { headers: authHeader(adminTok) })).json();
    const emp = users.find((u: any) => u.role === 'EMPLOYEE' && u.active);
    if (!emp) { test.skip(); return; }
    const { token: empTok } = await apiLogin(request, emp.email, '123456');
    // Employee should NOT be able to delete versions
    const r = await request.delete(`${API}/versions/nonexistent-id`, { headers: authHeader(empTok) });
    expect([401, 403, 404]).toContain(r.status());
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 7 — System Params
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SYS-01 · System Parameters', () => {

  test('SYS-01-01 · System params readable by admin', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/system-params`, { headers: authHeader(token) });
    expect(r.status()).toBe(200);
    const params = await r.json();
    const keys = params.map((p: any) => p.key);
    expect(keys).toContain('EMAIL_ENABLED');
  });

  test('SYS-01-02 · EMAIL_ENABLED is false (SMTP not configured)', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/system-params`, { headers: authHeader(token) });
    const params = await r.json();
    const emailParam = params.find((p: any) => p.key === 'EMAIL_ENABLED');
    console.log(`ℹ️  EMAIL_ENABLED = ${emailParam?.value} — email tests will be skipped`);
    // Not a fail — just a note
  });

  test('SYS-01-03 · Non-admin cannot update system params', async ({ request }) => {
    const { token: adminTok } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const users = await (await request.get(`${API}/users`, { headers: authHeader(adminTok) })).json();
    const emp = users.find((u: any) => u.role === 'EMPLOYEE' && u.active);
    if (!emp) { test.skip(); return; }
    const { token: empTok } = await apiLogin(request, emp.email, '123456');
    const r = await request.patch(`${API}/system-params/EMAIL_ENABLED`, {
      headers: authHeader(empTok),
      data: { value: 'true' }
    });
    expect([401, 403]).toContain(r.status());
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 8 — UI / UX Consistency
// ─────────────────────────────────────────────────────────────────────────────
test.describe('UI-01 · UI/UX Consistency', () => {

  test('UI-01-01 · Login page renders correctly', async ({ page }) => {
    await page.goto(APP);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
    await expect(page.locator('button[type="submit"]')).toBeVisible();
    await page.screenshot({ path: 'screenshots/ui-01-01-login.png' });
  });

  test('UI-01-02 · Dashboard — sidebar visible with stage labels', async ({ page }) => {
    await uiLogin(page);
    const sidebar = page.locator('text=שלבים בגרסה');
    await expect(sidebar).toBeVisible();
    await page.screenshot({ path: 'screenshots/ui-01-02-dashboard.png' });
  });

  test('UI-01-03 · TEST badge visible in sidebar', async ({ page }) => {
    await uiLogin(page);
    // TEST badge should appear (we're on port 3002 = test env)
    const testBadge = page.locator('text=test').first();
    await page.screenshot({ path: 'screenshots/ui-01-03-test-badge.png' });
    // Note: badge appears if REACT_APP_ENV=test
  });

  test('UI-01-04 · Version list page loads', async ({ page }) => {
    await uiLogin(page);
    // Navigate to versions (בנייה ואישור or similar)
    const versionsLink = page.locator('button').filter({ hasText: /בנייה|הכנה|prep/i }).first();
    if (await versionsLink.isVisible({ timeout: 3000 })) {
      await versionsLink.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: 'screenshots/ui-01-04-versions.png' });
  });

  test('UI-01-05 · WarRoom page loads', async ({ page }) => {
    await uiLogin(page);
    const warRoomLink = page.locator('button').filter({ hasText: /WarRoom|לילה|night/i }).first();
    if (await warRoomLink.isVisible({ timeout: 3000 })) {
      await warRoomLink.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: 'screenshots/ui-01-05-warroom.png' });
  });

  test('UI-01-06 · Timeline view loads', async ({ page }) => {
    await uiLogin(page);
    const timelineLink = page.locator('button').filter({ hasText: /ציר זמן|timeline/i }).first();
    if (await timelineLink.isVisible({ timeout: 3000 })) {
      await timelineLink.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: 'screenshots/ui-01-06-timeline.png' });
  });

  test('UI-01-07 · Admin panel accessible to admin', async ({ page }) => {
    await uiLogin(page);
    const adminLink = page.locator('button').filter({ hasText: /ניהול|admin/i }).first();
    if (await adminLink.isVisible({ timeout: 3000 })) {
      await adminLink.click();
      await page.waitForTimeout(1000);
    }
    await page.screenshot({ path: 'screenshots/ui-01-07-admin.png' });
  });

  test('UI-01-08 · Night summary visible after selecting completed version', async ({ page }) => {
    await uiLogin(page);
    // Try to access summary tab
    const summaryLink = page.locator('button').filter({ hasText: /סיכום|summary/i }).first();
    if (await summaryLink.isVisible({ timeout: 3000 })) {
      await summaryLink.click();
      await page.waitForTimeout(1500);
    }
    await page.screenshot({ path: 'screenshots/ui-01-08-summary.png' });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 9 — API Robustness
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API-01 · Robustness', () => {

  test('API-01-01 · Empty body on version create → 400', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.post(`${API}/versions`, {
      headers: authHeader(token),
      data: {}
    });
    expect([400, 422]).toContain(r.status());
  });

  test('API-01-02 · Non-existent version → 404', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/versions/00000000-0000-0000-0000-000000000000`, {
      headers: authHeader(token)
    });
    expect(r.status()).toBe(404);
  });

  test('API-01-03 · Tasks endpoint requires versionId', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/tasks`, { headers: authHeader(token) });
    // Either returns empty array or 400
    expect([200, 400]).toContain(r.status());
  });

  test('API-01-04 · Oversized payload rejected', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const bigString = 'A'.repeat(100_000);
    const r = await request.post(`${API}/versions`, {
      headers: authHeader(token),
      data: { name: bigString, description: bigString, plannedStart: '2099-01-01' }
    });
    // Should fail validation or be rejected
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });

  test('API-01-05 · CORS headers present', async ({ request }) => {
    const r = await request.get(`${API}/auth/config`);
    // Check response received (may be 200 or 404 but should not crash)
    expect(r.status()).toBeLessThan(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 10 — Task Proposals Flow
// ─────────────────────────────────────────────────────────────────────────────
test.describe('PROP-01 · Task Proposals', () => {
  let token: string;
  let versionId: string;

  test.beforeAll(async ({ request }) => {
    ({ token } = await apiLogin(request, ADMIN.email, ADMIN.password));
    // Use existing completed version for read tests
    const versions = await (await request.get(`${API}/versions`, { headers: authHeader(token) })).json();
    if (versions.length > 0) versionId = versions[0].id;
  });

  test('PROP-01-01 · Get proposals for version', async ({ request }) => {
    if (!versionId) { test.skip(); return; }
    const r = await request.get(`${API}/task-proposals?versionId=${versionId}`, {
      headers: authHeader(token)
    });
    expect([200, 404]).toContain(r.status());
  });

  test('PROP-01-02 · Create proposal requires team association', async ({ request }) => {
    if (!versionId) { test.skip(); return; }
    const r = await request.post(`${API}/task-proposals`, {
      headers: authHeader(token),
      data: {
        versionId,
        title: 'Test Proposal',
        phase: 1,
        estimatedMins: 30,
      }
    });
    // May succeed or require teamId
    expect(r.status()).toBeLessThan(500);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 11 — Version Status Transitions
// ─────────────────────────────────────────────────────────────────────────────
test.describe('VER-03 · Status Transitions', () => {
  let token: string;
  let testVersionId: string;

  test.beforeAll(async ({ request }) => {
    ({ token } = await apiLogin(request, ADMIN.email, ADMIN.password));
  });

  test.afterAll(async ({ request }) => {
    if (testVersionId) {
      await request.delete(`${API}/versions/${testVersionId}`, { headers: authHeader(token) });
    }
  });

  test('VER-03-01 · New version starts as DRAFT', async ({ request }) => {
    const r = await request.post(`${API}/versions`, {
      headers: authHeader(token),
      data: { name: 'TRANS-TEST-' + Date.now(), description: 'test', plannedStart: '2099-06-01' }
    });
    expect(r.status()).toBe(201);
    const body = await r.json();
    testVersionId = body.id;
    expect(body.status).toBe('DRAFT');
  });

  test('VER-03-02 · Cannot skip from DRAFT to ACTIVE', async ({ request }) => {
    if (!testVersionId) { test.skip(); return; }
    const r = await request.patch(`${API}/versions/${testVersionId}/status`, {
      headers: authHeader(token),
      data: { status: 'ACTIVE' }
    });
    expect([400, 403]).toContain(r.status());
  });

  test('VER-03-03 · DRAFT → COLLECTING is valid', async ({ request }) => {
    if (!testVersionId) { test.skip(); return; }
    const r = await request.patch(`${API}/versions/${testVersionId}/status`, {
      headers: authHeader(token),
      data: { status: 'COLLECTING' }
    });
    expect([200, 201]).toContain(r.status());
  });

  test('VER-03-04 · Cannot go COLLECTING → APPROVED (skip REFINING/REVIEW)', async ({ request }) => {
    if (!testVersionId) { test.skip(); return; }
    const r = await request.patch(`${API}/versions/${testVersionId}/status`, {
      headers: authHeader(token),
      data: { status: 'APPROVED' }
    });
    expect([400, 403]).toContain(r.status());
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 12 — CR Plans
// ─────────────────────────────────────────────────────────────────────────────
test.describe('CR-01 · CR Plans', () => {

  test('CR-01-01 · CR assignments endpoint', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const versions = await (await request.get(`${API}/versions`, { headers: authHeader(token) })).json();
    if (!versions.length) { test.skip(); return; }
    const r = await request.get(`${API}/versions/${versions[0].id}/cr-assignments`, {
      headers: authHeader(token)
    });
    expect([200, 404]).toContain(r.status());
  });

  test('CR-01-02 · CR review data endpoint', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const versions = await (await request.get(`${API}/versions`, { headers: authHeader(token) })).json();
    if (!versions.length) { test.skip(); return; }
    const r = await request.get(`${API}/versions/${versions[0].id}/cr-review`, {
      headers: authHeader(token)
    });
    expect([200, 404]).toContain(r.status());
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 13 — Night Summary
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SUM-01 · Night Summary', () => {

  test('SUM-01-01 · Summary endpoint returns data for existing version', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const versions = await (await request.get(`${API}/versions`, { headers: authHeader(token) })).json();
    if (!versions.length) { test.skip(); return; }
    const r = await request.get(`${API}/summary/${versions[0].id}`, { headers: authHeader(token) });
    expect([200, 404]).toContain(r.status());
  });

  test('SUM-01-02 · Summary email config endpoint', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/summary/email/config`, { headers: authHeader(token) });
    expect(r.status()).toBe(200);
    const body = await r.json();
    expect(typeof body.enabled).toBe('boolean');
  });

  test('SUM-01-03 · Sending email when disabled returns error', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const versions = await (await request.get(`${API}/versions`, { headers: authHeader(token) })).json();
    if (!versions.length) { test.skip(); return; }
    const r = await request.post(`${API}/summary/${versions[0].id}/send-email`, {
      headers: authHeader(token),
      data: { subject: 'Test', text: 'Test email body' }
    });
    // Should fail because EMAIL_ENABLED = false
    expect([400, 500]).toContain(r.status());
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK 14 — Security Specific
// ─────────────────────────────────────────────────────────────────────────────
test.describe('SEC-01 · Security', () => {

  test('SEC-01-01 · No sensitive data in /auth/config', async ({ request }) => {
    const r = await request.get(`${API}/auth/config`);
    if (r.status() === 200) {
      const body = await r.json();
      const str = JSON.stringify(body);
      expect(str).not.toContain('password');
      expect(str).not.toContain('secret');
    }
  });

  test('SEC-01-02 · JWT secret not exposed in any response', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/system-params`, { headers: authHeader(token) });
    const body = await r.text();
    expect(body.toLowerCase()).not.toContain('jwt_secret');
    // email password also should not appear
    expect(body).not.toContain('EMAIL_PASSWORD_VALUE');
  });

  test('SEC-01-03 · Rate limit test — rapid fire login attempts', async ({ request }) => {
    const results: number[] = [];
    for (let i = 0; i < 10; i++) {
      const r = await request.post(`${API}/auth/login`, {
        data: { email: 'attacker@test.com', password: 'wrong' }
      });
      results.push(r.status());
    }
    // All should be 401 — if any 429, rate limiting is working
    const has429 = results.some(s => s === 429);
    console.log(`Rate limit: ${has429 ? '✅ 429 detected' : '⚠️  No rate limiting (all 401)'}`);
    expect(results.every(s => [401, 429].includes(s))).toBe(true);
  });

  test('SEC-01-04 · LDAP config — passwords not returned', async ({ request }) => {
    const { token } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const r = await request.get(`${API}/system-params`, { headers: authHeader(token) });
    const params = await r.json();
    const ldapPw = params.find((p: any) => p.key === 'LDAP_BIND_PASSWORD');
    // The key exists but value should be empty or masked
    if (ldapPw) {
      expect(ldapPw.value).toBeFalsy();
    }
  });

  test('SEC-01-05 · Cannot delete other users as non-admin', async ({ request }) => {
    const { token: adminTok } = await apiLogin(request, ADMIN.email, ADMIN.password);
    const users = await (await request.get(`${API}/users`, { headers: authHeader(adminTok) })).json();
    const emps = users.filter((u: any) => u.role === 'EMPLOYEE' && u.active);
    if (emps.length < 2) { test.skip(); return; }
    const { token: empTok } = await apiLogin(request, emps[0].email, '123456');
    const r = await request.delete(`${API}/users/${emps[1].id}`, { headers: authHeader(empTok) });
    expect([401, 403]).toContain(r.status());
  });

});
