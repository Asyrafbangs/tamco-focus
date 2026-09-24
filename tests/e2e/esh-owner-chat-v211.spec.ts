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

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

/** A finding assigned to an accountless owner, and that owner's own link. */
async function assigned(suffix: string) {
  const db = service();
  const esh = await apiAs('izzul@tamco.local');
  const owner = `chat.owner.${suffix}@example.com`;
  const { data: saved } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v211 blocked exit ${suffix}`,
      description: 'Pallets stacked across the fire exit.',
      reported_on: '2026-09-21',
      accountable_department_id: OPS,
      location: 'BR2 Warehouse',
      required_outcome: 'Clear the exit and keep the route marked.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-09-30',
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
  const admin = await apiAs('admin@tamco.local');
  await admin.rpc('esh_set_contact_access', {
    p_principal_id: principal!.id,
    p_enabled: true,
    p_reason: 'v211 fixture',
  });

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

test('v211 an owner asks for more time in the thread and ESH grants it in one press', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One pass across both sides is enough.');
  const suffix = randomBytes(3).toString('hex');
  const fixture = await assigned(suffix);

  // The owner arrives from their email, on a phone.
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

  // What ESH needs is in sight without opening anything.
  await expect(owner.getByText('What ESH needs')).toBeVisible();
  await expect(owner.getByText('Clear the exit and keep the route marked.')).toBeVisible();

  await expect(owner.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await owner.getByRole('button', { name: 'Ask for more time' }).click();
  await owner.getByLabel('What date could you finish by?').fill('2026-10-15');
  await owner.getByLabel('Message ESH').fill('The contractor cannot come until the 14th.');
  await owner.getByRole('button', { name: 'Send update' }).click();

  // The ask is part of what they said, and the deadline has not moved.
  await expect(owner.getByText('Asked for more time, until')).toBeVisible({ timeout: 15_000 });
  await expect(owner.getByText('15 Oct 2026')).toBeVisible();
  await expect(owner.locator('.guest-chat-meta')).toContainText('Due 30 Sept 2026');

  const db = service();
  const { data: beforeDecision } = await db
    .from('esh_finding_actions')
    .select('due_at, state')
    .eq('id', fixture.actionId)
    .single();
  expect(String(beforeDecision!.due_at)).toContain('2026-09-30');
  // The first thing an owner says also starts the work (§6).
  expect(beforeDecision!.state).toBe('in_progress');

  // ESH sees the ask on the finding, and grants exactly the date asked for.
  await signIn(page);
  await page.goto(`/findings/${fixture.findingId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByText('Asked for more time, until')).toBeVisible();
  await page.getByRole('button', { name: 'Move the deadline to 15 Oct 2026' }).click();
  // Waiting on the ask's own words would pass before anything happened: they
  // already say 15 Oct. The deadline itself is what has to move.
  const dueRow = page
    .locator('.esh-facts div')
    .filter({ has: page.getByText('Due', { exact: true }) });
  await expect(dueRow).toContainText('15 Oct 2026', { timeout: 15_000 });
  await expect(page.getByRole('heading', { name: 'Due-date changes' })).toBeVisible();

  const { data: afterDecision } = await db
    .from('esh_finding_actions')
    .select('due_at')
    .eq('id', fixture.actionId)
    .single();
  expect(String(afterDecision!.due_at)).toContain('2026-10-15');

  // It was a due-date change like any other: reasoned, and on the record.
  const { data: change } = await db
    .from('esh_due_date_changes')
    .select('reason, new_due_at')
    .eq('action_id', fixture.actionId)
    .order('changed_at', { ascending: false })
    .limit(1)
    .single();
  expect(change!.reason).toContain('15 Oct 2026');
  await guestContext.close();
});

test('v211 the new finding form asks for what only a person knows', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The field set is the same at both widths.');
  await signIn(page);
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // Two steps, and nothing on them that already has a sound answer.
  const form = page.locator('form.esh-finding-form');
  for (const label of ['Finding title', 'What was found', 'Location', 'Accountable department']) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Next' }).click();
  for (const label of ['Required outcome', 'Action Owner email', 'Risk', 'Due date']) {
    await expect(form.getByLabel(label, { exact: true })).toBeVisible();
  }
  for (const hidden of ['Reported on', 'Source', 'Completion evidence', 'Action priority']) {
    await expect(form.getByLabel(hidden, { exact: true })).not.toBeVisible();
  }
  // One escalation level, and it says when it is told.
  await expect(form.locator('.esh-escalation-levels > *')).toHaveCount(1);
  await expect(form.getByText(/after \d+ days? overdue/)).toBeVisible();

  // The defaults are still submitted, not dropped: they are under the fold.
  await page.locator('.esh-form-more > summary').click();
  await expect(form.getByLabel('Reported on', { exact: true })).toBeVisible();
  await expect(form.getByLabel('Action priority', { exact: true })).toHaveValue('normal');
  await expect(form.getByLabel('Completion evidence', { exact: true })).toHaveValue(
    'Photo showing the corrected condition.',
  );
});
