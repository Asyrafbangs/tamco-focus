import { expect, test, type Page } from '@playwright/test';

import { makeXlsx } from '../fixtures/make-xlsx';

/**
 * v178 — the organisation file as an Excel workbook.
 *
 * The same file as the v174 check, saved as .xlsx instead of CSV: the counts
 * and the problems must come out the same, because a workbook is read into
 * the same rows and checked by the same planner.
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

test('an Excel workbook is checked exactly as its CSV would be', async ({ page }) => {
  await signIn(page, 'admin@tamco.local');
  await page.goto('/more/admin/organisation?import=1');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const panel = page.locator('.org-import');

  await panel.getByLabel('Excel or CSV file').setInputFiles({
    name: 'reorganisation.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: makeXlsx([
      ['Employee ID', 'Department code', 'Manager employee ID'],
      ['EMP-201', 'EHS', 'MGR-100'],
      ['TMP-900', 'NOPE', 'MGR-100'],
      ['ZZ-404', 'EHS', 'MGR-100'],
      ['EMP-202', 'EHS', 'ZZ-405'],
    ]),
  });
  await panel.getByRole('button', { name: 'Check file' }).click();
  await expect(
    panel.getByText('Checked reorganisation.xlsx. Nothing has been written yet.'),
  ).toBeVisible();

  const counts = panel.locator('.org-import-counts');
  await expect(counts).toContainText('0 ready to change');
  await expect(counts).toContainText('1 already matches');
  await expect(counts).toContainText('3 cannot be applied');
  await expect(panel.locator('.org-import-kinds')).toContainText('1 unknown department');
  await expect(
    panel
      .getByRole('list', { name: 'Rows that cannot be applied' })
      .getByRole('listitem')
      .filter({ hasText: 'TMP-900' }),
  ).toContainText('Row 3');
});

test('the old .xls format is named, not misread', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A message, not a layout.');
  await signIn(page, 'admin@tamco.local');
  await page.goto('/more/admin/organisation?import=1');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const panel = page.locator('.org-import');

  await panel.getByLabel('Excel or CSV file').setInputFiles({
    name: 'old.xls',
    mimeType: 'application/vnd.ms-excel',
    buffer: Buffer.from('not really a workbook'),
  });
  await panel.getByRole('button', { name: 'Check file' }).click();
  await expect(panel.getByText('That is the old Excel format.', { exact: false })).toBeVisible();
});
