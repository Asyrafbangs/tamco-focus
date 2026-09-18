import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v140 §8 — the employee says what they are working on, and the manager reads
 * the statement rather than a guess.
 *
 * My Team inferred it from whichever Active task had been touched most
 * recently. That column could never be empty and never be wrong, which is
 * another way of saying it never quite meant anything. "Not set" is now a real
 * answer, and the date shown is when the person said so — not when something
 * was last edited.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openWork(page: Page, query = '') {
  await page.goto(`/work${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('main#main')).not.toContainText('One moment');
  // §9 collapses the Active list once a current focus is set, which is exactly
  // what half of this file does before reaching for a row.
  await showActiveWork(page);
}

/**
 * Sign in as somebody else in the same browser.
 *
 * Going straight to /sign-in while a session is live lands on /today instead,
 * so the cookies go first. The five viewport projects share one database, so a
 * test that depends on who ran before it is a test that passes on ordering.
 */
async function switchTo(page: Page, email: string) {
  await page.context().clearCookies();
  await signIn(page, email);
}

/** Put a person back to "not set", whatever the previous test left behind. */
async function clearFocus(page: Page) {
  await openWork(page);
  const summary = page.locator('.working-on-summary');
  if ((await summary.innerText()).includes('Not set')) return;
  const link = summary.locator('.row-primary-link');
  await link.click();
  const drawer = page.locator('.task-detail-drawer');
  await expect(drawer).toBeVisible();
  await page.getByRole('button', { name: /Working on this . Clear/ }).click();
  // The save is on its way until the drawer says so; navigating before then
  // cancels it in the browser (seen in a v195 full run: the POST was aborted
  // 17ms after it left, and the focus was never cleared).
  await expect(drawer.getByRole('button', { name: 'Set as working on' })).toBeVisible();
  await openWork(page);
  await expect(summary).toContainText('Not set');
}

/** Claim the first started task, and return what it is called. */
async function claimFirstActive(page: Page): Promise<string> {
  await openWork(page);
  const row = page.locator('.task-row').first();
  const title = (await row.locator('strong').first().innerText()).trim();
  await row.locator('.row-primary-link').first().click();
  const drawer = page.locator('.task-detail-drawer');
  await expect(drawer).toBeVisible();
  await drawer.getByRole('button', { name: 'Set as working on' }).click();
  await expect(drawer.getByRole('button', { name: /Working on this/ })).toBeVisible();
  return title;
}

test.describe('v140 the employee sets it', () => {
  test('says "Not set" until somebody says otherwise', async ({ page }) => {
    await signIn(page, 'ajmal@tamco.local');
    await openWork(page);
    // No invented selection: §24.3 says existing users start with none.
    await expect(page.locator('.working-on-summary')).toContainText('Not set');
  });

  test('records the choice, shows it above Active, and clears again', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await clearFocus(page);

    const title = await claimFirstActive(page);

    await openWork(page);
    const summary = page.locator('.working-on-summary');
    await expect(summary).toContainText(title);
    await expect(summary).not.toContainText('Not set');

    /*
     * And it can be taken back — through the summary's own link, not through
     * whichever row happens to be first. Active is ordered by what is most
     * overdue, so "the first row" is not reliably the work that was chosen.
     */
    await clearFocus(page);
  });

  test('is not offered on work nobody has started', async ({ page }) => {
    /*
     * §8: an Available task is started first. The control is absent rather than
     * present-and-refusing, because the answer is "start it", not "you may not".
     */
    await signIn(page, 'ajmal@tamco.local');
    await openWork(page, '?tab=available');
    const row = page.locator('.task-row').first();
    if ((await row.count()) === 0) test.skip(true, 'This fixture has no Available work.');
    await row.locator('.row-primary-link').first().click();

    const drawer = page.locator('.task-detail-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('button', { name: 'Set as working on' })).toHaveCount(0);
  });
});

test.describe('v140 the manager reads it', () => {
  test('shows "Not set" rather than the most recently touched task', async ({ page }) => {
    // Establish the state rather than inherit it: Izzah has several Active
    // items and has chosen none of them. The old column named one anyway.
    await signIn(page, 'izzah@tamco.local');
    await clearFocus(page);

    await switchTo(page, 'izzul@tamco.local');
    await openWork(page, '?scope=team');
    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Izzah' });
    await expect(row.locator('[data-cell="working-on"]')).toContainText('Not set');
  });

  test('names the chosen work once it has been chosen', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await clearFocus(page);
    const title = await claimFirstActive(page);

    await switchTo(page, 'izzul@tamco.local');
    await openWork(page, '?scope=team');
    const cell = page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Izzah' })
      .locator('[data-cell="working-on"]');
    await expect(cell).toContainText(title);
    // When it was said, not how long ago something moved.
    await expect(cell).toContainText(/Set /);

    // Leave the fixture as it was found.
    await switchTo(page, 'izzah@tamco.local');
    await clearFocus(page);
  });
});
