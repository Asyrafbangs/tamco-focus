import { expect, test, type Page } from '@playwright/test';

/**
 * v302 — the Day/Night control shows something to press.
 *
 * The phone rule hid every span inside `.theme-toggle`, and the component
 * renders two: the word ("Night"/"Day") and the knob ("☀"/"☾"). Hiding the
 * word was the intention; hiding both left a blank 44px circle beside the
 * bell on every authenticated page, in both themes. axe passed it, because
 * the button still carries `aria-label="Switch to Night mode"` — only a
 * person looking at the screen could see the fault.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('amer@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('the theme control is never an empty circle', async ({ page }) => {
  await signIn(page);

  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const toggle = page.locator('.theme-toggle');
    await expect(toggle).toBeVisible();

    // Something must actually be painted inside it, at every width.
    const visibleText = await toggle.evaluate((el) =>
      Array.from(el.querySelectorAll('span'))
        .filter((span) => getComputedStyle(span).display !== 'none')
        .map((span) => span.textContent?.trim() ?? '')
        .join('')
        .trim(),
    );
    expect(visibleText, `theme control is blank at ${width}px`).not.toBe('');

    // And the knob specifically survives, in both themes.
    for (const theme of ['light', 'dark']) {
      await page.evaluate((value) => {
        document.documentElement.setAttribute('data-theme', value);
      }, theme);
      await expect(page.locator('.theme-toggle .theme-knob')).toBeVisible();
    }
  }
});
