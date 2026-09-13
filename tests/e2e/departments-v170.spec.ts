import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v170 — a department can be created and changed from the screen.
 *
 * Departments became records in v165, with a parent, a head and a status, but
 * the only way to make one was a database call. This is the small form the
 * brief asked for: name, code, what it sits under, and who heads it.
 *
 * The data changes run on desktop only, and each run uses its own code so the
 * shared database never sees two runs collide. What a run creates it archives
 * again through the same form, which is also how archiving gets exercised.
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

test.describe('v170 departments from the Organisation view', () => {
  test('offers a short form, and Cancel leaves nothing behind', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);

    await page.getByRole('link', { name: '+ Department' }).click();
    const form = page.locator('.org-move-panel');
    await expect(form.getByRole('heading', { name: 'New department' })).toBeVisible();
    await expect(form.getByLabel('Department name')).toBeVisible();
    await expect(form.getByLabel('Code')).toBeVisible();
    await expect(form.getByLabel('Reports under')).toBeVisible();
    await expect(form.getByLabel('Department head')).toBeVisible();

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);

    await form.getByRole('link', { name: 'Cancel' }).click();
    await expect(page.locator('.org-move-panel')).toHaveCount(0);
  });

  test('creates one under a parent with a head, then archives it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The data change runs once.');
    const stamp = Date.now().toString().slice(-7);
    const name = `Fabrication ${stamp}`;
    const code = `FAB${stamp}`;

    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);
    await page.getByRole('link', { name: '+ Department' }).click();

    const form = page.locator('.org-move-panel');
    await form.getByLabel('Department name').fill(name);
    await form.getByLabel('Code').fill(code);
    await form.getByLabel('Reports under').selectOption({ label: 'Operations (OPS)' });
    await form.getByLabel('Department head').selectOption({ label: 'Izzul Asyraf · MGR-100' });
    await form.getByRole('button', { name: 'Create department' }).click();
    await expect(form.getByText(`${name} created.`)).toBeVisible();

    // Read back from the list rather than from the form that just claimed it:
    // under Operations, with its head named.
    await openOrganisation(page);
    const created = page
      .locator('.org-department')
      .filter({ hasText: 'Operations' })
      .locator('.org-department-children .org-department')
      .filter({ hasText: name });
    await expect(created).toContainText('Head: Izzul Asyraf');

    // And archived again through the same form, which removes it from the list.
    await created.getByRole('link', { name: `Edit ${name}` }).click();
    const edit = page.locator('.org-move-panel');
    await expect(edit.getByRole('heading', { name: 'Edit department' })).toBeVisible();
    await edit.getByLabel('Status').selectOption('archived');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText(`${name} saved.`)).toBeVisible();

    await openOrganisation(page);
    await expect(page.locator('.org-department').filter({ hasText: name })).toHaveCount(0);
  });

  test('says which rule a refused department broke', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One attempt is enough.');
    await signIn(page, 'admin@tamco.local');
    await openOrganisation(page);
    await page.getByRole('link', { name: '+ Department' }).click();

    const form = page.locator('.org-move-panel');
    await form.getByLabel('Department name').fill('A second EHS');
    // EHS is seeded, so this code is taken on every database this runs against.
    await form.getByLabel('Code').fill('EHS');
    await form.getByRole('button', { name: 'Create department' }).click();

    await expect(form.getByText('Another department already uses that code.')).toBeVisible();
  });
});
