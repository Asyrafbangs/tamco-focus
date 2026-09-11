import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v157 — Trackable Steps, stage 4, where the manager looks.
 *
 * Amer's row on My Team says how many steps he owes on other people's work
 * and, once one is late, says so on a line of its own. Opening him lists them
 * under "Contributions to others" — whose work, when, and why it is held — and
 * each one opens that work at the step.
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

/** Izzah's work, due in ten days, with steps Amer owes on it. */
async function izzahsWork(title: string, steps: Array<{ action: string; due: number | null }>) {
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

test('v157 My Team shows the steps Amer owes, and opens one at the step', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `Quarterly ESH review ${stamp}`;
  const late = `Collect incident data ${stamp}`;
  const onTime = `Draft the summary ${stamp}`;
  const taskId = await izzahsWork(title, [
    { action: late, due: -1 },
    { action: onTime, due: null },
  ]);

  try {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Amer Hakim' });
    /*
     * Counted, not matched exactly: the phone project runs its own copy of
     * this fixture against the same database, so either run may see both.
     */
    await expect(row.locator('[data-cell="person"]')).toContainText(/\d+ shared steps/);
    await expect(row.getByTestId('assigned-step-overdue')).toContainText(
      /⚠ \d+ assigned steps? overdue/,
    );

    await row.locator('[data-cell="person"] strong').click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();

    // Collapsed like every section that is not a decision; the count says
    // there is something late inside.
    const section = panel.locator('.team-person-section[data-section="contributions"]');
    await expect(section).not.toHaveAttribute('open', '');
    await expect(section.locator('summary')).toContainText(
      /Contributions to others\s*\d+ · \d+ overdue/,
    );
    await section.locator('summary').click();

    const lateRow = section.locator('.member-other-row', { hasText: late });
    await expect(lateRow).toContainText(`For Izzah Nurul · ${title}`);
    await expect(lateRow).toContainText(`Overdue since ${shortLabel(-1)}`);
    const onTimeRow = section.locator('.member-other-row', { hasText: onTime });
    // No date of its own: due when the work is.
    await expect(onTimeRow).toContainText(`Due ${shortLabel(10)}`);

    // It opens the work, at the step.
    await lateRow.click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    await expect(page).toHaveURL(/step=/);
    await expect(page.locator('.task-checklist-row.is-focused')).toContainText(late);
  } finally {
    await removeTasks(taskId);
  }
});
