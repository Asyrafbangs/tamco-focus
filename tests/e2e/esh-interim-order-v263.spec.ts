import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v263 — what protects people, and where the owner's own job sits on a phone.
 *
 * Two changes, tested together because they are the same complaint. An Action
 * Owner opens their phone and has to know two things: what is holding the
 * hazard until they fix it, and where to type. Neither was on the first
 * screen — the first did not exist, and the second was below a read-only copy
 * of the finding record.
 *
 * The desktop arrangement approved in v227 is unchanged, and asserted here,
 * because the fix is the source order plus explicit grid placement rather
 * than folding anything away.
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

const CONTROL = 'Temporary interlocked gate across the feed opening, padlocked when unattended.';
const KEEPER = 'Shift supervisor, Line 2';

interface Arranged {
  owner: string;
  principalId: string;
  findingId: string;
  actionId: string;
}

async function arrange(id: string): Promise<Arranged> {
  const owner = `interim.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v263 guard missing ${id}`,
      description: 'The fixed guard on the press feed opening has been removed.',
      reported_on: '2026-10-20',
      accountable_department_id: departments?.[0]?.id,
      location: 'BR2 press line 2',
      required_outcome: 'Refit a fixed guard to the feed opening.',
      priority: 'urgent',
      risk_level: 'critical',
      owner_email: owner,
      due_date: '2026-12-15',
      escalation: [],
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.ok) throw new Error(`assign: ${error?.message ?? JSON.stringify(data)}`);

  const interim = await izzul.rpc('esh_set_interim_control', {
    p_finding_id: data.finding_id,
    p_payload: {
      immediate_containment: 'Press stopped and locked off at 14:10.',
      interim_control: CONTROL,
      interim_owner: KEEPER,
      not_required_reason: '',
    },
  });
  if (!interim.data?.ok) throw new Error(`interim: ${JSON.stringify(interim.data)}`);

  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  const admin = await apiAs('admin@tamco.local');
  const enabled = await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'e2e',
  });
  if (!enabled.data?.ok) throw new Error('could not enable the contact');

  return {
    owner,
    principalId: contact!.id,
    findingId: data.finding_id as string,
    actionId: data.action_id as string,
  };
}

async function openAsOwner(page: Page, arranged: Arranged) {
  const secret = randomBytes(32).toString('base64url');
  const { error } = await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: arranged.principalId,
      purpose: 'owner_action',
      action_id: arranged.actionId,
      assignment_version: 1,
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
  if (error) throw new Error(`mint: ${error.message}`);
  await page.goto(`/respond/access?for=action#${secret}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.getByRole('button', { name: 'Open action' }).click();
  await expect(page.locator('textarea')).toBeVisible({ timeout: 30_000 });
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
  return `${project.slice(0, 3)}${crypto.randomUUID().slice(0, 6)}`;
}

test('v263 the owner is told what is holding the hazard', async ({ page }, testInfo) => {
  const arranged = await arrange(stamp(testInfo.project.name));
  await openAsOwner(page, arranged);

  /*
   * Pinned beside the instruction, not filed in the record below it. The
   * owner is the person standing next to the machine.
   */
  const pinned = page.locator('.guest-interim');
  await expect(pinned).toBeVisible();
  await expect(pinned).toContainText(CONTROL);
  await expect(pinned, 'a control with nobody keeping it is not a control').toContainText(KEEPER);
});

test('v263 the owner can reach the update box without scrolling', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'A phone-sized screen.');
  const arranged = await arrange(stamp(testInfo.project.name));
  await openAsOwner(page, arranged);

  const where = await page.evaluate(() => {
    const box = document.querySelector('textarea')!.getBoundingClientRect();
    const record = document.querySelector('.guest-original')!.getBoundingClientRect();
    return {
      composeTop: Math.round(box.top + window.scrollY),
      recordTop: Math.round(record.top + window.scrollY),
      viewport: window.innerHeight,
    };
  });

  /*
   * Measured from the document top with the page unscrolled, against two
   * thirds of the viewport rather than all of it: a headless viewport has no
   * address bar, and the real one eats roughly a sixth of the screen.
   */
  expect(
    where.composeTop,
    `the update box starts ${where.composeTop}px down a ${where.viewport}px screen`,
  ).toBeLessThan(where.viewport * 0.66);

  expect(
    where.recordTop,
    'the read-only record is still above the box the owner came to type in',
  ).toBeGreaterThan(where.composeTop);
});

test('v263 the record still stands beside the conversation on a desktop', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The two-column arrangement.');
  const arranged = await arrange(stamp(testInfo.project.name));
  await openAsOwner(page, arranged);

  const side = await page.evaluate(() => {
    const record = document.querySelector('.guest-original')!.getBoundingClientRect();
    const thread = document.querySelector('.guest-thread')!.getBoundingClientRect();
    return { recordLeft: Math.round(record.left), threadLeft: Math.round(thread.left) };
  });

  // v227's arrangement, unchanged: the record is a column, not a footer.
  expect(
    side.recordLeft,
    'the record dropped below the conversation instead of sitting beside it',
  ).toBeLessThan(side.threadLeft);
});

test('v263 ESH sees the interim position on the finding', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One layout is enough for this.');
  const arranged = await arrange(stamp(testInfo.project.name));
  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${arranged.findingId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const interim = page.locator('.esh-interim');
  await expect(interim).toContainText(CONTROL);
  await expect(interim).toContainText(KEEPER);
  // Recorded but not yet checked by anybody, and the page says which.
  await expect(interim).toHaveAttribute('data-state', 'unverified');
  await expect(interim).toContainText(/nobody has recorded checking/i);
});

test('v263 a significant finding with nothing recorded says so', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One layout is enough for this.');
  const id = stamp(testInfo.project.name);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v263 nothing recorded ${id}`,
      description: 'Chemical decanted into an unlabelled container.',
      reported_on: '2026-10-20',
      accountable_department_id: departments?.[0]?.id,
      location: 'Mixing room',
      required_outcome: 'Label it.',
      priority: 'high',
      risk_level: 'high',
      owner_email: `bare.${id}@example.com`,
      due_date: '2026-12-15',
      escalation: [],
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });

  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${data.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const interim = page.locator('.esh-interim');
  await expect(interim).toHaveAttribute('data-state', 'unprotected');
  await expect(interim).toContainText(/nothing is recorded as protecting people/i);
});
