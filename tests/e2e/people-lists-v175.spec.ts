import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v175 — giving work to somebody starts with your own team.
 *
 * A manager assigning work is nearly always assigning it to the people who
 * report to them, and in a large organisation those few names are scattered
 * through an alphabetical list. The picker now offers them first, under their
 * own heading, with everyone else still below.
 *
 * That the lists reach past two hundred people is proven in the unit suite
 * against an API that pages; eight seeded people cannot show it here.
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

test.describe('v175 your team first', () => {
  test('a manager assigning work sees their direct team first, then everyone else', async ({
    page,
  }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/today?capture=1');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const owner = page.getByLabel('Primary owner');
    await expect(owner).toBeVisible();

    // Amer reports to Izzul, so he is under the team's heading.
    const team = owner.locator('optgroup[label="Your team"]');
    await expect(team.locator('option', { hasText: 'Amer Hakim' })).toHaveCount(1);

    /*
     * Who a manager may assign to is decided by what they may see, and in the
     * seed Izzul sees his own team and nobody else — so there is nobody to put
     * under "Everyone else", and no empty heading is drawn for them. The order
     * with both groups is proven in the unit suite.
     */
    await expect(owner.locator('optgroup[label="Everyone else"]')).toHaveCount(0);
    const loose = await owner.locator(':scope > option').allTextContents();
    expect(loose).toEqual(['Me — Izzul']);

    const accessibility = await new AxeBuilder({ page })
      .include('#capture-primary-owner')
      .analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('somebody with nobody reporting to them gets the plain list, with no empty heading', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The same list on both viewports.');
    await signIn(page, 'admin@tamco.local');
    await page.goto('/today?capture=1');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const owner = page.getByLabel('Primary owner');
    await expect(owner).toBeVisible();
    await expect(owner.locator('optgroup')).toHaveCount(0);
    await expect(owner.locator('option', { hasText: 'Amer Hakim' })).toHaveCount(1);
  });

  test('reassigning a task offers the team first, and everyone else below', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The same list on both viewports.');
    await signIn(page, 'izzul@tamco.local');
    // Amer's seeded evacuation drill: work Izzul manages and may hand on.
    await page.goto('/work?task=f0c05300-0000-4000-a000-000000000008');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await page.getByRole('button', { name: 'More task actions' }).click();
    await page.getByRole('button', { name: 'Reassign owner' }).click();
    const select = page.getByLabel('Who should carry this work?');
    await expect(select).toBeVisible();

    /*
     * Unlike assignment, reassignment chooses from the names-only directory,
     * which is everybody — so here both headings appear. Amer is not offered:
     * he already carries it.
     */
    const team = select.locator('optgroup[label="Your team"]');
    const others = select.locator('optgroup[label="Everyone else"]');
    await expect(team.locator('option', { hasText: 'Izzah Nurul' })).toHaveCount(1);
    await expect(others.locator('option', { hasText: 'System Administrator' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: 'Amer Hakim' })).toHaveCount(0);

    const labels = await select.locator('option').allTextContents();
    expect(labels.indexOf('Izzah Nurul')).toBeLessThan(labels.indexOf('System Administrator'));
  });
});
