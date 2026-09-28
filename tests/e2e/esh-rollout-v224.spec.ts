import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
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

async function signIn(page: Page, email: string) {
  // This test changes hands: an administrator sets the mode, ESH releases the
  // mail. Reaching /sign-in while still signed in as the first one lands back
  // in the application, where there is no form to fill.
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

/** A finding whose owner nobody has cleared: every assignment starts here. */
async function assigned(suffix: string, title: string) {
  const esh = await apiAs('izzul@tamco.local');
  const owner = `rollout.owner.${suffix}@example.com`;
  const { data: saved } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'Pallets stacked across the fire exit.',
      reported_on: '2026-09-21',
      accountable_department_id: OPS,
      location: 'BR2 Warehouse',
      required_outcome: 'Clear the exit and keep the route marked.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-12-30',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
  });
  if (!saved?.ok) throw new Error(`assign failed: ${JSON.stringify(saved)}`);
  return {
    owner,
    actionId: saved.action_id as string,
    findingId: saved.finding_id as string,
  };
}

async function stateOf(actionId: string) {
  const { data } = await service()
    .from('esh_notification_outbox')
    .select('state')
    .eq('action_id', actionId)
    .eq('event_type', 'owner_assignment')
    .single();
  return String(data?.state);
}

test('v224 an administrator opens the rollout, and ESH lets the held mail go in one press', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One pass over the two screens is enough.');
  // Two full sign-ins, because the mode is an administrator's decision and the
  // release is ESH's. Each costs the better part of the default budget.
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const first = await assigned(suffix, `v224 blocked exit ${suffix}`);
  expect(await stateOf(first.actionId)).toBe('held_rollout');

  /*
   * This suite shares one database and the rollout mode is global, so the test
   * that opens it is the test that must close it — through the procedure, not a
   * raw update, so whatever became reachable is properly put back.
   */
  try {
    await runTheCheck();
  } finally {
    const admin = await apiAs('admin@tamco.local');
    await admin.rpc('esh_set_rollout_mode', {
      p_mode: 'restricted',
      p_reason: 'v224 fixture: closing the rollout the test opened.',
    });
    const { data: settings } = await service()
      .from('esh_rollout_settings')
      .select('mode')
      .limit(1)
      .single();
    if (settings?.mode !== 'restricted') {
      throw new Error(`v224 left the rollout ${settings?.mode}; later specs expect restricted`);
    }
  }

  async function runTheCheck() {
    // ------------------------------------------------------------------
    // The administrator's half: the mode, and only the mode.
    // ------------------------------------------------------------------
    await signIn(page, 'admin@tamco.local');
    await page.goto('/more/admin/users');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const card = page.locator('.esh-rollout');
    await expect(card.locator('.esh-rollout-chip')).toHaveText('Restricted');
    await expect(card).toContainText('can be written to');
    // Releasing held mail is ESH's act, not an administrator's (§43.2). This
    // administrator holds no Finding access, so it is not offered here.
    await expect(card.getByRole('button', { name: /^Release/ })).toHaveCount(0);

    await card.getByText('Change the rollout', { exact: true }).click();
    await expect(card).toContainText('what is held stays held until it is released');
    // A sentence, not a word: the reason is read back a year later.
    const open = card.getByRole('button', { name: 'Open the rollout' });
    await card.getByLabel('Why the rollout is changing').fill('later');
    await expect(open).toBeDisabled();
    await card
      .getByLabel('Why the rollout is changing')
      .fill('Broad launch approved: every supervisor now owns actions.');
    await expect(open).toBeEnabled();
    await open.click();

    await expect(card.locator('.esh-rollout-chip')).toHaveText('Live', { timeout: 15_000 });
    // Opening the rollout is not sending (FM106).
    expect(await stateOf(first.actionId)).toBe('held_rollout');

    // ------------------------------------------------------------------
    // From here on a new assignment is simply told, and never held.
    // ------------------------------------------------------------------
    const second = await assigned(`${suffix}b`, `v224 spill by the press ${suffix}`);
    expect(await stateOf(second.actionId)).toBe('queued');

    // ------------------------------------------------------------------
    // ESH's half: everything that was waiting, in one press.
    // ------------------------------------------------------------------
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/findings');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const release = page.locator('.esh-held-release');
    await expect(release).toContainText('can go out now');
    await release.getByRole('button', { name: /^Release all/ }).click();

    // Not the button's own count, which said the same thing before anything
    // happened: the sentence the release itself came back with.
    await expect(release).toContainText('released, going out on the next dispatch', {
      timeout: 30_000,
    });
    expect(await stateOf(first.actionId)).toBe('queued');

    // And the finding no longer reports an owner who was never told.
    await page.goto(`/findings/${first.findingId}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.esh-detail')).not.toContainText('Held — access not enabled');
    await expect(page.locator('.esh-next-banner')).not.toContainText('Owner not told yet');
  }
});
