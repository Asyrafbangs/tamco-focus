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
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
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

  test('offers the team views as navigation and no card row above them', async ({ page }) => {
    /*
     * v132 put four figures here — People / Needs attention / Available work /
     * Completed — and section 3 of the change specification supersedes them:
     * that card row became the central navigation, which is a dashboard in
     * front of the list a manager came to read.
     *
     * The invariant is that absence, not the number of views. v232 adds Recent
     * activity as a genuine fourth destination — a list of what the team did,
     * which is a place to go rather than a figure to read. Attention stays a
     * filter inside Team, as the next test insists.
     */
    await expect(page.locator('.team-snapshot')).toHaveCount(0);

    const views = page.getByRole('navigation', { name: 'Team views' });
    await expect(views.getByRole('link')).toHaveCount(4);
    await expect(views.getByRole('link', { name: /Team/ })).toBeVisible();
    await expect(views.getByRole('link', { name: /Not started/ })).toBeVisible();
    await expect(views.getByRole('link', { name: /Completed/ })).toBeVisible();
    await expect(views.getByRole('link', { name: /Recent activity/ })).toBeVisible();
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
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText('last 90 days');
  });
});

test.describe('v132 the person expansion', () => {
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
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
  });

  test('reads the week, then the work, then what closed', async ({ page }) => {
    const headings = await page
      .getByTestId('my-team-person-panel')
      .locator('.team-person-section > h4, .team-person-section > summary')
      .allInnerTexts();
    const order = headings.map((text) => text.trim().split('\n')[0]!.trim());

    /*
     * v143 §6 fixes this order, and the reason is the order of the questions:
     * what did the two of them agree, what else is being carried, what has not
     * begun, what is the routine doing, what actually closed — and only then
     * the running commentary. Delivery stays above the update feed because a
     * list of edits says somebody has been busy and what closed says what came
     * of it.
     *
     * "Needs your decision" is not in this list because §6 forbids rendering
     * it for everyone. It appears only when the manager actually owes an
     * answer, so it is dropped here rather than asserted as always-first —
     * which is how the old drawer had it, and why every healthy person carried
     * a panel saying nothing was needed.
     */
    /*
     * v189 — "Needs attention" (what is late or due soon) is conditional in the
     * same way, and comes first when it is there.
     */
    const withoutAttention = order[0]?.startsWith('Needs attention') ? order.slice(1) : order;
    const withoutDecision = withoutAttention[0]?.startsWith('Needs your decision')
      ? withoutAttention.slice(1)
      : withoutAttention;
    /*
     * v157 puts "Contributions to others" straight after the person's own
     * active work: both answer "what else is being carried", and the steps
     * they owe on somebody else's work are the half their own list cannot show.
     */
    const expected = [
      'This week’s priorities',
      'Other active work',
      'Contributions to others',
      'Not started',
      'Routines',
      'Completed',
      'Recent updates',
    ];
    expect(withoutDecision).toHaveLength(expected.length);
    withoutDecision.forEach((text, index) => expect(text).toContain(expected[index]!));
  });

  test('never renders a null update', async ({ page }) => {
    /*
     * `String(update.body)` turned a null body into the four characters
     * "null", which appeared as somebody's most recent meaningful change.
     * System rows carry no body and belong to the audit trail, not to a list
     * headed "what changed".
     *
     * Counted rather than looked at, so a collapsed section is still covered:
     * the text is in the DOM either way, and §6 collapses this one.
     */
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel.getByText('null', { exact: true })).toHaveCount(0);
    await expect(panel.getByText('undefined', { exact: true })).toHaveCount(0);
  });

  test('shows load signals without turning them into a score', async ({ page }) => {
    /*
     * The figures moved onto the row itself in v142 §3, where they are read
     * across the whole team rather than one person at a time. Asserted there
     * because the expansion's own signal line is conditional — somebody with
     * nothing overdue and nothing stalled correctly has none, and a test that
     * demanded one would be demanding a problem.
     */
    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Izzah' });
    await expect(row.locator('[data-cell="person"]')).toContainText(
      /(overdue|active|waiting|Nothing active)/,
    );

    // No percentage, no rating, no "efficiency": every one of those would have
    // to rank a Major Project against a PPE check.
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel.getByText(/efficiency/i)).toHaveCount(0);
    await expect(panel.getByText(/productivity/i)).toHaveCount(0);
    await expect(panel.getByText(/score/i)).toHaveCount(0);
  });
});

test('v132 delivery is split by kind, not reported as one number', async ({ page }) => {
  await signIn(page, 'izzul@tamco.local');
  // The widest window, so the fixture has something to show.
  await openTeam(page, '&period=this-year');

  const rows = page.getByTestId('my-team-person-row');
  const count = await rows.count();
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    await row.locator('strong').first().click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();

    // §6 collapses Completed behind its count, so the count is read from the
    // summary and the records are opened only when there is something in them.
    const delivery = panel.locator('.team-person-section[data-section="completed"]');
    const summary = (await delivery.locator('summary').innerText()).trim();

    if (!/^Completed\s+0\b/.test(summary)) {
      await delivery.locator('summary').click();
      /*
       * The breakdown is the point. Ten routine occurrences are generated by a
       * schedule and closed weekly; one Major Project closes once a quarter; a
       * contribution to somebody else's work never appears in a completion
       * count at all. A bare total ranks the person doing the smallest work
       * highest.
       */
      await expect(delivery.locator('.member-signals-plain')).toBeVisible();
      return;
    }

    // Collapse before moving on: the header is the one control, so clicking it
    // again is how a person closes.
    await row.locator('strong').first().click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(0);
  }
  test.skip(true, 'Nobody in this fixture has completed anything this year.');
});
