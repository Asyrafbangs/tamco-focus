import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';

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
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

test('v204 configures a Draft report and opens an individual read-only snapshot', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'Configuration and guest access are one desktop flow.',
  );
  const db = service();
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `browser.leader.${suffix}@example.com`;
  const secret = crypto.randomUUID().replaceAll('-', '').padEnd(43, 'R');
  await db.from('esh_staff_access').update({ can_manage_reports: true }).eq('user_id', IZZUL);
  await signIn(page);
  await page.goto('/findings/settings?tab=reports');
  await expect(page.getByRole('heading', { name: 'Weekly reports' })).toBeVisible();
  const editor = page.locator('form', {
    has: page.getByRole('heading', { name: 'New weekly report' }),
  });
  await editor.getByLabel('Report name').fill(`Browser report ${suffix}`);
  await editor.getByLabel('Recipients').fill(email);
  await editor.getByLabel('Whole organisation').check();
  await editor.getByRole('button', { name: 'Save report' }).click();
  await expect(editor.getByRole('status')).toContainText('Weekly report saved');

  const { data: definition } = await db
    .from('esh_report_definitions')
    .select('id,organization_id')
    .eq('name', `Browser report ${suffix}`)
    .single();
  const { data: principal } = await db
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', email)
    .single();
  await db.from('esh_email_principals').update({ access_enabled: true }).eq('id', principal!.id);
  await db.from('esh_report_definitions').update({ state: 'active' }).eq('id', definition!.id);
  await db.rpc('esh_generate_weekly_reports', { p_now: '2026-09-21T01:00:00Z' });
  const { data: run } = await db
    .from('esh_report_runs')
    .select('id')
    .eq('report_definition_id', definition!.id)
    .single();
  const { data: recipient } = await db
    .from('esh_report_recipients')
    .select('id')
    .eq('report_definition_id', definition!.id)
    .single();
  const { data: outbox } = await db
    .from('esh_report_outbox')
    .select('id')
    .eq('run_id', run!.id)
    .eq('recipient_id', recipient!.id)
    .single();
  const claim = await db.rpc('esh_report_dispatch_claim', {
    p_outbox_id: outbox!.id,
    p_secret: secret,
  });
  expect(claim.error).toBeNull();
  expect(claim.data).toMatchObject({ ok: true });

  await page.context().clearCookies();
  await page.goto(`/respond/access?for=report#${secret}`);
  await page.getByRole('button', { name: 'Open weekly report' }).click();
  await expect(page).toHaveURL(new RegExp(`/respond/reports/${run!.id}$`));
  await expect(page.getByRole('heading', { name: `Browser report ${suffix}` })).toBeVisible();
  await expect(page.getByText(/Snapshot captured/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Live' })).toBeVisible();
  await expect(page.getByText('read-only leadership view')).toBeVisible();
});
