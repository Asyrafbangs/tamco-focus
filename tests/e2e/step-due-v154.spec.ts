import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v154 — Trackable Steps, stage 1, in the task the owner actually reads.
 *
 * "You must not lose the Step after assigning it." The parent task keeps
 * every step in view with who owes it and by when, a finished step shows who
 * finished it and opens its evidence in place, and Add step answers "Due" for
 * you — the task's own date, linked — so handing a step over stays one action.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const AMER = 'f0c05000-0000-4000-a000-000000000003';
const ZONE = 'Asia/Kuala_Lumpur';

// A 1×1 PNG: evidence the in-app viewer can actually display.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signedIn(email: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw error;
  return client;
}

/** The organisation-local date `days` from today, `YYYY-MM-DD`. */
function localDate(days: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

function endOfDay(days: number): string {
  return new Date(`${localDate(days)}T23:59:59.999+08:00`).toISOString();
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

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
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

async function planningTask(title: string) {
  const { data, error } = await service()
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
  return String(data!.id);
}

async function openSteps(page: Page, taskId: string, title: string) {
  await page.goto(`/work?task=${taskId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const drawer = page.getByRole('dialog', { name: title });
  await expect(drawer).toBeVisible();
  const steps = drawer.getByRole('button', { name: /^Steps/ });
  if ((await steps.getAttribute('aria-expanded')) !== 'true') await steps.click();
  return drawer;
}

test('v154 the task keeps every step in view: who owes it, by when, and what they sent', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts are enough.',
  );

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `3 Years Planning ${stamp}`;
  const taskId = await planningTask(title);
  const admin = service();

  const { data: steps, error } = await admin
    .from('task_checklist_items')
    .insert([
      // Needed back early: a date of its own.
      {
        task_id: taskId,
        position: 1,
        action: `Give department input ${stamp}`,
        assigned_to: AMER,
        evidence_rule: 'not_required',
        due_at: endOfDay(5),
      },
      // "Same as the task": no date of its own at all.
      {
        task_id: taskId,
        position: 2,
        action: `Review final proposal ${stamp}`,
        assigned_to: AMER,
        evidence_rule: 'not_required',
        due_at: null,
      },
      {
        task_id: taskId,
        position: 3,
        action: `Measure LEV airflow ${stamp}`,
        assigned_to: AMER,
        evidence_rule: 'optional',
        due_at: null,
      },
    ])
    .select('id,action');
  if (error) throw error;
  const measured = steps!.find((step) => step.action.startsWith('Measure'))!;

  // Amer finishes the third one and leaves his evidence on it.
  const path = `tasks/${taskId}/${crypto.randomUUID()}-airflow.png`;
  const upload = await admin.storage
    .from('task-attachments')
    .upload(path, PNG, { contentType: 'image/png' });
  if (upload.error) throw upload.error;
  const { error: attachError } = await admin.from('attachments').insert({
    task_id: taskId,
    checklist_item_id: measured.id,
    storage_bucket: 'task-attachments',
    storage_path: path,
    file_name: `airflow-${stamp}.png`,
    mime_type: 'image/png',
    byte_size: PNG.length,
    is_evidence: true,
    uploaded_by: AMER,
  });
  if (attachError) throw attachError;
  const amer = await signedIn('amer@tamco.local');
  const { data: done } = await amer.rpc('complete_checklist_item', {
    p_item_id: measured.id,
    p_completion_note: null,
    p_idempotency_key: null,
  });
  expect((done as { ok: boolean }).ok, 'Amer could not complete his step').toBe(true);

  try {
    await signIn(page, 'izzah@tamco.local');
    const drawer = await openSteps(page, taskId, title);
    const row = (action: string) => drawer.locator('.task-checklist-row', { hasText: action });

    // Who owes it and by when — the date it was given.
    await expect(row(`Give department input ${stamp}`)).toContainText(
      `Amer Hakim · Due ${shortLabel(5)}`,
    );
    // And one that simply follows the task shows the task's date, not nothing.
    await expect(row(`Review final proposal ${stamp}`)).toContainText(
      `Amer Hakim · Due ${shortLabel(10)}`,
    );

    // Finished: who did it, when, and the file — opened in place.
    const finished = row(`Measure LEV airflow ${stamp}`);
    await expect(finished).toContainText(`Amer Hakim · Completed ${shortLabel(0)}`);
    await finished.getByRole('button', { name: /Open the evidence/ }).click();
    await expect(page.getByRole('heading', { name: `airflow-${stamp}.png` })).toBeVisible();
  } finally {
    await admin.storage.from('task-attachments').remove([path]);
    await removeTasks(taskId);
  }
});

test('v154 Add step answers "Due" for you, and will not go past the task', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `Monthly ESH report ${stamp}`;
  const taskId = await planningTask(title);

  try {
    await signIn(page, 'izzah@tamco.local');
    const drawer = await openSteps(page, taskId, title);
    await drawer.getByRole('button', { name: '+ Add step' }).click();

    const dialog = page.getByRole('dialog', { name: 'Add step' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('What needs to be done?').fill(`Collect training data ${stamp}`);
    await dialog.getByLabel('Assigned to').selectOption({ label: 'Amer Hakim' });

    /*
     * One action: picking Amer is all it takes. "Same as the task" is already
     * chosen and names the date, so nobody has to type the deadline in again.
     */
    const same = dialog.getByRole('radio', { name: `Same as the task · ${shortLabel(10)}` });
    await expect(same).toBeChecked();

    // Needed back earlier: a date of its own, which cannot pass the task.
    await dialog.getByRole('radio', { name: 'Its own date' }).check();
    const date = dialog.getByLabel('Step due date');
    await expect(date).toHaveAttribute('max', localDate(10));

    await date.fill(localDate(14));
    await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    // The browser holds the form: four days past the task is not on offer.
    expect(await date.evaluate((input: HTMLInputElement) => input.validity.rangeOverflow)).toBe(
      true,
    );
    await expect(dialog).toBeVisible();

    await date.fill(localDate(6));
    await dialog.getByRole('button', { name: 'Add step', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    await expect(
      drawer.locator('.task-checklist-row', { hasText: `Collect training data ${stamp}` }),
    ).toContainText(`Amer Hakim · Due ${shortLabel(6)}`);
  } finally {
    await removeTasks(taskId);
  }
});
