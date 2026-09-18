import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v141 §7 — proposing a week's result, and agreeing it.
 *
 * The whole point is that nothing new is created. "Add to this week" puts work
 * that already exists forward as a result; the employee sees it as Proposed and
 * the manager turns it into an agreement. Delivery is read from the work, so
 * finishing the task is what marks the result delivered.
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

async function openWork(page: Page, query = '') {
  await page.goto(`/work${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('main#main')).not.toContainText('One moment');
  await showActiveWork(page);
}

/*
 * A different person per test.
 *
 * The five viewport projects share one database and an agreed commitment
 * cannot be withdrawn by the employee, so two tests using the same person would
 * depend on which ran first. Lim never has one proposed for him, which is what
 * makes him the honest subject for the empty state.
 */

/** Remove any priority this person has, so a test starts from a known week. */
async function clearWeek(page: Page) {
  await openWork(page);
  for (let guard = 0; guard < 6; guard += 1) {
    const withdraw = page.getByRole('button', { name: 'Withdraw' });
    const remaining = await withdraw.count();
    if (remaining === 0) break;
    await withdraw.first().click();
    /*
     * Wait for the row to go, not for the page to look settled.
     *
     * The button disables itself while the action runs, so a loop that clicks
     * again on the next tick clicks a disabled control and waits 45 seconds to
     * find that out.
     */
    await expect(withdraw).toHaveCount(remaining - 1);
  }
}

test.describe('v141 the employee proposes', () => {
  test('says there are no agreed priorities before any exist', async ({ page }) => {
    await signIn(page, 'lim@tamco.local');
    await openWork(page);
    // §8: "No agreed priorities" — never an invented one, and never a proposal
    // described as an agreement.
    await expect(page.locator('.weekly-priorities')).toContainText('No agreed priorities');
  });

  test('adds existing work to the week without creating a second task', async ({
    page,
  }, testInfo) => {
    // A data mutation, so it runs once. The five viewport projects share one
    // database, and an agreed commitment cannot be withdrawn by the employee —
    // so a second project would start from whatever the first left behind.
    test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');
    await signIn(page, 'izzah@tamco.local');
    await clearWeek(page);
    await openWork(page);

    const row = page.locator('.task-row').first();
    const title = (await row.locator('strong').first().innerText()).trim();
    /*
     * The tab badge, not the visible rows.
     *
     * v146 §9 moved work named as this week's result out of "Other active
     * work" and into the section above it, so the number of ROWS legitimately
     * drops by one. What must not change is how much active work this person
     * has — which is what the badge counts, and what would move if proposing a
     * result had created a second task.
     */
    const activeCount = page.locator('.focus-tabs a[aria-current="page"] .count');
    const before = (await activeCount.innerText()).trim();

    await row.locator('.row-primary-link').first().click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Add to this week' }).click();
    // Saved once the drawer says so; navigating sooner can cancel the save.
    await expect(page.locator('.task-detail-drawer')).toContainText('Proposed for this week');

    await openWork(page);
    const priorities = page.locator('.weekly-priorities');
    await expect(priorities).toContainText(title);
    await expect(priorities).toContainText('Proposed');

    // A priority is a reference, not a new task.
    await expect(activeCount).toHaveText(before);
    // And it is in one place: the section above, not both.
    await expect(page.getByTestId('other-active-work')).not.toContainText(title);

    await clearWeek(page);
  });
});

test.describe('v141 the manager agrees', () => {
  test('turns a proposal into an agreement, and the row then names it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');
    await signIn(page, 'ajmal@tamco.local');
    await clearWeek(page);
    await openWork(page);
    const title = (
      await page.locator('.task-row').first().locator('strong').first().innerText()
    ).trim();
    await page.locator('.task-row').first().locator('.row-primary-link').first().click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Add to this week' }).click();
    // Saved once the drawer says so; navigating sooner can cancel the save.
    await expect(page.locator('.task-detail-drawer')).toContainText('Proposed for this week');
    await openWork(page);
    await expect(page.locator('.weekly-priorities')).toContainText('Proposed');

    await signIn(page, 'izzul@tamco.local');
    await openWork(page, '?scope=team');
    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Ajmal' });
    // A proposal is not an agreement, and the column must not say it is.
    await expect(row.locator('[data-cell="next-result"]')).toContainText('No agreed priorities');

    // Agree it where the work is already being read.
    await row.getByText('Ajmal Rizani').click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(title);
    await panel.getByRole('button', { name: 'Agree' }).first().click();
    await expect(panel.locator('.weekly-priority').filter({ hasText: title })).toContainText(
      'Agreed',
    );

    await openWork(page, '?scope=team');
    await expect(
      page
        .getByTestId('my-team-person-row')
        .filter({ hasText: 'Ajmal' })
        .locator('[data-cell="next-result"]'),
    ).toContainText(title);

    await signIn(page, 'ajmal@tamco.local');
    await openWork(page);
    // The employee sees the agreement immediately, and it says who agreed it
    // rather than implying they confirmed it themselves.
    await expect(page.locator('.weekly-priorities')).toContainText('Agreed');
  });

  test('declining asks for a reason', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');
    await signIn(page, 'amer@tamco.local');
    await clearWeek(page);
    await openWork(page);
    await page.locator('.task-row').first().locator('.row-primary-link').first().click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Add to this week' }).click();
    // Saved once the drawer says so; navigating sooner can cancel the save.
    await expect(page.locator('.task-detail-drawer')).toContainText('Proposed for this week');
    await openWork(page);
    // Confirm the proposal exists before handing over, rather than assuming it:
    // a conditional that quietly did nothing left the manager with no decision
    // to make and the failure looked like a missing button.
    await expect(page.locator('.weekly-priorities')).toContainText('Proposed');

    await signIn(page, 'izzul@tamco.local');
    await openWork(page, '?scope=team');
    await page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Amer' })
      .getByText('Amer Hakim')
      .click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Decline' }).first().click();
    // Declining somebody's plan without saying why is not a decision they can
    // act on, so the reason box appears rather than the action completing.
    await expect(panel.getByLabel('Why not this week?')).toBeVisible();
  });
});
