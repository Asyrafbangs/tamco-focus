import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';
const OPS = 'f0c05100-0000-4000-a000-000000000002';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function apiAs(email: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return client;
}

async function signIn(page: Page, email = 'izzul@tamco.local') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

async function assigned(suffix: string, enableContact: boolean) {
  const db = service();
  const esh = await apiAs('izzul@tamco.local');
  const owner = `hand.owner.${suffix}@example.com`;
  const { data: saved } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v212 spill by the press ${suffix}`,
      description: 'Oil pooling under the press guard.',
      reported_on: '2026-09-21',
      accountable_department_id: OPS,
      location: 'BR2 Workshop',
      required_outcome: 'Stop the leak and clean the floor.',
      priority: 'normal',
      owner_email: owner,
      due_date: '2026-11-30',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
  });
  if (!saved?.ok) throw new Error(`assign failed: ${JSON.stringify(saved)}`);

  const { data: principal } = await db
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  if (enableContact) {
    const admin = await apiAs('admin@tamco.local');
    await admin.rpc('esh_set_contact_access', {
      p_principal_id: principal!.id,
      p_enabled: true,
      p_reason: 'v212 fixture',
    });
  }

  const secret = randomBytes(32).toString('base64url');
  await db.from('esh_access_grants').insert({
    organization_id: ORGANIZATION,
    principal_id: principal!.id,
    purpose: 'owner_action',
    action_id: saved.action_id as string,
    assignment_version: 1,
    token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
    issued_reason: 'notification',
    expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  });
  return {
    owner,
    actionId: saved.action_id as string,
    findingId: saved.finding_id as string,
    path: `/respond/access?for=action#${secret}`,
  };
}

test('v212 an owner says it is not theirs and ESH hands it over in one press', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One pass across both sides is enough.');
  const suffix = randomBytes(3).toString('hex');
  const fixture = await assigned(suffix, true);
  const successor = `hand.next.${suffix}@example.com`;

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const owner = await guestContext.newPage();
  await owner.goto(fixture.path);
  await expect(owner.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = owner.getByRole('button', { name: 'Open action' });
  if (await open.count()) await open.click();
  // Not waitForURL: the access exchange replaces the document, and waiting
  // on the navigation event races a frame being detached. The destination's
  // own header is what settles, so that is what the test waits for.
  await expect(owner.locator('.guest-chat-head')).toBeVisible({ timeout: 30_000 });

  await owner.getByText('Need help?').click();
  await owner.getByRole('button', { name: 'Wrong owner' }).click();
  await owner.getByLabel('Who should hold this instead?').fill(successor);
  await owner.getByLabel('Message ESH').fill('The press is maintenance, not production.');
  await owner.getByRole('button', { name: 'Send update' }).click();
  await expect(owner.getByText('Says this belongs to')).toBeVisible({ timeout: 15_000 });

  // Naming somebody hands them nothing: it is still this owner's action.
  const db = service();
  const { data: before } = await db
    .from('esh_finding_actions')
    .select('owner_principal_id, assignment_version')
    .eq('id', fixture.actionId)
    .single();
  const { data: namedYet } = await db
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', successor)
    .maybeSingle();
  expect(namedYet).toBeNull();
  expect(before!.assignment_version).toBe(1);

  await signIn(page);
  await page.goto(`/findings/${fixture.findingId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByText('Says this belongs to')).toBeVisible();
  await page.getByRole('button', { name: `Give it to ${successor}` }).click();

  // The successor's address is already on screen inside the ask, so waiting
  // for it anywhere would pass before anything moved. The owner row is the
  // only place it means the handover happened.
  const ownerRow = page.locator('.esh-context-facts');
  await expect(ownerRow).toContainText(`Owner ${successor}`, { timeout: 15_000 });
  const { data: after } = await db
    .from('esh_finding_actions')
    .select('owner_principal_id, assignment_version')
    .eq('id', fixture.actionId)
    .single();
  expect(after!.assignment_version).toBe(2);
  expect(after!.owner_principal_id).not.toBe(before!.owner_principal_id);
  await guestContext.close();
});

test('v212/v227 held email is released once, for the system, from the register', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the notice is enough.');
  const suffix = randomBytes(3).toString('hex');
  // The contact is left switched off, which is how every new contact starts.
  const fixture = await assigned(suffix, false);

  const admin = await apiAs('admin@tamco.local');
  const staffAccess = (enabled: boolean) =>
    admin.rpc('esh_set_staff_access', {
      p_user_id: 'f0c05000-0000-4000-a000-000000000001',
      p_enabled: enabled,
      p_preset: 'verifier',
      p_scope_all: true,
      p_department_ids: [],
      p_include_descendants: true,
      p_can_manage_reports: false,
      p_reason: 'v212 fixture: an administrator who is also ESH',
    });
  const granted = await admin.rpc('esh_set_staff_access', {
    p_user_id: 'f0c05000-0000-4000-a000-000000000001',
    p_enabled: true,
    p_preset: 'verifier',
    p_scope_all: true,
    p_department_ids: [],
    p_include_descendants: true,
    p_can_manage_reports: false,
    p_reason: 'v212 fixture: an administrator who is also ESH',
  });
  if (!granted.data?.ok) throw new Error(`staff access failed: ${JSON.stringify(granted.data)}`);
  /*
   * This suite shares one database, and a failing test is exactly the one that
   * must still put it back: leaving the administrator with Finding access adds
   * a module switcher to the chrome, which is how v203 came to find two
   * "Finding Management" on one page several tests later.
   */
  try {
    await runTheCheck();
  } finally {
    await staffAccess(false);
  }

  async function runTheCheck() {
    await signIn(page, 'admin@tamco.local');
    // v227 - the finding does not carry the held email as a problem of its own.
    await page.goto(`/findings/${fixture.findingId}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.getByText('Owner not told yet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Enable this contact' })).toHaveCount(0);

    // The register says it once. Nothing can go while the contact is not cleared.
    await page.goto('/findings/register');
    const held = page.locator('.esh-held-notice');
    await expect(held).toContainText('being held');
    await expect(held).toContainText('restricted');

    const { data: owner } = await service()
      .from('esh_email_principals')
      .select('id')
      .eq('canonical_email', fixture.owner)
      .single();
    const cleared = await admin.rpc('esh_set_contact_access', {
      p_principal_id: owner!.id,
      p_enabled: true,
      p_reason: 'Pilot owner briefed.',
    });
    expect(cleared.data?.ok).toBe(true);

    // Clearing is not sending: the one press on the register is.
    await page.reload();
    await held.getByRole('button', { name: /^Release all/ }).click();

    const db = service();
    await expect
      .poll(
        async () =>
          (
            await db
              .from('esh_notification_outbox')
              .select('state')
              .eq('action_id', fixture.actionId)
              .eq('event_type', 'owner_assignment')
              .single()
          ).data?.state,
        { timeout: 30_000 },
      )
      .toMatch(/^(queued|processing|provider_accepted)$/);
    const { data: principal } = await db
      .from('esh_email_principals')
      .select('access_enabled')
      .eq('canonical_email', fixture.owner)
      .single();
    expect(principal!.access_enabled).toBe(true);
  }
});

test('v212 recording a finding is two steps, and a problem pulls it back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The steps are the same at both widths.');
  await signIn(page);
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const form = page.locator('form.esh-finding-form');
  await expect(form.getByLabel('Finding title', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Action Owner email', { exact: true })).not.toBeVisible();

  await form.getByLabel('Finding title', { exact: true }).fill('v212 stepped finding');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.esh-step[data-state="done"]')).toHaveCount(1);
  await expect(form.getByLabel('Action Owner email', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Finding title', { exact: true })).not.toBeVisible();

  // Assigning from the last step with the first step unanswered must not bury
  // the problem on a screen nobody is looking at.
  await expect(page.locator('.esh-step[data-state="current"] .esh-step-mark')).toHaveText('2');
  // Pressing Next must not save anything. Rendered as one node whose type
  // flips from button to submit, it did: the browser honoured submit for the
  // click already in flight and the finding went in half-answered.
  await expect(page.getByRole('button', { name: 'Assign finding' })).toBeEnabled();
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page.getByText('need correcting')).toBeVisible({ timeout: 15_000 });
  await expect(form.getByLabel('Finding title', { exact: true })).toBeVisible();
});
