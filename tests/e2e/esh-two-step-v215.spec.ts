import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * v225 - the accountable department is a combobox: type, then choose.
 *
 * It replaced a select so that a long list can be narrowed and a missing
 * department added without abandoning the form.
 */
async function chooseDepartment(page: Page, name: string) {
  const field = page.getByLabel('Accountable department', { exact: true });
  await field.click();
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

test('v215 a finding is recorded in two steps, with its photograph attached there', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The steps are the same at both widths.');
  const suffix = randomBytes(3).toString('hex');
  const title = `v215 blocked exit ${suffix}`;

  await signIn(page);
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // Two steps, named for what they ask.
  await expect(page.locator('.esh-step')).toHaveCount(2);
  await expect(page.locator('.esh-step').nth(1)).toContainText('Action & follow-up');

  const form = page.locator('form.esh-finding-form');
  await form.getByLabel('Finding title', { exact: true }).fill(title);
  await form.getByLabel('What was found', { exact: true }).fill('Pallets across the fire exit.');
  await chooseDepartment(page, 'Operations');

  // The photograph is chosen where the condition is described.
  await form
    .locator('input[type=file]')
    .first()
    .setInputFiles({
      name: 'exit.png',
      mimeType: 'image/png',
      buffer: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      ),
    });
  // Attached after the department was chosen, which is where a live FileList
  // read too late used to lose it silently.
  await expect(form.getByText('exit.png')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  // Risk is asked for here; priority is not, because it already has an answer.
  await expect(form.getByLabel('Risk', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Action priority', { exact: true })).not.toBeVisible();
  // A level says when it is told, not only who.
  await expect(form.getByText(/after \d+ days? overdue/)).toBeVisible();
  await expect(form.getByText('Stop escalation after this level')).toBeVisible();

  await form.getByLabel('Required outcome', { exact: true }).fill('Clear the exit.');
  await form.getByLabel('Action Owner email', { exact: true }).fill(`two.${suffix}@example.com`);
  await form.getByLabel('Risk', { exact: true }).selectOption('high');
  await form.getByLabel('Due date', { exact: true }).fill('2026-12-18');
  await form.getByText('Stop escalation after this level').click();
  await form.getByLabel('Reason', { exact: true }).fill('Single-level route agreed.');

  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}\?saved=assigned/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  // The evidence belongs to the finding, recorded as the original condition.
  const db = service();
  const { data: finding } = await db
    .from('esh_findings')
    .select('id, risk_level')
    .eq('title', title)
    .single();
  expect(finding!.risk_level).toBe('high');
  const { data: assets } = await db
    .from('esh_evidence_assets')
    .select('original_name, purpose, state')
    .eq('finding_id', finding!.id);
  expect(assets).toHaveLength(1);
  expect(assets![0]!.purpose).toBe('original');
  expect(assets![0]!.state).toBe('ready');
  expect(assets![0]!.original_name).toBe('exit.png');
});
