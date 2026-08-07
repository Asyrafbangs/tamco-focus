import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function expectHydrated(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expectHydrated(page);
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('employee uses records, attachment history, audit, archive, and personal settings', async ({
  page,
}) => {
  await signIn(page, 'izzah@tamco.local');

  await page.goto('/more');
  await expect(page.getByRole('heading', { name: 'Records and settings' })).toBeVisible();
  await expect(page.getByRole('link', { name: /Completion reviews/ })).toBeVisible();
  await expectAccessible(page);

  await page.goto('/more/records');
  await expect(page.getByRole('heading', { name: 'Records and completion review' })).toBeVisible();
  await expect(page.locator('.record-list, .empty-state').first()).toBeVisible();

  await page.goto('/more/attachments');
  await expect(page.getByRole('heading', { name: 'Attachments' })).toBeVisible();
  await expect(page.getByRole('table')).toBeVisible();

  await page.goto('/more/audit');
  await expect(page.getByRole('heading', { name: 'Audit history' })).toBeVisible();
  await expect(page.locator('.audit-timeline li').first()).toBeVisible();

  await page.goto('/more/archive');
  await expect(page.getByRole('heading', { name: 'Cancelled outcomes' })).toBeVisible();

  await page.goto('/more/settings');
  await expect(page.getByRole('heading', { name: 'Team rules and my preferences' })).toBeVisible();
  await expectHydrated(page);
  await page.getByRole('button', { name: /Accessibility/ }).click();
  await page.getByLabel('Text size').selectOption('large');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Your preferences were saved.')).toBeVisible();
  await expectAccessible(page);
});

test('administrator provisions and safely deletes a history-free local user', async ({
  page,
}, testInfo) => {
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  const employeeId = `E2E-${Date.now().toString().slice(-8)}`;
  const fullName = `E2E User ${suffix}`;
  const email = `e2e-${suffix}@tamco.local`;

  await signIn(page, 'admin@tamco.local');
  await page.goto('/more/admin/users?create=1');
  await expect(page.getByRole('heading', { name: 'User directory' })).toBeVisible();
  await page.getByLabel('Full name').fill(fullName);
  await page.getByLabel('Employee ID', { exact: true }).fill(employeeId);
  await page.getByLabel('Email address', { exact: true }).fill(email);
  await page.getByLabel('Temporary password', { exact: true }).fill(PASSWORD);
  await page
    .locator('.detail-pane select[name="departmentId"]')
    .selectOption('f0c05100-0000-4000-a000-000000000002', { force: true });
  await page.getByRole('button', { name: 'Create user' }).click();
  await expect(page.getByText(`${fullName} can now sign in.`)).toBeVisible();

  await page.getByRole('link', { name: new RegExp(fullName) }).click();
  await expect(page.getByRole('heading', { name: fullName })).toBeVisible();
  await page.getByPlaceholder(`Type ${employeeId}`).fill(employeeId);
  await page.getByRole('button', { name: 'Permanently delete history-free account' }).click();
  await expect(page.getByText('Account permanently deleted.')).toBeVisible();
  await expectAccessible(page);
});

test('administrator previews effective RLS visibility before saving', async ({ page }) => {
  await signIn(page, 'admin@tamco.local');
  await page.goto('/more/admin/visibility');
  await expect(page.getByRole('heading', { name: 'Visibility rules' })).toBeVisible();
  await page.getByRole('link', { name: /Amer Hakim/ }).click();
  await expect(page.getByRole('heading', { name: 'Amer Hakim' })).toBeVisible();
  await page.getByLabel(/Direct reports \+ selected people/).check();
  await page.getByLabel(/Izzah/).check();
  await expect(page.getByRole('heading', { name: 'Effective-access preview' })).toBeVisible();
  await expect(page.locator('.effective-preview').getByText(/Izzah Nurul/)).toBeVisible();
  await page.getByLabel('Reason for change').fill('Browser verification of approved team scope');
  await page.getByRole('button', { name: 'Save visibility rules' }).click();
  await expect(page.getByText('Visibility rules saved and audited.')).toBeVisible();
  await expectAccessible(page);
});
