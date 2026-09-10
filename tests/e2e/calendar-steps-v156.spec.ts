import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v156 — Trackable Steps, stage 3: a calendar that knows about steps.
 *
 * Amer's calendar shows the step he owes, on its date, and opening it lands
 * inside the work it belongs to at that step. Izzah's shows a delegated step
 * only when it is due before her task; one due with the task is counted on the
 * task's own entry — "3 steps due" — instead of four squares on one day.
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

function currentMonth(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(new Date()).slice(0, 7);
}

function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openPlan(page: Page) {
  await page.goto(`/plan?month=${currentMonth()}`);
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
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

/**
 * Izzah's work due on the 25th: Amer's input needed back on the 18th, Amer's
 * review due with the task, and his sign-off given the task's own day.
 */
async function planning(stamp: string) {
  const month = currentMonth();
  const admin = service();
  const title = `3 Years Planning ${stamp}`;
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
      due_at: endOfDay(`${month}-25`),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(data!.id);

  const { data: steps, error: stepError } = await admin
    .from('task_checklist_items')
    .insert([
      {
        task_id: taskId,
        position: 1,
        action: `Give department input ${stamp}`,
        assigned_to: AMER,
        due_at: endOfDay(`${month}-18`),
      },
      {
        task_id: taskId,
        position: 2,
        action: `Review final proposal ${stamp}`,
        assigned_to: AMER,
        due_at: null,
      },
      {
        task_id: taskId,
        position: 3,
        action: `Sign off ${stamp}`,
        assigned_to: AMER,
        due_at: endOfDay(`${month}-25`),
      },
    ])
    .select('id,action');
  if (stepError) throw stepError;
  return { taskId, title, month, steps: steps! };
}

test('v156 Amer sees the step he owes, and it opens the work at that step', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );

  const stamp = crypto.randomUUID().slice(0, 6);
  const { taskId, title, month, steps } = await planning(stamp);
  const input = steps.find((step) => step.action.startsWith('Give department input'))!;

  try {
    await signIn(page, 'amer@tamco.local');
    await openPlan(page);

    const entry = page
      .locator(`.day[data-date="${month}-18"]`)
      .locator('.cal-item.step', { hasText: `Give department input ${stamp}` });
    await expect(entry).toContainText(`Shared step: Give department input ${stamp}`);
    await expect(entry).toContainText(`For ${title}`);
    // A step's date is its step's business, not something to drag about.
    await expect(entry).toHaveAttribute('draggable', 'false');

    // Inside the work it belongs to, at that step.
    await entry.click();
    const drawer = page.getByRole('dialog', { name: title });
    await expect(drawer).toBeVisible();
    await expect(
      drawer.locator(`.task-checklist-row.is-focused[data-step-id="${input.id}"]`),
    ).toBeVisible();
  } finally {
    await removeTasks(taskId);
  }
});

test('v156 the owner sees only the step due before her work, and a count for the rest', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const { taskId, title, month } = await planning(stamp);

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);

    // Needed back early: its own square, saying who owes it.
    const early = page
      .locator(`.day[data-date="${month}-18"]`)
      .locator('.cal-item.step', { hasText: `Give department input ${stamp}` });
    await expect(early).toContainText(`↳ Amer Hakim · Give department input ${stamp}`);

    // Due with the task: no square of their own — one count on the task's entry.
    await expect(
      page.locator('.cal-item.step', { hasText: `Review final proposal ${stamp}` }),
    ).toHaveCount(0);
    await expect(page.locator('.cal-item.step', { hasText: `Sign off ${stamp}` })).toHaveCount(0);
    const own = page
      .locator(`.day[data-date="${month}-25"]`)
      .locator('.cal-item', { hasText: title });
    await expect(own).toContainText('2 steps due');
  } finally {
    await removeTasks(taskId);
  }
});
