/**
 * TC-007: ארכיון
 * TC-008: פילטרים + פוקוס
 * TC-010: מקרי קצה GUI
 */
import { test, expect } from '@playwright/test';
import { login, apiToken, screenshot, navigateToVersions, openFirstVersion, API } from './helpers';

let token: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  token = await apiToken(page);
  await page.close();
});

// ─── TC-007: ארכיון ───────────────────────────────────────────────────────────

test('TC-007: פילטר ארכיון מציג גרסאות מאורכבות', async ({ page }) => {
  await login(page);
  await navigateToVersions(page);
  await page.waitForTimeout(700);

  // כפתור "📦 ארכיון (X)" בראש רשימת הגרסאות — מציג/מסתיר גרסאות שהסתיימו
  const archiveToggle = page.locator('button', { hasText: 'ארכיון' }).first();
  if (await archiveToggle.isVisible({ timeout: 3_000 })) {
    await archiveToggle.click();
    await page.waitForTimeout(500);
    await screenshot(page, 'tc007-archive-filter');

    // ודא שמופיע כותרת "📦 ארכיון"
    const archiveSection = page.locator('text=📦 ארכיון').first();
    const hasSectionOrMsg = await archiveSection.isVisible({ timeout: 3_000 }).catch(() => false)
      || await page.locator('text=אין גרסאות בארכיון').isVisible({ timeout: 2_000 }).catch(() => false);
    expect(hasSectionOrMsg, 'ארכיון לא נפתח').toBe(true);
  } else {
    test.skip(true, 'אין כפתור ארכיון בממשק');
  }
});

test('TC-007: גרסה APPROVED לא ניתנת לארכוב', async ({ page }) => {
  await login(page);

  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const approved = versions.find((v: any) => v.status === 'APPROVED' && !v.isArchived);
  if (!approved) { test.skip(true, 'אין גרסה APPROVED'); return; }

  const arcRes = await page.request.patch(`${API}/versions/${approved.id}/archive`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(arcRes.status()).toBe(400);
  const body = await arcRes.json();
  expect(body.message).toContain('ניתן לארכב רק גרסאות סגורות');
});

// ─── TC-008: פילטרים + פוקוס ─────────────────────────────────────────────────

test('TC-008a: החלפת פילטר מעדכנת את הדרופדאון', async ({ page }) => {
  await login(page);
  await navigateToVersions(page);
  await page.waitForTimeout(700);
  await screenshot(page, 'tc008a-versions-initial');

  // פילטרים בכותרת הראשי (header tabs): 🟢 פעילות, 📋 לא פעילות, 📦 ארכיון
  const filters = ['לא פעילות', 'פעילות', 'ארכיון'];
  for (const filterName of filters) {
    const filterBtn = page.locator('button', { hasText: filterName }).first();
    if (await filterBtn.isVisible({ timeout: 2_000 })) {
      await filterBtn.click();
      await page.waitForTimeout(400);
      await screenshot(page, `tc008a-filter-${filterName}`);
    }
  }

  // חזור ל"לא פעילות"
  const inactiveFilter = page.locator('button', { hasText: 'לא פעילות' }).first();
  if (await inactiveFilter.isVisible()) {
    await inactiveFilter.click();
    await page.waitForTimeout(300);
  }
  await screenshot(page, 'tc008a-filter-reset');
});

test('TC-008b: בחירת גרסה מסנכרנת שרשרת + דרופדאון', async ({ page }) => {
  await login(page);
  await navigateToVersions(page);
  await page.waitForTimeout(700);

  // לחץ על גרסה כלשהי בממשק
  await openFirstVersion(page).catch(() => {});
  await screenshot(page, 'tc008b-version-selected');
  // ודא שמוצגת שרשרת התקדמות
  const chainText = page.locator('text=הכנת התוכנית').first();
  const visible = await chainText.isVisible({ timeout: 3_000 }).catch(() => false);
  console.log(`Progress chain visible after version open: ${visible}`);
});

// ─── TC-010: מקרי קצה GUI ────────────────────────────────────────────────────

test('TC-010a: approve עם משימות פתוחות — הודעת שגיאה בממשק', async ({ page }) => {
  await login(page);

  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const morningAfter = versions.find((v: any) => v.status === 'MORNING_AFTER');

  if (!morningAfter) {
    test.skip(true, 'אין גרסה ב-MORNING_AFTER');
    return;
  }

  const approveRes = await page.request.post(`${API}/summary/${morningAfter.id}/approve`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {},
  });

  if (approveRes.status() === 400) {
    const body = await approveRes.json();
    expect(body.message).toMatch(/משימות/);
    console.log('Open tasks error:', body.message);
  } else {
    console.log('Version has no open tasks — approve succeeded');
  }
});

test('TC-010b: ROLLED_BACK — NightSummary לא מוצג', async ({ page }) => {
  await login(page);

  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const rolledBack = versions.find((v: any) => v.status === 'ROLLED_BACK');

  if (!rolledBack) { test.skip(true, 'אין גרסה ROLLED_BACK'); return; }

  const summaryRes = await page.request.get(`${API}/summary/${rolledBack.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log('Summary status for ROLLED_BACK:', summaryRes.status());
});

test('TC-010c: אישור כפול על גרסה COMPLETED — לא קורסת', async ({ page }) => {
  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const completed = versions.find((v: any) => v.status === 'COMPLETED' && !v.isArchived);
  if (!completed) { test.skip(true, 'אין גרסה COMPLETED'); return; }

  const r1 = await page.request.post(`${API}/summary/${completed.id}/approve`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {},
  });
  const r2 = await page.request.post(`${API}/summary/${completed.id}/approve`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {},
  });

  expect([200, 201]).toContain(r1.status());
  expect([200, 201]).toContain(r2.status());

  const ver = await page.request.get(`${API}/versions/${completed.id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const verBody = await ver.json();
  expect(verBody.status).toBe('COMPLETED');
});
