import { expect, test, type Page } from '@playwright/test';

/**
 * v243 — the settings section you are on is on screen.
 *
 * On a phone the settings menu is a horizontal scroller at 132px a row, and
 * eleven sections are about 1500px of it in a 362px box. Opening Appearance,
 * Delivery history or Security left the row you had just chosen off to the
 * right, with the menu still showing the first three and nothing saying which
 * section was open.
 *
 * The same shape as the tab strips v241 and v242 fixed, in the one place where
 * wrapping is not the answer: eleven rows would be five lines of menu before
 * any setting. So the menu reveals the current row instead.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** Sections far enough down the menu that the defect reached them. */
const SECTIONS = ['appearance', 'delivery', 'security', 'retention'];

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

test.describe('v243 the settings menu', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'The menu is only a scroller on a phone.');
    await signIn(page);
  });

  for (const section of SECTIONS) {
    test(`reveals ${section} when that is the section you opened`, async ({ page }) => {
      await page.goto(`/more/settings?section=${section}`);
      // Every panel is in the DOM whatever the active section, so this waits
      // for the page to have arrived without asserting anything about which.
      await page.locator('[data-settings-panel]').first().waitFor({ state: 'attached' });

      const where = await page.evaluate(() => {
        const menu = document.querySelector('.settings-menu');
        if (!menu) return null;
        const current = menu.querySelector('[aria-current="page"]');
        if (!current) return null;
        const bounds = menu.getBoundingClientRect();
        const box = current.getBoundingClientRect();
        return {
          label: (current.textContent ?? '').trim().slice(0, 30),
          scrolls: menu.scrollWidth > menu.clientWidth + 2,
          whole: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
        };
      });

      expect(where, 'the settings menu has no current row').not.toBeNull();
      /*
       * Asserted, not assumed: if the menu ever stops scrolling on a phone
       * this test is measuring nothing and should say so rather than passing.
       */
      expect(where!.scrolls, 'the menu no longer scrolls; this test is moot').toBe(true);
      expect(where!.whole, `"${where!.label}" is scrolled out of its own menu`).toBe(true);
    });
  }
});
