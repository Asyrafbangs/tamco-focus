import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v146 §9, §10 and §12 — the employee's own three screens.
 *
 * §9 reorders Active around the two questions an employee actually opens it
 * with: what am I on, and what did we agree this week. Everything else is a
 * reference list, and a reference list belongs behind its own heading.
 *
 * §10 is about a shared contribution being a request from a person, and §12
 * about the drawer saying where the work sits without offering to put it there
 * twice.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
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

async function openWork(page: Page, query = '') {
  await page.goto(`/work${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v146 §9 the Active tab', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
  });

  test('reads working on, then this week, then everything else', async ({ page }) => {
    await openWork(page);

    /*
     * §9 fixes this order. The current focus is one sentence about right now
     * and answers "where was I", so it has to be the first thing read; the
     * week is the agreement the rest is measured against; the list is a
     * reference. Asserted as document order rather than by looking, because
     * two of the three are one line tall and a screenshot would not settle it.
     */
    const order = await page.evaluate(() => {
      const marks = ['.working-on-summary', '.weekly-priorities', '.other-active'];
      return marks
        .map((selector) => ({
          selector,
          top: document.querySelector(selector)?.getBoundingClientRect().top ?? -1,
        }))
        .filter((entry) => entry.top >= 0)
        .sort((left, right) => left.top - right.top)
        .map((entry) => entry.selector);
    });

    expect(order).toEqual(['.working-on-summary', '.weekly-priorities', '.other-active']);
  });

  test('the list says how much it holds and whether any of it is late', async ({ page }) => {
    await openWork(page);
    const shell = page.getByTestId('other-active-work');
    await expect(shell).toBeVisible();

    const summary = shell.locator('summary');
    await expect(summary).toContainText('Other active work');

    // §9 — an accurate count, and overdue stays discoverable even collapsed.
    const rows = shell.locator('.task-row');
    const count = await rows.count();
    await expect(summary).toContainText(String(count));

    const overdue = await shell.locator('.row-due.red, .row-due.overdue').count();
    if (overdue > 0) await expect(summary).toContainText('overdue');
  });

  test('collapses once there is an answer above it', async ({ page }, testInfo) => {
    // A mutation, so it runs once: the five viewport projects share one database.
    test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

    await openWork(page);
    // With no current focus and no agreed week there is nothing above the
    // list, so A04's "work can continue" wins and it opens.
    await expect(page.getByTestId('other-active-work')).toHaveAttribute('open', '');

    await page.locator('.task-row .row-primary-link').first().click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Set as working on' }).click();
    await expect(page.getByRole('button', { name: /Working on this/ })).toBeVisible();

    try {
      await openWork(page);
      // Now something above it answers the question, so §9's default applies.
      await expect(page.getByTestId('other-active-work')).not.toHaveAttribute('open', '');
      await expect(page.locator('.working-on-summary')).not.toContainText('Not set');
    } finally {
      await openWork(page);
      await page.locator('.working-on-summary .row-primary-link').first().click();
      await expect(page.locator('.task-detail-drawer')).toBeVisible();
      await page.getByRole('button', { name: /Working on this/ }).click();
      await expect(page.getByRole('button', { name: 'Set as working on' })).toBeVisible();
    }
  });
});

test('§9 a weekly reference to unstarted work says so, and does not start it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const service = serviceClient();
  const title = `Weekly reference fixture ${Date.now()}`;
  const { data: task, error } = await service
    .from('tasks')
    .insert({
      title,
      status: 'backlog',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
      work_purpose: 'planned_operations',
    })
    .select('id')
    .single();
  if (error) throw error;

  try {
    await signIn(page, 'izzah@tamco.local');
    await openWork(page, '?tab=available');
    const activeCountBefore = await page.locator('.task-row').count();

    await page.locator('.task-row', { hasText: title }).locator('.row-primary-link').click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await page.getByRole('button', { name: 'Add to this week' }).click();
    // §12 — once it is in the week the drawer says so instead of offering to
    // add it again, which the one-reference index would refuse anyway.
    await expect(page.locator('.task-detail-drawer')).toContainText('Proposed for this week');
    await expect(page.getByRole('button', { name: 'Add to this week' })).toHaveCount(0);

    await openWork(page);
    const priorities = page.locator('.weekly-priorities');
    await expect(priorities).toContainText(title);
    // §9 — the source label, so a plan does not read as work already running.
    await expect(priorities).toContainText('still in Available');

    /*
     * And the work did not move. Putting something forward as this week's
     * result is a plan; if it silently activated the task, an employee would
     * discover they had "started" four things by proposing them.
     */
    const { data: after } = await service
      .from('tasks')
      .select('status')
      .eq('id', task!.id)
      .single();
    expect(after!.status).toBe('backlog');

    await openWork(page, '?tab=available');
    expect(await page.locator('.task-row').count()).toBe(activeCountBefore);
  } finally {
    await service.from('weekly_commitments').delete().eq('task_id', task!.id);
    await service.from('tasks').delete().eq('id', task!.id);
  }
});

test('§10 a shared contribution names the work, the owner and who asked', async ({ page }) => {
  await signIn(page, 'izzah@tamco.local');
  await openWork(page, '?tab=shared');

  const row = page.locator('.task-row').first();
  await expect(row).toBeVisible();
  // §10 lists six things a contribution has to show. The sixth — who assigned
  // it — is what turns "the system decided this is yours" into a request from
  // a person who can also withdraw it.
  await expect(row).toContainText('Shared contribution');
  await expect(row).toContainText('Part of');
  await expect(row).toContainText('Owned by');
  await expect(row).toContainText('Assigned by');
});

test('§10 Completed keeps a colleague’s work out of my own', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const service = serviceClient();
  const title = `Owned parent ${Date.now()}`;
  const stepAction = `Colleague step ${Date.now()}`;

  const { data: task, error } = await service
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
    })
    .select('id')
    .single();
  if (error) throw error;

  // A step on Izzah's task, done by somebody else.
  const AJMAL = 'f0c05000-0000-4000-a000-000000000005';
  const { error: stepError } = await service.from('task_checklist_items').insert({
    task_id: task!.id,
    position: 1,
    action: stepAction,
    assigned_to: AJMAL,
    state: 'completed',
    completed_by: AJMAL,
    completed_at: new Date().toISOString(),
  });
  if (stepError) throw stepError;

  try {
    await signIn(page, 'izzah@tamco.local');
    await openWork(page, '?tab=completed&period=90');

    /*
     * §10 — the owner is not credited with a colleague's contribution. It is
     * not in "All" either, which is read as "what I got done".
     */
    // Asserted against the panel, not the list: when a scope is empty there is
    // an empty state instead of a `.completed-list`, and a `not.toContainText`
    // against a locator that resolves to nothing never settles.
    await expect(page.locator('.completed-history')).not.toContainText(stepAction);
    await page.getByRole('link', { name: 'My contributions' }).click();
    await expect(page.locator('.completed-history')).not.toContainText(stepAction);

    await page.getByRole('link', { name: 'On my work' }).click();
    const row = page.locator('.completed-row', { hasText: stepAction });
    await expect(row).toBeVisible();
    // Named as theirs, because "completed on my work" with no name reads as
    // something the owner did.
    await expect(row).toContainText('Completed by Ajmal');
  } finally {
    await service.from('task_checklist_items').delete().eq('task_id', task!.id);
    await service.from('tasks').delete().eq('id', task!.id);
  }
});
