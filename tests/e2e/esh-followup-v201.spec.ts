import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

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
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
}

test('v201 ESH can review the policy and its maintained working-day calendar', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Desktop and mobile policy layouts.',
  );
  await signIn(page);
  await page.goto('/findings/settings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByRole('heading', { name: 'Follow-up settings' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Owner reminders' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Escalation timing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ESH review follow-up' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Working-day calendar' })).toBeVisible();
  await expect(page.getByText(/not a Malaysian holiday calendar/i)).toBeVisible();

  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByText(/Policy saved for new assignments/)).toBeVisible();
  await page.getByRole('button', { name: 'Save calendar' }).click();
  await expect(page.getByText('Working-day calendar saved.')).toBeVisible();
});

test('v201 an escalation recipient can respond and acknowledge, but cannot act as owner', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Desktop and mobile guest layouts.',
  );
  test.setTimeout(120_000);
  const id = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 7)}`;
  const owner = `owner.v201.${id}@example.com`;
  const supervisor = `supervisor.v201.${id}@example.com`;
  const title = `v201 escalation ${id}`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data: saved, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'A correction is overdue.',
      reported_on: '2026-09-10',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Complete the agreed correction.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-09-18',
      escalation: [{ level: 1, email: supervisor }],
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !saved?.ok) throw new Error(error?.message ?? JSON.stringify(saved));

  const backend = service();
  const { data: principal } = await backend
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', supervisor)
    .single();
  await backend
    .from('esh_email_principals')
    .update({ access_enabled: true })
    .eq('id', principal!.id);
  await backend.rpc('esh_run_followups', { p_now: '2026-09-20T01:00:00.000Z' });

  const secret = randomBytes(32).toString('base64url');
  const { error: grantError } = await backend.from('esh_access_grants').insert({
    organization_id: ORGANIZATION,
    principal_id: principal!.id,
    purpose: 'escalation_action',
    action_id: saved.action_id,
    assignment_version: 1,
    token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
    issued_reason: 'notification',
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  });
  if (grantError) throw new Error(grantError.message);

  await page.context().clearCookies();
  await page.goto(`/respond/access?for=action#${secret}`);
  await page.getByRole('button', { name: 'Open action' }).click();
  await expect(page).toHaveURL(new RegExp(`/respond/actions/${saved.action_id}$`));
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  // The response composer is a client component: a tap before it is listening
  // does nothing at all, which under a loaded suite reads as a lost message.
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByText('Escalation level 1', { exact: true })).toBeVisible();
  await expect(page.getByText(/remains assigned to the Action Owner/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'My Actions' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);

  const response = `Supporting the owner ${id}.`;
  await page.getByLabel('Respond to ESH and the Action Owner').fill(response);
  await page.getByRole('button', { name: 'Send response' }).click();
  await expect(page.getByText(response, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Acknowledge level 1' }).click();
  await expect(page.getByText(/Level 1 acknowledged/)).toBeVisible();

  const { data: action } = await backend
    .from('esh_finding_actions')
    .select('state')
    .eq('id', saved.action_id)
    .single();
  expect(action?.state).toBe('assigned');
});
