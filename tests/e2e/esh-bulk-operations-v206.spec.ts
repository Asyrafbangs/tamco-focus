import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v206 — an owner with several actions, doing them together (§40).
 *
 * Select actions is opt-in, one update reaches each chosen action as its own
 * message, and submitting several is several submissions with a per-item
 * answer. Nothing here finishes an action on the owner's say-so.
 */

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

async function openInbox(page: Page, principalId: string) {
  const secret = randomBytes(32).toString('base64url');
  const { error } = await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: principalId,
      purpose: 'owner_inbox',
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  if (error) throw new Error(error.message);
  await page.context().clearCookies();
  await page.goto(`/respond/access?for=actions#${secret}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = page.getByRole('button', { name: 'Open my actions' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page).toHaveURL(/\/respond\/my-actions/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('v206 an owner updates and submits several actions at once', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered elsewhere.');
  test.setTimeout(120_000);
  const id = crypto.randomUUID().slice(0, 8);
  const owner = `bulk.browser.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;

  const titles = [`v206 walkway ${id}`, `v206 guard ${id}`, `v206 label ${id}`];
  for (const title of titles) {
    const saved = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title,
        description: 'Bulk browser fixture',
        reported_on: '2026-09-10',
        accountable_department_id: ops,
        required_outcome: 'Put it right',
        priority: 'normal',
        owner_email: owner,
        due_date: '2026-12-10',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (!saved.data?.ok) throw new Error(JSON.stringify(saved.data ?? saved.error));
  }

  const backend = service();
  const { data: principal } = await backend
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  await backend
    .from('esh_email_principals')
    .update({ access_enabled: true })
    .eq('id', principal!.id);

  // Two of them ESH agreed can be answered in words. The third still wants a
  // photograph, which is why it is not submitted below.
  const { data: fixtures } = await backend
    .from('esh_finding_actions')
    .select('id, title')
    .in('title', titles);
  await backend
    .from('esh_finding_actions')
    .update({
      evidence_rule: 'no_file_exception',
      evidence_exception_reason: 'Fixture: the work speaks for itself',
    })
    .in(
      'id',
      (fixtures ?? []).filter((action) => action.title !== titles[2]).map((action) => action.id),
    );

  await openInbox(page, principal!.id);
  await expect(page.getByRole('heading', { name: 'My Actions' })).toBeVisible();

  // Selection is opt-in: nothing is tickable until it is asked for.
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Select actions' }).click();
  const rows = page.locator('.guest-actions > li');
  await rows.filter({ hasText: titles[0] }).getByRole('checkbox').check();
  await rows.filter({ hasText: titles[1] }).getByRole('checkbox').check();
  await expect(page.getByText('2 of 3 chosen')).toBeVisible();

  // One update, two actions, and it submits nothing.
  await page.getByRole('button', { name: 'Send a progress update' }).click();
  await page.getByLabel('Your update').fill(`Parts ordered ${id}.`);
  await page.getByRole('button', { name: /^Send update \(2\)$/ }).click();
  await expect(page.getByRole('status')).toContainText('Your update is on 2 actions.');

  const { count: messages } = await backend
    .from('esh_action_messages')
    .select('id', { count: 'exact', head: true })
    .eq('body', `Parts ordered ${id}.`);
  expect(messages).toBe(2);
  const { count: submissions } = await backend
    .from('esh_action_submissions')
    .select('id', { count: 'exact', head: true })
    .eq('owner_email', owner);
  expect(submissions).toBe(0);

  // Submitting several is several submissions, each with its own result.
  await page.getByRole('button', { name: 'Select actions' }).click();
  await rows.filter({ hasText: titles[0] }).getByRole('checkbox').check();
  await rows.filter({ hasText: titles[1] }).getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await page.getByLabel(`Result for ${titles[0]}`).fill('Walkway cleared and marked.');
  await page.getByLabel(`Result for ${titles[1]}`).fill('Guard refitted and tested.');
  await page.getByRole('button', { name: /^Submit these \(2\)$/ }).click();
  await expect(page.getByRole('status')).toContainText('2 actions submitted for review.');

  const { data: pending } = await backend
    .from('esh_action_submissions')
    .select('action_id, version, state')
    .eq('owner_email', owner);
  expect(pending?.length).toBe(2);
  expect(pending?.every((row) => row.state === 'pending')).toBe(true);

  // They moved to Awaiting ESH review; the third is still the owner's.
  await expect(page.getByRole('link', { name: /Awaiting ESH review \(2\)/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /Needs my action \(1\)/ })).toBeVisible();
});
