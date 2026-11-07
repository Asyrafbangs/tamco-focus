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

  /*
   * v288 built the submission path and moved the gate into the database, so
   * `/report` is now public and no longer the closed page: it tells a visitor
   * without a code where the code is. The claim this case exists to hold is
   * unchanged, and now lives one address along - a sticker's own page, while
   * the channel is closed, must say it submits nothing and must offer no form.
   *
   * No sign-in: the route is reachable without an account by design, which is
   * the whole point of a QR code on a wall.
   */
  await page.goto('/report');
  await expect(page.getByRole('heading', { name: 'Scan the sticker to report' })).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);

  // A code nobody issued, and a channel nobody has opened, reach the same
  // page - deliberately, because telling a stranger which of the two it is
  // would tell them about the plant's own arrangements.
  await page.goto('/report/BR2-NOT-A-REAL-CODE');
  await expect(
    page.getByRole('heading', { name: 'Safety reporting is not available from this link' }),
  ).toBeVisible();
  await expect(page.getByText(/does not submit a report or notify anyone/)).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Send report' })).toHaveCount(0);
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

  /*
   * v293 — the review happens where the report is, not on a second page.
   *
   * The queue and the decision are one screen now, so this drives the
   * workspace: pick the report, keep it for triage, correct what needs
   * correcting under Report details, and assign. Every assertion about what
   * the database ends up holding is unchanged, because none of that changed.
   */
  await signIn(page);
  await page.goto(`/findings/intake?report=${intake!.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.esh-intake-item').filter({ hasText: reportText })).toBeVisible();
  await expect(page.locator('.esh-intake-original')).toContainText(reportText);
  await expect(page.locator('.esh-intake-original')).toContainText('BR2 Workshop');

  // Claimed explicitly, and the queue says so.
  await page.locator('summary').filter({ hasText: 'Not enough to act on' }).click();
  await page.getByRole('button', { name: 'Keep for triage' }).click();
  await expect(
    page.locator('.esh-intake-item').filter({ hasText: reportText }).locator('.flag'),
  ).toHaveText('Being triaged', { timeout: 30_000 });

  const form = page.locator('form.esh-finding-form');
  // What the report said, carried into the finding and still editable.
  await form.locator('summary').filter({ hasText: 'Report details' }).click();
  await expect(form.getByLabel('What was found', { exact: true })).toHaveValue(reportText);
  await expect(form.getByLabel('Location', { exact: true })).toHaveValue('BR2 Workshop');
  await form.getByLabel('Finding title', { exact: true }).fill(title);
  await form
    .getByLabel('Required outcome', { exact: true })
    .fill('Restore the guard before the press is used.');
  await form.getByLabel('Action Owner email', { exact: true }).fill(owner);
  await form.getByLabel('Due date', { exact: true }).fill('2026-12-15');
  await form.getByText('Stop escalation after this level').click();
  await form
    .getByLabel('Reason', { exact: true })
    .fill('The normal escalation route is not set for this fixture.');
  await form.getByRole('button', { name: /^Assign( & next)?$|^Assign finding$/ }).click();

  /*
   * v293 — back to the queue, not onto the finding. Somebody working through
   * a day's reports wants the next one; the finding is one click from the
   * confirmation. Everything below checks what was actually written, which is
   * the part that has to be true either way.
   */
  await expect(page).toHaveURL(/\/findings\/intake/, { timeout: 30_000 });
  await expect(page.locator('.esh-intake-item').filter({ hasText: reportText })).toHaveCount(0);

  const sourceReference = `private-intake:${intake!.id}`;
  const { data: finding, error: findingError } = await db
    .from('esh_findings')
    .select('id, reference, source, source_reference, status')
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

  const duplicateText = `v278 duplicate guard ${suffix}`;
  const { data: duplicateIntake, error: duplicateIntakeError } = await db
    .from('esh_report_intake')
    .insert({
      organization_id: ORGANIZATION_ID,
      source: 'esh_manual',
      report_text: duplicateText,
      department_id: department!.id,
    })
    .select('id')
    .single();
  expect(duplicateIntakeError).toBeNull();

  await page.goto(`/findings/intake?report=${duplicateIntake!.id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const duplicateRow = page.locator('.esh-intake-item').filter({ hasText: duplicateText });
  await expect(duplicateRow).toBeVisible();
  // v293 — one of the three decisions that are not "assign this".
  const other = page.locator('.esh-intake-other');
  await other.locator('summary').filter({ hasText: 'Existing finding' }).click();
  const duplicateForm = other.locator('form').first();
  await duplicateForm.getByLabel('Existing Finding reference').fill(finding!.reference);
  await duplicateForm.getByLabel('Reason').fill('It describes the same press guard.');
  await duplicateForm.getByRole('button', { name: 'Link duplicate without action' }).click();
  await expect(duplicateRow).toHaveCount(0);

  const { data: duplicateState, error: duplicateStateError } = await db
    .from('esh_report_intake')
    .select('status, duplicate_of_finding_id')
    .eq('id', duplicateIntake!.id)
    .single();
  expect(duplicateStateError).toBeNull();
  expect(duplicateState).toMatchObject({
    status: 'duplicate',
    duplicate_of_finding_id: finding!.id,
  });
});
