import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v176 — the Directory keeps both lines, and can say what they were.
 *
 * The brief put the secondary (functional) manager among the things the
 * Directory maintains, and asked that the organisation's history answer "who
 * was this person's manager in March?". The line could be drawn only from the
 * Organisation view, and the history was written but never read.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const TESTER = 'Temporary Tester';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openTester(page: Page) {
  await page.goto('/more/admin/users');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.locator('.master-list a', { hasText: TESTER }).click();
  await expect(page).toHaveURL(/user=/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByRole('heading', { name: TESTER })).toBeVisible();
}

function saveStatus(page: Page) {
  return page.locator('.settings-form [role="status"], .settings-form [role="alert"]').first();
}

test.describe('v176 the Directory keeps both lines', () => {
  test('offers the dotted line and answers who somebody reported to on a date', async ({
    page,
  }) => {
    await signIn(page, 'admin@tamco.local');
    await openTester(page);

    await expect(page.getByLabel('Dotted-line manager (optional)')).toBeVisible();
    await expect(page.getByText('It gives that person no sight of their work.')).toBeVisible();

    const history = page.locator('.admin-history-section');
    await expect(history.getByRole('heading', { name: 'Reporting history' })).toBeVisible();
    await history.getByLabel('Who did Temporary report to on').fill('2026-01-15');
    await history.getByRole('button', { name: 'Check' }).click();
    await expect(page).toHaveURL(/on=2026-01-15/);
    // Whatever the record holds, the answer is a sentence about this person.
    await expect(page.locator('.admin-history-section .notice')).toContainText('Temporary');

    const accessibility = await new AxeBuilder({ page }).include('.detail-pane').analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('draws a dotted line from the Directory, records it, and takes it away', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The data change runs once.');
    await signIn(page, 'admin@tamco.local');
    await openTester(page);

    await page
      .getByLabel('Dotted-line manager (optional)')
      .selectOption({ label: 'Amer Hakim · EMP-201' });
    await page.getByRole('button', { name: /^Save user$/ }).click();
    await expect(saveStatus(page)).toContainText('with a dotted line to Amer Hakim');

    // Read back: the history the move wrote, and the chart.
    await openTester(page);
    await expect(page.locator('.reporting-history')).toContainText(
      'Dotted line: None → Amer Hakim',
    );
    await expect(page.getByLabel('Dotted-line manager (optional)')).toHaveValue(/.+/);

    // The same person on both lines is refused, and nothing is written.
    // By field name: a select inside its label carries its chosen option in its
    // accessible name, so neither a loose nor an exact label match is one field.
    const reportingManager = await page.locator('select[name="reportingManagerId"]').inputValue();
    await page.getByLabel('Dotted-line manager (optional)').selectOption(reportingManager);
    await page.getByRole('button', { name: /^Save user$/ }).click();
    await expect(saveStatus(page)).toContainText('already the reporting manager');

    // And taken away through the same form.
    await openTester(page);
    await page.getByLabel('Dotted-line manager (optional)').selectOption('');
    await page.getByRole('button', { name: /^Save user$/ }).click();
    await expect(saveStatus(page)).toContainText('Saved.');
    await expect(saveStatus(page)).not.toContainText('dotted line');

    await page.goto('/more/admin/organisation');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await page.getByLabel('Find a person').fill(TESTER);
    await page.getByRole('button', { name: 'Find' }).click();
    await expect(page.locator('.org-match').filter({ hasText: TESTER })).toBeVisible();
    await expect(page.locator('.org-person').filter({ hasText: TESTER })).toHaveCount(0);
  });
});
