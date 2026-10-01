import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v189 — My Team inherits the attention window (Product Owner, 15 September
 * 2026).
 *
 * A person's row says "⚠ 1 overdue · ! 2 due within 5 days", counting their
 * own work and the steps they owe on anybody else's, so a manager can step in
 * before work is late. Opening them starts with Needs attention: Overdue, then
 * Due within 5 days.
 *
 * Lim owns the work because he has none of his own, so his counts are exact.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ZONE = 'Asia/Kuala_Lumpur';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const LIM = 'f0c05000-0000-4000-a000-000000000006';

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

async function createWork(owner: string, title: string, days: number, extra = {}) {
  const { data, error } = await service()
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: owner,
      created_by: owner,
      due_at: endOf(days),
      due_is_date_only: true,
      ...extra,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
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

test('v189 a person’s row and panel say what is late and what is due soon', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  test.setTimeout(90_000);
  const stamp = crypto.randomUUID().slice(0, 5);
  const ids: string[] = [];

  try {
    ids.push(
      await createWork(LIM, `Ergonomic risk assessment ${stamp}`, -2),
      await createWork(LIM, `PME repair ${stamp}`, 1),
      await createWork(LIM, `Replace the fire blankets ${stamp}`, 20),
    );
    // A step Lim owes on Izzah's work, due in four days.
    const parent = await createWork(IZZAH, `BR2 project ${stamp}`, 10);
    ids.push(parent);
    const { error } = await service()
      .from('task_checklist_items')
      .insert({
        task_id: parent,
        position: 1,
        action: `Check supplier submission ${stamp}`,
        assigned_to: LIM,
        evidence_rule: 'not_required',
        due_at: endOf(4),
      });
    if (error) throw error;

    await signIn(page, 'izzul@tamco.local');
    await page.goto(`/work?scope=team&person=${LIM}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Lim Wei Sheng' });
    /*
     * v235 moved these out of the person's summary, where they sat beside
     * volume figures of the same shape and read as facts of equal standing.
     * They are exceptions, and they now live in the column a manager reads to
     * decide whether this row needs them at all.
     */
    await expect(row.locator('[data-cell="needs-you"]')).toContainText('⚠ 1 overdue');
    await expect(row.locator('[data-cell="needs-you"]')).toContainText('! 2 due within 5 days');
    await expect(row.locator('[data-cell="person"]')).not.toContainText('overdue');

    const attention = page
      .getByTestId('my-team-person-panel')
      .locator('section', { has: page.getByRole('heading', { name: 'Needs attention' }) });
    const group = (label: string) =>
      attention.locator('.member-deadline-group', {
        has: page.locator('.member-deadline-heading', { hasText: label }),
      });

    await expect(group('Overdue').locator('.member-work-row')).toHaveCount(1);
    await expect(group('Overdue')).toContainText(`Ergonomic risk assessment ${stamp}`);
    await expect(group('Overdue')).toContainText('Task · ⚠ Overdue 2 days');

    const soon = group('Due within 5 days');
    await expect(soon.locator('.member-work-row').nth(0)).toContainText(`PME repair ${stamp}`);
    await expect(soon.locator('.member-work-row').nth(0)).toContainText('! Due tomorrow');
    await expect(soon.locator('.member-work-row').nth(1)).toContainText(
      `Check supplier submission ${stamp}`,
    );
    await expect(soon.locator('.member-work-row').nth(1)).toContainText(
      `Shared step · ! Due in 4 days · For BR2 project ${stamp}`,
    );
    // Work further out stays in the lists below, not here.
    await expect(attention).not.toContainText(`Replace the fire blankets ${stamp}`);
  } finally {
    await removeTasks(ids);
  }
});
