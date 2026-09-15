import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Locator, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v188 — My Day as the action view (Product Owner, 15 September 2026).
 *
 * One sentence, then Overdue and Due within 5 days, one card per problem.
 * A late step of your own, and a step somebody else owes you, are lines on the
 * work they belong to — never cards of their own — and work that is not due
 * soon itself surfaces when one of its steps is. A step you owe on somebody
 * else's work is its own card, and opens at the step. Start here, Next up,
 * Waiting on others and Coming up are gone.
 *
 * Replaces my-day-v125 (sections that repeated each other), the My Day half of
 * waiting-on-others-v155, and my-day-steps-v160 (steps in Coming up), whose
 * sections no longer exist; what they protected is asserted here instead.
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

function endOf(days: number): string {
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
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openMyDay(page: Page) {
  await page.goto('/today');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Izzah's work, with its steps. */
async function izzahsWork(
  title: string,
  days: number,
  steps: Array<{ action: string; assignee: string | null; due: number | null }> = [],
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
      due_at: endOf(days),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(data!.id);
  for (const [index, step] of steps.entries()) {
    const { error: stepError } = await admin.from('task_checklist_items').insert({
      task_id: taskId,
      position: index + 1,
      action: step.action,
      assigned_to: step.assignee,
      evidence_rule: 'not_required',
      due_at: step.due === null ? null : endOf(step.due),
    });
    if (stepError) throw stepError;
  }
  return taskId;
}

async function removeTasks(...ids: string[]) {
  const admin = service();
  for (const id of ids) {
    await admin.from('notifications').delete().eq('task_id', id);
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (!error) continue;
    await admin
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZAH })
      .eq('id', id);
  }
}

const section = (page: Page, heading: RegExp) =>
  page.locator('section.day-section', { has: page.getByRole('heading', { name: heading }) });
const card = (scope: Locator, title: string) => scope.locator('.day-card', { hasText: title });

test('v188 My Day holds what is late and what is close, one card per problem', async ({
  page,
}, testInfo) => {
  const stamp = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 5)}`;
  const late = `Conduct DHA for combustible dust ${stamp}`;
  const risky = `BR2 improvement ${stamp}`;
  const tomorrow = `LEV fire protection ${stamp}`;
  const later = `Contractor audit ${stamp}`;
  const ids = [
    await izzahsWork(late, -3, [
      { action: `Walk the dust areas ${stamp}`, assignee: null, due: -4 },
      { action: `Give department input ${stamp}`, assignee: AMER, due: -4 },
    ]),
    // Not due for nine days, but somebody owes a step on it tomorrow.
    await izzahsWork(risky, 9, [
      { action: `Review fire proposal ${stamp}`, assignee: AMER, due: 1 },
    ]),
    await izzahsWork(tomorrow, 1),
    await izzahsWork(later, 12),
  ];

  try {
    await signIn(page, 'izzah@tamco.local');
    await openMyDay(page);

    // The sentence, and none of the replaced sections.
    await expect(page.locator('.day-summary')).toContainText(/\d+ overdue · \d+ due within 5 days/);
    for (const gone of [/^Start here$/, /^Next up$/, /^Coming up$/, /^Waiting on others$/]) {
      await expect(page.getByRole('heading', { name: gone })).toHaveCount(0);
    }

    const overdue = section(page, /^Overdue/);
    const soon = section(page, /^Due within 5 days/);

    // One card for the late work, carrying both of its late steps.
    const lateCard = card(overdue, late);
    await expect(lateCard).toHaveCount(1);
    await expect(lateCard).toContainText('Task · ⚠ Overdue 3 days');
    await expect(lateCard).toContainText('0/2 steps complete');
    await expect(lateCard).toContainText('Your step overdue 4 days');
    await expect(lateCard).toContainText('Waiting on Amer · overdue 4 days');
    await expect(
      page.locator('.day-card', { hasText: `Walk the dust areas ${stamp}` }),
    ).toHaveCount(0);

    // Work due in nine days is here, because of the step due tomorrow.
    const riskyCard = card(soon, risky);
    await expect(riskyCard).toContainText('Waiting on Amer · due tomorrow');
    await expect(card(soon, tomorrow)).toContainText('Task · ! Due tomorrow');

    // And work that is on time further out is not on My Day at all.
    await expect(page.locator('.day-card', { hasText: later })).toHaveCount(0);

    // A card opens its work.
    await lateCard.click();
    await expect(page.getByRole('dialog', { name: late })).toBeVisible();
  } finally {
    await removeTasks(...ids);
  }
});

test('v188 a step you owe on somebody else’s work is a card that opens at the step', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  const stamp = crypto.randomUUID().slice(0, 5);
  const ids = [
    await izzahsWork(`Monthly ESH report ${stamp}`, 10, [
      { action: `Collect training data ${stamp}`, assignee: AMER, due: -1 },
    ]),
    await izzahsWork(`Quarterly review ${stamp}`, 10, [
      { action: `Give department input ${stamp}`, assignee: AMER, due: 0 },
    ]),
  ];

  try {
    await signIn(page, 'amer@tamco.local');
    await openMyDay(page);

    const lateCard = card(section(page, /^Overdue/), `Collect training data ${stamp}`);
    await expect(lateCard).toContainText('Shared step · ⚠ Overdue 1 day');
    await expect(lateCard).toContainText(`For: Monthly ESH report ${stamp}`);

    const todayCard = card(section(page, /^Due within 5 days/), `Give department input ${stamp}`);
    await expect(todayCard).toContainText('Shared step · ! Due today');

    await todayCard.click();
    await expect(page.getByRole('dialog', { name: `Quarterly review ${stamp}` })).toBeVisible();
    await expect(page.locator('.task-checklist-row.is-focused')).toContainText(
      `Give department input ${stamp}`,
    );
  } finally {
    await removeTasks(...ids);
  }
});

test.describe('v188 My Day says each thing once', () => {
  /** The task id each card points at, which is what "the same work" means. */
  const taskIds = (page: Page) =>
    page
      .locator('.day-card')
      .evaluateAll((elements) =>
        elements
          .map((element) => /task=([0-9a-f-]+)/.exec(element.getAttribute('href') ?? '')?.[1] ?? '')
          .filter(Boolean),
      );

  test('no work appears twice, and one routine never fills the page', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await openMyDay(page);

    const ids = await taskIds(page);
    const duplicated = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicated, `these appear more than once: ${duplicated.join(', ')}`).toEqual([]);

    const titles = (await page.locator('.day-card .today-copy strong').allInnerTexts()).map(
      (title) => title.trim(),
    );
    const repeated = titles.filter((title, index) => titles.indexOf(title) !== index);
    expect(repeated, `these titles are shown more than once: ${repeated.join(' | ')}`).toEqual([]);
  });

  test('the workload counts are shortcuts, not decoration', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await openMyDay(page);

    const active = page.locator('.summary-link').first();
    const available = page.locator('.summary-link').nth(1);
    await expect(active).toHaveAttribute('href', '/work');
    await expect(available).toHaveAttribute('href', '/work?tab=available');
    await active.click();
    await expect(page).toHaveURL(/\/work$/);
  });

  test('a clear day says so in one sentence', async ({ page }) => {
    // Lim carries nothing, so nothing is late or close.
    await signIn(page, 'lim@tamco.local');
    await openMyDay(page);
    await expect(page.locator('.day-summary')).toHaveText(
      'Nothing overdue, and nothing due in the next 5 days',
    );
    await expect(
      page.getByRole('heading', { name: 'Nothing overdue, and nothing due soon' }),
    ).toBeVisible();
  });
});
