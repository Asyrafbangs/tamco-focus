import { expect, test, type Page } from '@playwright/test';

/**
 * v235, as v323 leaves it — the roster is scanned, not decoded.
 *
 * The row carried eight figures across five columns: overdue, due soon, active,
 * shared steps, overdue shared steps, current work, agreed priorities and the
 * latest update. Two of those columns were mostly absence — "No agreed
 * priorities" and the dash under "Needs you" — so the loudest repeated text in
 * the table said nothing, on every line, about every person.
 *
 * v235 cut that to three columns. v323 made the roster a column beside the
 * person being read rather than the width of the page, which takes two of them
 * away again: what somebody is working on and what they agreed to deliver are
 * in the panel, open, the whole time. What a card carries is who they are, how
 * much they are carrying, and what is wrong — and the load is drawn as well as
 * stated, so the busiest person is the widest bar rather than the largest
 * number to read.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function openTeam(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await page.goto('/work?scope=team');
  /*
   * The name is a client button, so a click landing before hydration does
   * nothing at all and the panel simply never appears — which reads as the
   * panel being broken rather than as the test being early.
   */
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
}

test.describe('v323 the roster card', () => {
  test.beforeEach(async ({ page }) => {
    await openTeam(page);
  });

  test('the card holds two things and a chevron, not five', async ({ page }) => {
    const cells = page.getByTestId('my-team-person-row').first().locator('> [data-cell]');
    await expect(cells).toHaveCount(3);
    for (const name of ['person', 'needs-you', 'action']) {
      await expect(
        page.getByTestId('my-team-person-row').first().locator(`> [data-cell="${name}"]`),
      ).toHaveCount(1);
    }
    /*
     * The two that left are in the panel instead, not deleted. A roster column
     * cannot carry a task title and an agreed result at 300px, and it no longer
     * has to: the panel beside it is open while the roster is being read.
     */
    await expect(
      page.getByTestId('my-team-person-row').first().locator('[data-cell="working-on"]'),
    ).toHaveCount(0);
  });

  test('no card repeats an absence down the roster', async ({ page }) => {
    /*
     * Both of these were printed on every row that had nothing to report, which
     * is most rows: a column of "No agreed priorities" is a column of nothing,
     * said loudly, in a place a manager cannot act on.
     */
    await expect(page.getByText('No agreed priorities')).toHaveCount(0);
    await expect(page.getByText('No action needed from you')).toHaveCount(0);
  });

  test('the card says how much they carry, and what is wrong, and when they last spoke', async ({
    page,
  }) => {
    const rows = page.getByTestId('my-team-person-row');
    const count = await rows.count();
    expect(count).toBeGreaterThan(0);

    let sawException = false;
    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      /*
       * Volume only, in the stated figures. "15 overdue" beside "3 active"
       * read as a fact of the same standing rather than as the one figure that
       * decides anything, so the exceptions are chips on the name line with
       * their own colours, and the load line states load.
       */
      const load = await row.locator('[data-cell="load"]').innerText();
      expect(load).not.toMatch(/overdue|due within/);
      expect(load, 'the load line always says how much, even when it is none').toMatch(
        /\d+ (active|shared steps?|waiting)|No open items/,
      );

      /*
       * When they last said anything. Always answered, on every card — it sits
       * on the load line from v324, because the cell beside the name is now
       * the state and the reason, and a timestamp is neither.
       */
      const latest = await row.locator('[data-cell="latest"]').innerText();
      expect(latest).toMatch(/updated |no updates recorded/);

      /*
       * And what is wrong, counted in words. v323 drew it as "3" beside a
       * warning glyph with the words in a title attribute, which left the most
       * important thing on the card as the one thing a manager had to decode.
       */
      const spoken = await row.locator('[data-cell="person"]').innerText({ timeout: 5_000 });
      if (/\d+ overdue|\d+ due within/.test(spoken)) sawException = true;
    }

    expect(sawException, 'no card in this fixture reported an exception').toBe(true);
  });

  test('an agreed result is stated in the panel, and nowhere on the card', async ({ page }) => {
    /*
     * It moved off the card with v323 and is not restated there: the panel
     * carries it under Current focus, where it sits beside what the person
     * actually chose to work on, which is the thing it is an agreement about.
     */
    await expect(page.locator('[data-cell="next-result"]')).toHaveCount(0);

    const row = page.getByTestId('my-team-person-row').first();
    await row.locator('[data-cell="person"] strong').click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();

    const agreed = panel.locator('[data-field="agreed"]');
    const found = await agreed.count();
    expect(found, 'an agreed result should appear once on a panel, or not at all').toBeLessThan(2);
    if (found === 1) {
      // Named as what it is. Without the label it reads as a second title
      // beside the work they are currently on.
      await expect(agreed).toHaveText(/Agreed:\s*\S/);
    } else {
      /*
       * Nobody in the seed has an agreed result, so this half is reported
       * rather than demanded: the case that matters is covered end to end by
       * `weekly-priorities-v141`, which agrees one and then reads it back.
       */
      test.info().annotations.push({
        type: 'note',
        description: 'No agreed result in the seed; the positive case is v141.',
      });
    }
  });

  test('a quiet card says so in words everybody gets', async ({ page }) => {
    /*
     * The dash under "Needs you" went in v235 because sighted readers take the
     * absence of a flag as the answer, and a screen reader was given the words
     * in a hidden span instead. v324 made the state a real label on every
     * card, so both readers get the same sentence and the hidden one is gone
     * rather than merely redundant.
     */
    const quiet = page.getByTestId('my-team-person-row').filter({ hasText: 'No issues flagged' });
    expect(await quiet.count()).toBeGreaterThan(0);
    await expect(quiet.first().locator('[data-cell="state"]')).toBeVisible();
    await expect(page.getByText('Nothing needed from you')).toHaveCount(0);
  });
});
