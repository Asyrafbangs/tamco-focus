import { expect, test, type Page } from '@playwright/test';

/**
 * v236 — opening a person gives an overview, not an application.
 *
 * The panel opened straight into eight sections: priorities, other active work,
 * contributions, not started, routines, completed and the update feed, all
 * expanded or half-expanded. A manager comparing two people was reading a page
 * each, which is the opposite of why the expansion exists.
 *
 * It now opens on the figures and what the person said they are working on.
 * Everything else is still here, in the same order, one click down.
 *
 * Two words also changed, because they had drifted from the tabs above them:
 * the panel said "Not started" where the tab has said Waiting since v233, and
 * "Recent updates" where the tab has said Recent activity since v232.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function openPerson(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await page.goto('/work?scope=team');
  /*
   * The name is a button that expands the panel in the client, so a click
   * landing before hydration does nothing at all and the panel simply never
   * appears. Inside the full suite the server and the browser cache are warm
   * enough that it happened to work; running this file on its own failed every
   * time, which is the same bug either way.
   */
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Izzah Nurul' });
  await expect(row).toBeVisible();
  await row.locator('[data-cell="person"] strong').click();
  const panel = page.getByTestId('my-team-person-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('v236 the person opens as an overview', () => {
  test('states six figures, in six fixed cells, in one fixed order', async ({ page }) => {
    const panel = await openPerson(page);

    // The name, so a panel held beside another is still identifiable.
    await expect(panel.locator('.team-person-name')).toHaveText('Izzah Nurul');

    /*
     * v236 wrote these as a sentence with the zeroes left out, on the argument
     * that "0 overdue · 0 due soon" is nothing happening said at length. That
     * is true of one person read alone and false of two read side by side,
     * which is what the panel is for since v323: a sentence that changes
     * length and order with its contents makes the reader count words instead
     * of comparing figures.
     *
     * So the cells are fixed, and the assertion is that they are — in order,
     * all five, every one of them a number.
     */
    const stats = panel.getByTestId('team-person-stats');
    await expect(stats.locator('.team-person-stat')).toHaveCount(6);
    expect(
      await stats
        .locator('.team-person-stat')
        .evaluateAll((cells) => cells.map((cell) => cell.getAttribute('data-stat'))),
    ).toEqual(['overdue', 'soon', 'active', 'shared', 'waiting', 'completed']);
    /*
     * Five measures of load and risk and one of output. Without the last one
     * two people read side by side can be compared on what they are carrying
     * and not on what they are getting done, which is half the question.
     */
    await expect(stats.locator('.team-person-stat[data-stat="completed"] dt')).toHaveText(
      /^Done, /,
    );
    for (const value of await stats.locator('dd').allInnerTexts()) {
      expect(value.trim(), 'every cell carries a figure, zero included').toMatch(/^\d+$/);
    }
    /*
     * And the ones worth acting on are the ones that are not zero, which is
     * what the tone says. Izzah is overdue in this seed, so the positive case
     * is real rather than skipped.
     */
    await expect(stats.locator('.team-person-stat[data-stat="overdue"]')).toHaveAttribute(
      'data-tone',
      'alert',
    );

    // What they said they are on, which is a different question from what they
    // have been touching. "Not set" is a real answer to it.
    await expect(panel.getByRole('heading', { name: 'Current focus' })).toBeVisible();
    await expect(panel.locator('.team-person-section[aria-labelledby$="-focus"]')).toContainText(
      /Set \S|Not set|Agreed:/,
    );
  });

  test('the reading is open and the reference is folded', async ({ page }) => {
    const panel = await openPerson(page);

    /*
     * v236 folded all seven, because the panel was an expansion inside the
     * roster and six open sections pushed the next person off the screen. The
     * panel has its own column since v323, so the thing that cost height costs
     * nothing — and "a lot of things are hidden" is the complaint that started
     * that change.
     *
     * What the person has agreed for the week and what they are carrying are
     * the reading, so they are open wherever there is anything in them. The
     * five below are the reference, and stay folded.
     */
    /*
     * v324 folded the active list again: open, it repeated the tasks that
     * "Work needs attention" had just listed directly above it.
     */
    await expect(panel.locator('.team-person-section[data-section="active"]')).not.toHaveAttribute(
      'open',
      '',
    );

    for (const section of ['week']) {
      const details = panel.locator(`.team-person-section[data-section="${section}"]`);
      await expect(details, `${section} is missing from the panel`).toHaveCount(1);
      const count = Number(
        ((await details.locator('.team-person-count').first().innerText()) ?? '0').trim(),
      );
      if (count > 0) {
        await expect(details, `${section} holds ${count} and starts folded`).toHaveAttribute(
          'open',
          '',
        );
      } else {
        /*
         * A heading, a count of zero and an empty box are three statements of
         * the same nothing, so an empty section stays shut.
         */
        await expect(details, `${section} is empty and starts open`).not.toHaveAttribute(
          'open',
          '',
        );
      }
    }

    const folded = ['contributions', 'waiting', 'routines', 'completed', 'activity'];
    for (const section of folded) {
      /* Absent is the other correct answer from v324: a section with nothing
         in it is named in the sentence below rather than shut in a drawer. */
      if ((await panel.locator(`.team-person-section[data-section="${section}"]`).count()) === 0) {
        await expect(panel.getByTestId('team-person-tail-empty')).toContainText(/\S/);
        continue;
      }
      const details = panel.locator(`.team-person-section[data-section="${section}"]`);
      await expect(details, `${section} is missing from the panel`).toHaveCount(1);
      await expect(details, `${section} starts open`).not.toHaveAttribute('open', '');
      /*
       * Folded, but the summary says whether opening it is worth the click.
       *
       * The section's own summary, not any summary inside it: Other active work
       * puts everything past the fifth row behind a "Show N more" fold of its
       * own, so an unscoped locator matches two elements as soon as somebody
       * has six. It did not until v261, because `evidence-upload-v135` had been
       * quietly completing two of Izzah's active tasks before this ran.
       */
      await expect(details.locator('> summary')).toHaveText(/\S/);
    }
  });

  test('calls the same work by the same name as the tabs above it', async ({ page }) => {
    /*
     * The panel said "Not started" while the tab said Waiting, and "Recent
     * updates" while the tab said Recent activity. One set of work under two
     * names is two things to anybody who has not read the code.
     */
    const panel = await openPerson(page);
    await expect(
      panel.locator('.team-person-section[data-section="waiting"] > summary'),
    ).toContainText('Waiting');
    await expect(
      panel.locator('.team-person-section[data-section="activity"] > summary'),
    ).toContainText('Recent activity');
    await expect(panel.getByText('Not started', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('Recent updates', { exact: true })).toHaveCount(0);
  });

  test('says where the rest of this person’s work is', async ({ page }) => {
    const panel = await openPerson(page);
    const exit = panel.locator('.team-person-exit a');
    await expect(exit).toHaveText(/View full work/);
    await exit.click();
    // Records is the surface that can filter, sort and go back further than an
    // expansion should try to.
    await expect(page).toHaveURL(/\/more\/records\?owner=/);
  });
});

test.describe('v236 the Recent activity tab carries its figure', () => {
  test('and the figure is the number of cards the tab shows', async ({ page }) => {
    /*
     * The badge was left off because a count there costs a query on every
     * other tab. It is wanted, so it is counted the only way that can be
     * right: merge keys rather than audit rows. One person on one task for an
     * afternoon is one card on that tab, and a badge saying six would be
     * counting something nobody can see.
     */
    await page.goto('/sign-in');
    await page.getByLabel('Email address').fill('izzul@tamco.local');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });

    await page.goto('/work?scope=team');
    const tab = page
      .getByRole('navigation', { name: 'Team views' })
      .getByRole('link', { name: /Recent activity/ });
    await expect(tab).toBeVisible();
    const badge = Number((await tab.innerText()).replace(/[^0-9]/g, '') || '0');

    await page.goto('/work?scope=team&filter=updates');
    await expect(page.locator('.team-activity')).toBeVisible();
    expect(await page.locator('.team-activity-row').count()).toBe(badge);
  });
});
