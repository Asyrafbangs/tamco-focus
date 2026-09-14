import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v181 — text that disappeared at night.
 *
 * `--navy` is both a background and, in three places, a text colour. Night mode
 * sets it near-black for the backgrounds, which left attachment names, Directory
 * form headings and metric figures at 1.09:1 on the dark surfaces — present,
 * and unreadable. Found by scanning the pages again in Night mode; held here to
 * the same scan.
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

test('attachments and a Directory page are readable in Night mode', async ({ page }) => {
  await signIn(page, 'admin@tamco.local');
  await page.evaluate(() => localStorage.setItem('tamco-focus-theme', 'dark'));

  for (const path of [
    '/more/attachments',
    '/more/admin/users?user=f0c05000-0000-4000-a000-000000000003',
    // The "Open person" links on waiting work were the browser's own link blue.
    '/work?scope=team&filter=available',
  ]) {
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const result = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(
      result.violations.flatMap((violation) =>
        violation.nodes.map((node) => `${path} ${node.target.join(' ')}`),
      ),
    ).toEqual([]);
  }
});
