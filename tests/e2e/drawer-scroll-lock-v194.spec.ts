import { expect, test, type Page } from '@playwright/test';

/**
 * v194 — the page still scrolls after the task window has been opened many
 * times (reported 18 September 2026).
 *
 * Both overlays used to save `document.body.style.overflow` and put it back
 * themselves. Whenever two overlapped — a dialog inside the drawer, or a
 * second drawer opening while the first slid out — the last one to leave
 * restored `hidden`, and nothing on screen could undo it. The page then
 * ignored the wheel, the keyboard and the scrollbar until it was reloaded.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** What the page is left with once nothing is on screen. */
async function settled(page: Page) {
  await expect(page.locator('.task-detail-layer')).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(400);
  return page.evaluate(() => ({
    overflow: document.body.style.overflow,
    computed: getComputedStyle(document.body).overflowY,
  }));
}

test('v194 opening one task after another leaves the page scrollable', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'two layouts',
  );
  test.setTimeout(180_000);
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const rows = page.locator('a[href*="task="]');
  expect(await rows.count()).toBeGreaterThan(1);

  // Open one, dismiss it, and open the next before the first has left: the
  // second drawer mounts while the first still holds the lock.
  for (const index of [0, 1, 0]) {
    await rows.nth(index).click();
    await page.locator('.task-detail[data-open="true"]').waitFor({ timeout: 15_000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
  }
  await page
    .locator('.task-detail[data-open="true"]')
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page.keyboard.press('Escape');

  const state = await settled(page);
  expect(state.overflow, 'the page must not be left locked').toBe('');
  expect(state.computed).not.toBe('hidden');
});

test('v194 closing the task window under an open dialog leaves the page scrollable', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The dialog is the same component on a phone.');
  test.setTimeout(180_000);
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  await page.locator('a[href*="task="]').first().click();
  await page.locator('.task-detail[data-open="true"]').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'More task actions' }).first().click();
  await page.getByRole('button', { name: 'Change due date' }).click();
  await page.getByRole('dialog', { name: 'Edit due date' }).waitFor({ timeout: 15_000 });

  /*
   * Close the drawer while the dialog is still up. A person does this by
   * pressing Escape twice quickly, or by clicking Close as the dialog fades;
   * the click is dispatched directly so the race is the test's, not the
   * browser's hit-testing.
   */
  await page
    .locator('.task-detail[data-open="true"]')
    .getByRole('button', { name: /^Close/ })
    .last()
    .dispatchEvent('click');

  const state = await settled(page);
  expect(state.overflow, 'the page must not be left locked').toBe('');
  expect(state.computed).not.toBe('hidden');
});

test('v194 a task opened while the last one is closing stays open', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'two layouts',
  );
  test.setTimeout(180_000);
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const rows = page.locator('a[href*="task="]');

  await rows.nth(0).click();
  await page.locator('.task-detail[data-open="true"]').waitFor({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  // Inside the closing window, where the close used to navigate on top of this.
  await page.waitForTimeout(120);
  const second = await rows.nth(1).getAttribute('href');
  await rows.nth(1).click();

  await page.waitForTimeout(2_500);
  await expect(page.locator('.task-detail[data-open="true"]')).toHaveCount(1);
  expect(page.url()).toContain(second!.split('task=')[1]!.split('&')[0]!);
});

test('v194 pressing the same task again while it closes brings it back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One layout is enough for the race.');
  test.setTimeout(180_000);
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const row = page.locator('a[href*="task="]').first();

  await row.click();
  await page.locator('.task-detail[data-open="true"]').waitFor({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(120);
  await row.click();

  await page.waitForTimeout(2_500);
  await expect(page.locator('.task-detail[data-open="true"]')).toHaveCount(1);
  expect(page.url()).toContain('task=');
});

test('v194 twelve quick open and close rounds leave the page working', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The race is the same on a phone.');
  test.setTimeout(300_000);
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const rows = page.locator('a[href*="task="]');
  const count = await rows.count();
  expect(count).toBeGreaterThan(1);

  for (let round = 0; round < 12; round += 1) {
    await rows.nth(round % count).click();
    await page.locator('.task-detail[data-open="true"]').waitFor({ timeout: 15_000 });
    if (round % 2 === 0) await page.keyboard.press('Escape');
    else
      await page
        .locator('.task-detail[data-open="true"]')
        .getByRole('button', { name: /^Close/ })
        .last()
        .click();
    await page.waitForTimeout(140);
  }

  // The page is still usable: it opens, and it is not left locked.
  await page.waitForTimeout(1_500);
  await rows.nth(0).click();
  await expect(page.locator('.task-detail[data-open="true"]')).toHaveCount(1, { timeout: 15_000 });
  await page.keyboard.press('Escape');
  const state = await settled(page);
  expect(state.overflow, 'the page must not be left locked').toBe('');
});
