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

  test('offers three views of the team and no card row above them', async ({ page }) => {
    /*
     * v132 put four figures here — People / Needs attention / Available work /
     * Completed — and section 3 of the change specification supersedes them:
     * that card row became the central navigation, which is a dashboard in
     * front of the list a manager came to read.
     */
    await expect(page.locator('.team-snapshot')).toHaveCount(0);

    const views = page.getByRole('navigation', { name: 'Team views' });
    await expect(views.getByRole('link')).toHaveCount(3);
    await expect(views.getByRole('link', { name: /Team/ })).toBeVisible();
    await expect(views.getByRole('link', { name: /Not started/ })).toBeVisible();
    await expect(views.getByRole('link', { name: /Completed/ })).toBeVisible();
  });

  test('reaches unstarted work as a view, with attention a filter inside Team', async ({
    page,
  }) => {
    // Attention narrows the people list; it is not a fourth destination.
    const filter = page.getByRole('navigation', { name: 'Team filter' });
    await expect(filter.getByRole('link')).toHaveCount(2);
    await expect(filter.getByRole('link', { name: /Not started/i })).toHaveCount(0);

    await page
      .getByRole('navigation', { name: 'Team views' })
      .getByRole('link', { name: /Not started/ })
      .click();
    await expect(page).toHaveURL(/filter=available/);
    await expect(page.locator('.focus-panel')).toContainText('Work waiting to be picked up');
  });

  test('the window is a choice, and it is never all time', async ({ page }) => {
    /*
     * The rule outlives the strip it was written for: a lifetime figure
     * flatters whoever has been here longest and says nothing about now.
     */
    const picker = page.locator('.team-views .period-picker');
    await expect(picker.getByRole('button')).toContainText('Last 30 days');
    await picker.getByRole('button').click();

    const menu = page.locator('.period-picker-panel');
    await expect(menu.getByRole('link')).toHaveCount(5);
    await expect(menu.getByRole('link', { name: /all time/i })).toHaveCount(0);
    await expect(menu.getByRole('link', { name: 'Last 30 days' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await expect(menu.getByLabel('From')).toBeVisible();
    await expect(menu.getByLabel('To')).toBeVisible();

    await menu.getByRole('link', { name: 'Last 90 days' }).click();
    await expect(page).toHaveURL(/period=90/);
    await expect(page.locator('.team-views .period-picker').getByRole('button')).toContainText(
      'Last 90 days',
    );
  });

  test('the chosen window survives opening a person', async ({ page }) => {
    // Widening to ninety days and then opening somebody should not silently
    // put the question back to thirty.
    await openTeam(page, '&period=90');
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
    /*
     * v141 §6 put this week's priorities directly below the attention block and
     * above everything else: they are what the two people agreed, and the rest
     * of the active work is context for them. The attention block stays first
     * because it is only there when the manager actually owes something.
     */
    expect(order.slice(0, 5)).toEqual([
      'Needs your attention',
      'This week’s priorities',
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
  await openTeam(page, '&period=this-year');

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
