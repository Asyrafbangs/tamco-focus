import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v187 — one deadline language (Product Owner, 15 September 2026).
 *
 * Overdue is already late; due soon is inside the five-day attention window;
 * anything further out is its date. The same words and weight on My Work,
 * Shared, a task's steps, the task drawer and My Team — and a delegated step
 * due soon surfaces on the parent before the parent itself is endangered.
 *
 * Lim owns the work because he has none of his own; Amer owes the steps.
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

/** "25 Sep", the way a row writes a date beyond the window. */
function shortLabel(days: number) {
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

async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function createWork(title: string, days: number, fields: Record<string, unknown> = {}) {
  const { data, error } = await service()
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: LIM,
      created_by: LIM,
      due_at: endOfDay(days),
      due_is_date_only: true,
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

async function addStep(taskId: string, action: string, days: number | null, position = 1) {
  const { error } = await service()
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position,
      action,
      assigned_to: AMER,
      evidence_rule: 'not_required',
      due_at: days === null ? null : endOfDay(days),
    });
  if (error) throw error;
}

async function removeTasks(ids: string[]) {
  const admin = service();
  for (const id of ids) {
    await admin.from('notifications').delete().eq('task_id', id);
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (error) {
      await admin
        .from('tasks')
        .update({ deleted_at: new Date().toISOString(), deleted_by: LIM })
        .eq('id', id);
    }
  }
}

test('v187 My Work, the drawer and steps say how close each deadline is', async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 5)}`;
  const titles = {
    late: `Replace the gas detector heads ${stamp}`,
    today: `Submit the permit renewal ${stamp}`,
    tomorrow: `Book the crane inspection ${stamp}`,
    soon: `Review the LEV proposal ${stamp}`,
    later: `Plan the contractor audit ${stamp}`,
  };
  const ids: string[] = [];

  try {
    ids.push(
      await createWork(titles.late, -2),
      await createWork(titles.today, 0),
      await createWork(titles.tomorrow, 1),
      await createWork(titles.soon, 3),
      await createWork(titles.later, 12),
    );
    // A step Amer owes on the later work, due tomorrow: the parent is not
    // endangered yet, and says so anyway.
    await addStep(ids[4]!, `Send the contractor list ${stamp}`, 1);

    await signIn(page, 'lim@tamco.local');
    await visit(page, '/work');
    const row = (title: string) => page.locator('.task-row-lean', { hasText: title });

    await expect(row(titles.late).locator('.deadline-overdue')).toHaveText('⚠ Overdue 2 days');
    await expect(row(titles.today).locator('.deadline-today')).toHaveText('! Due today');
    await expect(row(titles.tomorrow).locator('.deadline-tomorrow')).toHaveText('! Due tomorrow');
    await expect(row(titles.soon).locator('.deadline-soon')).toHaveText('! Due in 3 days');
    await expect(row(titles.later).locator('.deadline-later').first()).toHaveText(
      `Due ${shortLabel(12)}`,
    );
    await expect(row(titles.later).locator('.deadline-tomorrow')).toHaveText(
      '! Delegated step due tomorrow',
    );

    // Colour is not the only signal: late is red, close is amber, later is not.
    const colour = (title: string, tone: string) =>
      row(title)
        .locator(`.deadline-${tone}`)
        .first()
        .evaluate((element) => getComputedStyle(element).color);
    expect(await colour(titles.late, 'overdue')).not.toBe(await colour(titles.soon, 'soon'));
    expect(await colour(titles.soon, 'soon')).not.toBe(await colour(titles.later, 'later'));

    // The drawer says the same, beside the exact date.
    await visit(page, `/work?task=${ids[3]}`);
    await expect(
      page.getByRole('dialog', { name: titles.soon }).locator('.task-status-line'),
    ).toContainText('Due in 3 days');
    await visit(page, `/work?task=${ids[0]}`);
    await expect(
      page.getByRole('dialog', { name: titles.late }).locator('.task-status-line'),
    ).toContainText('Overdue 2 days');

    // And the step, in its task.
    await visit(page, `/work?task=${ids[4]}`);
    const drawer = page.getByRole('dialog', { name: titles.later });
    await drawer.getByRole('button', { name: /^Steps/ }).click();
    await expect(
      drawer.locator('.task-checklist-row', { hasText: 'Send the contractor list' }),
    ).toContainText('Amer Hakim · ! Due tomorrow');
    // Further out, the drawer keeps its date and adds nothing.
    await expect(drawer.locator('.task-status-line .deadline')).toHaveCount(0);
  } finally {
    await removeTasks(ids);
  }
});

test('v187 Shared lists what you owe in order of urgency', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  const stamp = crypto.randomUUID().slice(0, 5);
  const ids: string[] = [];

  try {
    const parent = await createWork(`Three year planning ${stamp}`, 20);
    ids.push(parent);
    await addStep(parent, `Later input ${stamp}`, 15, 1);
    await addStep(parent, `Soon input ${stamp}`, 4, 2);
    await addStep(parent, `Late input ${stamp}`, -1, 3);
    await addStep(parent, `Today input ${stamp}`, 0, 4);

    await signIn(page, 'amer@tamco.local');
    await visit(page, '/work?tab=shared');
    const titles = await page.locator('.task-row-lean strong').allInnerTexts();
    const order = [
      `Late input ${stamp}`,
      `Today input ${stamp}`,
      `Soon input ${stamp}`,
      `Later input ${stamp}`,
    ].map((title) => titles.indexOf(title));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);

    const row = (title: string) => page.locator('.task-row-lean', { hasText: title });
    await expect(row(`Late input ${stamp}`)).toContainText('Overdue 1 day');
    await expect(row(`Today input ${stamp}`)).toContainText('Due today');
    await expect(row(`Soon input ${stamp}`)).toContainText('Due in 4 days');
    await expect(row(`Later input ${stamp}`)).toContainText(`Due ${shortLabel(15)}`);
  } finally {
    await removeTasks(ids);
  }
});

test('v187 My Team puts late work first, then work due soon', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  const stamp = crypto.randomUUID().slice(0, 5);
  const recent = new Date().toISOString();
  const older = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const ids: string[] = [];

  try {
    for (let index = 0; index < 5; index += 1) {
      ids.push(
        await createWork(`Later ${index + 1} ${stamp}`, 20 + index, {
          last_meaningful_update_at: recent,
        }),
      );
    }
    ids.push(
      await createWork(`Soon ${stamp}`, 2, { last_meaningful_update_at: older }),
      await createWork(`Late ${stamp}`, -1, { last_meaningful_update_at: older }),
    );

    await signIn(page, 'izzul@tamco.local');
    await visit(page, `/work?scope=team&person=${LIM}`);
    // Named rather than found by element: v236 folded this section, so it is a
    // <details> and no longer a <section>.
    const section = page
      .getByTestId('my-team-person-panel')
      .locator('.team-person-section[data-section="active"]');
    const rows = section.locator(':scope > .member-work-list > .member-work-row');
    await expect(rows.nth(0)).toContainText(`Late ${stamp}`);
    await expect(rows.nth(0).locator('.deadline-overdue')).toHaveText('⚠ Overdue 1 day');
    await expect(rows.nth(1)).toContainText(`Soon ${stamp}`);
    await expect(rows.nth(1).locator('.deadline-soon')).toHaveText('! Due in 2 days');
    await expect(rows.nth(2)).toContainText('Later');
  } finally {
    await removeTasks(ids);
  }
});
