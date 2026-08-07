import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function expectHydrated(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function signIn(page: Page, email = 'izzah@tamco.local') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|plan|more|team)/);
  await expectHydrated(page);
}

async function attachViewport(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    body: await page.screenshot({ animations: 'disabled', fullPage: false }),
    contentType: 'image/png',
  });
}

async function expectNoDocumentOverflow(page: Page, path: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.document,
    `${path} causes document-level horizontal scrolling`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('main employee surfaces retain prototype structure at every required viewport', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await signIn(page);

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect(page.locator('.today-grid')).toBeVisible();
  await attachViewport(page, testInfo, 'today');
  await expectNoDocumentOverflow(page, '/today');

  for (const tab of ['major', 'operational', 'self_development', 'shared', 'available']) {
    await page.goto(`/work?tab=${tab}`);
    await expect(page.locator('.focus-tabs a.active')).toHaveAttribute('href', `/work?tab=${tab}`);
    await expect(page.locator('.focus-panel')).toBeVisible();
    await attachViewport(page, testInfo, `work-${tab}`);
    await expectNoDocumentOverflow(page, `/work?tab=${tab}`);
  }

  await page.goto('/work/routine');
  await expect(page.getByRole('heading', { name: 'Routine' })).toBeVisible();
  await attachViewport(page, testInfo, 'routine');
  await expectNoDocumentOverflow(page, '/work/routine');

  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();
  await expect(page.locator('.goal-list-panel')).toBeVisible();
  await attachViewport(page, testInfo, 'goals');
  await expectNoDocumentOverflow(page, '/goals');

  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
  await expect(page.locator('.calendar, .empty-state').first()).toBeVisible();
  await attachViewport(page, testInfo, 'plan');
  await expectNoDocumentOverflow(page, '/plan');

  await page.goto('/more/records');
  await expect(page.getByRole('heading', { name: 'Records and completion review' })).toBeVisible();
  await expect(page.locator('.record-list')).toBeVisible();
  await attachViewport(page, testInfo, 'records');
  await expectNoDocumentOverflow(page, '/more/records');

  await page.goto('/more/settings');
  await expect(page.getByRole('heading', { name: 'Team rules and my preferences' })).toBeVisible();
  await expect(page.locator('.settings-shell')).toBeVisible();
  await attachViewport(page, testInfo, 'settings');
  await expectNoDocumentOverflow(page, '/more/settings');
  await expectHydrated(page);

  await page.getByRole('button', { name: 'Switch to Night mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkTokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue('--bg').trim(), style.getPropertyValue('--surface').trim()];
  });
  expect(darkTokens).toEqual(['#0d1420', '#151f2d']);
  await attachViewport(page, testInfo, 'settings-dark');

  expect(consoleErrors).toEqual([]);
});

test('manager Team view uses compact RLS-authorised workload rows', async ({ page }, testInfo) => {
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/team');
  await expect(page.getByRole('heading', { name: 'Team Load' })).toBeVisible();
  await expect(page.locator('.member-card').first()).toBeVisible();
  await expect(page.locator('.member-focus-grid').first()).toBeVisible();
  await expect(page.locator('.member-task-row').first()).toBeVisible();
  await attachViewport(page, testInfo, 'team');
  await expectNoDocumentOverflow(page, '/team');
});

test('rows, nested actions, drawers, checklist evidence, tabs and calendar are independent', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Interaction mutation/restore runs once.');
  await signIn(page);

  await page.goto('/work?tab=operational');
  await expectHydrated(page);
  const firstRow = page.locator('.task-row').first();
  await expect(firstRow).toBeVisible();
  const rowHref = await firstRow.locator('.row-primary-link').getAttribute('href');
  const box = await firstRow.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height / 2);
  await expect(page).toHaveURL(new RegExp(rowHref!.replace(/[?]/g, '\\?')));

  const drawer = page.locator('.task-detail');
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => getComputedStyle(element).transitionDuration)).not.toBe(
    '0s',
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await expect(firstRow.locator('.row-primary-link')).toBeFocused();

  await firstRow.locator('.row-primary-link').focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('tab', { name: /Checklist/ }).click();
  const requiredItem = drawer.locator('.checklist-item').filter({ hasText: 'Evidence required' });
  await expect(requiredItem.getByRole('button', { name: 'Complete' })).toBeDisabled();
  const chooserPromise = page.waitForEvent('filechooser');
  await requiredItem.locator('label.attachment-picker-button').click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);

  const optionalItem = drawer.locator('.checklist-item').filter({ hasText: 'Evidence optional' });
  await optionalItem.getByRole('button', { name: 'Complete' }).click();
  await expect(optionalItem.getByRole('button', { name: 'Reopen' })).toBeVisible();
  await optionalItem.getByRole('button', { name: 'Reopen' }).click();
  await expect(optionalItem.getByRole('button', { name: 'Complete' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/work?tab=available');
  await expectHydrated(page);
  const availableRow = page.locator('.task-row').first();
  await expect(availableRow).toBeVisible();
  await availableRow.getByRole('button', { name: 'Activate' }).click();
  await expect(page.locator('.task-detail')).toHaveCount(0);
  const reasonModal = page.getByRole('dialog', { name: 'Over focus target' });
  const undo = page.getByRole('button', { name: 'Undo' });
  if (await reasonModal.isVisible()) {
    await page.keyboard.press('Escape');
    await expect(reasonModal).toBeHidden();
  } else {
    await expect(undo).toBeVisible();
    await undo.focus();
    await page.keyboard.press('Enter');
  }

  await page.goto('/plan');
  await expectHydrated(page);
  const calendarItems = page.locator('.cal-item');
  if ((await calendarItems.count()) > 0) {
    const item = calendarItems.first();
    const taskHref = await item.getAttribute('href');
    await item.click();
    await expect(page).toHaveURL(new RegExp(taskHref!.replace(/[?]/g, '\\?')));
    await expect(page.locator('.task-detail')).toBeVisible();
    await page.keyboard.press('Escape');
  }

  await page.goto('/more/settings');
  await expectHydrated(page);
  await page.getByRole('button', { name: /Accessibility/ }).click();
  await expect(page.getByLabel('Text size')).toBeVisible();
  await page.getByLabel('Text size').selectOption('large');
  await expect(page.getByText(/unsaved section/)).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText(/unsaved section/)).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedDuration = await page
    .locator('.settings-nav-row')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(['0.01ms', '1e-05s']).toContain(reducedDuration);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('mobile navigation and full-width drawer retain keyboard-sized controls', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only interaction contract.');
  await signIn(page);
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.goto('/work?tab=operational');
  await expectHydrated(page);
  await page.locator('.task-row').first().locator('.row-primary-link').click();
  const drawer = page.locator('.task-detail');
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(390);
  await expectNoDocumentOverflow(page, 'mobile task drawer');
});
