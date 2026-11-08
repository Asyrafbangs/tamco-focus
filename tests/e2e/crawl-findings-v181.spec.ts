import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v181 — what a crawl of every reachable page found.
 *
 * Signed in as an administrator, a manager and two team members on both
 * viewports, following every link and scanning each page: a My Team row that
 * was one button hiding its own contents and wrapping a second button, an
 * attachments table that pushed the whole page sideways on a phone and could
 * not be scrolled by keyboard, and a tab row wider than a phone. These hold
 * each page to the checks that found it.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function seriousViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .map((violation) => `${violation.id}: ${violation.nodes[0]?.target.join(' ')}`);
}

async function pageScrollsSideways(page: Page) {
  return page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
}

test.describe('v181 crawl findings', () => {
  test('a My Team row reads as its contents, with the name as the one control', async ({
    page,
  }) => {
    await signIn(page, 'izzul@tamco.local');
    await open(page, '/work?scope=team');

    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Amer Hakim' });
    await expect(row).not.toHaveAttribute('role', 'button');
    const toggle = row.getByRole('button', { name: /team member detail for Amer Hakim/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await toggle.click();
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');

    expect(await seriousViolations(page)).toEqual([]);
  });

  test('attachments and records stay inside a phone screen', async ({ page }, testInfo) => {
    await signIn(page, 'izzul@tamco.local');

    await open(page, '/more/attachments');
    expect(await pageScrollsSideways(page), 'attachments page scrolls sideways').toBe(false);
    /*
     * v306 — and the table does not scroll sideways inside its own box.
     *
     * The assertion above passed for five months while the file name was the
     * only readable column on a phone: `min-width: 760px` kept the work item,
     * who added the file and when off the right edge of `.data-table-wrap`,
     * which scrolls on its own and leaves the page alone. v181 fixed the page
     * and made the box keyboard-reachable, which is the correct answer for a
     * 1024px window and the wrong one for a 390px screen, where there is no
     * width to find. The rows stack below 600px, so there is nothing left to
     * scroll to.
     */
    if (testInfo.project.name === 'mobile') {
      const overflow = await page.evaluate(() => {
        const wrap = document.querySelector('.data-table-wrap');
        if (!wrap) return null;
        return wrap.scrollWidth - wrap.clientWidth;
      });
      expect(overflow, 'the attachments table is not on this page').not.toBeNull();
      expect(overflow, 'the attachments table scrolls sideways inside its box').toBeLessThanOrEqual(
        1,
      );
    }
    expect(await seriousViolations(page)).toEqual([]);

    await open(page, '/more/records?review=pending');
    expect(await pageScrollsSideways(page), 'records page scrolls sideways').toBe(false);
    if (testInfo.project.name === 'mobile') {
      // The tabs scroll within themselves instead.
      const tabs = page.locator('.workspace-tabs:visible').first();
      await expect(tabs).toBeVisible();
      const box = await tabs.boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
    }
  });
});
