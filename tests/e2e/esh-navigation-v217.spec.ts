import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

test('v4101 keeps one primary navigation while preserving the closed deep link', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the navigation is enough.');
  await signIn(page);
  await page.goto('/findings/register');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const nav = page.getByRole('navigation', { name: 'Finding Management' });
  for (const destination of ['Today', 'Findings', 'Patterns', 'Configuration']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${destination}`) })).toBeVisible();
  }
  await expect(nav.getByRole('link', { name: 'Dashboard' })).toHaveCount(0);
  await expect(nav.getByRole('link', { name: 'Register' })).toHaveCount(0);

  /*
   * The register's own views, by name rather than by count.
   *
   * This asserted "three" until v269 added a fourth, which broke a test whose
   * actual claim -- filters remain focused record views rather than another
   * competing navigation system -- was never about how many chips there are.
   */
  const views = page.getByRole('navigation', { name: 'Register views' }).getByRole('link');
  for (const view of ['Needs attention', 'All open', 'Overdue', 'Not assessed']) {
    await expect(views.filter({ hasText: view })).toHaveCount(1);
  }
  await expect(views.filter({ hasText: 'Closed' })).toHaveCount(0);

  // The retained deep link reaches the closed Findings filter.
  await page.goto('/findings/closed');
  await expect(page).toHaveURL(/filter=closed/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(nav.getByRole('link', { name: 'Findings' })).toHaveAttribute('aria-current', 'page');

  await page.goto('/findings/verification');
  await expect(page).toHaveURL(/\/findings\?queue=verification/);
  await expect(page.getByRole('heading', { name: 'To verify', level: 1 })).toBeVisible();
});
