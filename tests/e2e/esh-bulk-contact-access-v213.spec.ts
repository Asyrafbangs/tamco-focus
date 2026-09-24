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
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

/** Two owners with work waiting, neither cleared to receive anything. */
async function twoWaitingOwners(suffix: string) {
  const esh = await apiAs('izzul@tamco.local');
  const owners = [`bulk.one.${suffix}@example.com`, `bulk.two.${suffix}@example.com`];
  for (const [index, owner] of owners.entries()) {
    const { data } = await esh.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title: `v213 waiting ${index + 1} ${suffix}`,
        description: 'Recorded while the contact was switched off.',
        reported_on: '2026-09-21',
        accountable_department_id: OPS,
        location: 'BR2',
        required_outcome: 'Put it right.',
        priority: 'normal',
        owner_email: owner,
        due_date: '2026-11-30',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
    });
    if (!data?.ok) throw new Error(`assign failed: ${JSON.stringify(data)}`);
  }
  return owners;
}

test('v213 an administrator clears several waiting contacts at once, and sends nothing', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Administration; one layout is enough.');
  const suffix = randomBytes(3).toString('hex');
  const owners = await twoWaitingOwners(suffix);
  const db = service();

  await signIn(page, 'admin@tamco.local');
  await page.goto('/more/admin/users');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const panel = page.getByRole('region', { name: 'Contacts waiting to be cleared' });
  await expect(panel).toBeVisible();
  for (const owner of owners) {
    await expect(panel.getByText(owner, { exact: false })).toBeVisible();
  }

  // Nothing happens without a reason: the gate keeps its record.
  for (const owner of owners) {
    await panel.locator('li').filter({ hasText: owner }).getByRole('checkbox').check();
  }
  await panel.getByRole('button', { name: 'Clear selected contacts' }).click();
  await expect(panel.getByRole('status')).toContainText('Say why these contacts may be written to');

  await panel.getByLabel('Why these contacts may be written to').fill('Supervisors who own work.');
  await panel.getByRole('button', { name: 'Clear selected contacts' }).click();
  await expect(panel.getByRole('status')).toContainText('2 contacts cleared to receive email', {
    timeout: 15_000,
  });

  const { data: principals } = await db
    .from('esh_email_principals')
    .select('canonical_email, access_enabled, access_reason')
    .in('canonical_email', owners);
  expect(principals).toHaveLength(2);
  for (const principal of principals!) {
    expect(principal.access_enabled).toBe(true);
    // Each one is switched on by the same audited procedure, with the reason.
    expect(principal.access_reason).toBe('Supervisors who own work.');
  }

  // Clearing a contact is not sending: every notice raised while they were
  // switched off is still held, awaiting its own release (§43.4).
  const recipients = (
    await db.from('esh_email_principals').select('id').in('canonical_email', owners)
  ).data!.map((row) => row.id);
  const { data: held, error } = await db
    .from('esh_notification_outbox')
    .select('state')
    .in('recipient_principal_id', recipients);
  expect(error).toBeNull();
  expect(held!.length).toBeGreaterThan(0);
  expect(held!.every((row) => row.state === 'held_rollout')).toBe(true);
});
