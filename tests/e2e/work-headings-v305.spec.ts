import { expect, test, type Page } from '@playwright/test';

/**
 * v305 — My Day and Work name their blocks with headings, not with capitals.
 *
 * Every block on these screens was introduced by a tracked-out uppercase
 * label: "DAILY WORKSPACE" above "My Day", "WORK" above "My Work", "DECISIONS"
 * above a heading that already said decisions, and "WORKING ON" and
 * "THIS WEEK" above blocks that had no heading at all.
 *
 * Two costs. The ones that restated the heading spent a line of a phone screen
 * saying nothing. The ones that were a block's only label were doing a
 * heading's job while giving a screen reader no structure to do it with — a
 * reader tabbing by heading found a page of lists with nothing naming them.
 *
 * This guards both halves: the device is gone from these screens, and what
 * replaced it is a real outline with no level skipped.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

/** A manager sees every block these screens can render. */
const ROUTES = ['/today', '/work', '/work?scope=team', '/work/routine'];

async function settle(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('My Day and Work are named by headings', () => {
  test('no block on these screens is introduced by an uppercase label', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
      'One pass over the markup is enough.',
    );
    test.setTimeout(120_000);
    await signIn(page, 'izzul@tamco.local');

    const found: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const labels = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('.eyebrow')]
          .filter((element) => element.offsetParent !== null)
          .map((element) => (element.textContent ?? '').trim()),
      );
      found.push(...labels.map((label) => `${route} · "${label}"`));
    }

    expect(found, 'eyebrow labels still introducing a block').toEqual([]);
  });

  /**
   * What replaced them has to be worth more than what it replaced.
   *
   * "Working on" and "This week" are the only label each of their blocks has.
   * As a `<p>` in capitals they were invisible to a reader navigating by
   * heading, which is the half of the fault that was not about taste. They are
   * second-level headings under the page's own, reachable by role.
   */
  test('the blocks that were labelled in capitals are headings now', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await settle(page, '/work');

    await expect(page.getByRole('heading', { name: 'My Work', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Working on', level: 2 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'This week', level: 2 })).toBeVisible();

    // And written once, not once per branch of the line beneath it.
    await expect(page.getByRole('heading', { name: 'Working on', level: 2 })).toHaveCount(1);
  });
});
