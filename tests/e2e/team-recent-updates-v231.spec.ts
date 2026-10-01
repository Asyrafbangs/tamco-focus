import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
/** Izzul manages the team; Amer and Izzah are on it. */
const AMER = 'f0c05000-0000-4000-a000-000000000003';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page, email = 'izzul@tamco.local') {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

/** A task owned by somebody, with an update written at a chosen moment. */
async function updateAt(ownerId: string, title: string, body: string, daysAgo: number) {
  const db = service();
  const { data: task, error } = await db
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: ownerId,
      created_by: ownerId,
      work_purpose: 'planned_operations',
    })
    .select('id')
    .single();
  if (error) throw new Error(`task insert failed: ${error.message}`);

  const at = new Date(Date.now() - daysAgo * 24 * 3_600_000).toISOString();
  const { error: updateError } = await db
    .from('task_updates')
    .insert({ task_id: task!.id, author_id: ownerId, body, is_meaningful: true, created_at: at });
  if (updateError) throw new Error(`update insert failed: ${updateError.message}`);
  return task!.id as string;
}

/**
 * v231 — the manager reads what changed instead of touring people.
 */
test('v231 Recent updates lists what the team wrote, and each row opens its task', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the list is enough.');
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const recentTitle = `v231 recent ${suffix}`;
  const oldTitle = `v231 ancient ${suffix}`;
  const recentBody = `Replaced the damaged guard ${suffix}`;
  const oldBody = `Something from long ago ${suffix}`;

  const recentTask = await updateAt(AMER, recentTitle, recentBody, 2);
  const oldTask = await updateAt(IZZAH, oldTitle, oldBody, 45);

  try {
    await signIn(page);
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    // The tab sits beside Completed, as asked.
    const tabs = page.locator('.team-views');
    await expect(tabs).toContainText('Completed');
    await tabs.getByRole('link', { name: /Recent updates/ }).click();
    await expect(page).toHaveURL(/filter=updates/);

    /*
     * A fortnight by default. The 45-day-old update is the control: if the
     * default were the usual thirty days it would still be absent, so the
     * assertion below checks the control itself rather than only the range.
     */
    // The whole panel: the list is split into one <ul> per day.
    const feed = page.locator('.team-updates-panel');
    await expect(feed).toContainText(recentBody);
    await expect(feed).not.toContainText(oldBody);
    await expect(page.locator('.focus-tab-meaning')).toContainText('in the last 14 days');

    // It says who did what, not just that something happened.
    const row = page.locator('.team-updates-row', { hasText: recentBody });
    await expect(row).toContainText('Amer');
    await expect(row).toContainText('posted an update on');

    // The range is the person's to choose, and a wider one reaches further back.
    await page.goto('/work?scope=team&filter=updates&period=90');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.team-updates-panel')).toContainText(oldBody);
    await expect(page.locator('.team-updates-panel')).toContainText(recentBody);

    // And the row opens the task it is about.
    // The whole row, not the title: that is what the stretched link is for,
    // and clicking the row is what a person actually does.
    await page.locator('.team-updates-row', { hasText: recentBody }).first().click();
    await expect(page).toHaveURL(new RegExp(`task=${recentTask}`), { timeout: 15_000 });
    await expect(page.locator('.task-detail-drawer')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.task-detail-drawer')).toContainText(recentTitle);
  } finally {
    const db = service();
    await db.from('task_updates').delete().in('task_id', [recentTask, oldTask]);
    await db.from('tasks').delete().in('id', [recentTask, oldTask]);
  }
});
