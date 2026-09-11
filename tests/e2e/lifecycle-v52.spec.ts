import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * v48 §8 — a task closes back to the screen it was opened from.
 *
 * Every surface in the product can open a task, and all of them used to close
 * to My Work's Active tab: opening one entry in the audit log moved you to a
 * different workspace and lost your place.
 */
test('a task opened from another screen closes back to it', async ({ page }) => {
  await signIn(page, 'izzah@tamco.local');

  for (const origin of ['/today', '/plan', '/work/routine', '/more/records']) {
    await page.goto(origin);

    const link = page.locator(`a[href*="from=${encodeURIComponent(origin)}"]`).first();
    if ((await link.count()) === 0) continue;

    await link.click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();

    const layer = page.locator('.task-detail-layer').last();
    await expect(layer).toHaveAttribute('data-open', 'true');
    await layer
      .getByRole('dialog')
      .getByRole('button', { name: /^Close/ })
      .click();

    await expect(page, `closing a task opened from ${origin} left the screen`).toHaveURL(
      new RegExp(origin.replace(/\//g, '\/') + '$'),
    );
  }
});

/**
 * The origin arrives from the address bar, so it must never be able to send
 * somebody off-site.
 */
test('an external return path is ignored', async ({ page }) => {
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work?tab=available');

  const first = page.locator('.task-row .row-primary-link').first();
  const href = await first.getAttribute('href');
  const taskId = new URL(href!, 'http://localhost').searchParams.get('task');

  await page.goto(`/work?task=${taskId}&from=https%3A%2F%2Fexample.com%2Fevil`);
  const layer = page.locator('.task-detail-layer').last();
  await expect(layer).toHaveAttribute('data-open', 'true');
  await layer
    .getByRole('dialog')
    .getByRole('button', { name: /^Close/ })
    .click();

  // Back inside the application, and nowhere near the host in the parameter.
  await expect(page).toHaveURL(/\/work$/);
  await expect(page).not.toHaveURL(/example\.com/);
});
