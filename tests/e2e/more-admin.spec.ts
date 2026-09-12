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
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
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
  /*
   * Exact, because "Attachments" is a substring of "No matching attachments" —
   * the empty state's own heading. With data present this matched one element
   * and passed; run where that employee has none, and the same line failed on
   * two matches rather than on the thing it is about.
   */
  await expect(page.getByRole('heading', { name: 'Attachments', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Identity and access' })).toBeVisible();
  await page.getByLabel('Full name').fill(fullName);
  await page.getByLabel('Job title').fill('EHS Executive');
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
  // v167 — the title given at creation is stored, not merely accepted.
  await expect(page.getByLabel('Job title')).toHaveValue('EHS Executive');
  await page.getByPlaceholder(`Type ${employeeId}`).fill(employeeId);
  await page.getByRole('button', { name: 'Permanently delete history-free account' }).click();
  await expect(page.getByText('Account permanently deleted.')).toBeVisible();
  await expectAccessible(page);
});

test('the old Visibility rules path lands on the person it described', async ({ page }) => {
  /*
   * Visibility rules used to be its own screen, editing the same policy from
   * the other end — "who is the viewer?" first. The editor now sits on each
   * person's page in the User directory, so the old path redirects there
   * rather than 404ing a bookmark, carrying the viewer through as the
   * selected user.
   */
  await signIn(page, 'admin@tamco.local');
  await page.goto('/more/admin/visibility');
  await expect(page).toHaveURL(/\/more\/admin\/users/);
  await expect(page.getByRole('heading', { name: 'Identity and access' })).toBeVisible();

  // And the More menu offers one door to this, not two.
  await page.goto('/more');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByRole('link', { name: /Visibility rules/ })).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Directory and organisation/ })).toBeVisible();
  await expectAccessible(page);
});
