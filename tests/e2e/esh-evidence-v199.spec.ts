import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v199 — evidence and submissions (docs/specs/..._v1.3.md §11, §12, §23).
 * FM16-FM22, FM46-FM49.
 *
 * An owner attaches a photo, sends it, submits it as it was, withdraws and
 * resubmits; a file-required rule refuses "Done" alone; a renamed file is
 * refused; ESH sees the fixed submission and adds original evidence the
 * owner can open; nobody else can open any of it.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

// A real, tiny JPEG: the server reads the bytes, so they have to be one.
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

/** One action for one owner, their access on, assigned by the local Verifier. */
async function arrange(id: string) {
  const owner = `evidence.${id}@example.com`;
  const title = `v199 guard ${id}`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'Guard missing on press 2.',
      reported_on: '2026-09-18',
      accountable_department_id: departments?.[0]?.id,
      location: 'Workshop',
      required_outcome: 'Refit the guard.',
      evidence_instruction: 'Photo of the refitted guard.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-12-15',
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.ok)
    throw new Error(`assign failed: ${error?.message ?? JSON.stringify(data)}`);
  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  const admin = await apiAs('admin@tamco.local');
  await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'e2e',
  });
  return {
    owner,
    title,
    principalId: contact!.id as string,
    actionId: data.action_id as string,
    findingId: data.finding_id as string,
  };
}

async function openAsOwner(page: Page, principalId: string, actionId: string) {
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
  await page.goto(`/respond/access?for=action#${secret}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = page.getByRole('button', { name: 'Open action' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/respond/actions/${actionId}$`));
}

async function attach(page: Page, name: string, buffer: Buffer, mimeType: string) {
  await page.getByLabel('Attach files').setInputFiles({ name, mimeType, buffer });
}

test('v199 an owner sends a photo, submits it as it was, withdraws and resubmits', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  test.setTimeout(150_000);
  const arranged = await arrange(stamp(testInfo.project.name));
  await openAsOwner(page, arranged.principalId, arranged.actionId);

  // "Done" alone does not pass a file-required rule (FM20).
  await page.getByLabel('Message ESH').fill('Done.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.locator('#guest-composer-problem')).toHaveText(
    'To submit for review, attach at least one file showing the correction.',
  );
  await expect(page.locator('.guest-state')).toHaveText('Assigned');

  // A renamed file is refused; a real photo is ready (FM47).
  await attach(page, 'guard.jpg', Buffer.from('MZ this is not a photo'), 'image/jpeg');
  const refused = page.locator('.esh-upload[data-status="failed"]');
  await expect(refused).toContainText('This file is not what its name says, so it was refused.');
  await expect(page.getByRole('button', { name: 'Send update' })).toBeDisabled();
  await page.getByRole('button', { name: 'Remove guard.jpg' }).click();

  await attach(page, 'Guard refitted.jpg', JPEG, 'image/jpeg');
  await expect(page.locator('.esh-upload[data-status="ready"]')).toContainText(
    /JPG · \d+ B · Not scanned · Ready to send/,
  );

  // Sent as an update: a message with a file, not a submission (FM16).
  await page.getByLabel('Message ESH').fill('Guard refitted and tested.');
  await page.getByRole('button', { name: 'Send update' }).click();
  const update = page
    .locator('.esh-message.mine')
    .filter({ hasText: 'Guard refitted and tested.' });
  await expect(update.locator('.esh-file')).toContainText('Guard refitted.jpg');
  await expect(page.locator('.guest-state')).toHaveText('In progress');

  // The file opens through the owner's own access route (FM49).
  const href = await update.locator('.esh-file a').getAttribute('href');
  const opened = await page.request.get(href!, { maxRedirects: 0 });
  expect(opened.status()).toBe(303);

  // Submitted exactly as it was sent: no retyping, no second upload (FM18).
  await update.getByRole('button', { name: 'Submit this update for review' }).click();
  await expect(page.locator('.guest-state')).toHaveText('Awaiting ESH review');
  await expect(page.locator('.esh-submission-mark')).toHaveText(
    'Submitted for ESH review (version 1). This finding is still open.',
  );
  await expect(page.getByRole('button', { name: 'Submit for review' })).toHaveCount(0);
  await expect(
    page.getByText('New messages do not replace your submitted evidence.'),
  ).toBeVisible();

  // Withdraw to revise, then submit a new version from the composer (FM22).
  await page.getByRole('button', { name: 'Withdraw to revise' }).click();
  await expect(page.locator('.guest-state')).toHaveText('In progress');
  await expect(page.locator('.esh-submission-mark')).toHaveText(
    'Version 1 was withdrawn to revise it.',
  );
  await attach(page, 'Guard close-up.jpg', JPEG, 'image/jpeg');
  await expect(page.locator('.esh-upload[data-status="ready"]')).toHaveCount(1);
  await page.getByLabel('Message ESH').fill('Close-up of the fixings added.');
  await page.getByRole('button', { name: 'Submit for review' }).click();
  await expect(page.locator('.guest-state')).toHaveText('Awaiting ESH review');
  await expect(page.locator('.esh-submission-mark[data-state="pending"]')).toHaveText(
    'Submitted for ESH review (version 2). This finding is still open.',
  );

  // ESH was told, twice over: a review, a withdrawal, and a review again (FM17).
  const { data: told } = await service()
    .from('esh_notification_outbox')
    .select('event_type')
    .eq('action_id', arranged.actionId)
    .in('event_type', ['submission_received', 'submission_withdrawn']);
  expect((told ?? []).map((row) => row.event_type).sort()).toEqual([
    'submission_received',
    'submission_received',
    'submission_withdrawn',
  ]);
});

test('v199 ESH reads the fixed submission and adds original evidence the owner can open', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Staff screens; one layout is enough.');
  test.setTimeout(150_000);
  const arranged = await arrange(stamp(testInfo.project.name));

  // The owner submits a photo.
  const ownerContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  await openAsOwner(owner, arranged.principalId, arranged.actionId);
  await attach(owner, 'After.jpg', JPEG, 'image/jpeg');
  await expect(owner.locator('.esh-upload[data-status="ready"]')).toHaveCount(1);
  await owner.getByLabel('Message ESH').fill('Refitted.');
  await owner.getByRole('button', { name: 'Submit for review' }).click();
  await expect(owner.locator('.guest-state')).toHaveText('Awaiting ESH review');

  // ESH sees it, fixed, with its file; and adds the original photo.
  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${arranged.findingId}`);
  const submission = page.getByRole('region', { name: /Submitted for review · version 1/ });
  await expect(submission).toContainText('Refitted.');
  await expect(submission.locator('.esh-file')).toContainText('After.jpg');
  const original = page.getByRole('region', { name: 'Original evidence' });
  await original.getByLabel('Attach files').setInputFiles({
    name: 'Before.jpg',
    mimeType: 'image/jpeg',
    buffer: JPEG,
  });
  await expect(original.locator('.esh-file')).toContainText('Before.jpg');

  // The owner finds it under the original finding.
  await owner.reload();
  await owner.getByText('Original finding & evidence').click();
  const before = owner.locator('.guest-original-files .esh-file a');
  await expect(before).toContainText('Before.jpg');
  const beforeHref = await before.getAttribute('href');
  expect((await owner.request.get(beforeHref!, { maxRedirects: 0 })).status()).toBe(303);

  // Nobody else opens any of it (FM46, FM49): another owner, or no session.
  const stranger = await browser.newContext();
  const outsider = await stranger.newPage();
  expect((await outsider.request.get(beforeHref!, { maxRedirects: 0 })).status()).toBe(404);
  const other = await arrange(stamp(testInfo.project.name));
  await openAsOwner(outsider, other.principalId, other.actionId);
  expect((await outsider.request.get(beforeHref!, { maxRedirects: 0 })).status()).toBe(404);
  await stranger.close();
  await ownerContext.close();
});
