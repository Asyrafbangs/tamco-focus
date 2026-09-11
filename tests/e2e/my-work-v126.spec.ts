import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v126 — My Work shows enough to choose a row, and nothing else.
 *
 * The row had grown to carry the title, the work class, a steps sentence, an
 * open age, an in-state age, a status label, a due date, a progress bar, the
 * same step count again in a different format, an Open button and Move out.
 * Inside the Active tab every row also announced "Active"; "Open 12h" sat
 * beside a button labelled Open. None of it helped anybody decide which row to
 * open, and because everything shouted, the overdue work looked exactly like
 * the rest.
 *
 * These assert the absences, because that is what the change is: what a row
 * must no longer say, and what may only appear when something is genuinely
 * wrong.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v126 the work row is quiet until something is wrong', () => {
  test('no Open button, no Move out, no repeated status on the rows', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work');
    await showActiveWork(page);
    await expect(page.locator('.task-row').first()).toBeVisible();

    const rows = page.locator('.task-row');
    // The whole row opens the task, so a button that does the same is one
    // control too many — and it was called Open, next to a chip reading
    // "Open 12h".
    await expect(rows.getByRole('link', { name: /^Open$/ })).toHaveCount(0);
    // Moving work out is administration; it lives in the task's ••• menu.
    await expect(page.getByRole('button', { name: 'Move out' })).toHaveCount(0);
    // Inside the Active tab, every row saying "Active" adds nothing.
    await expect(rows.locator('.status')).toHaveCount(0);
    // The step count appeared twice, once as a sentence and once as a bar.
    await expect(rows.locator('.progress')).toHaveCount(0);
    await expect(page.getByText(/^Steps \d+\/\d+ complete$/)).toHaveCount(0);
  });

  test('overdue work sorts to the top on its own', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work');
    await showActiveWork(page);
    await expect(page.locator('.task-row').first()).toBeVisible();

    /*
     * Automatic, not a sort control: nobody should have to configure a list to
     * find the work that has already slipped.
     */
    const flags = await page.locator('.task-row').first().locator('.row-flag').allInnerTexts();
    const overdueRows = await page
      .locator('.task-row', { has: page.locator('.row-flag.red') })
      .count();
    if (overdueRows > 0) {
      expect(flags.join(' '), 'the first row is not the overdue one').toMatch(/Overdue/);
    }
  });

  test('a count of zero is not shown at all', async ({ page }) => {
    // Somebody with an empty workspace: six counters all reading 0 make it
    // look like a broken dashboard rather than a clear day.
    await signIn(page, 'izzul@tamco.local');

    for (const route of ['/work', '/work/routine']) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      // v130 — scope and work type are two controls with two labels now
      // ("Work scope" and "Work type"), so this asks the component rather than
      // one of the two names.
      const badges = await page.locator('nav.workspace-tabs .count').allInnerTexts();
      expect(badges, `${route} shows a zero badge`).not.toContain('0 active');
      expect(badges, `${route} shows a "none due" badge`).not.toContain('none due');
      await expect(page.locator('.focus-tabs .count', { hasText: /^0$/ })).toHaveCount(0);
    }
  });

  test('the empty Focus state never sends you to another empty tab', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work');

    const empty = page.locator('.empty-state');
    await expect(empty).toContainText('No active work right now');
    /*
     * With nothing in Available, "View Available" walked people from one empty
     * page to another — past a tab already reading Available 0.
     */
    await expect(empty.getByRole('link', { name: /View Available/ })).toHaveCount(0);
    await expect(empty.getByRole('link', { name: /New Work/ })).toBeVisible();
  });

  test('the Routine empty state does not offer New Work', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work/routine');

    const empty = page.locator('.empty-state').first();
    await expect(empty).toBeVisible();
    /*
     * New Work does not create a schedule, so offering it here invited people
     * to make a task and wonder why no routine ever appeared.
     */
    await expect(empty.getByRole('link', { name: /^New Work$/ })).toHaveCount(0);
    await expect(empty).not.toContainText('Occurrences are created from the routines above');
  });

  test('Due now says what it holds, and the schedules are not "management"', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work/routine');

    // The old label promised the week; its own description said overdue or
    // today. The description was the honest one.
    await expect(page.locator('.focus-tabs')).toContainText('Due now');
    await expect(page.getByText('Due now / this week')).toHaveCount(0);
    await expect(page.locator('.routine-manage summary')).toHaveText('Routine schedules');
  });
});
