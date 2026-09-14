import { expect, test, type Page } from '@playwright/test';

/**
 * v182 — a save after the session ended goes to sign-in, and back.
 *
 * Found by clearing the session while forms were open and pressing Save on New
 * Work, an update, a Directory record, a department and Settings: every one
 * landed on the workspace error page, which said the failure "was a read, not a
 * save" and to check the local database. Now the person is told their session
 * ended, signs in, and is returned to the page they were on.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

test('a save after the session ended asks to sign in, then returns to the page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Session handling is viewport independent.');
  await page.goto('/sign-in');
  await signIn(page, 'admin@tamco.local');
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });

  await page.goto('/more/admin/users');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.locator('.master-list a', { hasText: 'Lim Wei Sheng' }).click();
  await expect(page).toHaveURL(/user=/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const personUrl = new URL(page.url());

  // The session ends while the form is open.
  await page.context().clearCookies();
  await page.getByRole('button', { name: /^Save user$/ }).click();

  await expect(page).toHaveURL(/\/sign-in\?session=ended/, { timeout: 20_000 });
  await expect(page.getByText('Your session ended')).toBeVisible();
  await expect(page.getByText('Something went wrong')).toHaveCount(0);

  await signIn(page, 'admin@tamco.local');
  // Back on the same record, not merely the same screen.
  await expect(page).toHaveURL(
    (url) =>
      url.pathname === personUrl.pathname &&
      url.searchParams.get('user') === personUrl.searchParams.get('user'),
    { timeout: 30_000 },
  );
});
