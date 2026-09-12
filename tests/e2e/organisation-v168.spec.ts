import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v168 — Identity and access answers "where does this person sit?".
 *
 * The Directory maintains accounts and always could. What it could not show is
 * the shape of the organisation: which department sits under which, who heads
 * one, and who reports to whom. This is that half, read-only for now.
 *
 * The rule the tests hold it to is restraint. A chart that draws six hundred
 * people is unusable, so a branch is loaded only when somebody opens it, and
 * search answers with the line above a person rather than a bare name.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v168 the Organisation view', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/more/admin/organisation');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  });

  test('is one of two tabs under a single heading', async ({ page }) => {
    await expect(page.getByRole('heading', { name: 'Identity and access' })).toBeVisible();

    const tabs = page.getByRole('navigation', { name: 'Identity and access' });
    await expect(tabs.getByRole('link', { name: 'Organisation' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The other half of the same job, not a different place.
    await tabs.getByRole('link', { name: 'Directory' }).click();
    await expect(page).toHaveURL(/\/more\/admin\/users/);
    await expect(page.getByRole('heading', { name: 'Identity and access' })).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: 'Identity and access' }).getByRole('link', {
        name: 'Directory',
      }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('gives every department its size and its head, and says when there is none', async ({
    page,
  }) => {
    const departments = page.locator('.org-department');
    await expect(departments.filter({ hasText: 'Environment, Health & Safety' })).toContainText(
      'Head: Izzul Asyraf',
    );
    /*
     * Operations is seeded without a head deliberately. An organisation with no
     * gaps in it would not test the one thing an administrator opens this
     * screen to find.
     */
    await expect(departments.filter({ hasText: 'Operations' })).toContainText('No head');
  });

  test('opens a branch only when asked, and closes it again', async ({ page }) => {
    /*
     * No count of the roots, and no count of the reports.
     *
     * The suite shares one database across both viewports, and several specs
     * provision an account with no reporting manager — which is, correctly,
     * another person at the top of the line. Asserting "two" passed when this
     * spec ran alone and found three on desktop and four on mobile in a full
     * run. The seeded pair is what this test is about, so it names them and
     * reads the rest off the screen.
     */
    const roots = page.locator('.org-tree > .org-node');
    await expect(roots.filter({ hasText: 'System Administrator' })).toContainText('No reports');

    const manager = roots.filter({ hasText: 'Izzul Asyraf' });
    await expect(manager).toHaveCount(1);

    // Nothing below the top is drawn until somebody asks for it.
    await expect(page.locator('.org-branch')).toHaveCount(0);

    await manager.getByRole('link', { name: /Show \d+ reports?/ }).click();
    await expect(page.locator('.org-branch')).toContainText('Amer Hakim');

    await manager.getByRole('link', { name: /Hide \d+ reports?/ }).click();
    await expect(page.locator('.org-branch')).toHaveCount(0);
  });

  test('search says where somebody sits, not only who they are', async ({ page }) => {
    await page.getByLabel('Find a person').fill('Amer');
    await page.getByRole('button', { name: 'Find' }).click();

    const match = page.locator('.org-match').filter({ hasText: 'Amer Hakim' });
    await expect(match).toContainText('EHS Executive');
    // Izzul reports to nobody, so the line above Amer stops there.
    await expect(match.locator('.org-chain')).toContainText('Izzul Asyraf → Amer Hakim');
  });

  test('carries no accessibility violations', async ({ page }) => {
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations).toEqual([]);
  });
});
