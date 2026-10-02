import { expect, test, type Page } from '@playwright/test';

/**
 * v239 — two things a phone was given that a phone cannot use.
 *
 * Both were introduced by earlier stages of this work and neither was visible
 * to any measurement already in the suite, because both leave the page exactly
 * as wide as it was:
 *
 *  - v235 clamped the attention reason to one line to win back row height in
 *    the two-band table layout at 1024, and the phone inherited it. "Please
 *    confirm the approved pilot platform and arrange access to three
 *    Operations…" was the whole of what a manager was told.
 *  - v237 raised the filter chips to a 44px touch target, which is right, and
 *    eleven of them then wrapped into six rows — so Recent activity opened on
 *    its own controls with the activity below the fold.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

test.describe('v239 the phone layout', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'Both rules are phone rules.');
    await signIn(page);
  });

  test('an attention reason that needs two lines is given two lines', async ({ page }) => {
    await page.goto('/work?scope=team');
    await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();

    const clipped = await page.evaluate(() => {
      const out: string[] = [];
      for (const reason of document.querySelectorAll('[data-cell="attention-reason"]')) {
        const element = reason as HTMLElement;
        const line = parseFloat(getComputedStyle(element).lineHeight) || 13;
        /*
         * Truncation is only a defect where there was something to truncate.
         * A reason that fits on one line is not evidence either way, so the
         * test asks only of the ones that do not: if the text needs a second
         * line, a second line has to be on screen.
         */
        if (element.scrollHeight > line * 1.5 && element.clientHeight < line * 1.5) {
          out.push(
            `"${(element.textContent ?? '').trim().slice(0, 40)}" shows ${element.clientHeight}px of ${element.scrollHeight}px`,
          );
        }
      }
      return out;
    });

    expect(clipped, 'attention reasons cut to one line on a phone').toEqual([]);
  });

  test('the filter strips are one scrolling row, not six wrapped ones', async ({ page }) => {
    for (const url of [
      '/work?scope=team&filter=updates&period=30',
      '/work?scope=team&filter=delivered&period=this-year',
    ]) {
      await page.goto(url);
      await page.locator('.team-activity, .team-delivered').first().waitFor({ state: 'visible' });

      const rows = await page.evaluate(() => {
        const out: Array<{ strip: string; rows: number; chips: number }> = [];
        const strips = document.querySelectorAll(
          '.team-activity-filters, .team-activity-people, .team-delivered-people',
        );
        for (const strip of strips) {
          const tops = new Set<number>();
          for (const chip of strip.querySelectorAll(':scope > a')) {
            tops.add(Math.round(chip.getBoundingClientRect().top));
          }
          out.push({
            strip: (strip.className || '').toString().split(' ')[0] ?? '?',
            rows: tops.size,
            chips: strip.querySelectorAll(':scope > a').length,
          });
        }
        return out;
      });

      for (const strip of rows) {
        // One row whatever the count: the strip scrolls sideways instead of
        // growing down the page and pushing the content it filters off it.
        expect(strip.rows, `${url} ${strip.strip} wrapped over ${strip.chips} chips`).toBeLessThan(
          2,
        );
      }
    }
  });
});
