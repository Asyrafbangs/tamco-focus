import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v160 — My Day knows about steps.
 *
 * A late step of your own counts in Needs attention, as a late step somebody
 * else owes you has since v155; so does a late contribution you owe on
 * somebody else's work. Steps you owe that fall due this week are in Coming up
 * beside the work that does, and open at the step.
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

/** The end of the organisation's day `days` from today. */
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

/** Izzah's work, due in ten days, with one step. */
async function izzahsWork(
  title: string,
  step: { action: string; assignee: string | null; due: string },
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
      due_at: endOf(10),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const taskId = String(data!.id);
  const { error: stepError } = await admin.from('task_checklist_items').insert({
    task_id: taskId,
    position: 1,
    action: step.action,
    assigned_to: step.assignee,
    evidence_rule: 'not_required',
    due_at: step.due,
  });
  if (stepError) throw stepError;
  return taskId;
}

async function openMyDay(page: Page) {
  await page.goto('/today');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

const comingUp = (page: Page) => page.locator('section[aria-labelledby="coming-heading"]');

test('v160 your own late step needs attention, and your next one is coming up', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const ids = [
    await izzahsWork(`Contractor audit ${stamp}`, {
      action: `Book the site visit ${stamp}`,
      assignee: null,
      due: endOf(-1),
    }),
    await izzahsWork(`Budget review ${stamp}`, {
      action: `Collect quotes ${stamp}`,
      assignee: IZZAH,
      due: endOf(0),
    }),
  ];

  try {
    await signIn(page, 'izzah@tamco.local');
    await openMyDay(page);

    // Counted, not matched exactly: seeded work may carry late steps of its own.
    await expect(page.locator('.attention-banner')).toContainText(/\d+ steps? overdue/);

    const entry = comingUp(page).locator('.coming-item', { hasText: `Collect quotes ${stamp}` });
    await expect(entry).toContainText(`Step: Collect quotes ${stamp}`);
    await expect(entry).toContainText(`Part of Budget review ${stamp}`);

    await entry.click();
    await expect(page.getByRole('dialog', { name: `Budget review ${stamp}` })).toBeVisible();
    await expect(page.locator('.task-checklist-row.is-focused')).toContainText(
      `Collect quotes ${stamp}`,
    );
  } finally {
    await removeTasks(...ids);
  }
});

test('v160 a contribution you owe is on your My Day, late or coming up', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const stamp = crypto.randomUUID().slice(0, 6);
  const ids = [
    await izzahsWork(`Monthly ESH report ${stamp}`, {
      action: `Collect training data ${stamp}`,
      assignee: AMER,
      due: endOf(-1),
    }),
    await izzahsWork(`Quarterly review ${stamp}`, {
      action: `Give department input ${stamp}`,
      assignee: AMER,
      due: endOf(0),
    }),
  ];

  try {
    await signIn(page, 'amer@tamco.local');
    await openMyDay(page);

    await expect(page.locator('.attention-banner')).toContainText(/\d+ contributions? overdue/);

    const entry = comingUp(page).locator('.coming-item', {
      hasText: `Give department input ${stamp}`,
    });
    await expect(entry).toContainText(`Shared step: Give department input ${stamp}`);
    await expect(entry).toContainText(`Part of Quarterly review ${stamp}`);
  } finally {
    await removeTasks(...ids);
  }
});
