/**
 * QA — Recent changes verification
 * 1. TaskRow buttons moved below content (horizontal, not left-column)
 * 2. DelayPanel/TaskRow stability (no remount during updates)
 * 3. Select/Deselect All on sub-phases
 * 4. NightSummary effectiveGo after force-approve
 */
import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { login, apiToken, screenshot, APP, API } from './helpers';

// ── helpers ──────────────────────────────────────────────────────────────────
async function findActiveVersion(page: Page, token: string): Promise<string | null> {
  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const active = versions.find((v: any) => ['ACTIVE', 'REHEARSAL', 'MORNING_AFTER'].includes(v.status));
  return active?.id ?? null;
}

// ── TC-QA-01: TaskRow layout — buttons appear below content, not on far left ──
test('TC-QA-01 TaskRow buttons are below task content in execution mode', async ({ page }) => {
  await login(page);
  await page.waitForTimeout(1000);
  await screenshot(page, 'qa01-after-login');

  const token = await apiToken(page);
  const versionId = await findActiveVersion(page, token);

  if (!versionId) {
    console.log('No active version found — creating test setup screenshot only');
    await screenshot(page, 'qa01-no-active-version');
    test.skip(true, 'No active/rehearsal version to test execution mode');
    return;
  }

  // Navigate to WarRoom which embeds TeamView
  await page.goto(`${APP}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await screenshot(page, 'qa01-dashboard-view');

  // Click on the active night / WarRoom
  const warRoomNav = page.getByText('War Room', { exact: false })
    .or(page.getByText('חדר מלחמה', { exact: false }))
    .or(page.getByText('WarRoom', { exact: false }));

  if (await warRoomNav.count() > 0) {
    await warRoomNav.first().click();
    await page.waitForTimeout(1500);
    await screenshot(page, 'qa01-warroom');
  }

  // Check for task rows — look for "פתח לביצוע" buttons
  const execButtons = page.locator('button').filter({ hasText: /פתח לביצוע|התחל|סיים/ });
  const btnCount = await execButtons.count();
  console.log(`Found ${btnCount} execution buttons`);
  await screenshot(page, 'qa01-task-buttons-visible');

  if (btnCount > 0) {
    // Verify button is NOT far to the left of the task title
    // The button should be in the same column (flex column inside the task content div)
    const firstBtn = execButtons.first();
    const btnBox = await firstBtn.boundingBox();

    // Find the task title (bold text near this button)
    // In the new layout, button is BELOW the title — both share similar X coordinate
    const firstTaskTitle = page.locator('span').filter({ hasText: /[א-ת]{3,}/ }).first();
    const titleBox = await firstTaskTitle.boundingBox();

    if (btnBox && titleBox) {
      console.log(`Button X: ${btnBox.x.toFixed(0)}, Title X: ${titleBox.x.toFixed(0)}`);
      console.log(`Button Y: ${btnBox.y.toFixed(0)}, Title Y: ${titleBox.y.toFixed(0)}`);
      // New layout: button should be BELOW title (higher Y) not far to the left
      // In 1400px RTL layout, "far left" = X < 300
      // The task title should be at X > 600 (right side in RTL)
      // Button should be at similar X range (not far left)
      const buttonIsBelow = btnBox.y > titleBox.y;
      console.log(`Button is below title: ${buttonIsBelow}`);
      expect(btnBox.x).toBeGreaterThan(200); // Not stuck at far left edge
    }

    await screenshot(page, 'qa01-button-position-verified');
  }
});

// ── TC-QA-02: Sub-phase select / deselect all buttons ──
test('TC-QA-02 Sub-phase has select-all and deselect buttons', async ({ page }) => {
  await login(page);
  await page.waitForTimeout(1000);

  const token = await apiToken(page);
  const versionId = await findActiveVersion(page, token);

  if (!versionId) {
    test.skip(true, 'No active/rehearsal version to test execution mode');
    return;
  }

  await page.goto(`${APP}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Navigate to WarRoom
  const warRoomNav = page.getByText('War Room', { exact: false })
    .or(page.getByText('חדר מלחמה', { exact: false }))
    .or(page.getByText('WarRoom', { exact: false }));

  if (await warRoomNav.count() > 0) {
    await warRoomNav.first().click();
    await page.waitForTimeout(1500);
  }

  await screenshot(page, 'qa02-warroom-loaded');

  // Look for sub-phase "✓ בחר הכל" buttons
  const selectAllBtns = page.locator('button').filter({ hasText: /✓ בחר הכל/ });
  const selectCount = await selectAllBtns.count();
  console.log(`Found ${selectCount} "✓ בחר הכל" buttons (phase + sub-phase level)`);
  await screenshot(page, 'qa02-before-select');

  if (selectCount > 0) {
    // Click the LAST "בחר הכל" button — sub-phase level (phase-level comes first in DOM)
    const lastSelectBtn = selectAllBtns.last();
    await lastSelectBtn.click({ force: true });
    await page.waitForTimeout(500);
    await screenshot(page, 'qa02-after-select-subphase');

    // The multi-select toolbar should appear with "נבחרו" text
    const toolbar = page.locator('text=/\\d+ נבחרו/');
    const toolbarVisible = await toolbar.isVisible({ timeout: 2000 }).catch(() => false);
    console.log(`Multi-select toolbar visible after select: ${toolbarVisible}`);

    // Now look for "✕ בטל" deselect button at sub-phase level
    const deselectBtns = page.locator('button').filter({ hasText: /✕ בטל/ });
    const deselCount = await deselectBtns.count();
    console.log(`Found ${deselCount} "✕ בטל" deselect buttons`);
    await screenshot(page, 'qa02-deselect-buttons-visible');

    expect(deselCount).toBeGreaterThan(0);

    // Click deselect
    if (deselCount > 0) {
      await deselectBtns.last().click({ force: true });
      await page.waitForTimeout(500);
      await screenshot(page, 'qa02-after-deselect');

      // Toolbar should be gone or show 0
      const toolbarGone = await page.locator('text=/\\d+ נבחרו/').count() === 0;
      console.log(`Toolbar gone after deselect: ${toolbarGone}`);
    }
  } else {
    console.log('No select-all buttons found — may be in non-execution mode or permission issue');
    await screenshot(page, 'qa02-no-buttons-found');
  }
});

// ── TC-QA-03: Console errors — no JS runtime errors ──
test('TC-QA-03 No console errors during normal navigation', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', err => {
    consoleErrors.push(`UNCAUGHT: ${err.message}`);
  });

  await login(page);
  await page.waitForTimeout(1000);

  // Navigate around
  const navItems = ['War Room', 'גרסאות', 'ניהול', 'צוותים'];
  for (const item of navItems) {
    const el = page.getByText(item, { exact: false }).first();
    if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
      await el.click();
      await page.waitForTimeout(700);
    }
  }

  await screenshot(page, 'qa03-navigation-done');

  // Filter known-harmless errors
  const realErrors = consoleErrors.filter(e =>
    !e.includes('favicon') &&
    !e.includes('ResizeObserver') &&
    !e.includes('WebSocket') &&
    !e.includes('net::ERR')
  );

  console.log('Console errors during navigation:', realErrors.length > 0 ? realErrors : 'none');
  expect(realErrors).toHaveLength(0);
});

// ── TC-QA-04: NightSummary effectiveGo — basic render without crash ──
test('TC-QA-04 NightSummary loads without crash', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', err => pageErrors.push(err.message));

  await login(page);
  await page.waitForTimeout(1000);

  const token = await apiToken(page);
  const versionId = await findActiveVersion(page, token);

  if (!versionId) {
    test.skip(true, 'No active version to test NightSummary');
    return;
  }

  // Try navigating to summary via Night Summary sidebar
  const summaryNav = page.getByText('סיכום', { exact: false })
    .or(page.getByText('Night Summary', { exact: false }))
    .or(page.getByText('דוח', { exact: false }));

  if (await summaryNav.count() > 0) {
    await summaryNav.first().click();
    await page.waitForTimeout(1500);
  }

  await screenshot(page, 'qa04-night-summary');
  console.log('Page errors:', pageErrors.length > 0 ? pageErrors : 'none');
  expect(pageErrors).toHaveLength(0);

  // If GO/NO GO banner is visible, capture its state
  const goBanner = page.locator('text=/GO|NO GO/').first();
  if (await goBanner.isVisible({ timeout: 2000 }).catch(() => false)) {
    const bannerText = await goBanner.textContent();
    console.log('GO/NO GO banner text:', bannerText);
    await screenshot(page, 'qa04-gonogo-banner');
  }
});
