import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v177 — finding people by department, and seeing where somebody sits.
 *
 * The brief asked for the chart to be filtered by department rather than drawn
 * whole, and for a search to jump to the person with the line over them and
 * the people under them. Search named the line in words and stopped there.
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

test.describe('v177 finding people in the organisation', () => {
  test('lists a department, names its head, and opens the chart at a person', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);

    // By field name: the select's accessible name includes its chosen option.
    await page
      .locator('select[name="dept"]')
      .selectOption({ label: 'Environment, Health & Safety' });
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page).toHaveURL(/dept=/);

    const results = page.locator('.section-block').filter({
      has: page.getByRole('heading', { name: /in Environment, Health & Safety/ }),
    });
    await expect(results.getByText('Headed by Izzul Asyraf.')).toBeVisible();
    // The name line only: his reports' rows name him too, in their chain.
    await expect(results.locator('.org-match > strong', { hasText: 'Izzul Asyraf' })).toContainText(
      'Head of department',
    );

    const accessibility = await new AxeBuilder({ page }).include('main').analyze();
    expect(accessibility.violations).toEqual([]);

    // Amer reports to Izzul: the chart opens down to him, marked.
    await results.getByRole('link', { name: 'Show Amer Hakim in the chart' }).click();
    await expect(page).toHaveURL(/focus=/);
    const amer = page.locator('.org-node[data-focused="true"]');
    await expect(amer).toHaveCount(1);
    await expect(amer.locator('> .org-person')).toContainText('Amer Hakim');
    // The line over him is open, which is how he came to be drawn at all.
    await expect(
      page
        .locator('.org-tree > .org-node')
        .filter({ hasText: 'Izzul Asyraf' })
        .locator('.org-branch'),
    ).toContainText('Amer Hakim');
  });

  test("a department's People link lists who is in it", async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);

    await page.getByRole('link', { name: 'Show the people in Operations' }).click();
    await expect(page.getByRole('heading', { name: /people? in Operations/ })).toBeVisible();
    await expect(page.getByText('Nobody heads this department yet.')).toBeVisible();
    await expect(page.locator('.org-match').filter({ hasText: 'Lim Wei Sheng' })).toBeVisible();
  });
});
