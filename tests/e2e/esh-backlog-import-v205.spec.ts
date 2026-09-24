import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

import { makeXlsx } from '../fixtures/make-xlsx';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * v205 — the backlog somebody has been keeping in Excel, brought in once.
 *
 * The journey the specification describes: upload, choose the sheet and how
 * its dates are written, point the columns at what they mean, look at what
 * each row would become, fix the ones that cannot go, and release the rest.
 */

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('v205 an Excel backlog is mapped, reconciled and released', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One guided flow; layout is covered elsewhere.');
  test.setTimeout(120_000);
  const id = crypto.randomUUID().slice(0, 8);

  // A file in somebody else's shape: a title row above the headings, a row
  // with no corrective action, and dates written day-first.
  const workbook = makeXlsx([
    ['Outstanding ESH findings — 2026'],
    [
      'Finding No',
      'Description of observation',
      'Required corrective action',
      'Department',
      'Owner email',
      'Reported',
      'Target date',
      'Priority',
    ],
    [
      `BL-${id}-1`,
      `Machine guard missing on the press ${id}`,
      'Refit and test the guard',
      'OPS',
      `backlog.one.${id}@example.com`,
      '02/03/2026',
      '01/04/2026',
      'High',
    ],
    [
      `BL-${id}-2`,
      'Spill kit empty in the store',
      '',
      'OPS',
      `backlog.two.${id}@example.com`,
      '04/03/2026',
      '04/04/2026',
      'Normal',
    ],
  ]);

  await signIn(page);
  await page.goto('/findings/register');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.getByRole('button', { name: 'More register tools' }).click();
  await page.getByRole('menuitem', { name: 'Import backlog' }).click();
  await expect(page.getByRole('heading', { name: 'Import a backlog', level: 1 })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  await page.getByLabel('Backlog file').setInputFiles({
    name: `backlog-${id}.xlsx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    buffer: workbook,
  });

  // The headings are on row 2, under a title: the wizard asks rather than
  // assuming row 1 (FM83).
  await expect(page.getByLabel('Heading row')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Heading row').fill('2');
  await page.getByLabel('Dates are written').selectOption('dmy');
  await page.getByLabel('Source register').fill(`Browser register ${id}`);
  await page.getByRole('button', { name: 'Read this sheet' }).click();

  // The mapping is suggested from the headings and shown before it is used.
  await expect(page.getByText('2 rows under row 2')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByLabel('Finding number', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Required corrective action', { exact: true })).toHaveValue('2');
  await page.getByLabel('Owner email', { exact: true }).selectOption('4');
  await page.getByLabel('Reported date', { exact: true }).selectOption('5');
  await page.getByLabel('Target date', { exact: true }).selectOption('6');
  await page.getByLabel('Priority', { exact: true }).selectOption('7');
  await page.getByRole('button', { name: /^Stage 2 rows$/ }).click();

  // Staged: every row accounted for, and nothing live yet.
  await expect(page.getByRole('heading', { name: 'Every row accounted for' })).toBeVisible({
    timeout: 30_000,
  });
  const reconciliation = page.locator('.esh-import-reconciliation');
  const readyCount = reconciliation.getByText('Ready', { exact: true }).locator('..');
  await expect(readyCount).toContainText('1');
  await expect(
    reconciliation.getByText('Needs a decision', { exact: true }).locator('..'),
  ).toContainText('1');

  const blocked = page.locator('.esh-import-rows > li', { hasText: `BL-${id}-2` });
  await expect(blocked).toContainText('No corrective action');

  // ESH writes what the file left out, and the row becomes releasable.
  await blocked.getByLabel(/Corrective action for row/).fill('Restock and seal the spill kit');
  await blocked.getByRole('button', { name: /^Save row/ }).click();
  await expect(readyCount).toContainText('2', { timeout: 30_000 });

  // Release says what it is about to do, including what is already late.
  const release = page.locator('.esh-import-release');
  await expect(release).toContainText('already past their target date');
  await release.getByRole('button', { name: /^Release 2 rows$/ }).click();
  await expect(page.getByText('Each owner has one summary waiting.')).toBeVisible({
    timeout: 30_000,
  });

  // The finding is live, and still as late as the file said it was: a backlog
  // does not become punctual by being imported (§38.3).
  await page.goto(`/findings/register?q=${encodeURIComponent(`press ${id}`)}`);
  // The suite shares one database, so the row is found by this run's own id.
  const listed = page.locator('.esh-register > li', {
    hasText: `Machine guard missing on the press ${id}`,
  });
  await expect(listed).toBeVisible();
  await expect(listed).toContainText(/\d+ days overdue/);

  const { data: action } = await service()
    .from('esh_finding_actions')
    .select('due_at, followup_active_from, finding:esh_findings!inner(source, source_register)')
    .eq('finding.source_register', `Browser register ${id}`)
    .limit(1)
    .single();
  expect(String(action!.due_at)).toContain('2026-04-01');
});
