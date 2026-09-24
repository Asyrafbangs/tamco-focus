import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const OPS = 'f0c05100-0000-4000-a000-000000000002';

async function apiAs(email: string) {
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
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

test('v214 the register says who acts next, and the finding says the same thing', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the list is enough.');
  const suffix = randomBytes(3).toString('hex');
  const esh = await apiAs('izzul@tamco.local');
  const { data: saved } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v214 blocked walkway ${suffix}`,
      description: 'Recorded on the walk.',
      reported_on: '2026-09-05',
      accountable_department_id: OPS,
      location: 'BR2 Warehouse',
      required_outcome: 'Clear the walkway.',
      priority: 'normal',
      risk_level: 'high',
      owner_email: `next.${suffix}@example.com`,
      due_date: '2026-12-15',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
  });
  if (!saved?.ok) throw new Error(JSON.stringify(saved));

  await signIn(page);
  await page.goto('/findings/register?filter=open');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const row = page
    .locator('.esh-register-row')
    .filter({ hasText: `v214 blocked walkway ${suffix}` });
  await expect(row).toBeVisible();
  // Held, because the contact has never been cleared — and that outranks the
  // deadline, which is months away.
  await expect(row.locator('.esh-next-chip')).toHaveText('Owner not told yet');
  await expect(row).toContainText('not cleared to receive email');
  await expect(row).toContainText('High risk');

  // The occasional tools are behind one button rather than beside New finding.
  await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More register tools' }).click();
  await expect(page.getByRole('menuitem', { name: 'Export register (CSV)' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Import backlog' })).toBeVisible();

  // The finding itself opens with the same sentence, from the same rule.
  await page.goto(`/findings/${saved.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const banner = page.locator('.esh-next-banner');
  await expect(banner).toContainText('Owner not told yet');
  await expect(banner).toHaveAttribute('data-tone', 'problem');
});
