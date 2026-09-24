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

test('v217 Closed is a destination, not a chip competing with the navigation', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the navigation is enough.');
  await signIn(page);
  await page.goto('/findings/register');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const nav = page.getByRole('navigation', { name: 'Finding Management' });
  for (const destination of ['Register', 'Verification', 'Closed']) {
    await expect(nav.getByRole('link', { name: new RegExp(`^${destination}`) })).toBeVisible();
  }

  // Three views in the register itself; Closed is no longer one of them.
  const views = page.getByRole('navigation', { name: 'Register views' }).getByRole('link');
  await expect(views).toHaveCount(3);
  await expect(views.filter({ hasText: 'Closed' })).toHaveCount(0);

  // The destination shows the closed register, and the navigation says so.
  await nav.getByRole('link', { name: 'Closed' }).click();
  await expect(page).toHaveURL(/filter=closed/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(nav.getByRole('link', { name: 'Closed' })).toHaveAttribute('aria-current', 'page');
  await expect(nav.getByRole('link', { name: 'Register' })).not.toHaveAttribute(
    'aria-current',
    'page',
  );
});
