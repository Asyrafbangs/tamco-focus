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
  /*
   * No workspace tablist for somebody without reports.
   *
   * It held a single tab, "My Goals", which selects the page it is already on —
   * a full row of vertical space restating the heading above it. Together with
   * the intro banner and the session panel it pushed the first goal to roughly
   * 690px down a 768px laptop screen, so the page about goals showed almost no
   * goals. A manager still gets the tablist, because they have somewhere to go;
   * that is asserted in the team test below.
   */
  await expect(page.getByRole('navigation', { name: 'Goal workspace' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Goals/ }),
  ).toBeVisible();
  await page.getByRole('button', { name: '+ New goal' }).click();
  const selfSetup = page.getByRole('dialog', { name: 'Set a Goal' });
  await expect(selfSetup.getByLabel('Employee', { exact: true })).toHaveCount(0);
  await expect(selfSetup.getByLabel('Measure type')).toHaveCount(0);
  await expect(selfSetup.getByLabel('Target state')).toHaveCount(0);
  await expect(selfSetup.getByLabel('Period')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await expect(row).toBeVisible();
  await expect(row).toContainText(/success measure/);
  await expect(row).not.toContainText(/\d+% progress/);
  await expect(row).toContainText(/Needs attention|Update due/);
  await expect(row).not.toContainText(/overall/i);

  for (const view of ['Draft', 'Completed', 'Active']) {
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
  await expect(drawer.getByRole('tab', { name: 'Success' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(drawer.getByText('Success comes first.', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Success measures' })).toBeVisible();
  await expect(drawer.getByText('Agreed outcome', { exact: true })).toBeVisible();
  await expect(drawer.getByText('Success measures', { exact: true }).last()).toBeVisible();
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
  await page.goto(`/goals?goal=${SAFETY_GOAL}`);

  const drawer = page.locator('.goal-detail-drawer');
  await drawer.getByRole('tab', { name: /Milestones/ }).click();
  await drawer
    .locator('.goal-milestone:not(.completed)')
    .first()
    .locator('.goal-milestone-summary')
    .click();
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
  await update.getByRole('button', { name: 'Add evidence', exact: true }).click();
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
  // Completed milestones collapse into <details class="goal-milestones-done">,
  // so a bare .first() can land on one that is not expanded and never becomes
  // clickable. Target the current milestone explicitly.
  const current = drawer.locator('.goal-milestone:not(.completed)').first();
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

test('owner completes one monthly employee session without creating an approval', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The monthly mutation runs once.');
  await signIn(page, 'amer@tamco.local');
  await page.goto('/goals');

  /*
   * The performance period now sits below the goals, folded shut.
   *
   * It is a once-a-month action that was occupying about 180px above the list
   * on every single visit, which is most of why the first goal sat near the
   * bottom of a laptop screen. The summary line still states the position, so
   * opening it is one click rather than a hunt.
   */
  await page.locator('.goal-session-disclosure > summary').click();

  const panel = page.getByRole('region', { name: /Performance Period|Goal plan/ });
  await expect(panel.getByText('Monthly Goal session')).toBeVisible();
  await panel.getByRole('button', { name: 'Start monthly session' }).click();
  const session = page.getByRole('dialog', { name: /Monthly Goal session/ });
  await expect(session.getByText(/normal update needs no approval/i)).toBeVisible();
  await session.getByRole('button', { name: 'Complete month' }).click();
  await expect(session).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Month complete' })).toBeDisabled();
  await expect(panel.getByText(/approve|reject/i)).toHaveCount(0);
});

test('manager My Team and two-step setup retain the approved master-detail structure', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop manager structure is covered once.');
  await signIn(page, 'izzul@tamco.local');

  await page.goto('/work?scope=team&filter=attention');
  const goalAttention = page
    .getByTestId('my-team-person-row')
    .filter({ hasText: 'Goal support needed' });
  // Direct children only: v130 put a tone dot inside the headline chip, so a
  // descendant selector's second span is now that dot rather than the reason.
  await expect(goalAttention.locator('[data-cell="needs-you"] > span').nth(1)).toHaveText(/\S/);
  await goalAttention.getByRole('button', { name: /Review goal for Amer Hakim/ }).click();
  await expect(page).toHaveURL(new RegExp(`goal=${SAFETY_GOAL}`));
  expect(new URL(page.url()).searchParams.has('action')).toBe(false);
  const goalDrawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
  await expect(goalDrawer.getByRole('button', { name: 'Resolve support' }).first()).toBeVisible();

  await page.goto('/goals?view=team');

  await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();
  await expect(page.locator('.team-goal-people')).toBeVisible();
  await expect(page.locator('.team-goal-detail')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Goal workspace' }).getByRole('link', { name: 'My Team' }),
  ).toBeVisible();
  await expect(page.getByText('Coaching and alignment', { exact: false })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Goal lifecycle' })).toBeVisible();

  const safety = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await expect(safety).toBeVisible();
  await safety.locator('.row-primary-link').click();
  const drawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
  await expect(drawer.getByText('Support requested').first()).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Request update' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.getByRole('button', { name: '+ Add goal' }).click();
  const setup = page.getByRole('dialog', { name: 'Set a Goal' });
  await expect(setup.getByRole('heading', { name: 'Set the expectation' })).toBeVisible();
  expect(await setup.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expect(setup.getByLabel('Employee', { exact: true })).toHaveCount(0);
  await expect(setup.getByLabel('Agreed approach')).toBeHidden();
  await setup
    .getByLabel('What result should be achieved?')
    .fill('Validate the two-step Goal setup');
  await setup.getByLabel('Success measure 1').fill('The alignment flow completes clearly.');
  await setup.getByLabel('Formal weight').fill('10');
  await setup
    .getByLabel('Target date')
    .fill(new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10));
  await setup.getByRole('button', { name: 'Continue to discussion' }).click();
  await expect(setup.getByRole('heading', { name: 'Discuss and agree' })).toBeVisible();
  await expect(setup.getByLabel('Milestone result')).toHaveCount(0);
  await setup.getByRole('button', { name: '+ Add milestone' }).click();
  await expect(setup.getByLabel('Milestone result')).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Save for discussion' })).toBeVisible();
  await expect(setup.getByRole('button', { name: 'Agree & activate' })).toBeVisible();
  await setup.getByRole('button', { name: 'Back' }).click();
  await setup.getByLabel('Formal weight').fill('100');
  await setup.getByRole('button', { name: 'Continue to discussion' }).click();
  await expect(setup.getByRole('button', { name: 'Agree & activate' })).toBeDisabled();
  await expect(setup.getByRole('button', { name: 'Save for discussion' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);
});

test('manager sees the lean Major Project discussion and its three explicit decisions', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Desktop decision drawer is covered once.');
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/work?scope=team');

  const inbox = page.getByRole('region', { name: 'Major Projects for discussion' });
  await expect(inbox).toContainText('Introduce a permit-to-work system across both sites');
  await inbox
    .getByRole('link', { name: /Review Major Project proposal Introduce a permit-to-work/ })
    .click();
  const drawer = page.getByRole('dialog', { name: /Introduce a permit-to-work/ });
  await expect(drawer.getByRole('button', { name: 'Agree' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Request changes' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Decline' })).toBeVisible();
  await expect(drawer).toContainText(/creates one Major Project in Available/i);
});

test('mobile Goals navigation and My Team avoid document overflow', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only layout check.');
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/goals?view=team');
  await expect(page.locator('.mobile-nav').getByText('Goals')).toBeVisible();
  await expect(page.locator('.team-goal-people')).toBeVisible();
  await expectNoOverflow(page);

  const firstGoal = page.locator('.goal-row').first();
  await firstGoal.locator('.row-primary-link').click();
  const goalDrawer = page.locator('.goal-detail-drawer');
  await goalDrawer.getByRole('button', { name: 'Sessions', exact: true }).click();
  await expect(goalDrawer.getByRole('tab', { name: 'Sessions' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(goalDrawer.getByRole('heading', { name: 'Goal session record' })).toBeVisible();
  await expectNoOverflow(page);
  await page.keyboard.press('Escape');
  await expect(goalDrawer).toHaveCount(0);

  await page.evaluate(() => localStorage.setItem('tamco-focus-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // `data-theme` is written by an inline script before hydration, so asserting
  // it proves the page painted, not that React has wired anything up. Clicking
  // on that signal alone races hydration and the handler never fires. Wait for
  // the hydration flag the app sets itself.
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expectNoOverflow(page);

  await page.getByRole('button', { name: '+ Add goal' }).click();
  const setup = page.getByRole('dialog', { name: 'Set a Goal' });
  await expect(setup.getByRole('heading', { name: 'Set the expectation' })).toBeVisible();
  expect(await setup.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expect(setup.getByLabel('Employee', { exact: true })).toHaveCount(0);
  await expect(setup.getByLabel('Agreed approach')).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(setup).toHaveCount(0);

  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'My Goals' })).toHaveCount(0);
  await expectNoOverflow(page);

  await page.goto('/work');
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Work type' }).getByRole('link', { name: 'Routine' }),
  ).toBeVisible();
});
