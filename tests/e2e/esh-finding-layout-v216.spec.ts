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

test('v216/v223 the finding reads as work, with the trail behind it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the layout is enough.');
  const suffix = randomBytes(3).toString('hex');
  const esh = await apiAs('izzul@tamco.local');
  const { data: saved } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v216 blocked walkway ${suffix}`,
      description: 'Materials stored outside the designated zone.',
      reported_on: '2026-09-05',
      accountable_department_id: OPS,
      location: 'BR2 Warehouse',
      required_outcome: 'Clear the walkway.',
      priority: 'normal',
      risk_level: 'high',
      owner_email: `layout.${suffix}@example.com`,
      due_date: '2026-12-15',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
  });
  if (!saved?.ok) throw new Error(JSON.stringify(saved));

  await signIn(page);
  await page.goto(`/findings/${saved.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // v223 - context left, conversation right; one card says what to fix.
  await expect(page.locator('.esh-detail-main')).toContainText('Conversation with the owner');
  const side = page.locator('.esh-detail-side');
  await expect(side.getByText('Required action', { exact: true })).toBeVisible();
  await expect(side.getByRole('heading', { name: 'What was found' })).toBeVisible();
  await expect(side.locator('section.esh-form-card')).toHaveCount(1);
  // The rest of the record is kept, and folded.
  await expect(side.locator('details', { hasText: 'Full record' })).not.toHaveAttribute('open', '');

  // Administrative controls are named items behind one button.
  await expect(page.getByRole('button', { name: 'Change due date' })).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions for this finding' }).click();
  const menu = page.getByRole('list', { name: 'Finding actions' });
  for (const item of ['Change due date', 'Change owner', 'Edit finding', 'Change risk']) {
    await expect(menu.getByRole('button', { name: item })).toBeVisible();
  }
  await expect(menu.getByRole('button', { name: 'Cancel / mark duplicate' })).toBeVisible();

  // Held email is not repeated on the finding; the activity line is the story
  // and the full history (with the delivery log) is in a drawer.
  await expect(page.getByText('Owner not told yet')).toHaveCount(0);
  const activity = page.locator('.esh-activity-line');
  await expect(activity).toContainText('Latest:');
  await expect(activity).not.toContainText('Email');
  await activity.getByRole('button', { name: 'View full history' }).click();
  const drawer = page.getByRole('dialog', { name: 'Full history' });
  await expect(drawer.getByRole('heading', { name: 'Delivery log' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: 'Everything that happened' })).toBeVisible();
});
