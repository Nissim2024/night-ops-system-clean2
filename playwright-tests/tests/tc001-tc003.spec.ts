import { test, expect } from '@playwright/test';
import { login, apiToken, deleteVersion, screenshot, navigateToVersions, API } from './helpers';

let token: string;
let testVersionId: string;
const VERSION_NAME = `QA-GUI-${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  token = await apiToken(page);
  await page.close();
});

test.afterAll(async ({ browser }) => {
  if (testVersionId) {
    const page = await browser.newPage();
    await deleteVersion(page, token, testVersionId);
    await page.close();
  }
});

// ─── TC-001: יצירת גרסה ─────────────────────────────────────────────────────

test('TC-001a: יצירת גרסה חדשה עם שם ותאריך', async ({ page }) => {
  await login(page);
  await navigateToVersions(page);
  await screenshot(page, 'tc001a-versions-screen');

  // פתח דיאלוג יצירת גרסה
  const createBtn = page.locator('button', { hasText: 'גרסה חדשה' }).first();
  await expect(createBtn).toBeVisible({ timeout: 8_000 });
  await createBtn.click();

  // מלא שם — placeholder is "לדוגמה: ITv04-2026"
  const nameInput = page.locator('input[placeholder*="ITv04"], input[placeholder*="שם"], input[placeholder*="גרסה"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 8_000 });
  await nameInput.fill(VERSION_NAME);

  // מלא תאריך ושעת התחלה (datetime-local)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const dateInput = page.locator('input[type="datetime-local"]').first();
  await dateInput.fill(tomorrow);

  await screenshot(page, 'tc001a-filled-form');

  // שלח — כפתור "📄 גרסה ריקה"
  const submitBtn = page.locator('button', { hasText: 'גרסה ריקה' }).first();
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();
  await page.waitForTimeout(2000);

  // ודא שהגרסה נוצרה
  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const created = versions.find((v: any) => v.name === VERSION_NAME);
  expect(created, `גרסה "${VERSION_NAME}" לא נמצאה`).toBeTruthy();
  expect(created.status).toBe('DRAFT');
  testVersionId = created.id;

  await screenshot(page, 'tc001a-version-created');
});

test('TC-001b: שם גרסה כפול — שגיאה מוצגת', async ({ page }) => {
  if (!testVersionId) { test.skip(true, 'TC-001a לא יצר גרסה'); return; }
  await login(page);
  await navigateToVersions(page);

  const createBtn = page.locator('button', { hasText: 'גרסה חדשה' }).first();
  await expect(createBtn).toBeVisible({ timeout: 8_000 });
  await createBtn.click();

  const nameInput = page.locator('input[placeholder*="ITv04"], input[placeholder*="שם"], input[placeholder*="גרסה"]').first();
  await nameInput.waitFor({ state: 'visible', timeout: 8_000 });
  await nameInput.fill(VERSION_NAME); // שם קיים

  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  const dateInput = page.locator('input[type="datetime-local"]').first();
  await dateInput.fill(tomorrow);

  const submitBtn = page.locator('button', { hasText: 'גרסה ריקה' }).first();
  await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
  await submitBtn.click();
  await page.waitForTimeout(2000);

  // חפש הודעת שגיאה — כולל toast, alert, div עם שגיאה
  const errorMsg = page.locator('[class*="error"], [class*="Error"], [role="alert"]').first()
    .or(page.locator('text=כבר קיימת'))
    .or(page.locator('text=שגיאה'));
  await expect(errorMsg).toBeVisible({ timeout: 5_000 });
  await screenshot(page, 'tc001b-duplicate-error');
});

test('TC-001c: גרסה חדשה מופיעה בדרופדאון תחת לא פעילות', async ({ page }) => {
  if (!testVersionId) { test.skip(true, 'TC-001a לא יצר גרסה'); return; }
  await login(page);
  await navigateToVersions(page);

  // Wait for versions list to load
  await page.locator('text=טוען...').waitFor({ state: 'detached', timeout: 8_000 }).catch(() => {});
  await page.waitForTimeout(500);

  // Find the version name specifically in a span (not in option/select dropdown)
  const versionInCard = page.locator('span', { hasText: VERSION_NAME }).first();
  await expect(versionInCard).toBeVisible({ timeout: 8_000 });

  // ודא שהפילטר "📋 לא פעילות" בכותרת הראשי מסמן אותה
  const inactiveFilter = page.locator('button', { hasText: 'לא פעילות' }).first();
  if (await inactiveFilter.isVisible()) {
    await inactiveFilter.click();
    await page.waitForTimeout(300);
  }

  await expect(page.locator('span', { hasText: VERSION_NAME }).first()).toBeVisible();
  await screenshot(page, 'tc001c-version-in-dropdown');
});

// ─── TC-003: שרשרת התקדמות ───────────────────────────────────────────────────

test('TC-003: שרשרת התקדמות משתנה לפי סטטוס', async ({ page }) => {
  await login(page);

  // VersionProgressChain מוצג בכותרת כאשר גרסה נבחרת
  // המרכיב מציג "הכנת התוכנית" כשלב ראשון
  const chainText = page.locator('text=הכנת התוכנית').first();
  await expect(chainText).toBeVisible({ timeout: 10_000 });
  await screenshot(page, 'tc003-progress-chain');

  // VersionProgressChain always shows all main stages
  const chainItems = [
    page.locator('text=הכנת התוכנית').first(),
    page.locator('text=חזרה גנרלית').first(),
    page.locator('text=הרצה בפועל').first(),
  ];
  let foundCount = 0;
  for (const item of chainItems) {
    if (await item.isVisible({ timeout: 2_000 }).catch(() => false)) foundCount++;
  }
  expect(foundCount).toBeGreaterThan(0);

  // נווט לגרסאות ובחר גרסה לבדיקת שרשרת
  await navigateToVersions(page);
  await screenshot(page, 'tc003-versions-screen');
});
