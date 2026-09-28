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

test('v210 shows what a weekly report would say before anybody activates it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Report configuration is one desktop flow.');
  const db = service();
  const suffix = crypto.randomUUID().slice(0, 8);
  const email = `preview.leader.${suffix}@example.com`;
  const name = `Preview report ${suffix}`;
  await db.from('esh_staff_access').update({ can_manage_reports: true }).eq('user_id', IZZUL);

  await signIn(page);
  await page.goto('/findings/settings?tab=reports');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const draft = page.locator('form', {
    has: page.getByRole('heading', { name: 'New weekly report' }),
  });
  await draft.getByLabel('Report name').fill(name);
  await draft.getByLabel('Recipients').fill(email);
  await draft.getByLabel('Whole organisation').check();
  await draft.getByRole('button', { name: 'Save report' }).click();
  await expect(draft.getByRole('status')).toContainText('Weekly report saved');

  // A draft is saved, and nothing has been sent. §34.1 asks that the audience
  // and the numbers are shown before it is switched on, so they are.
  const saved = page.locator('form', { has: page.getByRole('heading', { name }) });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await saved.getByRole('button', { name: 'Preview' }).click();
  const preview = saved.locator('.esh-report-preview');
  await expect(preview).toContainText('Nothing was sent.');
  await expect(preview).toContainText(name);
  await expect(preview).toContainText(email);
  await expect(preview).toContainText('contact access is off');
  await expect(preview).toContainText('Departments in scope:');

  const { data: definition } = await db
    .from('esh_report_definitions')
    .select('id,state')
    .eq('name', name)
    .single();
  expect(definition!.state).toBe('draft');
  const { count } = await db
    .from('esh_report_runs')
    .select('id', { count: 'exact', head: true })
    .eq('report_definition_id', definition!.id);
  expect(count).toBe(0);
});

test('v210 says on the Overview when the scheduled run has stopped reporting', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the Overview is enough.');
  const db = service();
  const { data: organization } = await db.from('organizations').select('id').limit(1).single();
  // A record of a run four days old, which is the newest this table holds: a
  // daily job that stopped on Tuesday looks exactly like this, and nothing in
  // an HTTP response would ever say so (§27).
  await db.from('esh_worker_runs').insert({
    organization_id: organization!.id,
    worker: 'cron',
    ok: true,
    detail: { source: 'v210 browser test' },
    ran_at: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
  });

  await signIn(page);
  await page.goto('/findings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const health = page.locator('.esh-health');
  await expect(health.getByRole('heading', { name: 'Worth knowing' })).toBeVisible();
  await expect(health).toContainText('The scheduled run last reported 4 days ago');
  await expect(health).toContainText('it should report daily');
});
