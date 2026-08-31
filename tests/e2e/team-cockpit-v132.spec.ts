import { expect, test, type Page } from '@playwright/test';

/**
 * v132 — My Team answers three questions in the order a manager asks them.
 *
 * Who needs me, what is everyone carrying, and what has actually been
 * delivered. Before this the page could answer the first, hinted at the
 * second, and answered the third only as a collapsed list of everything
 * finished in a fixed 31 days — with no way to widen it, so a quarterly
 * conversation had no evidence in the product at all.
 *
 * The other half of the change is what is deliberately NOT here: no score. A
 * single productivity number would have to decide how a Major Project compares
 * with a PPE check, and every answer it could give rewards whoever does the
 * smallest work. Delivery is split by kind so the manager can see what the
 * count is made of.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openTeam(page: Page, query = '') {
  await page.goto(`/work?scope=team${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v132 the snapshot', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await openTeam(page);
  });

  test('is four numbers, and no more', async ({ page }) => {
    const snapshot = page.locator('.team-snapshot');
    await expect(snapshot).toBeVisible();
    // Four. A fifth would be the start of a dashboard, which is not what a
    // manager opened this page for.
    await expect(snapshot.locator('.snapshot-figures li')).toHaveCount(4);
    await expect(snapshot).toContainText('People');
    await expect(snapshot).toContainText('Needs attention');
    await expect(snapshot).toContainText('Available work');
    await expect(snapshot).toContainText('Completed 30 days');
  });

  test('the backlog is reached from the snapshot, not from a tab beside the people views', async ({
    page,
  }) => {
    /*
     * Everyone and Needs attention browse PEOPLE. Team available work browses
     * TASKS, and giving it equal billing made the main way to manage people a
     * list of unstarted work — which says seven items are waiting for somebody
     * and nothing about whether that is a problem.
     */
    const tabs = page.getByRole('navigation', { name: 'Team filter' });
    await expect(tabs.getByRole('link')).toHaveCount(2);
    await expect(tabs.getByRole('link', { name: /available/i })).toHaveCount(0);

    await page
      .locator('.team-snapshot')
      .getByRole('link', { name: /Available work/ })
      .click();
    await expect(page).toHaveURL(/filter=available/);
    await expect(page.locator('.focus-panel')).toContainText('Work waiting to be picked up');
  });

  test('the window is a choice, and it is never all time', async ({ page }) => {
    const windows = page.getByRole('navigation', { name: 'Delivery window' });
    await expect(windows.getByRole('link')).toHaveCount(4);
    await expect(windows.getByRole('link', { name: /all time/i })).toHaveCount(0);
    // Thirty days by default, so the page opens on what is happening now.
    await expect(windows.getByRole('link', { name: '30 days' })).toHaveAttribute(
      'aria-current',
      'true',
    );

    await windows.getByRole('link', { name: '90 days' }).click();
    await expect(page).toHaveURL(/delivery=90/);
    await expect(page.locator('.team-snapshot')).toContainText('Completed 90 days');
  });

  test('the chosen window survives opening a person', async ({ page }) => {
    // Widening to ninety days and then opening somebody should not silently
    // put the question back to thirty.
    await openTeam(page, '&delivery=90');
    await page.getByTestId('my-team-person-row').first().locator('strong').first().click();
    const drawer = page.locator('.team-member-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText('Last 90 days');
  });
});

test.describe('v132 the person drawer', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await openTeam(page);
    // The name, not the centre of the row: on a phone the row is a tall
    // stack of bands and its middle is not a reliable place to press.
    await page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Izzah' })
      .getByText('Izzah Nurul')
      .click();
    await expect(page.locator('.team-member-drawer')).toBeVisible();
  });

  test('reads attention, commitments, delivery, then updates', async ({ page }) => {
    const headings = await page.locator('.team-member-drawer .detail-section h3').allInnerTexts();
    const order = headings.map((text) => text.trim().split('\n')[0]);
    /*
     * Delivery above the update feed, because they answer different
     * questions: a list of edits says somebody has been busy, and what closed
     * says what came of it.
     */
    expect(order.slice(0, 4)).toEqual([
      'Needs your attention',
      'Current commitments',
      expect.stringContaining('Recent delivery'),
      'Recent updates',
    ]);
  });

  test('never renders a null update', async ({ page }) => {
    /*
     * `String(update.body)` turned a null body into the four characters
     * "null", which appeared in the drawer as somebody's most recent
     * meaningful change. System rows carry no body and belong to the audit
     * trail, not to a list headed "what changed".
     */
    const drawer = page.locator('.team-member-drawer');
    await expect(drawer.getByText('null', { exact: true })).toHaveCount(0);
    await expect(drawer.getByText('undefined', { exact: true })).toHaveCount(0);
  });

  test('shows load signals without turning them into a score', async ({ page }) => {
    const drawer = page.locator('.team-member-drawer');
    await expect(drawer.locator('.member-signals').first()).toBeVisible();
    // No percentage, no rating, no "efficiency": every one of those would have
    // to rank a Major Project against a PPE check.
    await expect(drawer.getByText(/efficiency/i)).toHaveCount(0);
    await expect(drawer.getByText(/productivity/i)).toHaveCount(0);
    await expect(drawer.getByText(/score/i)).toHaveCount(0);
  });
});

test('v132 delivery is split by kind, not reported as one number', async ({ page }) => {
  await signIn(page, 'izzul@tamco.local');
  // The widest window, so the fixture has something to show.
  await openTeam(page, '&delivery=year');

  const rows = page.getByTestId('my-team-person-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    await rows.nth(index).locator('strong').first().click();
    const drawer = page.locator('.team-member-drawer');
    await expect(drawer).toBeVisible();
    const delivery = drawer.locator('.detail-section', { hasText: 'Recent delivery' });

    if ((await delivery.locator('.member-delivery-total').count()) > 0) {
      /*
       * The breakdown is the point. Ten routine occurrences are generated by a
       * schedule and closed weekly; one Major Project closes once a quarter; a
       * contribution to somebody else's work never appears in a completion
       * count at all. A bare total ranks the person doing the smallest work
       * highest.
       */
      await expect(delivery.locator('.member-signals').first()).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(drawer).toHaveCount(0);
      return;
    }
    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
  }
  test.skip(true, 'Nobody in this fixture has completed anything this year.');
});
