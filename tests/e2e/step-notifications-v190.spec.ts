import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v190 — Step notifications (Product Owner, 15 September 2026).
 *
 * The morning job reminds Amer that a step is due tomorrow and tells both him
 * and Lim, the owner, that another is late. Lim's notice opens his work at the
 * step. From the drawer he reopens a step Amer completed and gives another a
 * new date; Amer hears about both straight away, by email as well, and the
 * reopened notice opens the work at the step. Neither is told about
 * what they did themselves.
 *
 * Lim owns the work because he has none of his own.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ZONE = 'Asia/Kuala_Lumpur';
const AMER = 'f0c05000-0000-4000-a000-000000000003';
const LIM = 'f0c05000-0000-4000-a000-000000000006';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function localDate(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

function endOfDay(days: number) {
  return new Date(`${localDate(days)}T23:59:59.999+08:00`).toISOString();
}

/** How the database writes a date: "16 Sep". */
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

async function removeTask(id: string) {
  const admin = service();
  await admin.from('notifications').delete().eq('task_id', id);
  const { error } = await admin.from('tasks').delete().eq('id', id);
  if (error) {
    await admin
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: LIM })
      .eq('id', id);
    await admin.from('notifications').delete().eq('task_id', id);
  }
}

/** The email queued for Amer's notice with this title, once it has gone. */
async function emailedToAmer(taskId: string, title: string) {
  const admin = service();
  const { data: notices } = await admin
    .from('notifications')
    .select('id')
    .eq('recipient_id', AMER)
    .eq('task_id', taskId)
    .eq('title', title);
  if (!notices?.length) return [];
  const { data } = await admin
    .from('notification_email_deliveries')
    .select('recipient_email,status')
    .in(
      'notification_id',
      notices.map((notice) => notice.id),
    );
  return data ?? [];
}

test('v190 a step’s reminder, lateness, reopening and new date reach the right people', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  test.setTimeout(150_000);
  const stamp = crypto.randomUUID().slice(0, 5);
  const title = `Replace the fire extinguishers ${stamp}`;
  const quote = `Check the supplier quote ${stamp}`;
  const hoses = `Inspect the hoses ${stamp}`;
  const witness = `Witness the pressure test ${stamp}`;
  const admin = service();

  const { data: task, error } = await admin
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: LIM,
      created_by: LIM,
      due_at: endOfDay(10),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(task!.id);

  try {
    const { data: steps, error: stepError } = await admin
      .from('task_checklist_items')
      .insert([
        {
          task_id: taskId,
          position: 1,
          action: quote,
          assigned_to: AMER,
          evidence_rule: 'not_required',
          due_at: endOfDay(1),
          // One shape for every row: a bulk insert sends null for a missing column.
          state: 'ready',
          completed_by: null,
          completed_at: null,
        },
        {
          task_id: taskId,
          position: 2,
          action: hoses,
          assigned_to: AMER,
          evidence_rule: 'not_required',
          due_at: endOfDay(-1),
          state: 'ready',
          completed_by: null,
          completed_at: null,
        },
        {
          task_id: taskId,
          position: 3,
          action: witness,
          assigned_to: AMER,
          evidence_rule: 'not_required',
          due_at: endOfDay(3),
          state: 'completed',
          completed_by: AMER,
          completed_at: new Date().toISOString(),
        },
      ])
      .select('id,action');
    if (stepError) throw stepError;
    const idOf = (action: string) => String(steps!.find((row) => row.action === action)!.id);

    // The morning job.
    const { data: reminded } = await admin.rpc('notify_steps_due_tomorrow', {
      p_task_ids: [taskId],
    });
    expect(reminded).toEqual({ ok: true, notified: 1 });
    const { data: late } = await admin.rpc('notify_overdue_contributions', {
      p_task_ids: [taskId],
    });
    expect(late).toEqual({ ok: true, notified: 1, owners: 1 });

    // Lim hears the hoses are late, and his notice opens the work at the step.
    await signIn(page, 'lim@tamco.local');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const limBell = page.getByRole('dialog', { name: 'Notifications' });
    const lateEntry = limBell.locator('li', { hasText: hoses });
    await expect(lateEntry).toContainText('Contribution overdue on your work');
    await expect(lateEntry).toContainText('Waiting on Amer Hakim');
    await expect(limBell.locator('li', { hasText: quote })).toHaveCount(0);
    await lateEntry.getByRole('button').click();

    const drawer = page.getByRole('dialog', { name: title });
    await expect(drawer.locator('.task-checklist-row.is-focused')).toContainText(hoses);

    // He reopens the pressure test Amer completed.
    const witnessRow = drawer.locator('.task-checklist-row', { hasText: witness });
    await witnessRow.getByRole('button', { name: 'Undo' }).click();
    await expect(witnessRow.getByRole('button', { name: 'Undo' })).toHaveCount(0);

    // And gives the quote a later date of its own.
    await drawer.getByRole('button', { name: `More actions for ${quote}` }).click();
    await page.getByRole('menuitem', { name: 'Edit step' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit step' });
    await expect(editor.getByRole('radio', { name: 'Its own date' })).toBeChecked();
    await editor.getByLabel('Step due date').fill(localDate(4));
    await editor.getByRole('button', { name: 'Save changes' }).click();
    await expect(editor).toHaveCount(0);
    await expect(drawer.locator('.task-checklist-row', { hasText: quote })).toContainText(
      'Due in 4 days',
    );

    // Amer is emailed about both straight away.
    await expect
      .poll(() => emailedToAmer(taskId, 'Contribution reopened'), { timeout: 30_000 })
      .toEqual([{ recipient_email: 'amer@tamco.local', status: 'sent' }]);
    await expect
      .poll(() => emailedToAmer(taskId, 'Contribution due date changed'), { timeout: 30_000 })
      .toEqual([{ recipient_email: 'amer@tamco.local', status: 'sent' }]);

    // Lim is told about none of what he did.
    const { data: limsOwn } = await admin
      .from('notifications')
      .select('title')
      .eq('recipient_id', LIM)
      .eq('task_id', taskId);
    expect((limsOwn ?? []).map((row) => row.title)).toEqual(['Contribution overdue on your work']);

    await signIn(page, 'amer@tamco.local');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const amerBell = page.getByRole('dialog', { name: 'Notifications' });
    const entry = (heading: string, step: string) =>
      amerBell.locator('li', { hasText: heading }).filter({ hasText: step });

    await expect(entry('Contribution due tomorrow', quote)).toContainText(
      `It is due tomorrow, ${shortLabel(1)}.`,
    );
    await expect(entry('Contribution overdue', hoses)).toBeVisible();
    await expect(entry('Contribution due date changed', quote)).toContainText(
      `Lim Wei Sheng moved it from ${shortLabel(1)} to ${shortLabel(4)}.`,
    );
    const reopened = entry('Contribution reopened', witness);
    await expect(reopened).toContainText('Reopened by Lim Wei Sheng.');
    // Undo asks for no reason, so none is invented for it.
    await expect(reopened).not.toContainText('Reason');

    // It opens the work at the step. `item` in a contribution link was never
    // read before v190, so the work opened and the step did not.
    await reopened.getByRole('button').click();
    await expect(page).toHaveURL(new RegExp(`item=${idOf(witness)}`));
    await expect(
      page.getByRole('dialog', { name: title }).locator('.task-checklist-row.is-focused'),
    ).toContainText(witness);
  } finally {
    await removeTask(taskId);
  }
});

test('v190 a contribution notice’s link opens the step, on a phone too', async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 5)}`;
  const title = `Service the sprinkler pump ${stamp}`;
  const action = `Book the contractor ${stamp}`;
  const admin = service();
  const { data: task, error } = await admin
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: LIM,
      created_by: LIM,
      due_at: endOfDay(10),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(task!.id);

  try {
    const { data: step, error: stepError } = await admin
      .from('task_checklist_items')
      .insert({
        task_id: taskId,
        position: 1,
        action,
        assigned_to: AMER,
        evidence_rule: 'not_required',
        due_at: endOfDay(3),
      })
      .select('id')
      .single();
    if (stepError) throw stepError;

    await signIn(page, 'amer@tamco.local');
    // The shape every contribution notice and its email has used since v44.
    await page.goto(`/work?tab=shared&task=${taskId}&item=${step!.id}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const focused = page
      .getByRole('dialog', { name: title })
      .locator('.task-checklist-row.is-focused');
    await expect(focused).toContainText(action);
    // Shown, not merely present: on a phone the Steps section starts closed.
    await expect(focused).toBeVisible();
  } finally {
    await removeTask(taskId);
  }
});
