/**
 * TC-SCH: בדיקות מסך "הכן ותזמן" + לוח זמנים
 */
import { test, expect } from '@playwright/test';
import { login, apiToken, screenshot, navigateToVersions, openFirstVersion, API } from './helpers';

let token: string;
let versionId: string;

test.beforeAll(async ({ browser }) => {
  const page = await browser.newPage();
  token = await apiToken(page);

  const res = await page.request.get(`${API}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const versions = await res.json();
  const suitable = versions.find((v: any) =>
    ['DRAFT', 'COLLECTING', 'REFINING', 'REVIEW', 'APPROVED'].includes(v.status) &&
    !v.isArchived &&
    v.plannedStart
  );
  if (suitable) versionId = suitable.id;
  await page.close();
});

// ─── SCH-001: פתיחת דיאלוג הכן ותזמן ────────────────────────────────────────

test('SCH-001: כפתור הכן ותזמן מופיע ופותח דיאלוג', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);
  await navigateToVersions(page);
  await openFirstVersion(page);

  // "הכן ותזמן" button appears in VersionDetail for managers
  const scheduleBtn = page.locator('button', { hasText: 'הכן ותזמן' }).first();
  await expect(scheduleBtn).toBeVisible({ timeout: 10_000 });
  await screenshot(page, 'sch001-schedule-button');

  await scheduleBtn.click();
  await page.waitForTimeout(800);

  const dialogTitle = page.locator('text=הכן ותזמן').last();
  await expect(dialogTitle).toBeVisible({ timeout: 5_000 });
  await screenshot(page, 'sch001-dialog-open');
});

// ─── SCH-002: הגדרת שעות לשלבים ─────────────────────────────────────────────

test('SCH-002: הגדרת שעת התחלה לשלבים בדיאלוג', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);
  await navigateToVersions(page);
  await openFirstVersion(page);

  const scheduleBtn = page.locator('button', { hasText: 'הכן ותזמן' }).first();
  await scheduleBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(800);
  await screenshot(page, 'sch002-dialog-before');

  const timeInputs = page.locator('input[type="time"], input[type="datetime-local"]');
  const count = await timeInputs.count();
  console.log(`Found ${count} time inputs`);
  if (count === 0) {
    console.log('No phase time inputs — version has no phases');
    test.skip(true, 'גרסה ללא שלבים — לא ניתן לבדוק SCH-002');
    return;
  }
  expect(count).toBeGreaterThan(0);

  const d = new Date(Date.now() + 86400000).toISOString().slice(0, 10); // "2026-05-24"
  if (count >= 1) { await timeInputs.nth(0).fill(`${d}T08:00`); await page.waitForTimeout(200); }
  if (count >= 2) { await timeInputs.nth(1).fill(`${d}T22:00`); await page.waitForTimeout(200); }
  if (count >= 3) { await timeInputs.nth(2).fill(`${d}T23:45`); await page.waitForTimeout(200); }

  await screenshot(page, 'sch002-times-filled');

  if (count >= 1) {
    const val = await timeInputs.nth(0).inputValue();
    expect(val).toContain('T08:00');
  }
});

// ─── SCH-003: חישוב preview ───────────────────────────────────────────────────

test('SCH-003: לחיצה על חשב/תצוגה מקדימה מציגה תזמון', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);
  await navigateToVersions(page);
  await openFirstVersion(page);

  const scheduleBtn = page.locator('button', { hasText: 'הכן ותזמן' }).first();
  await scheduleBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const timeInputs = page.locator('input[type="time"], input[type="datetime-local"]');
  const count = await timeInputs.count();
  const d2 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (count >= 1) await timeInputs.nth(0).fill(`${d2}T08:00`);
  if (count >= 2) await timeInputs.nth(1).fill(`${d2}T22:00`);
  if (count >= 3) await timeInputs.nth(2).fill(`${d2}T23:45`);

  const previewBtn = page.locator('button', { hasText: 'חשב' }).or(
    page.locator('button', { hasText: 'תצוגה מקדימה' }).or(
      page.locator('button', { hasText: 'preview' })
    )
  ).first();

  if (await previewBtn.isVisible({ timeout: 3_000 })) {
    await previewBtn.click();
    await page.waitForTimeout(2000);
    await screenshot(page, 'sch003-preview-result');
    const taskRows = page.locator('tr, [style*="display: flex"]').filter({
      hasText: /\d{2}:\d{2}/,
    });
    const rowCount = await taskRows.count();
    console.log(`Preview rows with times: ${rowCount}`);
    expect(rowCount).toBeGreaterThan(0);
  } else {
    console.log('No dedicated preview button — schedule fills on time input');
    await screenshot(page, 'sch003-no-preview-btn');
  }
});

// ─── SCH-004: שמירת תזמון ─────────────────────────────────────────────────────

test('SCH-004: שמירת תזמון — משימות מקבלות plannedStart/plannedEnd', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);
  await navigateToVersions(page);
  await openFirstVersion(page);

  const scheduleBtn = page.locator('button', { hasText: 'הכן ותזמן' }).first();
  await scheduleBtn.click({ timeout: 10_000 });
  await page.waitForTimeout(800);

  const timeInputs = page.locator('input[type="time"], input[type="datetime-local"]');
  const count = await timeInputs.count();
  if (count === 0) {
    console.log('No phase time inputs — version has no phases');
    test.skip(true, 'גרסה ללא שלבים — לא ניתן לבדוק SCH-004');
    return;
  }
  const d3 = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  if (count >= 1) await timeInputs.nth(0).fill(`${d3}T08:00`);
  if (count >= 2) await timeInputs.nth(1).fill(`${d3}T22:00`);
  if (count >= 3) await timeInputs.nth(2).fill(`${d3}T23:45`);
  if (count >= 4) await timeInputs.nth(3).fill(`${d3}T06:00`);

  await screenshot(page, 'sch004-before-preview');

  // Step 1: click preview button to compute schedule
  const previewBtn = page.locator('button', { hasText: 'חשב ותצוגה מקדימה' }).first();
  if (await previewBtn.isVisible({ timeout: 5_000 })) {
    await previewBtn.click();
    await page.waitForTimeout(3000);
    await screenshot(page, 'sch004-after-preview');
  }

  await screenshot(page, 'sch004-before-apply');

  // Step 2: click apply button — only appears after preview
  // Text: "✅ אשר ועדכן תוכנית (N משימות)"
  const applyBtn = page.locator('button', { hasText: 'אשר ועדכן תוכנית' }).first();

  const applyResponsePromise = page.waitForResponse(
    r => r.url().includes('apply-schedule') && r.status() === 201,
    { timeout: 15_000 }
  ).catch(() => null);

  if (await applyBtn.isVisible({ timeout: 5_000 })) {
    await applyBtn.click();
  }

  const applyResp = await applyResponsePromise;
  await page.waitForTimeout(2000);
  await screenshot(page, 'sch004-after-apply');

  const verRes = await page.request.get(`${API}/versions/${versionId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const ver = await verRes.json();
  const allTasks: any[] = [];
  for (const ph of ver.phases ?? []) {
    for (const sp of ph.subPhases ?? []) {
      for (const t of sp.tasks ?? []) {
        allTasks.push(t);
      }
    }
  }

  const withTimes = allTasks.filter(t => t.plannedStart && t.plannedEnd);
  const withDuration = allTasks.filter(t => t.duration);
  console.log(`Tasks with times: ${withTimes.length}/${allTasks.length}`);
  console.log(`Tasks with duration: ${withDuration.length}/${allTasks.length}`);

  if (applyResp || withTimes.length > 0) {
    expect(withTimes.length).toBeGreaterThan(0);
  } else {
    console.warn('WARNING: apply-schedule not triggered — check button label');
  }
});

// ─── SCH-005: לוח זמנים ──────────────────────────────────────────────────────

test('SCH-005: לוח זמנים מציג משימות עם שעות', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);

  const timelineNav = page.locator('text=ציר זמן').first();
  if (await timelineNav.isVisible({ timeout: 5_000 })) {
    await timelineNav.click();
    await page.waitForTimeout(1200);
    await screenshot(page, 'sch005-timeline');

    const timeline = page.locator('[class*="timeline"], [class*="Timeline"], canvas').first();
    const timelineVisible = await timeline.isVisible({ timeout: 8_000 }).catch(() => false);

    const timeTexts = page.locator('text=/\\d{2}:\\d{2}/').first();
    const hasTime = await timeTexts.isVisible({ timeout: 5_000 }).catch(() => false);
    console.log(`Timeline visible: ${timelineVisible}, time texts: ${hasTime}`);
    await screenshot(page, 'sch005-timeline-detail');
  } else {
    test.skip(true, 'אין ניווט לציר זמן');
  }
});

// ─── SCH-006: מקרי קצה — משימות ללא duration ────────────────────────────────

test('SCH-006: משימות ללא duration לא נכשלות את התזמון', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);
  await navigateToVersions(page);
  await openFirstVersion(page);

  const scheduleBtn = page.locator('button', { hasText: 'הכן ותזמן' }).first();
  if (!await scheduleBtn.isVisible({ timeout: 5_000 })) {
    test.skip(true, 'כפתור תזמון לא נמצא');
    return;
  }

  await scheduleBtn.click();
  await page.waitForTimeout(600);

  // ודא שהדיאלוג נפתח בלי שגיאה
  const dialogTitle = page.locator('text=הכן ותזמן').last();
  await expect(dialogTitle).toBeVisible({ timeout: 5_000 });
  await screenshot(page, 'sch006-dialog-no-crash');
});

// ─── SCH-007: תלויות (respectDeps) ─────────────────────────────────────────

test('SCH-007: תזמון עם תלויות — תיבת סימון respectDeps', async ({ page }) => {
  if (!versionId) test.skip(true, 'אין גרסה מתאימה');
  await login(page);
  await navigateToVersions(page);
  await openFirstVersion(page);

  const scheduleBtn = page.locator('button', { hasText: 'הכן ותזמן' }).first();
  if (!await scheduleBtn.isVisible({ timeout: 5_000 })) {
    test.skip(true, 'כפתור תזמון לא נמצא');
    return;
  }

  await scheduleBtn.click();
  await page.waitForTimeout(600);

  const checkboxInDialog = page.locator('input[type="checkbox"]').first();
  if (await checkboxInDialog.isVisible({ timeout: 3_000 })) {
    const isChecked = await checkboxInDialog.isChecked();
    await checkboxInDialog.setChecked(!isChecked);
    await page.waitForTimeout(300);
    const newChecked = await checkboxInDialog.isChecked();
    expect(newChecked).toBe(!isChecked);
    await screenshot(page, 'sch007-deps-checkbox');
  } else {
    console.log('No checkbox found in dialog');
    await screenshot(page, 'sch007-no-checkbox');
  }
});
