import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const SAFETY_GOAL = 'f0c06000-0000-4000-a000-000000000001';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function expectNoOverflow(page: Page) {
  const width = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(width.document).toBeLessThanOrEqual(width.viewport + 1);
}

test('Goals is a dedicated accessible workspace with whole-row drawer interaction', async ({
  page,
}) => {
  await signIn(page, 'amer@tamco.local');
  await page.goto('/goals');

  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(
    page.getByText(/Agreed outcomes, visible progress, actionable milestones/),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Goal workspace' }).getByRole('link', {
      name: 'My Goals',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Goals/ }),
  ).toBeVisible();
  const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/\d+% progress/);
  await expect(row).toContainText('Calculated from agreed milestones');
  await expect(row).toContainText(/Needs attention|Update due/);
  await expect(row).not.toContainText(/overall/i);

  for (const view of ['For discussion', 'Completed', 'All', 'Active']) {
    await page
      .getByRole('navigation', { name: 'Goal lifecycle' })
      .getByRole('link', { name: new RegExp(view) })
      .click();
    await expect(page.getByRole('navigation', { name: 'Goal lifecycle' })).toBeVisible();
  }

  const box = await row.boundingBox();
  expect(box).not.toBeNull();
  await row.click({ position: { x: box!.width * 0.45, y: box!.height / 2 } });
  await expect(page).toHaveURL(new RegExp(`goal=${SAFETY_GOAL}`));
  const drawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('tab', { name: 'Overview' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(drawer.getByText('Milestone-based progress:', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Agreed outcome', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Manager expectation', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Update milestone' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(row.locator('.row-primary-link')).toBeFocused();

  await row.locator('.row-primary-link').focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toBeVisible();
  await expectNoOverflow(page);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations).toEqual([]);
});

test('milestone drawer synchronises progress, saves evidence, requests support, and completes', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The data mutation runs once.');
  await signIn(page, 'amer@tamco.local');
  await page.goto(`/goals?goal=${SAFETY_GOAL}&action=update`);

  const drawer = page.locator('.goal-detail-drawer');
  const update = page.getByRole('dialog', { name: /^Update / });
  await expect(update).toBeVisible();
  const slider = update.getByLabel('Milestone progress');
  const percentage = update.getByLabel('Progress percentage');
  await expect(slider).toHaveAttribute('step', '5');
  await slider.fill('65');
  await expect(percentage).toHaveValue('65');
  await percentage.fill('70');
  await expect(slider).toHaveValue('70');
  await expect(update.getByText('New 70%', { exact: true })).toBeVisible();
  await update.getByLabel('What changed?').fill('Completed the next validation walkthrough.');

  const chooserPromise = page.waitForEvent('filechooser');
  await update.locator('label.attachment-picker-button').click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles({
    name: 'milestone-evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('validated milestone evidence'),
  });

  await update.getByText('Add next step or request support').click();
  await update.getByLabel('Next step').fill('Confirm the result with the remaining users.');
  await update.getByLabel('I need support').check();
  await update.getByLabel('Support needed').fill('Please arrange access to the night shift.');
  await update.getByRole('button', { name: 'Save update' }).click();
  await expect(update).toHaveCount(0);
  await expect(drawer.getByText('Milestone update posted.')).toBeVisible();

  await drawer.getByRole('tab', { name: /Milestones/ }).click();
  const current = drawer.locator('.goal-milestone').first();
  await current.locator('.goal-milestone-summary').click();
  const completionUpdate = page.getByRole('dialog', { name: /^Update / });
  await completionUpdate.getByLabel('What changed?').fill('The milestone result was accepted.');
  await completionUpdate.getByLabel('Mark this milestone complete').check();
  await expect(completionUpdate.getByLabel('Progress percentage')).toHaveValue('100');
  await completionUpdate.getByRole('button', { name: 'Save update' }).click();
  await expect(completionUpdate).toHaveCount(0);
  await expect(drawer.getByText('Milestone completed.')).toBeVisible();
  await expect(drawer.locator('details.goal-milestones-done')).toBeVisible();
});

test('manager Team Goals and two-step setup retain the approved master-detail structure', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop manager structure is covered once.');
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/goals?view=team');

  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(page.locator('.team-goal-people')).toBeVisible();
  await expect(page.locator('.team-goal-detail')).toBeVisible();
  await expect(page.getByText('Coaching and alignment', { exact: false })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Goal lifecycle' })).toBeVisible();

  const safety = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await expect(safety).toBeVisible();
  await safety.locator('.row-primary-link').click();
  const drawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
  await expect(drawer.getByText('Support requested').first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Request update' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: /Set up goal/ }).click();
  const setup = page.getByRole('dialog', { name: 'Set a Goal' });
  await expect(setup.getByRole('heading', { name: 'Set the expectation' })).toBeVisible();
  expect(await setup.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expect(setup.getByLabel("Employee's proposed approach")).toBeHidden();
  await setup
    .getByLabel('Employee', { exact: true })
    .selectOption({ label: 'Izzah Nurul · EMP-202' });
  await setup.getByLabel('Expected result').fill('Validate the two-step Goal setup');
  await setup
    .getByLabel('How will success be measured?')
    .fill('The alignment flow completes without ambiguity.');
  await setup
    .getByLabel('Target date')
    .fill(new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  await setup.getByRole('button', { name: 'Continue to discussion' }).click();
  await expect(setup.getByRole('heading', { name: 'Discuss and agree' })).toBeVisible();
  await expect(setup.getByLabel('Milestone result')).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Save for discussion' })).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Agree & activate' })).toBeVisible();
  await setup.getByRole('button', { name: 'Back' }).click();
  await setup.getByText('＋ More context').click();
  await setup.getByLabel('Goal weight (%)').fill('100');
  await setup.getByRole('button', { name: 'Continue to discussion' }).click();
  await expect(setup.getByRole('button', { name: 'Agree & activate' })).toBeDisabled();
  await expect(setup.getByRole('button', { name: 'Save for discussion' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);
});

test('mobile Goals navigation and Team Goals avoid document overflow', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only layout check.');
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/goals?view=team');
  await expect(page.locator('.mobile-nav').getByText('Goals')).toBeVisible();
  await expect(page.locator('.team-goal-people')).toBeVisible();
  await expectNoOverflow(page);

  const firstGoal = page.locator('.goal-row').first();
  await firstGoal.locator('.row-primary-link').click();
  const goalDrawer = page.locator('.goal-detail-drawer');
  await goalDrawer.getByRole('button', { name: 'Update', exact: true }).click();
  const bottomSheet = page.getByRole('dialog', { name: /^Update / });
  const sheetBox = await bottomSheet.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.width).toBeLessThanOrEqual(430);
  expect(Math.abs(sheetBox!.y + sheetBox!.height - 844)).toBeLessThanOrEqual(2);
  await page.keyboard.press('Escape');
  await expect(bottomSheet).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(goalDrawer).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('tamco-focus-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expectNoOverflow(page);

  await page.getByRole('button', { name: /Set up goal/ }).click();
  const setup = page.getByRole('dialog', { name: 'Set a Goal' });
  await expect(setup.getByRole('heading', { name: 'Set the expectation' })).toBeVisible();
  expect(await setup.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expect(setup.getByLabel("Employee's proposed approach")).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);

  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Goals' })).toHaveCount(0);
  await expectNoOverflow(page);

  await page.goto('/work');
  await expect(page.getByRole('heading', { name: 'My Focus' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Workspace' }).getByRole('link', { name: 'Routine' }),
  ).toBeVisible();
});
