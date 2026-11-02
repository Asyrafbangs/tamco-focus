import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION_ID = 'e5e50000-0000-4000-8000-000000000001';

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

test('v272 public reporting remains explicitly closed', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'The policy message is shared; private workflow covers both widths.',
  );

  // The application proxy requires an account before any route renders. Once
  // signed in, the route still makes its safe no-submission/no-notification
  // state explicit rather than exposing an anonymous form.
  await signIn(page);
  await page.goto('/report');
  await expect(
    page.getByRole('heading', { name: 'Safety reporting is not available from this link' }),
  ).toBeVisible();
  await expect(
    page.getByText('This link does not submit a report or notify anyone.'),
  ).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
});

test('v278 a claimed private report becomes one explicitly assigned Finding', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Private intake is validated at the supported desktop and phone layouts.',
  );
  test.setTimeout(120_000);

  const suffix = randomBytes(3).toString('hex');
  const reportText = `v278 missing guard ${suffix}`;
  const title = `v278 press guard ${suffix}`;
  const owner = `owner.${suffix}@example.com`;
  const db = service();
  const { data: department, error: departmentError } = await db
    .from('departments')
    .select('id')
    .eq('code', 'OPS')
    .single();
  expect(departmentError).toBeNull();

  const { data: intake, error: intakeError } = await db
    .from('esh_report_intake')
    .insert({
      organization_id: ORGANIZATION_ID,
      source: 'esh_manual',
      report_text: reportText,
      reported_location: 'BR2 Workshop',
      department_id: department!.id,
    })
    .select('id')
    .single();
  expect(intakeError).toBeNull();

  await signIn(page);
  await page.goto('/findings/intake');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const row = page.locator('.esh-register-row').filter({ hasText: reportText });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Claim for triage' }).click();
  await expect(row.locator('.status-chip')).toHaveText('triaging');
  await row.getByRole('link', { name: 'Review as Finding' }).click();

  await expect(page).toHaveURL(new RegExp(`/findings/new\\?intake=${intake!.id}`));
  const form = page.locator('form.esh-finding-form');
  await expect(form.getByLabel('What was found', { exact: true })).toHaveValue(reportText);
  await expect(form.getByLabel('Location', { exact: true })).toHaveValue('BR2 Workshop');
  await form.getByLabel('Finding title', { exact: true }).fill(title);
  await form.getByRole('button', { name: 'Next' }).click();
  await form
    .getByLabel('Required outcome', { exact: true })
    .fill('Restore the guard before the press is used.');
  await form.getByLabel('Action Owner email', { exact: true }).fill(owner);
  await form.getByLabel('Due date', { exact: true }).fill('2026-12-15');
  await form.getByText('Stop escalation after this level').click();
  await form
    .getByLabel('Reason', { exact: true })
    .fill('The normal escalation route is not set for this fixture.');
  await form.getByRole('button', { name: 'Assign finding' }).click();

  await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}\?saved=assigned/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();

  const sourceReference = `private-intake:${intake!.id}`;
  const { data: finding, error: findingError } = await db
    .from('esh_findings')
    .select('id, source, source_reference, status')
    .eq('source_reference', sourceReference)
    .single();
  expect(findingError).toBeNull();
  expect(finding).toMatchObject({
    source: 'observation',
    source_reference: sourceReference,
    status: 'open',
  });

  const [
    { data: acceptedIntake, error: acceptedIntakeError },
    { data: action, error: actionError },
  ] = await Promise.all([
    db
      .from('esh_report_intake')
      .select('status, accepted_finding_id')
      .eq('id', intake!.id)
      .single(),
    db.from('esh_finding_actions').select('state').eq('finding_id', finding!.id).single(),
  ]);
  expect(acceptedIntakeError).toBeNull();
  expect(acceptedIntake).toMatchObject({ status: 'accepted', accepted_finding_id: finding!.id });
  expect(actionError).toBeNull();
  expect(action).toMatchObject({ state: 'assigned' });
});
