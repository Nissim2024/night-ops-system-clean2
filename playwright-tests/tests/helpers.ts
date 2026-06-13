import { Page } from '@playwright/test';

export const ADMIN = { email: 'nissim@test.com', password: '123456' };
export const API = 'http://localhost:3000';
export const APP = 'http://localhost:3003';

export async function login(page: Page, email = ADMIN.email, password = ADMIN.password) {
  await page.goto(APP);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill(password);
  await page.locator('button[type="submit"]').click();
  // Wait for login form to disappear — signals dashboard has loaded
  await page.waitForSelector('input[type="email"]', { state: 'detached', timeout: 15_000 });
  await page.waitForTimeout(500);
}

export async function apiToken(page: Page, email = ADMIN.email, password = ADMIN.password): Promise<string> {
  const res = await page.request.post(`${API}/auth/login`, {
    data: { email, password },
  });
  const body = await res.json();
  return body.token;
}

export async function createTestVersion(page: Page, token: string, name: string): Promise<string> {
  // Use the UI to create a version with plannedStart so Hebrew is encoded correctly
  const res = await page.request.post(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    data: {
      name,
      description: 'גרסת בדיקה אוטומטית',
      plannedStart: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
    },
  });
  const body = await res.json();
  return body.id;
}

export async function deleteVersion(page: Page, token: string, id: string) {
  await page.request.delete(`${API}/versions/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

export async function screenshot(page: Page, name: string) {
  await page.screenshot({ path: `screenshots/${name}.png`, fullPage: false });
}

export async function navigateTo(page: Page, section: string) {
  // Use getByText for partial/contains matching (sidebar labels include emoji prefix)
  const nav = page.getByText(section, { exact: false }).first();
  await nav.waitFor({ state: 'visible', timeout: 15_000 });
  await nav.click();
  await page.waitForTimeout(500);
}

// Navigate to the VersionsView (prep stage — "בנייה ואישור" sidebar item)
export async function navigateToVersions(page: Page) {
  await navigateTo(page, 'בנייה ואישור');
}

// Click the first version card in the list to enter VersionDetail view
export async function openFirstVersion(page: Page) {
  // Wait for versions list to load (loading indicator disappears)
  await page.locator('text=טוען...').waitFor({ state: 'detached', timeout: 8_000 }).catch(() => {});
  // Click the creation-date span "🗓 נוצר:" which is unique to version cards
  // (avoids matching the VersionProgressChain stage labels)
  const createdSpan = page.locator('span').filter({ hasText: /🗓 נוצר:/ }).first();
  if (await createdSpan.isVisible({ timeout: 5_000 })) {
    await createdSpan.click();
  } else {
    // Fallback: click first delete button's sibling card div
    const firstCard = page.locator('button', { hasText: '🗑' }).or(page.locator('button', { hasText: 'מחק' })).first();
    if (await firstCard.isVisible({ timeout: 3_000 })) {
      // Click the parent card (go up to the card div)
      await page.locator('span').filter({ hasText: /👤/ }).first().click();
    }
  }
  // Wait for VersionDetail to render (back button appears)
  await page.locator('button', { hasText: 'חזור' }).waitFor({ state: 'visible', timeout: 8_000 });
}
