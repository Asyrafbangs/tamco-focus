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
  const { data: written, error: updateError } = await db
    .from('task_updates')
    .insert({ task_id: task!.id, author_id: ownerId, body, is_meaningful: true, created_at: at })
    .select('id')
    .single();
  if (updateError) throw new Error(`update insert failed: ${updateError.message}`);

  /*
   * The feed reads the audit trail, not the updates table — that is the whole
   * design: one record of what happened, not two. So the fixture records the
   * event as the application would, pointing at the update it describes.
   */
  const { error: auditError } = await db.from('audit_events').insert({
    event_type: 'update_posted',
    occurred_at: at,
    actor_id: ownerId,
    task_id: task!.id,
    detail: { update_id: written!.id, evidence_only: false, attachment_count: 0 },
  });
  if (auditError) throw new Error(`audit insert failed: ${auditError.message}`);
  return task!.id as string;
}

/**
 * v232 — the manager reads what changed instead of touring people, and reads
 * it as one card per person per task per day rather than an audit trail.
 */
test('v232 Recent activity merges a day into one card, and it opens its task', async ({
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
    await tabs.getByRole('link', { name: /Recent activity/ }).click();
    await expect(page).toHaveURL(/filter=updates/);

    /*
     * A fortnight by default. The 45-day-old update is the control: if the
     * default were the usual thirty days it would still be absent, so the
     * assertion below checks the control itself rather than only the range.
     */
    // The whole panel: the list is split into one <ul> per day.
    const feed = page.locator('.team-activity');
    await expect(feed).toContainText(recentBody);
    await expect(feed).not.toContainText(oldBody);
    // v232 — a week by default, not a fortnight.
    await expect(page.locator('.focus-tab-meaning')).toContainText('in the last 7 days');

    // It says who did what, not just that something happened.
    const card = page.locator('.team-activity-card', { hasText: recentBody });
    await expect(card).toContainText('Amer');
    await expect(card).toContainText(recentTitle);

    // The range is the person's to choose, and a wider one reaches further back.
    await page.goto('/work?scope=team&filter=updates&period=90');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.team-activity')).toContainText(oldBody);
    await expect(page.locator('.team-activity')).toContainText(recentBody);

    // And the row opens the task it is about.
    // The whole row, not the title: that is what the stretched link is for,
    // and clicking the row is what a person actually does.
    await page.locator('.team-activity-card', { hasText: recentBody }).first().click();
    await expect(page).toHaveURL(new RegExp(`task=${recentTask}`), { timeout: 15_000 });
    await expect(page.locator('.task-detail-drawer')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.task-detail-drawer')).toContainText(recentTitle);
  } finally {
    /*
     * `audit_events` is append-only — a trigger refuses deletion, because
     * history that can be erased is not history. The task therefore cannot be
     * deleted either while its events point at it, so it is cancelled instead
     * and leaves every live view. The verify resets this database before the
     * end-to-end run, so the events do not accumulate between runs.
     */
    const db = service();
    const cancelled = await db
      .from('tasks')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .in('id', [recentTask, oldTask]);
    if (cancelled.error) throw new Error(`cleanup failed: ${cancelled.error.message}`);
  }
});
