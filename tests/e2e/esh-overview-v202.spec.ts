import { readFile } from 'node:fs/promises';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function apiAsIzzul() {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: 'izzul@tamco.local',
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
}

test('v202 overview totals drill into the matching action rows without changing open work', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'The new overview is checked at its desktop and phone layouts.',
  );
  const api = await apiAsIzzul();
  const { data: departments } = await api.from('departments').select('id').eq('code', 'OPS');
  const id = `${testInfo.project.name}-${crypto.randomUUID().slice(0, 7)}`;
  const title = `=v202 formula ${id}`;
  const { data, error } = await api.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: '+spreadsheet formula must stay text',
      reported_on: '2026-09-10',
      accountable_department_id: departments?.[0]?.id,
      required_outcome: 'Correct the overdue condition.',
      priority: 'high',
      owner_email: `owner.${id}@example.com`,
      due_date: '2026-10-18',
      escalation: [],
      no_further_escalation_reason: 'No escalation is needed for this fixture.',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.ok) throw new Error(error?.message ?? JSON.stringify(data));
  await service()
    .from('esh_finding_actions')
    .update({ due_at: '2026-09-18T09:00:00Z' })
    .eq('id', data.action_id);

  await signIn(page);
  await page.goto('/findings');
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  const navigation = page.getByRole('navigation', { name: 'Finding Management' });
  // v223 - kept at its address, reached from the register's tools rather than
  // standing first in the navigation.
  await expect(navigation.getByRole('link', { name: 'Overview' })).toHaveCount(0);
  await expect(navigation.getByRole('link', { name: 'Register' })).toBeVisible();
  await expect(navigation.getByRole('link', { name: /Verification/ })).toBeVisible();
  await expect(page.getByText('By accountable department')).toBeVisible();
  await expect(page.getByText(/Data at/)).toBeVisible();

  const openSignal = page.locator('.esh-signal').filter({ hasText: 'Open findings' });
  const openBefore = await openSignal.locator('strong').innerText();
  await page.getByRole('button', { name: 'Change the closure period' }).click();
  await page.getByRole('link', { name: 'Last 90 days' }).click();
  await expect(page).toHaveURL(/period=90/);
  await expect(openSignal.locator('strong')).toHaveText(openBefore);

  await page.locator('.esh-signal').filter({ hasText: 'Overdue actions' }).click();
  await expect(page).toHaveURL(/\/findings\/register\?filter=overdue/);
  await expect(page.getByRole('heading', { name: 'Finding Register' })).toBeVisible();
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expect(page.getByText(/actions? in this view/)).toBeVisible();

  await page.goto('/findings/closed?period=60');
  await expect(page).toHaveURL('/findings/register?filter=closed&period=60');

  if (testInfo.project.name === 'desktop') {
    await page.goto('/findings/register');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await page.getByRole('button', { name: 'More register tools' }).click();
    const downloadEvent = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'Export register (CSV)' }).click();
    const download = await downloadEvent;
    const path = await download.path();
    expect(path).not.toBeNull();
    const csv = await readFile(path!, 'utf8');
    expect(csv).toContain(`'=v202 formula ${id}`);
    expect(csv).toContain("'+spreadsheet formula must stay text");
    expect(csv).not.toMatch(/\/respond\/|token=/i);
  }
});
