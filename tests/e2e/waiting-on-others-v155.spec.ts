import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

import { showActiveWork } from './support/work-list';

config({ path: '.env.local', quiet: true });

/**
 * v155 — Trackable Steps, stage 2, where the owner actually looks.
 *
 * The Active card says whose steps are with others and when the next one is
 * needed back, and turns into a warning once one is late. My Day lists the
 * late ones by name — "Waiting on others · Amer Hakim · Give department input
 * · Due yesterday" — so nobody has to open every task to find what to chase.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const AMER = 'f0c05000-0000-4000-a000-000000000003';
const ZONE = 'Asia/Kuala_Lumpur';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

/** How the application writes a date on a row: "16 Sep". */
function shortLabel(days: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    day: 'numeric',
    month: 'short',
  }).formatToParts(new Date(Date.now() + days * 86_400_000));
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return `${read('day')} ${read('month')}`;
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Deleted where possible; binned where history forbids it (see v153). */
async function removeTasks(...ids: string[]) {
  const admin = service();
  for (const id of ids) {
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (!error) continue;
    const { error: binError } = await admin
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZAH })
      .eq('id', id);
    if (binError) throw new Error(`Could not remove fixture ${id}: ${binError.message}`);
  }
}

async function taskWithSteps(title: string, steps: Array<{ action: string; due: number | null }>) {
  const admin = service();
  const { data, error } = await admin
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
      due_at: endOfDay(10),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(data!.id);

  const { error: stepError } = await admin.from('task_checklist_items').insert(
    steps.map((step, index) => ({
      task_id: taskId,
      position: index + 1,
      action: step.action,
      assigned_to: AMER,
      evidence_rule: 'not_required',
      due_at: step.due === null ? null : endOfDay(step.due),
    })),
  );
  if (stepError) throw stepError;
  return taskId;
}

test('v155 the Active card says whose steps are out, and warns once one is late', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const onTime = `Planning on time ${stamp}`;
  const late = `Planning running late ${stamp}`;
  const onTimeId = await taskWithSteps(onTime, [
    { action: `Give department input ${stamp}`, due: 3 },
    { action: `Review final proposal ${stamp}`, due: null },
  ]);
  const lateId = await taskWithSteps(late, [{ action: `Collect training data ${stamp}`, due: -1 }]);

  try {
    await signIn(page);
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await showActiveWork(page);

    const row = (title: string) => page.locator('.task-row', { hasText: title });

    // Out with others, on time: how many, and when the first is needed back.
    await expect(row(onTime)).toContainText('0/2 steps · 2 with others');
    await expect(row(onTime)).toContainText(`Next contribution due ${shortLabel(3)}`);

    // Late: the task itself is fine, and the row says it is at risk anyway.
    await expect(row(late)).toContainText('1 delegated step overdue');
    await expect(row(late)).not.toContainText('Next contribution due');
  } finally {
    await removeTasks(onTimeId, lateId);
  }
});

test('v155 My Day names the late step, who owes it, and the work it belongs to', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `3 Years Planning ${stamp}`;
  const step = `Give department input ${stamp}`;
  const taskId = await taskWithSteps(title, [{ action: step, due: -1 }]);

  try {
    await signIn(page);
    await page.goto('/today');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const waiting = page.locator('section.waiting-on-others');
    await expect(waiting.getByRole('heading', { name: 'Waiting on others' })).toBeVisible();

    const entry = waiting.locator('.coming-item', { hasText: step });
    await expect(entry).toContainText(`Amer Hakim · ${step}`);
    await expect(entry).toContainText('Due yesterday');
    await expect(entry).toContainText(`Part of: ${title}`);

    // And it counts in the banner as the exception it is.
    await expect(page.locator('.attention-banner')).toContainText('waiting on others');

    // It opens the work the step belongs to, where the step is.
    await entry.click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
  } finally {
    await removeTasks(taskId);
  }
});
