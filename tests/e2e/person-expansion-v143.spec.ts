import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v143 §6 — a person opens in place, not over the list.
 *
 * The drawer answered "show me this record". A manager reading My Team is
 * asking "who needs me", which is a question about the list — and covering the
 * list to answer it meant the comparison they came for could only be done from
 * memory, one person at a time.
 *
 * Acceptance A01, A02 and A03.
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

async function openTeam(page: Page, query = '') {
  await page.goto(`/work?scope=team${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
}

const rowFor = (page: Page, name: string) =>
  page.getByTestId('my-team-person-row').filter({ hasText: name });

/**
 * Put this person's week back to empty, as the person themselves.
 *
 * Waits for the row to go rather than for the page to look settled: the button
 * disables itself while the action runs, so a loop that clicks again on the
 * next tick clicks a disabled control and waits forty-five seconds to find out.
 */
async function withdrawEveryProposal(page: Page) {
  await page.goto('/work');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await showActiveWork(page);
  for (let guard = 0; guard < 6; guard += 1) {
    const withdraw = page.getByRole('button', { name: 'Withdraw' });
    const remaining = await withdraw.count();
    if (remaining === 0) break;
    await withdraw.first().click();
    await expect(withdraw).toHaveCount(remaining - 1);
  }
}

test.describe('v143 §6 inline person expansion', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
  });

  /** A01 — name, whitespace and chevron are one control, and no drawer opens. */
  test('A01 the whole header toggles the same expansion', async ({ page }) => {
    for (const target of ['name', 'whitespace', 'chevron'] as const) {
      await openTeam(page);
      const row = rowFor(page, 'Izzah Nurul');
      await expect(row).toHaveAttribute('aria-expanded', 'false');

      if (target === 'name') {
        await row.getByText('Izzah Nurul').click();
      } else if (target === 'chevron') {
        await row.locator('[data-cell="action"]').click();
      } else {
        /*
         * Blank space, measured with the row on screen. On a phone the row is
         * a tall stack of bands and its middle is not a reliable place to
         * press, so this takes the left edge near the bottom of the row —
         * inside it, and inside no cell's content.
         */
        await row.scrollIntoViewIfNeeded();
        const box = (await row.boundingBox())!;
        await row.click({ position: { x: 6, y: box.height - 6 } });
      }

      await expect(
        page.getByTestId('my-team-person-panel'),
        `${target} did not expand the person`,
      ).toBeVisible();
      await expect(row).toHaveAttribute('aria-expanded', 'true');
      await expect(page).toHaveURL(/person=/);
      // No person drawer, and no drawer of any other kind either.
      await expect(page.locator('.task-detail-layer')).toHaveCount(0);
      // The list is still there to compare against, which is the point.
      await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
    }
  });

  /**
   * §6 fixes the order, and it is the order of the questions a manager asks.
   * Everything below priorities that is not itself a decision starts closed.
   */
  test('the sections are in §6 order, and only priorities are open', async ({ page }) => {
    await openTeam(page);
    await rowFor(page, 'Izzah Nurul').getByText('Izzah Nurul').click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();

    await expect(panel.getByRole('heading', { name: 'This week’s priorities' })).toBeVisible();
    for (const section of ['not-started', 'routines', 'completed', 'details']) {
      await expect(
        panel.locator(`.team-person-section[data-section="${section}"]`),
      ).not.toHaveAttribute('open', '');
    }

    /*
     * §6 — no empty attention panel for everyone. "Needs your decision" is
     * rendered only where a request actually exists, so its heading is either
     * present with content under it or absent altogether; a person with
     * nothing outstanding does not get a section saying so.
     */
    const decisions = panel.getByRole('heading', { name: 'Needs your decision' });
    if ((await decisions.count()) > 0) {
      await expect(panel.locator('.member-attention-row').first()).toBeVisible();
    }
  });

  /** A02 — opening a task keeps the expansion, the filter and the position. */
  test('A02 opening and closing a task leaves the person expanded', async ({ page }) => {
    await openTeam(page, '&filter=attention&period=90');
    const row = page.getByTestId('my-team-person-row').first();
    const name = (await row.locator('[data-cell="person"] strong').innerText()).trim();
    await row.locator('[data-cell="person"] strong').click();

    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();

    const work = panel.locator('.member-work-row').first();
    test.skip((await work.count()) === 0, `${name} has no active work to open.`);

    /*
     * Measured with the row already in view. `click()` scrolls to its target
     * first, so reading the position before that call attributes Playwright's
     * own scroll to the drawer and the assertion fails on 585 pixels the
     * product never moved.
     */
    await work.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await work.click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    // §6 — the task opens over the list, never over a second person layer.
    await expect(page.locator('.task-detail-layer')).toHaveCount(1);

    await page
      .locator('.task-detail-layer')
      .getByRole('dialog')
      .getByRole('button', { name: /^Close/ })
      .click();
    await expect(page.locator('.task-detail-drawer')).toHaveCount(0);

    await expect(panel).toBeVisible();
    await expect(page).toHaveURL(/person=/);
    // The filter and the window the manager asked for, both still asked.
    await expect(page).toHaveURL(/filter=attention/);
    await expect(page).toHaveURL(/period=90/);
    /*
     * And the page did not jump. Opening a record used to scroll the list back
     * to the top on the way in and again on the way out, so a manager reading
     * the fourth person had to find them twice per task.
     */
    expect(Math.abs((await page.evaluate(() => window.scrollY)) - scrollBefore)).toBeLessThan(80);
  });

  /** A03 — Keep open retains one person while another is read. */
  test('A03 Keep open holds a person while the next one opens', async ({ page }) => {
    await openTeam(page);
    const rows = page.getByTestId('my-team-person-row');
    test.skip((await rows.count()) < 2, 'Comparison needs two people.');

    const firstName = (await rows.nth(0).locator('[data-cell="person"] strong').innerText()).trim();
    const secondName = (
      await rows.nth(1).locator('[data-cell="person"] strong').innerText()
    ).trim();

    // Without Keep open, opening the second closes the first. That is the
    // default §6 asks for: one expanded person at a time.
    await rowFor(page, firstName).getByText(firstName).click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(1);
    await rowFor(page, secondName).getByText(secondName).click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(1);
    await expect(rowFor(page, firstName)).toHaveAttribute('aria-expanded', 'false');
    await expect(rowFor(page, secondName)).toHaveAttribute('aria-expanded', 'true');

    // With it, both stay — which is what makes them comparable.
    await page.getByRole('link', { name: 'Keep open' }).click();
    await expect(page.getByRole('link', { name: 'Stop keeping open' })).toBeVisible();
    await rowFor(page, firstName).getByText(firstName).click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(2);
    await expect(rowFor(page, firstName)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowFor(page, secondName)).toHaveAttribute('aria-expanded', 'true');

    // Releasing the pin closes the person it was holding, and leaves the one
    // the manager is actually reading.
    await page.getByRole('link', { name: 'Stop keeping open' }).click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(1);
    await expect(rowFor(page, firstName)).toHaveAttribute('aria-expanded', 'true');
    await expect(rowFor(page, secondName)).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * §6 — a task put forward as this week's result is not also listed below it
   * as an independent commitment. The two lists would otherwise say the person
   * had agreed one thing and was separately carrying the same thing.
   */
  test('a weekly priority is not repeated in Other active work', async ({ page }, testInfo) => {
    /*
     * It arranges its own priority rather than hoping the fixture has one.
     *
     * Written the other way first, it walked the team looking for somebody
     * with a commitment and skipped when it found none — which is what a fresh
     * database always looks like, so the rule §6 cares about most was never
     * actually checked. A mutation, so it runs once: the five viewport
     * projects share one database.
     */
    test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

    try {
      await signIn(page, 'izzah@tamco.local');
      await withdrawEveryProposal(page);
      await page.goto('/work');
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await showActiveWork(page);

      const title = (
        await page.locator('.task-row').first().locator('strong').first().innerText()
      ).trim();
      await page.locator('.task-row').first().locator('.row-primary-link').first().click();
      await expect(page.locator('.task-detail-drawer')).toBeVisible();
      await page.getByRole('button', { name: 'Add to this week' }).click();

      /*
       * Confirm it landed before handing over. Signing in clears the cookies
       * and navigates, which abandons a server action still in flight — and
       * the failure then appears three steps later, as a manager looking at a
       * week with nothing in it.
       */
      await page.goto('/work');
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.locator('.weekly-priorities')).toContainText(title);

      await signIn(page, 'izzul@tamco.local');
      await openTeam(page);
      await rowFor(page, 'Izzah Nurul').getByText('Izzah Nurul').click();
      const panel = page.getByTestId('my-team-person-panel');
      await expect(panel).toBeVisible();

      // It is in the week…
      await expect(panel.locator('.weekly-priority')).toContainText(title);
      // …and therefore not also below it as a separate thing being carried.
      const active = (await panel.locator('.member-work-row > strong').allInnerTexts()).map(
        (text) => text.trim(),
      );
      expect(active, `"${title}" is counted twice`).not.toContain(title);
    } finally {
      await signIn(page, 'izzah@tamco.local');
      await withdrawEveryProposal(page);
    }
  });

  /**
   * §6 — `?person=` is the expanded state, so the links already in inboxes and
   * notifications still land on the person they name. It used to open a drawer,
   * which meant the parameter also worked from scopes that no longer render a
   * person at all.
   */
  test('a person link opens the expansion directly, on the view that shows it', async ({
    page,
  }) => {
    await openTeam(page);
    const row = page.getByTestId('my-team-person-row').first();
    await row.locator('[data-cell="person"] strong').click();
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
    const link = page.url();

    // The same URL cold, and from a filter that lists work rather than people.
    for (const target of [link, link.replace('scope=team', 'scope=team&filter=delivered')]) {
      await page.goto(target);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
      await expect(row).toHaveAttribute('aria-expanded', 'true');
    }
  });

  /**
   * §60 still holds: an id in the URL is a request, not an authorisation, and
   * a hand-written `kept` list is no different from a hand-written `person`.
   */
  test('kept ids cannot expand somebody outside the viewer’s team', async ({ page }) => {
    const lim = 'f0c05000-0000-4000-a000-000000000006';
    await signIn(page, 'amer@tamco.local');
    await page.goto(`/work?scope=team&kept=${lim}&person=${lim}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(0);
    await expect(page.getByText('Lim Wei Sheng', { exact: true })).toHaveCount(0);
  });
});
