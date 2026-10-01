import { expect, test, type Page } from '@playwright/test';

/**
 * v235 — the people table is read, not decoded.
 *
 * The row carried eight figures across five columns: overdue, due soon, active,
 * shared steps, overdue shared steps, current work, agreed priorities and the
 * latest update. Two of those columns were mostly absence — "No agreed
 * priorities" and the dash under "Needs you" — so the loudest repeated text in
 * the table said nothing, on every line, about every person.
 *
 * Three columns now, in the order a manager asks: who they are and how much
 * they are carrying; what they are on; and what needs you, with when they were
 * last heard from. The exceptions are in one place instead of split between the
 * first column and the fourth.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function openTeam(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await page.goto('/work?scope=team');
  await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
}

test.describe('v235 three columns', () => {
  test.beforeEach(async ({ page }) => {
    await openTeam(page);
  });

  test('the row holds three things and a chevron, not five', async ({ page }) => {
    const cells = page.getByTestId('my-team-person-row').first().locator('> [data-cell]');
    await expect(cells).toHaveCount(4);
    for (const name of ['person', 'working-on', 'needs-you', 'action']) {
      await expect(
        page.getByTestId('my-team-person-row').first().locator(`> [data-cell="${name}"]`),
      ).toHaveCount(1);
    }
  });

  test('no column repeats an absence down the table', async ({ page }) => {
    /*
     * Both of these were printed on every row that had nothing to report, which
     * is most rows: a column of "No agreed priorities" is a column of nothing,
     * said loudly, in a place a manager cannot act on.
     */
    await expect(page.getByText('No agreed priorities')).toHaveCount(0);
    await expect(page.getByText('No action needed from you')).toHaveCount(0);
  });

  test('the person says how much they carry, and the exceptions say what is wrong', async ({
    page,
  }) => {
    const rows = page.getByTestId('my-team-person-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    let sawException = false;
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      // Load only. Beside "3 active", "15 overdue" read as a fact of the same
      // standing rather than as the one figure that decides anything.
      await expect(row.locator('[data-cell="person"]')).not.toContainText('overdue');
      await expect(row.locator('[data-cell="person"]')).not.toContainText('due within');

      const attention = await row.locator('[data-cell="needs-you"]').innerText();
      // One column, one question: is this person in trouble, and when did they
      // last say anything. The second half must always be answered.
      expect(attention).toMatch(/Updated |No recent activity/);
      if (/overdue|due within/.test(attention)) sawException = true;
    }

    expect(sawException, 'no row in this fixture reported an exception').toBe(true);
  });

  test('an agreed result is stated where there is one, and nowhere else', async ({ page }) => {
    const rows = page.getByTestId('my-team-person-row');
    let sawOne = false;
    for (let index = 0; index < (await rows.count()); index += 1) {
      const agreed = rows.nth(index).locator('[data-cell="next-result"]');
      const found = await agreed.count();
      expect(found, 'an agreed result should appear once on a row, or not at all').toBeLessThan(2);
      if (found === 1) {
        // Named as what it is. Without the label it reads as a second title
        // beside the work they are currently on.
        await expect(agreed).toContainText('Agreed:');
        await expect(agreed).toHaveText(/Agreed:\s*\S/);
        sawOne = true;
      }
    }
    /*
     * Nobody in the seed has an agreed result, so this half is reported rather
     * than demanded: the case that matters is covered end to end by
     * `weekly-priorities-v141`, which agrees one and then reads it off the row.
     * What is asserted here is the half that spec cannot see — that every other
     * row stays silent rather than restating the absence.
     */
    if (!sawOne) {
      test.info().annotations.push({
        type: 'note',
        description: 'No agreed result in the seed; the positive case is v141.',
      });
    }
  });

  test('a screen reader is still told that a quiet row is quiet', async ({ page }) => {
    /*
     * The dash under "Needs you" was removed because sighted readers take the
     * absence of a flag as the answer. A screen reader has no absence to take,
     * so the words are still there, for it alone.
     */
    const quiet = page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Nothing needed from you' });
    expect(await quiet.count()).toBeGreaterThan(0);
    await expect(quiet.first()).toBeVisible();
  });
});
