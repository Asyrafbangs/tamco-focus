import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v295 — the assistant's screen, in the state most installations will see it.
 *
 * CI has no GROQ_API_KEY and should not have one: a browser suite that called
 * a paid or rate-limited API would be slow, flaky and billable. So what this
 * proves is the half that does not need a model, and that half matters more
 * than it sounds:
 *
 *   * the rail reaches it, so the feature is findable at all;
 *   * the page renders for a signed-in person without the key;
 *   * the disabled state is *honest* - it says the assistant is off and what
 *     switches it on, rather than offering a box that silently fails;
 *   * the box cannot be used when it cannot answer, which is the difference
 *     between a disabled feature and a broken one;
 *   * it works at 390 wide without a sideways scroll.
 *
 * An assistant that looks available and does nothing is worse than one that
 * says it is off. That is the regression this spec exists to catch.
 */

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function scrollsSideways(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const before = root.scrollLeft;
    root.scrollLeft = 9999;
    const moved = root.scrollLeft > 0;
    root.scrollLeft = before;
    return moved || document.body.scrollWidth > document.documentElement.clientWidth + 1;
  });
}

test.describe('v295 TAMCO AI workspace', () => {
  test('is reachable from the rail and opens for a signed-in person', async ({ page }) => {
    await signIn(page);
    /*
     * The rail collapses to labels only at some widths, so the destination is
     * found by its accessible name rather than by position.
     */
    const entry = page.getByRole('link', { name: 'TAMCO AI' }).first();
    await expect(entry).toBeVisible();
    await entry.click();

    await expect(page).toHaveURL(/\/ai/);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(
      page.getByRole('heading', { name: 'Ask about your work', level: 1 }),
    ).toBeVisible();
  });

  test('says it is switched off rather than offering a box that fails', async ({ page }) => {
    await signIn(page);
    await page.goto('/ai');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    /*
     * `exact` on every name here, and not by habit: the app shell's search
     * control is labelled "Search tasks, routines or people", and Playwright
     * matches an accessible name as a case-insensitive substring - so a
     * relaxed `name: 'Ask'` matches "t-ask-s" and resolves to two elements.
     */
    const box = page.getByLabel('Ask the assistant', { exact: true });
    await expect(box).toBeVisible();

    /*
     * Either state is correct depending on whether the environment running
     * this suite has a key, and the spec asserts the pair rather than
     * guessing: enabled means you can type, disabled means you are told why
     * and cannot. What is never acceptable is an enabled-looking box that
     * does nothing.
     */
    if (await box.isDisabled()) {
      await expect(box).toHaveAttribute('placeholder', /not switched on|(GROQ|OPENAI)_API_KEY/);
      await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
    } else {
      await box.fill('Why are my corrective actions delayed?');
      await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
    }
  });

  test('lists conversations and offers a new one', async ({ page }) => {
    await signIn(page);
    await page.goto('/ai');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New' })).toBeVisible();
  });

  test('fits a phone without scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);
    await page.goto('/ai');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(
      page.getByRole('heading', { name: 'Ask about your work', level: 1 }),
    ).toBeVisible();
    expect(await scrollsSideways(page)).toBe(false);
  });
});
