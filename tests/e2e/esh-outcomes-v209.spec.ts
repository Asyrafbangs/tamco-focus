import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/**
 * v209 — a finding recorded in error, answered for without being called
 * verified (§6), and a schedule that differs for critical work (§16).
 */

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function apiAs(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(error.message);
  return client;
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('v209 a finding typed twice is recorded as a duplicate, not closed', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered elsewhere.');
  test.setTimeout(120_000);
  const id = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;

  const make = async (title: string) => {
    const saved = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title,
        description: 'Outcome fixture',
        reported_on: '2026-09-10',
        accountable_department_id: ops,
        required_outcome: 'Put it right',
        priority: 'normal',
        owner_email: `outcome.owner.${id}@example.com`,
        due_date: '2026-12-10',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (!saved.data?.ok) throw new Error(JSON.stringify(saved.data ?? saved.error));
    return saved.data as { finding_id: string; action_id: string; reference: string };
  };

  const kept = await make(`v209 the real one ${id}`);
  const twice = await make(`v209 typed twice ${id}`);

  await signIn(page);
  await page.goto(`/findings/${twice.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // v223 - rare, so behind the menu under one plain name.
  await page.getByRole('button', { name: 'More actions for this finding' }).click();
  await page.getByRole('button', { name: 'Cancel / mark duplicate' }).click();
  const outcome = page.locator('.esh-finding-outcome');
  await expect(outcome.getByRole('radio')).toHaveCount(3);
  await expect(outcome.getByText('Withdraw')).toHaveCount(0);
  await outcome.getByRole('radio', { name: /Duplicate finding/ }).check();
  await outcome.getByLabel('Reason').fill('Recorded twice on the same walk');
  await outcome.getByLabel('The finding this repeats').fill(kept.finding_id);
  await outcome.getByRole('button', { name: 'Duplicate finding' }).click();

  // The page now says what became of it, and offers no second outcome.
  await expect(page.getByText(`Duplicate of ${kept.reference}`)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Recorded twice on the same walk')).toBeVisible();
  // Once an outcome is recorded nothing is left to administer: no menu at all.
  await expect(page.getByRole('button', { name: 'More actions for this finding' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel / mark duplicate' })).toHaveCount(0);

  // It is not a closure, its work stopped, and the finding it repeats is untouched.
  const backend = service();
  const { data: row } = await backend
    .from('esh_findings')
    .select('status, closed_at, resolved_outcome, duplicate_of_finding_id')
    .eq('id', twice.finding_id)
    .single();
  expect(row).toMatchObject({
    status: 'duplicate',
    closed_at: null,
    resolved_outcome: 'duplicate',
    duplicate_of_finding_id: kept.finding_id,
  });
  const { data: action } = await backend
    .from('esh_finding_actions')
    .select('state')
    .eq('id', twice.action_id)
    .single();
  expect(action?.state).toBe('cancelled');
  const { data: keptRow } = await backend
    .from('esh_findings')
    .select('status')
    .eq('id', kept.finding_id)
    .single();
  expect(keptRow?.status).toBe('open');
});

test('v209 ESH gives critical work its own follow-up schedule', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings are one desktop flow.');
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto('/findings/settings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByRole('heading', { name: 'When the schedule differs' })).toBeVisible();

  const editor = page.locator('form', {
    has: page.getByRole('heading', { name: 'A different schedule for some work' }),
  });
  await editor.getByLabel('Applies to').selectOption('risk');
  await editor.getByLabel('Which').selectOption('critical');
  await editor.getByLabel('Before due date').fill('1');
  await editor.getByLabel('Overdue reminder, every').fill('1');
  await editor.getByRole('button', { name: 'Add this rule' }).click();
  await expect(page.getByText('Rule saved.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'Critical risk' })).toBeVisible();

  // Quiet hours are policy too, and say plainly that escalation is not held.
  const quiet = page.locator('form', {
    has: page.getByRole('heading', { name: 'Quiet hours and catching up' }),
  });
  await quiet.getByLabel('Quiet from').fill('21:00');
  await quiet.getByLabel('Quiet until').fill('07:00');
  await quiet.getByRole('button', { name: 'Save these' }).click();
  await expect(page.getByText('Quiet hours saved.')).toBeVisible({ timeout: 30_000 });

  const { data: policy } = await service()
    .from('esh_followup_policies')
    .select('quiet_from, quiet_to, catch_up')
    .single();
  expect(policy).toMatchObject({ quiet_from: '21:00:00', quiet_to: '07:00:00' });
});
