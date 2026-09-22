import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('admin@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

async function createContactFixture(email: string, title: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const signedIn = await client.auth.signInWithPassword({
    email: 'izzul@tamco.local',
    password: PASSWORD,
  });
  if (signedIn.error) throw signedIn.error;
  const { data: departments } = await client.from('departments').select('id').eq('code', 'OPS');
  const saved = await client.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'v203 browser fixture.',
      reported_on: '2026-09-20',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Correct the condition.',
      priority: 'normal',
      owner_email: email,
      due_date: '2026-12-01',
      escalation: [],
      no_further_escalation_reason: 'Browser fixture.',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (saved.error || !saved.data?.ok)
    throw new Error(saved.error?.message ?? JSON.stringify(saved.data));
}

test('v203 People & access keeps module authority and email contacts in one directory', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'The consolidated directory is checked at desktop and phone widths.',
  );
  const suffix = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 7)}`;
  const email = `person.${suffix}@example.com`;
  await createContactFixture(email, `v203 people ${suffix}`);
  await signIn(page);

  await page.goto(`/more/admin/users?type=contacts&q=${encodeURIComponent(suffix)}`);
  await expect(page.getByRole('heading', { name: 'Identity and access' })).toBeVisible();
  await expect(page.getByLabel('Person type')).toHaveValue('contacts');
  await expect(page.getByRole('link', { name: 'Email contacts' })).toHaveCount(0);
  const row = page.locator('.master-list a', { hasText: email });
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByText('Email-link contact · no account required').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Finding Management access' })).toBeVisible();
  await expect(page.getByText('Action Owner', { exact: true })).toBeVisible();
  await expect(page.getByText('1 open', { exact: true })).toBeVisible();
  await expect(page.getByText('No active grants, sessions or entitlements.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Correct email' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Disable contact' })).toBeVisible();

  const access = page.locator('.esh-access-form');
  await access.getByRole('checkbox').check();
  await access.getByLabel(/Reason/).fill('Approved for assigned correction');
  await access.getByRole('button', { name: 'Save contact access' }).click();
  await expect(access.getByRole('status')).toContainText('Access on');

  await page.goto('/more/admin/users?user=f0c05000-0000-4000-a000-000000000005');
  await expect(page.getByRole('heading', { name: 'Module access' })).toBeVisible();
  await expect(page.getByLabel('TAMCO Focus preset')).toBeVisible();
  await expect(page.getByLabel('Platform administrator')).toBeVisible();
  await expect(page.getByText('Finding Management', { exact: true })).toBeVisible();

  if (testInfo.project.name === 'mobile') {
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  }
});
