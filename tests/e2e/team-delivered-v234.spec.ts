import { expect, test, type Page } from '@playwright/test';

/**
 * v234 — Completed answers "what did we finish this week?" before it answers
 * "how is Amer doing?".
 *
 * The tab grouped everything under the person who closed it, which is a useful
 * screen and the wrong default: a manager writing their weekly update had to
 * read six lists, each in its own time order, and merge them by eye. Time is
 * now the axis the tab opens on and the person grouping is one link away.
 *
 * Both views are rendered from one list of records. That is the point of the
 * last test here: the headline figure and the list behind it were separate
 * reads once, and they drifted.
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

async function openCompleted(page: Page, query = '') {
  await page.goto(`/work?scope=team&filter=delivered&period=this-year${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.team-delivered')).toBeVisible();
}

test.describe('v234 Completed is a week before it is a league table', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
  });

  test('opens on the timeline, with the days named', async ({ page }) => {
    await openCompleted(page);

    const days = page.locator('.team-delivered-day');
    expect(await days.count()).toBeGreaterThan(0);
    // "Today", "Yesterday", then the weekday: a position in the week, not a
    // duration a reader has to subtract.
    await expect(days.first().locator('h3')).toHaveText(
      /^(Today|Yesterday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/,
    );
    // Not the person grouping, which is now the second view.
    await expect(page.locator('.team-delivered-group')).toHaveCount(0);
  });

  test('names who closed each item, because a timeline without the person says nothing', async ({
    page,
  }) => {
    await openCompleted(page);
    const first = page.locator('.team-delivered-row').first();
    // v247 gave the row columns, so the kind and the person each have one.
    await expect(first.locator('.team-delivered-kind')).toContainText(
      /Owned work|Contribution|Routine/,
    );
    const people = await page.locator('.team-delivered-people > a > span').allInnerTexts();
    const names = people.map((name) => name.trim()).filter(Boolean);
    const said = await first.locator('.team-delivered-person').innerText();
    expect(
      names.some((name) => said.includes(name)),
      `the row named nobody from ${names.join(', ')}`,
    ).toBe(true);
  });

  test('the second view is an address, not a mode', async ({ page }) => {
    await openCompleted(page);
    await page
      .getByRole('navigation', { name: 'Completed view' })
      .getByRole('link', { name: 'By person' })
      .click();

    await expect(page).toHaveURL(/view=person/);
    await expect(page.locator('.team-delivered-group').first()).toBeVisible();
    await expect(page.locator('.team-delivered-day')).toHaveCount(0);

    // Reloaded, it is still the view that was asked for.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.team-delivered-group').first()).toBeVisible();
  });

  test('a person can be read alone, and the ones who closed nothing are still named', async ({
    page,
  }) => {
    await openCompleted(page);

    const strip = page.locator('.team-delivered-people > a');
    expect(await strip.count()).toBeGreaterThan(1);

    /*
     * Somebody who closed something, found by their own figure rather than by
     * index: the five viewport projects share one database and the order is
     * not stable between them. The people who closed nothing say so in words,
     * which is the point of the strip.
     */
    let name = '';
    for (let index = 0; index < (await strip.count()); index += 1) {
      const figure = (await strip.nth(index).locator('strong').innerText()).trim();
      if (/^\d+$/.test(figure)) {
        name = (await strip.nth(index).locator('span').innerText()).trim();
        await strip.nth(index).click();
        break;
      }
    }
    expect(
      name,
      'the seed must carry work closed inside the window, or this test proves nothing',
    ).toBeTruthy();
    await expect(page.locator('.team-delivered')).toBeVisible();

    await expect(page).toHaveURL(/who=/);
    const rows = page.locator('.team-delivered-row');
    expect(await rows.count()).toBeGreaterThan(0);
    for (let index = 0; index < (await rows.count()); index += 1) {
      await expect(rows.nth(index).locator('.team-delivered-person')).toContainText(name);
    }
  });

  test('a row opens the work it is about', async ({ page }) => {
    await openCompleted(page);
    const title = (
      await page.locator('.team-delivered-row .row-primary-link').first().innerText()
    ).trim();
    await page.locator('.team-delivered-row .row-primary-link').first().click();
    await expect(page.locator('.task-detail-drawer')).toContainText(title);
  });

  test('the two views and the figure above them cannot disagree', async ({ page }) => {
    /*
     * One list of records read two ways. The headline figure and the list
     * behind it were separate queries once, so a manager could see 15
     * completed and count 11 — and nothing on the page said which was wrong.
     */
    await openCompleted(page);
    const summary = await page.locator('.team-delivered-summary').innerText();
    const total = Number(summary.match(/^(\d+) completed/)![1]);
    expect(await page.locator('.team-delivered-row').count()).toBe(total);

    await openCompleted(page, '&view=person');
    expect(await page.locator('.team-delivered-row').count()).toBe(total);

    const counts = await page.locator('.team-delivered-group > header .muted').allInnerTexts();
    const summed = counts.reduce((carried, text) => carried + Number(text.trim().split(' ')[0]), 0);
    expect(summed).toBe(total);
  });
});
