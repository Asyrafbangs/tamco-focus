import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v174 — importing the organisation, checked before anything is written.
 *
 * What these hold the screen to: a file is checked and its problems are named,
 * in counts and by row, before any button that writes appears; applying writes
 * what the check said, and the chart shows it; and the organisation can be
 * downloaded as the file to start from. The planner's rules are proven in the
 * integration suite, on accounts made for the purpose.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'Izzul Asyraf';
const TESTER = 'Temporary Tester';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openImport(page: Page) {
  await page.goto('/more/admin/organisation?import=1');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const panel = page.locator('.org-import');
  await expect(panel.getByRole('heading', { name: 'Import organisation' })).toBeVisible();
  return panel;
}

async function checkFile(page: Page, name: string, csv: string) {
  const panel = await openImport(page);
  await panel.getByLabel('CSV file').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv, 'utf8'),
  });
  await panel.getByRole('button', { name: 'Check file' }).click();
  await expect(panel.getByText(`Checked ${name}. Nothing has been written yet.`)).toBeVisible();
  return panel;
}

async function testerRow(page: Page) {
  await page.goto('/more/admin/organisation');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page
    .locator('.org-tree > .org-node')
    .filter({ hasText: IZZUL })
    .getByRole('link', { name: /Show \d+ reports?/ })
    .click();
  await expect(page.locator('.org-branch')).toContainText(TESTER);
  return page.locator('.org-person').filter({ hasText: TESTER });
}

test.describe('v174 importing the organisation', () => {
  test('checks a file and names what is wrong with it, before anything can be written', async ({
    page,
  }) => {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/more/admin/organisation');
    await page.getByRole('link', { name: 'Import organisation' }).click();
    await expect(page).toHaveURL(/import=1/);

    const panel = await checkFile(
      page,
      'reorganisation.csv',
      [
        'employee_id,department_code,manager_employee_id',
        'EMP-201,EHS,MGR-100',
        'TMP-900,NOPE,MGR-100',
        'ZZ-404,EHS,MGR-100',
        'EMP-202,EHS,ZZ-405',
      ].join('\n'),
    );

    const counts = panel.locator('.org-import-counts');
    await expect(counts).toContainText('0 ready to change');
    await expect(counts).toContainText('1 already matches');
    await expect(counts).toContainText('3 cannot be applied');

    const kinds = panel.locator('.org-import-kinds');
    await expect(kinds).toContainText('1 person not in the Directory');
    await expect(kinds).toContainText('1 unknown department');
    await expect(kinds).toContainText('1 missing manager');

    // Each problem by the row it is on, so the spreadsheet can be fixed.
    const problemRow = panel
      .getByRole('list', { name: 'Rows that cannot be applied' })
      .getByRole('listitem')
      .filter({ hasText: 'TMP-900' });
    await expect(problemRow).toContainText('Row 3');
    await expect(problemRow).toContainText('No department has the code NOPE.');
    // The sentence is on screen, not off the edge of a phone behind a scroll.
    const sentence = await problemRow.getByText('No department has the code NOPE.').boundingBox();
    const viewport = page.viewportSize();
    expect(sentence && viewport && sentence.x + sentence.width <= viewport.width).toBe(true);

    // Nothing to apply, so no button that writes.
    await expect(panel.getByText('Nothing in this file would change anybody.')).toBeVisible();
    await expect(panel.getByRole('button', { name: /^Apply/ })).toHaveCount(0);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);

    await panel.getByRole('button', { name: 'Choose another file' }).click();
    await expect(panel.getByLabel('CSV file')).toBeVisible();
  });

  test('applies what the check promised, and the chart shows it', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The data change runs once.');
    await signIn(page, 'admin@tamco.local');

    const panel = await checkFile(
      page,
      'titles.csv',
      'employee_id,job_title\nTMP-900,Import check\n',
    );
    await expect(panel.locator('.org-import-counts')).toContainText('1 ready to change');
    await panel.getByText('Show the 1 change').click();
    await expect(panel.locator('.org-import-changes')).toContainText(
      'Job title: None → Import check',
    );

    await panel.getByLabel('Reason (optional)').fill('v174 import check');
    await panel.getByRole('button', { name: 'Apply 1 change' }).click();
    await expect(panel.getByText('1 change applied from titles.csv.')).toBeVisible();

    // Read back from the chart, not from the panel that claimed it.
    await expect(await testerRow(page)).toContainText('Import check · TMP-900');

    // And put back the same way, leaving the fixture as it was found.
    const again = await checkFile(page, 'titles-back.csv', 'employee_id,job_title\nTMP-900,\n');
    await again.getByRole('button', { name: 'Apply 1 change' }).click();
    await expect(again.getByText('1 change applied from titles-back.csv.')).toBeVisible();
    await expect(await testerRow(page)).not.toContainText('Import check');
  });

  test('downloads the organisation as the file to start from, for administrators only', async ({
    page,
    playwright,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A request, not a layout.');
    await signIn(page, 'admin@tamco.local');

    const response = await page.request.get('/more/admin/organisation/export');
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    expect(response.headers()['content-disposition']).toMatch(
      /attachment; filename="organisation-/,
    );
    // The byte-order mark is there for Excel; the header is what follows it.
    const text = (await response.text()).replace(/^\uFEFF/, '');
    expect(text.split('\r\n')[0]).toBe(
      'employee_id,name,email,department_code,job_title,manager_employee_id,functional_manager_employee_id',
    );
    expect(text).toContain('TMP-900,Temporary Tester,');

    const stranger = await playwright.request.newContext({ baseURL });
    const refused = await stranger.get('/more/admin/organisation/export', { maxRedirects: 0 });
    expect(refused.status()).not.toBe(200);
    expect(await refused.text()).not.toContain('TMP-900');
    await stranger.dispose();
  });
});
