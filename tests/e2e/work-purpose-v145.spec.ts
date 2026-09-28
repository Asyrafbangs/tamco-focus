import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

config({ path: '.env.local', quiet: true });

/**
 * v145 §11 — why work exists, in the words people use.
 *
 * The product led with what shape work was: Major Project, Operational Action,
 * Self-Development. Those are real distinctions about size and governance and
 * they are still recorded — but they are not what a manager and an employee
 * talk about, which is whether something broke, whether this runs anyway, or
 * whether we are making something better.
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
  await showActiveWork(page);
}

test('§11 registering work asks why, and the row then says so', async ({ page }, testInfo) => {
  // A mutation, so it runs once: the five viewport projects share one database.
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const title = `Purpose fixture ${Date.now()}`;
  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/today?capture=1');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const purpose = page.getByRole('group', { name: 'Why is this work happening?' });
    // §11 asks the question at registration. Behind a disclosure it would not
    // be asked at all: whoever never opens it creates unclassified work.
    await expect(purpose).toBeVisible();
    await expect(purpose).toContainText('Responding to an incident, breakdown or unexpected');

    // By id: "What needs to be done?" is also the label on every optional step
    // inside Add details, and getByLabel matches those even while collapsed.
    await page.locator('#capture-title').fill(title);
    await purpose.getByRole('radio', { name: /Reactive work/ }).check();
    await page.getByRole('button', { name: 'Create work' }).click();

    /*
     * The form navigates when it is done. Waiting for that rather than going
     * there directly: a `page.goto` on the next tick abandons the server
     * action mid-flight, and the failure then reads as "the work was never
     * created" three assertions later.
     */
    await expect(page).toHaveURL(/\/work\?tab=available/);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const row = page.locator('.task-row', { hasText: title });
    await expect(row).toBeVisible();
    // The word on the row is now the purpose, where the work class used to be.
    await expect(row.locator('.sub').first()).toContainText('Reactive');
    await expect(row.locator('.sub').first()).not.toContainText('Operational');
  } finally {
    await serviceClient().from('tasks').delete().eq('title', title);
  }
});

test('§11 the purpose can be corrected where the work is read', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const service = serviceClient();
  const title = `Purpose correction ${Date.now()}`;
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
      work_purpose: 'planned_operations',
    })
    .select('id')
    .single();
  if (error) throw error;

  try {
    await signIn(page, 'izzah@tamco.local');
    await openWork(page);
    const row = page.locator('.task-row', { hasText: title });
    await expect(row.locator('.sub').first()).toContainText('Planned');

    await row.locator('.row-primary-link').first().click();
    const drawer = page.locator('.task-detail-drawer');
    await expect(drawer).toBeVisible();
    // §11 — visible and editable by permitted users, not decided once at
    // creation and then frozen.
    await drawer.getByRole('button', { name: /Details/ }).click();
    const select = drawer.getByLabel('Why is this work happening?');
    await expect(select).toBeVisible();
    await select.selectOption('reactive');

    /*
     * Wait for the save to land before leaving the page.
     *
     * Choosing an option starts a server action against this URL, and
     * navigating while it is in flight aborts it: the browser cancels the POST,
     * nothing is written, and the assertion below then reads the old purpose
     * and looks like a product bug. Under a loaded suite the navigation won
     * often enough to fail about one run in ten.
     *
     * The list is still mounted behind the drawer, so its own row is the
     * confirmation — and it is the user-visible outcome, not a toast that the
     * revalidation replaces.
     */
    await expect(row.locator('.sub').first()).toContainText('Reactive', { timeout: 15_000 });

    await openWork(page);
    await expect(
      page.locator('.task-row', { hasText: title }).locator('.sub').first(),
    ).toContainText('Reactive');

    const { data: after } = await service
      .from('tasks')
      .select('work_purpose')
      .eq('id', task!.id)
      .single();
    expect(after!.work_purpose).toBe('reactive');
  } finally {
    await service.from('tasks').delete().eq('id', task!.id);
  }
});

test('§11 work nobody has classified says so rather than claiming a purpose', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const service = serviceClient();
  const title = `Unclassified fixture ${Date.now()}`;
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
      work_purpose: null,
    })
    .select('id')
    .single();
  if (error) throw error;

  try {
    await signIn(page, 'izzah@tamco.local');
    await openWork(page);

    /*
     * §11 — do not blindly map an old Operational Action to Planned
     * operations. The row keeps showing what is actually known about it, its
     * class, and the drawer is where the gap is offered to be filled.
     */
    const row = page.locator('.task-row', { hasText: title });
    await expect(row.locator('.sub').first()).toContainText('Operational');
    for (const word of ['Reactive', 'Planned', 'Improvement']) {
      await expect(row.locator('.sub').first()).not.toContainText(word);
    }

    await row.locator('.row-primary-link').first().click();
    const drawer = page.locator('.task-detail-drawer');
    await drawer.getByRole('button', { name: /Details/ }).click();
    await expect(drawer.getByLabel('Why is this work happening?')).toHaveValue('');
    await expect(drawer).toContainText('Purpose not recorded');
  } finally {
    await service.from('tasks').delete().eq('id', task!.id);
  }
});
