import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

import { showActiveWork } from './support/work-list';

config({ path: '.env.local', quiet: true });

/**
 * v159 — your own steps, where you look for them.
 *
 * A step you gave yourself, or left unassigned, with a date of its own is on
 * your calendar as "Step: …" and opens the work at that step; your card says
 * when it is next or that it is late; and a contribution past its date says so
 * on the Shared list of the person who owes it.
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

/** The end of a calendar day in this month, or `days` from today. */
function endOf(day: string | number): string {
  const date =
    typeof day === 'string'
      ? day
      : new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
          new Date(Date.now() + day * 86_400_000),
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

/** Izzah's work, with the steps given; returns the task and the step ids by action. */
async function izzahsWork(
  title: string,
  dueAt: string | null,
  steps: Array<{ action: string; assignee: string | null; due: string | null }>,
) {
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
      due_at: dueAt,
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(data!.id);

  const { data: rows, error: stepError } = await admin
    .from('task_checklist_items')
    .insert(
      steps.map((step, index) => ({
        task_id: taskId,
        position: index + 1,
        action: step.action,
        assigned_to: step.assignee,
        evidence_rule: 'not_required',
        due_at: step.due,
      })),
    )
    .select('id,action');
  if (stepError) throw stepError;
  return {
    taskId,
    stepIds: new Map((rows ?? []).map((row) => [String(row.action), String(row.id)])),
  };
}

test('v159 your own dated steps are on your calendar, and open at the step', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );

  const stamp = crypto.randomUUID().slice(0, 6);
  const month = currentMonth();
  const title = `3 Years Planning ${stamp}`;
  const undated = `Safety survey ${stamp}`;
  const planning = await izzahsWork(title, endOf(`${month}-25`), [
    { action: `Prepare structure ${stamp}`, assignee: IZZAH, due: endOf(`${month}-18`) },
    { action: `Draft outline ${stamp}`, assignee: null, due: endOf(`${month}-20`) },
    { action: `Final check ${stamp}`, assignee: IZZAH, due: null },
  ]);
  const survey = await izzahsWork(undated, null, [
    { action: `Give department input ${stamp}`, assignee: AMER, due: endOf(`${month}-22`) },
  ]);

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);

    const entry = (date: string, text: string) =>
      page
        .locator(`.day[data-date="${month}-${date}"]`)
        .locator('.cal-item.step', { hasText: text });

    // Yours, on your own work: a step, not a shared one.
    const structure = entry('18', `Prepare structure ${stamp}`);
    await expect(structure).toContainText(`Prepare structure ${stamp}`);
    await expect(structure).not.toContainText('Shared step');
    await expect(structure).toContainText(title);
    // Unassigned is yours too.
    await expect(entry('20', `Draft outline ${stamp}`)).toContainText(`Draft outline ${stamp}`);
    // No date of its own: counted on the work's entry, not drawn beside it.
    await expect(page.locator('.cal-item.step', { hasText: `Final check ${stamp}` })).toHaveCount(
      0,
    );
    await expect(
      page.locator(`.day[data-date="${month}-25"]`).locator('.cal-item', { hasText: title }),
    ).toContainText('1 step due');
    // Work with no date has no entry to count on, so a step dated on it is drawn.
    await expect(entry('22', `Give department input ${stamp}`)).toContainText('↘ Amer');

    // And it opens the work at the step.
    await structure.click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    await expect(
      page.locator(
        `.task-checklist-row.is-focused[data-step-id="${planning.stepIds.get(`Prepare structure ${stamp}`)}"]`,
      ),
    ).toBeVisible();
  } finally {
    await removeTasks(planning.taskId, survey.taskId);
  }
});

test('v159 the card says when your own step is next or late, and so does My Team', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const upcoming = `Budget review ${stamp}`;
  const late = `Contractor audit ${stamp}`;
  const upcomingWork = await izzahsWork(upcoming, endOf(10), [
    { action: `Collect quotes ${stamp}`, assignee: IZZAH, due: endOf(3) },
  ]);
  const lateWork = await izzahsWork(late, endOf(10), [
    { action: `Book the site visit ${stamp}`, assignee: null, due: endOf(-1) },
  ]);

  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await showActiveWork(page);

    const row = (title: string) => page.locator('.task-row', { hasText: title });
    await expect(row(upcoming)).toContainText(`Next step due ${shortLabel(3)}`);
    await expect(row(late)).toContainText('1 step overdue');
    await expect(row(late)).not.toContainText('Next step due');

    // Her manager sees the same thing on her active work.
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Izzah Nurul' })
      .locator('[data-cell="person"] strong')
      .click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();
    // Behind "Show more" when she carries more than five.
    const more = panel.locator('.team-person-more > summary');
    if ((await more.count()) > 0) await more.first().click();
    await expect(panel.locator('.member-work-row', { hasText: late })).toContainText(
      '1 step overdue',
    );
  } finally {
    await removeTasks(upcomingWork.taskId, lateWork.taskId);
  }
});

test('v159 a late contribution says so on the Shared list', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const work = await izzahsWork(`Monthly ESH report ${stamp}`, endOf(10), [
    { action: `Collect training data ${stamp}`, assignee: AMER, due: endOf(-1) },
  ]);

  try {
    await signIn(page, 'amer@tamco.local');
    await page.goto('/work?tab=shared');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(
      page.locator('.task-row', { hasText: `Collect training data ${stamp}` }),
    ).toContainText(`Overdue since ${shortLabel(-1)}`);
  } finally {
    await removeTasks(work.taskId);
  }
});
