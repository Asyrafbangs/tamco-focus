import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v171 — the organisation's gaps, stated.
 *
 * People nobody placed, people with no department, people still reporting to a
 * deactivated account, and departments with no head: every one was already in
 * the records, and no screen said so.
 *
 * Nothing here counts. The database is shared across both viewports and across
 * specs that provision accounts with no manager, so the total moves with
 * whatever ran before. The seed leaves two gaps on purpose — Operations has no
 * head, and the System Administrator has nobody above or below — and the tests
 * name those.
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

async function openOrganisation(page: Page) {
  await page.goto('/more/admin/organisation');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v171 organisation issues', () => {
  test('names the gaps the records hold, and opens each to who it concerns', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);

    const panel = page.locator('.org-issues');
    await expect(panel.getByRole('heading', { name: /organisation issues?/i })).toBeVisible();

    // Nothing listed until a line is opened: a summary, not a wall.
    await expect(panel.locator('.org-issue-items')).toHaveCount(0);

    const noHead = panel.locator('[data-issue="noHead"]');
    await noHead.getByRole('link', { name: 'Show departments with no head' }).click();
    await expect(noHead.locator('.org-issue-items')).toContainText('Operations');

    const unplaced = page.locator('.org-issues [data-issue="unplaced"]');
    await unplaced
      .getByRole('link', { name: 'Show people with no manager and no reports' })
      .click();
    await expect(unplaced.locator('.org-issue-items')).toContainText('System Administrator');

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('each gap leads to the control that fixes it', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);

    const noHead = page.locator('.org-issues [data-issue="noHead"]');
    await noHead.getByRole('link', { name: 'Show departments with no head' }).click();
    await noHead.getByRole('link', { name: 'Edit Operations' }).click();

    // The department form, already on Operations: the fix is one choice away.
    const form = page.locator('.org-move-panel');
    await expect(form.getByRole('heading', { name: 'Edit department' })).toBeVisible();
    await expect(form.getByLabel('Department name')).toHaveValue('Operations');

    await openOrganisation(page);
    const unplaced = page.locator('.org-issues [data-issue="unplaced"]');
    await unplaced
      .getByRole('link', { name: 'Show people with no manager and no reports' })
      .click();
    await unplaced
      .getByRole('link', { name: 'Change who System Administrator reports to' })
      .click();
    await expect(
      page.locator('.org-move-panel').getByRole('heading', { name: 'Change reporting line?' }),
    ).toBeVisible();
  });
});
