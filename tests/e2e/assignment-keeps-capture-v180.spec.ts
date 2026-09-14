import { expect, test, type Page } from '@playwright/test';

/**
 * v180 — work assigned from New Work keeps what was chosen for it.
 *
 * A manager choosing somebody else as Primary owner used to have the draft
 * discarded after assignment, which dropped the completion evidence rule and
 * deleted the attached files from storage. Read back here as the person the
 * work was given to: the file is on the task, and still there to open.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v180 assignment from New Work', () => {
  test('work assigned from New Work keeps its files', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The data change runs once.');
    const title = `v179 assigned with a file ${Date.now()}`;

    await signIn(page, 'izzul@tamco.local');
    await open(page, '/today?capture=1');
    await page.getByLabel('What needs to be done?').fill(title);
    await page.getByLabel('Completion evidence').selectOption('file');
    await page.getByLabel('Primary owner').selectOption({ label: 'Amer Hakim' });
    await page.getByText('Add details').click();
    await page.getByLabel('Attach files').setInputFiles({
      name: 'v179-signed-checklist.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('signed'),
    });
    await page.getByRole('button', { name: 'Create work' }).click();
    await expect(page).toHaveURL(/\/work/, { timeout: 20_000 });

    // Read back as the person it was given to.
    await signIn(page, 'amer@tamco.local');
    await open(page, '/work?tab=available');
    await page.getByRole('link', { name: title }).click();
    // Files are listed under Details, which opens on request.
    await page.locator('.task-detail-drawer').getByText('Details', { exact: true }).click();
    const file = page.locator('.task-detail-drawer .attachment-row', {
      hasText: 'v179-signed-checklist.txt',
    });
    await expect(file).toBeVisible();

    // And the stored file is still there to open — discarding the draft used
    // to delete it from storage.
    const href = await file.getAttribute('href');
    expect(href).toBeTruthy();
    const response = await page.request.get(href!, { maxRedirects: 0 });
    expect([200, 303]).toContain(response.status());
  });
});
