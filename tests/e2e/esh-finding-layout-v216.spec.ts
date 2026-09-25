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

test('v216 the finding reads as work, with the trail behind it', async ({ page }, testInfo) => {
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

  // The conversation is the work; the context stands beside it.
  await expect(page.locator('.esh-detail-main')).toContainText('Conversation with the owner');
  const side = page.locator('.esh-detail-side');
  await expect(side.getByRole('heading', { name: 'Required action' })).toBeVisible();
  await expect(side.getByRole('heading', { name: 'The finding' })).toBeVisible();
  // What was seen belongs to the finding, not to a card of its own.
  await expect(side.getByRole('heading', { name: 'Original evidence' })).toBeVisible();

  // Administrative controls are behind one button in the header, not on the
  // page and not above the composer.
  await expect(page.getByText('Change the due date, the priority or the owner')).toHaveCount(0);
  await page.getByRole('button', { name: 'More actions for this finding' }).click();
  await expect(page.getByText('Change the due date, the priority or the owner')).toBeVisible();

  // This assignment is held, so the trail opens itself to show the remedy.
  const activity = page.locator('.esh-activity');
  await expect(activity).toHaveAttribute('open', '');
  await expect(activity.getByRole('heading', { name: 'Delivery' })).toBeVisible();
  await expect(activity.getByRole('heading', { name: 'History' })).toBeVisible();

  // v222 — the end of the story by default, the rest on request.
  const listed = activity.locator('.esh-history').first().locator('li');
  await expect(listed).toHaveCount(Math.min(3, await listed.count()));
});
