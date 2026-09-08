import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v135 — evidence goes up one file at a time.
 *
 * A single request carrying five photographs fails as one thing: everything is
 * discarded, and somebody on a plant network starts again from the camera roll
 * — which is where people give up and complete the work with no evidence at
 * all. Per file, a failure names itself, offers Retry, and leaves the ones
 * that worked attached.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Opens the completion form of the first task that can actually be completed. */
async function openCompletion(page: Page): Promise<boolean> {
  for (const tab of ['active', 'available']) {
    await page.goto(`/work?tab=${tab}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await showActiveWork(page);
    const rows = page.locator('.task-row .title-link');
    const total = await rows.count();
    for (let index = 0; index < total; index += 1) {
      await page.goto(`/work?tab=${tab}`);
      await showActiveWork(page);
      await rows.nth(index).click();
      await expect(page.locator('.task-detail-drawer')).toBeVisible();
      const complete = page.getByRole('button', { name: /^Complete work$/ }).first();
      if ((await complete.count()) > 0 && (await complete.isEnabled())) {
        await complete.click();
        await expect(page.locator('.evidence-target')).toBeVisible();
        return true;
      }
    }
  }
  return false;
}

const csv = (name: string, body: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(body),
});

test('several files at once, each reporting its own outcome', async ({ page }) => {
  await signIn(page, 'izzah@tamco.local');
  if (!(await openCompletion(page))) test.skip(true, 'Nothing completable in this seed.');

  // Multi-select, not one at a time: nobody should choose, add, choose, add.
  await page
    .locator('.evidence-zone input[type="file"]')
    .first()
    .setInputFiles([csv('reading-one.csv', 'a,b\n1,2\n'), csv('reading-two.csv', 'c,d\n3,4\n')]);

  await expect(page.locator('.evidence-list-head')).toContainText('2 files attached', {
    timeout: 20_000,
  });

  const rows = page.locator('.evidence-item');
  await expect(rows).toHaveCount(2);
  // Each row states where that file got to, rather than one status for the batch.
  await expect(rows.first()).toContainText('Attached');
  await expect(rows.nth(1)).toContainText('Attached');
});

test('a file already on the record cannot be tidied away from the form', async ({ page }) => {
  await signIn(page, 'izzah@tamco.local');
  if (!(await openCompletion(page))) test.skip(true, 'Nothing completable in this seed.');

  await page
    .locator('.evidence-zone input[type="file"]')
    .first()
    .setInputFiles([csv('attached.csv', 'a\n1\n')]);
  await expect(page.locator('.evidence-item')).toContainText('Attached', { timeout: 20_000 });

  /*
   * Removing evidence from the work is an operation on the record, with its
   * own authority and its own audit entry. Offering × here would make it look
   * like a tidy-up of a form, and quietly leave the file attached anyway.
   */
  await expect(page.locator('.evidence-item .evidence-remove')).toHaveCount(0);
});

test('the completion counts what is attached, not what was chosen', async ({ page }) => {
  await signIn(page, 'izzah@tamco.local');
  if (!(await openCompletion(page))) test.skip(true, 'Nothing completable in this seed.');

  await page
    .locator('.evidence-zone input[type="file"]')
    .first()
    .setInputFiles([csv('proof.csv', 'a\n1\n')]);
  await expect(page.locator('.evidence-item')).toContainText('Attached', { timeout: 20_000 });

  /*
   * The files were uploaded as they arrived, so the form must not post them a
   * second time. A hidden input still named `files` would attach every one of
   * them twice — once here and once again on submit.
   */
  const named = await page.locator('.evidence-zone input[type="file"][name]').count();
  expect(named, 'the zone still posts its files with the form').toBe(0);

  // The dialog's submit, not the drawer's button that opened it, nor the
  // backdrop that shares the accessible name.
  await page
    .getByRole('dialog', { name: 'Complete work' })
    .getByRole('button', { name: 'Complete work' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Complete work' })).toHaveCount(0, {
    timeout: 20_000,
  });
});
