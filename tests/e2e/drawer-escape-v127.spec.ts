import { expect, test, type Page } from '@playwright/test';

/**
 * v127 — a drawer that is on screen answers Escape.
 *
 * `SideDrawer` kept an `open` flag that exists only to drive the slide-in
 * transition: false on mount, true one animation frame later. `close()` was
 * guarded on it — `if (!open) return` — so for that one frame the drawer was
 * rendered, focused, and silently ignored Escape. Pressing it again worked,
 * which is why it read as "sometimes the drawer stays open" rather than as a
 * reproducible fault.
 *
 * It cost a full-suite run: `team-visibility-v69` failed on about one run in
 * three. Measured before the fix, 2 of 8 attempts landed inside the window and
 * both stayed open; after it, 2 of 24 landed inside it and both closed.
 *
 * This SAMPLES the race rather than forcing it — the window is a single frame
 * and cannot be opened on demand from here, and the honest alternative would
 * be a component-level test that needs a DOM test environment this repo does
 * not have. So it will not catch a regression every time; it will never fail
 * falsely, and `team-visibility-v69` covers the same ground incidentally.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('Escape closes a drawer opened a moment ago, every time', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One pass over the race is enough.');
  await signIn(page, 'admin@tamco.local');

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Izzul Asyraf' });
    await expect(row).toBeVisible();
    await row.focus();
    await page.keyboard.press('Enter');

    /*
     * Waits for the drawer to EXIST, not for it to finish opening. Waiting for
     * the transition would step over the very window this is looking for.
     */
    const drawer = page.locator('.team-member-drawer');
    await drawer.waitFor({ state: 'attached' });
    await page.keyboard.press('Escape');

    await expect(drawer, `attempt ${attempt}: Escape was swallowed`).toHaveCount(0);
    await expect(page).not.toHaveURL(/person=/);
  }
});

test('a second Escape does not queue a second navigation', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One pass is enough.');
  await signIn(page, 'admin@tamco.local');
  await page.goto('/work?scope=team');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Izzul Asyraf' });
  await expect(row).toBeVisible();
  await row.focus();
  await page.keyboard.press('Enter');

  const drawer = page.locator('.team-member-drawer');
  await expect(drawer).toBeVisible();

  /*
   * The guard that was removed also prevented re-entrancy, so its replacement
   * has to keep doing that: two Escapes must not push two history entries and
   * leave Back somewhere surprising.
   */
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).toHaveURL(/scope=team/);

  await page.goBack();
  await expect(page).toHaveURL(/person=/);
});
