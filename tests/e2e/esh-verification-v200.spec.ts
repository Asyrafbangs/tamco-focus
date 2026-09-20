import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v200 — ESH decides (docs/specs/..._v1.3.md §13, §14). FM22-FM29, FM52.
 *
 * The queue, the before-and-after review, asking for more, accepting and
 * closing, reopening, and the two changes only ESH can make: the due date
 * and the owner.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
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

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

function stamp(project: string) {
  return `${project.slice(0, 1)}${crypto.randomUUID().slice(0, 6)}`;
}

/** An action whose owner has submitted a correction, waiting for ESH. */
async function submitted(id: string, ownerEmail: string) {
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const title = `v200 guard ${id}`;
  const { data: saved, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'Guard missing on press 2.',
      reported_on: '2026-09-18',
      accountable_department_id: departments?.[0]?.id,
      location: 'Workshop',
      required_outcome: 'Refit the guard.',
      priority: 'normal',
      owner_email: ownerEmail,
      due_date: '2026-12-15',
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !saved?.ok)
    throw new Error(`assign failed: ${error?.message ?? JSON.stringify(saved)}`);
  const admin = await apiAs('admin@tamco.local');
  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', ownerEmail.toLowerCase())
    .single();
  await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'e2e',
  });
  const session = await ownerSession(contact!.id as string, saved.action_id as string);
  const submissionId = await submit(session, saved.action_id as string, 'Guard refitted.', id);
  return {
    title,
    ownerEmail,
    principalId: contact!.id as string,
    actionId: saved.action_id as string,
    findingId: saved.finding_id as string,
    session,
    submissionId,
  };
}

/** A guest session for the owner, opened the way a mailed link opens one. */
async function ownerSession(principalId: string, actionId: string) {
  const secret = randomBytes(32).toString('base64url');
  await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: principalId,
      purpose: 'owner_action',
      action_id: actionId,
      assignment_version: 1,
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  const session = randomBytes(32).toString('base64url');
  const { data } = await service().rpc('esh_guest_exchange', {
    p_token: secret,
    p_new_session: session,
    p_existing_session: null,
    p_challenge: null,
    p_consume: true,
  });
  if (!data?.ok) throw new Error(`exchange failed: ${JSON.stringify(data)}`);
  return session;
}

async function submit(session: string, actionId: string, body: string, key: string) {
  const client = service();
  const { data: started } = await client.rpc('esh_guest_start_upload', {
    p_session: session,
    p_action_id: actionId,
    p_name: 'after.jpg',
    p_size: JPEG.byteLength,
  });
  const assetId = (started as { asset_id: string }).asset_id;
  const objectKey = (started as { object_key: string }).object_key;
  const { data: signed } = await client.storage
    .from('finding-evidence')
    .createSignedUploadUrl(objectKey);
  await client.storage
    .from('finding-evidence')
    .uploadToSignedUrl(signed!.path, signed!.token, JPEG, {
      contentType: 'image/jpeg',
    });
  await client.rpc('esh_guest_finish_upload', {
    p_session: session,
    p_asset_id: assetId,
    p_ok: true,
    p_type: 'image/jpeg',
    p_size: JPEG.byteLength,
    p_sha256: createHash('sha256').update(JPEG).digest('hex'),
    p_reason: null,
  });
  const { data } = await client.rpc('esh_guest_submit', {
    p_session: session,
    p_action_id: actionId,
    p_body: body,
    p_asset_ids: [assetId],
    p_reuse_message_id: null,
    p_client_key: `submit-${key}-${crypto.randomUUID().slice(0, 8)}`,
  });
  if (!data?.ok) throw new Error(`submit failed: ${JSON.stringify(data)}`);
  return data.submission_id as string;
}

test('v200 ESH reviews from the queue, asks for more, then accepts and closes', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  test.setTimeout(180_000);
  const id = stamp(testInfo.project.name);
  const work = await submitted(id, `verify.${id}@example.com`);

  await signIn(page, 'izzul@tamco.local');
  await page.goto('/findings/verification');
  const row = page.locator('.esh-register-row').filter({ hasText: work.title });
  await expect(row).toContainText('Version 1');
  await expect(row).toContainText(work.ownerEmail);
  await row.click();
  await expect(page).toHaveURL(
    new RegExp(`/findings/${work.findingId}\\?action=${work.actionId}$`),
  );

  // Before and after, side by side (§13).
  const submission = page.getByRole('region', { name: /Submitted for review/ });
  await expect(submission).toContainText('Guard missing on press 2.');
  await expect(submission).toContainText('Guard refitted.');
  await expect(submission.getByRole('list', { name: 'Original evidence' })).toHaveCount(0);
  await expect(submission.getByRole('list', { name: 'Submitted files' })).toContainText(
    'after.jpg',
  );

  // Ask for more, keeping the due date (FM23).
  await submission.getByRole('button', { name: 'Request improvement' }).click();
  await submission.getByLabel('What is still needed').fill('The photo misses the lower fixing.');
  await submission.getByRole('button', { name: 'Send back version 1' }).click();
  await expect(page.getByRole('region', { name: 'Verification' })).toContainText(
    'Version 1 sent back',
  );
  await expect(page.locator('.esh-status-flag')).toHaveText('In progress');
  await expect(
    page
      .getByRole('region', { name: 'Conversation with the owner' })
      .getByText('The photo misses the lower fixing.', { exact: true }),
  ).toBeVisible();

  // The owner sends a second version; ESH accepts it and the finding closes.
  await submit(work.session, work.actionId, 'Lower fixing photographed.', `${id}-2`);
  await page.reload();
  const second = page.getByRole('region', { name: /Submitted for review · version 2/ });
  await second.getByRole('button', { name: 'Accept & close finding' }).click();
  await expect(page.locator('.esh-status-flag')).toHaveText('Closed');
  const closure = page.getByRole('region', { name: 'Closure record' });
  await expect(closure).toContainText('Izzul Asyraf');

  // It appears in Closed, and can be reopened with a reason (FM52).
  await page.goto('/findings/closed');
  await expect(page.locator('.esh-register-row').filter({ hasText: work.title })).toContainText(
    'Closed',
  );
  await page.goto(`/findings/${work.findingId}`);
  await page.getByText('Reopen this finding').click();
  await page.getByLabel('Why it is being reopened (the owner sees it)').fill('Guard loose again.');
  await page.getByRole('button', { name: 'Reopen finding' }).click();
  await expect(page.locator('.esh-status-flag')).toHaveText('In progress');
  await expect(page.getByText('Guard loose again.').first()).toBeVisible();
});

test('v200 nobody verifies their own correction', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Server behaviour; one layout is enough.');
  test.setTimeout(150_000);
  const id = stamp(testInfo.project.name);
  // The owner's address is the Verifier's own account address.
  const work = await submitted(id, 'izzul@tamco.local');

  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${work.findingId}`);
  const submission = page.getByRole('region', { name: /Submitted for review/ });
  await expect(submission).toContainText('another ESH Verifier has to check it');
  await expect(submission.getByRole('button', { name: /Accept/ })).toHaveCount(0);
  await expect(submission.getByRole('button', { name: 'Request improvement' })).toHaveCount(0);
});

test('v200 ESH moves the due date and the owner, and says why', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Staff screens; one layout is enough.');
  test.setTimeout(180_000);
  const id = stamp(testInfo.project.name);
  const work = await submitted(id, `move.${id}@example.com`);

  // Decide the submission first, so the action is the owner's again.
  const izzulApi = await apiAs('izzul@tamco.local');
  await izzulApi.rpc('esh_verify_submission', {
    p_submission_id: work.submissionId,
    p_decision: 'changes_requested',
    p_method: null,
    p_note: 'One more angle, please.',
    p_keep_due: true,
    p_due_date: null,
    p_due_time: null,
  });

  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${work.findingId}`);
  await page.getByText('Change the due date or the owner').click();
  await page.getByLabel('New due date').fill('2027-01-20');
  await page.getByLabel('Reason (the owner sees it)').fill('Parts on order');
  await page.getByRole('button', { name: 'Change due date' }).click();
  await expect(page.getByText('Due date changed. The owner has been told.')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Verification' })).toContainText('Parts on order');

  // The owner reads the change as an event in their conversation (§14).
  const owner = await page.context().browser()!.newContext();
  const ownerPage = await owner.newPage();
  const site = new URL(page.url());
  await ownerPage
    .context()
    .addCookies([
      { name: 'tamco_esh_guest', value: work.session, domain: site.hostname, path: '/respond' },
    ]);
  await ownerPage.goto(`/respond/actions/${work.actionId}`);
  const dueChange = ownerPage.locator('.esh-message-body').filter({
    hasText: 'Due date changed from',
  });
  await expect(dueChange).toContainText('Due date changed from');
  await expect(dueChange).toContainText('Parts on order');

  // Reassigned: the old owner's page stops working on the next request (FM13).
  await page.getByLabel('New Action Owner email').fill(`after.${id}@example.com`);
  await page.getByLabel('Reason (recorded)').fill('Night shift takes it');
  await page.getByRole('button', { name: 'Reassign action' }).click();
  await expect(
    page.getByText('Reassigned. The new owner is emailed their own links.'),
  ).toBeVisible();
  await ownerPage.reload();
  await expect(
    ownerPage.getByRole('heading', { name: 'This action is not available' }),
  ).toBeVisible();
  await owner.close();
});
