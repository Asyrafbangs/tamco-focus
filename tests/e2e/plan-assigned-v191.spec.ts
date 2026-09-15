import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v191 — work you assigned is on your own calendar.
 *
 * Reported from Production on 15 September 2026: "in calendar, when showing
 * me, it doesn't show the task I have assigned to other people". Only me
 * listed work the viewer owns and work shared with them, so a task Izzul
 * handed to Amer left his calendar the moment he assigned it, and could only be
 * found under My team — or nowhere, for somebody outside his team.
 *
 * It now shows as the work's due date, with who owes it ("↘ Amer"). Nothing
 * else about that work comes with it: its review date and its steps are the
 * owner's to plan. Work Amer owns that Izzul did not assign stays off.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
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
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function removeTasks(...ids: string[]) {
  const admin = service();
  for (const id of ids) {
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (!error) continue;
    await admin
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZUL })
      .eq('id', id);
  }
}

async function amersWork(title: string, fields: Record<string, unknown>) {
  const { data, error } = await service()
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: AMER,
      created_by: AMER,
      due_is_date_only: true,
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

test('v191 Only me shows the work you assigned, saying who owes it', async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  const stamp = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 5)}`;
  const month = currentMonth();
  const assigned = `Audit the permit-to-work log ${stamp}`;
  const notAssigned = `Amer's own inspection ${stamp}`;
  const ids = [
    await amersWork(assigned, {
      created_by: IZZUL,
      assigned_by: IZZUL,
      origin: 'manager_assigned',
      due_at: endOfDay(`${month}-26`),
      review_at: endOfDay(`${month}-24`),
    }),
    await amersWork(notAssigned, { due_at: endOfDay(`${month}-26`) }),
  ];
  const { error: stepError } = await service()
    .from('task_checklist_items')
    .insert({
      task_id: ids[0],
      position: 1,
      action: `Collect the permits ${stamp}`,
      assigned_to: AMER,
      due_at: endOfDay(`${month}-20`),
    });
  if (stepError) throw stepError;

  try {
    await signIn(page, 'izzul@tamco.local');
    await page.goto(`/plan?month=${month}`);
    await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.getByRole('link', { name: 'Only me' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const entry = page
      .locator(`.day[data-date="${month}-26"]`)
      .locator('.cal-item', { hasText: assigned });
    await expect(entry).toHaveCount(1);
    await expect(entry).toContainText('↘ Amer');
    await expect(entry).toHaveAttribute('title', `${assigned} — assigned to Amer Hakim`);

    // Its due date only: the owner's review date and his steps stay his.
    await expect(page.locator('.cal-item', { hasText: assigned })).toHaveCount(1);
    await expect(
      page.locator('.cal-item', { hasText: `Collect the permits ${stamp}` }),
    ).toHaveCount(0);
    // Work he did not assign is still only under My team.
    await expect(page.locator('.cal-item', { hasText: notAssigned })).toHaveCount(0);

    await entry.click();
    await expect(page.getByRole('dialog', { name: assigned })).toBeVisible();
  } finally {
    await removeTasks(...ids);
  }
});
