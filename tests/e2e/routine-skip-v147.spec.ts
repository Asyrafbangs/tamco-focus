import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v147 §15 — the way out of a skip request.
 *
 * An employee who marks an occurrence as not required and then finds the area
 * open after all had no route back: the request sat with their manager, and
 * the work could not be done until somebody else returned it. §15's
 * implementation default is that they can take it back themselves.
 *
 * Acceptance A17.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('§15 a skip request can be taken back and the work done instead', async ({
  page,
}, testInfo) => {
  // A mutation, so it runs once: the five viewport projects share one database.
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const service = serviceClient();
  const stamp = crypto.randomUUID().slice(0, 8);

  const { data: template, error: templateError } = await service
    .from('routine_templates')
    .insert({
      title: `Skip walk ${stamp}`,
      default_owner_id: IZZAH,
      created_by: IZZAH,
      frequency: 'weekly',
      interval_count: 1,
      weekday: 1,
    })
    .select('id')
    .single();
  if (templateError) throw templateError;

  const title = `Skip walk occurrence ${stamp}`;
  const { data: task, error } = await service
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'routine_occurrence',
      focus_bucket: null,
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
      routine_template_id: template!.id,
      occurrence_date: new Date().toISOString().slice(0, 10),
    })
    .select('id')
    .single();
  if (error) throw error;

  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto(`/work?task=${task!.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const drawer = page.locator('.task-detail-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer).toContainText(title);

    // Mark it as not required, which sends it to the manager.
    await drawer.getByRole('button', { name: 'Not required this time' }).click();
    const reason = page.getByRole('dialog', { name: 'Not required this time' });
    await expect(reason).toBeVisible();
    await reason.getByRole('button', { name: 'No applicable site or work' }).click();

    /*
     * Waited for, not navigated past. The panel refreshes itself when the
     * action lands; a `page.goto` on the next tick abandons the server action
     * mid-flight and the failure then reads as "the request was never raised".
     */
    await expect(drawer).toContainText('Waiting for your manager to accept');

    /*
     * §15 — the way back, and it belongs to the person who raised it. Without
     * this they had to ask their manager to return their own request before
     * they could do the work.
     */
    const withdraw = drawer.getByRole('button', { name: 'Withdraw and complete it instead' });
    await expect(withdraw).toBeVisible();
    await withdraw.click();

    // Back to the normal flow: the request is gone and the occurrence is the
    // employee's to complete again.
    await expect(drawer.getByRole('button', { name: 'Not required this time' })).toBeVisible();
    await expect(drawer).not.toContainText('Waiting for your manager to accept');

    const { data: request } = await service
      .from('routine_occurrence_exceptions')
      .select('state')
      .eq('task_id', task!.id)
      .single();
    expect(request!.state).toBe('withdrawn');
  } finally {
    await service.from('routine_occurrence_exceptions').delete().eq('task_id', task!.id);
    await service.from('tasks').delete().eq('id', task!.id);
    await service.from('routine_templates').delete().eq('id', template!.id);
  }
});
