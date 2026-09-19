import { expect, test, type Page } from '@playwright/test';

/**
 * v179 — choices that did nothing.
 *
 * Reported as "selected item not function", and found in three places by
 * working every select and checkbox on the admin and assignment screens:
 * filters that ignored a chosen option until a separate button was pressed,
 * visibility ticks that could not be ticked, and people to invite that could
 * only be chosen one at a time. New Work assigned to somebody else losing its
 * evidence rule and files is v180.
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

test.describe('v179 a chosen option does something', () => {
  test('filters apply when an option is chosen, without a second button', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');

    await open(page, '/more/admin/users');
    await page.locator('select[name="status"]').selectOption('deactivated');
    await expect(page).toHaveURL(/status=deactivated/);

    await open(page, '/more/admin/organisation');
    await page.locator('select[name="dept"]').selectOption({ label: 'Operations' });
    await expect(page).toHaveURL(/dept=/);
    await expect(page.getByRole('heading', { name: /in Operations/ })).toBeVisible();

    await open(page, '/more/records');
    await page.getByText('Filter records').click();
    await page.locator('select[name="state"]').selectOption('cancelled');
    await expect(page).toHaveURL(/state=cancelled/);
  });

  test('arrowing through a filter by keyboard waits until the field is left', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Keyboard, not layout.');
    await signIn(page, 'admin@tamco.local');
    await open(page, '/more/admin/users');

    const status = page.locator('select[name="status"]');
    await status.focus();
    await page.keyboard.press('ArrowDown');
    // Held: an arrow press is a step through the options, not a choice.
    await page.waitForTimeout(800);
    await expect(page).not.toHaveURL(/status=/);
    await page.keyboard.press('Tab');
    await expect(page).toHaveURL(/status=/);
  });

  test('a department chosen before the scripts arrive still applies', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Timing, not layout.');
    await signIn(page, 'admin@tamco.local');

    // The filter bar is on screen and answering the pointer while the page's
    // scripts are still coming down, so a quick choice arrives before anything
    // is listening and the change is simply lost. Holding the scripts back
    // makes that window wide enough to choose in; under a loaded full suite it
    // opened on its own once, and the list stayed as it was (v199).
    await page.route('**/*.js', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    await page.goto('/more/admin/organisation', { waitUntil: 'commit' });

    const dept = page.locator('select[name="dept"]');
    await dept.waitFor();
    await dept.selectOption({ label: 'Operations' });
    await expect(page).not.toHaveURL(/dept=/);

    await page.unroute('**/*.js');
    await expect(page).toHaveURL(/dept=/, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: /in Operations/ })).toBeVisible();
  });

  test('ticking a person under "No team visibility" switches the mode, visibly', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Nothing is saved; one viewport suffices.');
    await signIn(page, 'admin@tamco.local');
    await open(page, '/more/admin/users');
    await page.locator('.master-list a', { hasText: 'Lim Wei Sheng' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const section = page.locator('.admin-visibility-section');
    await section.getByRole('radio', { name: /No team visibility/ }).check();
    await expect(
      section.getByText('Ticking a person switches it to Specific people only.'),
    ).toBeVisible();

    const first = section.getByRole('checkbox').first();
    await first.check();
    await expect(first).toBeChecked();
    await expect(section.getByRole('radio', { name: /Specific people only/ })).toBeChecked();
  });
});
