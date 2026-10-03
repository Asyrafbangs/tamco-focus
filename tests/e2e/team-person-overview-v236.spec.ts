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
  const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Izzah Nurul' });
  await expect(row).toBeVisible();
  await row.locator('[data-cell="person"] strong').click();
  const panel = page.getByTestId('my-team-person-panel');
  await expect(panel).toBeVisible();
  return panel;
}

test.describe('v236 the person opens as an overview', () => {
  test('states the figures and what they are on, before any list', async ({ page }) => {
    const panel = await openPerson(page);

    // The name, so a panel kept open beside another is still identifiable.
    await expect(panel.locator('.team-person-name')).toHaveText('Izzah Nurul');
    // The figures a manager opens somebody to see. Never empty: where there is
    // nothing outstanding it says so rather than printing a row of zeroes.
    await expect(panel.locator('.team-person-figures')).toHaveText(
      /(\d+ (overdue|due within|active|shared|waiting))|Nothing outstanding/,
    );
    // No zeroes: "0 overdue · 0 due soon" is nothing happening, said at length.
    // Bounded, because "10 overdue" is a figure and contains a zero.
    await expect(panel.locator('.team-person-figures')).not.toContainText(/(^|\s)0\s/);

    // What they said they are on, which is a different question from what they
    // have been touching. "Not set" is a real answer to it.
    await expect(panel.getByRole('heading', { name: 'Current focus' })).toBeVisible();
    await expect(panel.locator('.team-person-section').first()).toContainText(
      /Set \S|Not set|Agreed:/,
    );
  });

  test('everything that is a list is folded', async ({ page }) => {
    const panel = await openPerson(page);
    const folded = [
      'week',
      'active',
      'contributions',
      'waiting',
      'routines',
      'completed',
      'activity',
    ];
    for (const section of folded) {
      const details = panel.locator(`.team-person-section[data-section="${section}"]`);
      await expect(details, `${section} is missing from the panel`).toHaveCount(1);
      await expect(details, `${section} starts open`).not.toHaveAttribute('open', '');
      // Folded, but the summary says whether opening it is worth the click.
      await expect(details.locator('summary')).toHaveText(/\S/);
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
