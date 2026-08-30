import { expect, test, type Page } from '@playwright/test';

/**
 * v125 — My Day reveals different work as you read down it.
 *
 * The page has three regions and they had drifted into repeating each other.
 * The exclusion ran one way only: Next up dropped anything already recommended
 * or coming up, while Coming up was computed independently and cheerfully
 * repeated the Start here card — the largest thing on the page, shown twice.
 *
 * Deduplicating by task id was not enough either. A routine makes one task per
 * period, each with the same title, so a weekly walk put four rows reading
 * "Weekly workplace safety walk" across three sections: four different ids,
 * every one correctly deduplicated, and the page still repeating itself to the
 * person reading it. Nobody needs next week's occurrence while this week's is
 * open.
 *
 * These assert what a reader would notice — the same work, or the same
 * routine, in two places at once — rather than the mechanism that prevents it.
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

/** The task id each row points at, which is what "the same work" means. */
async function taskIds(page: Page, selector: string): Promise<string[]> {
  return page.locator(selector).evaluateAll((elements) =>
    elements
      .map((element) => {
        const anchor = element.matches('a') ? element : element.querySelector('a');
        const href = anchor?.getAttribute('href') ?? '';
        return /task=([0-9a-f-]+)/.exec(href)?.[1] ?? '';
      })
      .filter(Boolean),
  );
}

test.describe('v125 My Day says each thing once', () => {
  test('no work appears in two sections at once', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');

    const start = await taskIds(page, '.start-card h2');
    const nextUp = await taskIds(page, '.today-item');
    const coming = await taskIds(page, '.coming-item');

    const all = [...start, ...nextUp, ...coming];
    const duplicated = all.filter((id, index) => all.indexOf(id) !== index);
    expect(duplicated, `these appear in more than one section: ${duplicated.join(', ')}`).toEqual(
      [],
    );
  });

  test('one routine never fills the page with its own occurrences', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');

    // Titles, because that is what repeating looks like to a reader: four rows
    // with the same words on them, whatever their ids say.
    const titles = await page
      .locator('.start-card h2, .today-item .today-copy strong, .coming-item strong')
      .allInnerTexts();
    const trimmed = titles.map((title) => title.trim()).filter(Boolean);
    const repeated = trimmed.filter((title, index) => trimmed.indexOf(title) !== index);
    expect(repeated, `these titles are shown more than once: ${repeated.join(' | ')}`).toEqual([]);
  });

  test('the recommendation explains itself without a second click', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');

    const reason = page.locator('.start-reason');
    await expect(reason).toBeVisible();
    await expect(reason).toContainText(/because/i);

    // The detailed rule stays available, but nobody needs it to understand the
    // recommendation.
    await expect(page.getByRole('button', { name: /Why this/i })).toBeVisible();
  });

  test('the workload counts are shortcuts, not decoration', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');

    const active = page.locator('.summary-link').first();
    const available = page.locator('.summary-link').nth(1);
    await expect(active).toHaveAttribute('href', '/work');
    await expect(available).toHaveAttribute('href', '/work?tab=available');

    await active.click();
    await expect(page).toHaveURL(/\/work$/);
  });

  test('the heading matches what the list actually holds', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');

    /*
     * "Today" was a promise the list could not keep: it ranks the next useful
     * work, which on a clear week is due next month. People read the heading,
     * saw dates a fortnight out, and reasonably asked why it was under Today.
     */
    await expect(page.locator('#next-up-heading')).toHaveText('Next up');
    await expect(page.getByRole('heading', { name: 'Today', exact: true })).toHaveCount(0);
  });
});
