import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v158 — Trackable Steps, stage 5, where the owner hears about it.
 *
 * Amer finishes the step Izzah handed him. Izzah is told quietly — it is in
 * her bell, it asks nothing of her, and no email goes out — and the notice
 * opens her own work at that step, not somebody else's Shared list.
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

/** Amer, signed in as himself, so the completion is his own act. */
async function asAmer() {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({
    email: 'amer@tamco.local',
    password: PASSWORD,
  });
  if (error) throw error;
  return client;
}

function endOfDay(days: number): string {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
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

test('v158 the owner is told quietly that a step is done, and lands on it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `Monthly ESH report ${stamp}`;
  const step = `Collect training data ${stamp}`;

  const admin = service();
  const { data: task, error } = await admin
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
  const taskId = String(task!.id);

  try {
    const { data: item, error: stepError } = await admin
      .from('task_checklist_items')
      .insert({
        task_id: taskId,
        position: 1,
        action: step,
        assigned_to: AMER,
        evidence_rule: 'not_required',
      })
      .select('id')
      .single();
    if (stepError) throw stepError;
    const stepId = String(item!.id);

    const amer = await asAmer();
    const { data: done, error: doneError } = await amer.rpc('complete_checklist_item', {
      p_item_id: stepId,
      p_completion_note: null,
      p_idempotency_key: null,
    });
    if (doneError) throw doneError;
    expect((done as { ok: boolean }).ok).toBe(true);

    await signIn(page, 'izzah@tamco.local');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    const entry = panel.locator('li', { hasText: step });
    await expect(entry).toContainText('Contribution completed');
    await expect(entry).toContainText('Completed by Amer Hakim.');

    // It opens her work, at the step.
    await entry.getByRole('button').click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`step=${stepId}`));
    await expect(page.locator('.task-checklist-row.is-focused')).toContainText(step);
  } finally {
    await removeTasks(taskId);
  }
});
