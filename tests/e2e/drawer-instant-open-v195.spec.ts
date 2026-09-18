import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v195 — a task opens the moment it is pressed.
 *
 * Reported 18 September 2026: "when i click, it loading slow and taking time.
 * it is not as smooth". Opening a task is a navigation, and nothing on screen
 * moved until the server had rendered the whole page again — measured locally
 * with production's network hop at about half a second, every time, with the
 * page apparently ignoring the press. Now:
 *
 * - the drawer starts sliding in on the press, titled from the row, and the
 *   task takes its place when it arrives without sliding in a second time;
 * - Escape abandons an open that has not arrived yet;
 * - a press on work that has gone meanwhile does not leave a stand-in behind;
 * - "This week" rows open in the page instead of reloading all of it;
 * - and the header that spares the page its own trip to the auth server
 *   cannot be written by a client.
 *
 * The server's answer is held back on purpose in most of these, so what is
 * being tested is what the screen does while it waits.
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

function localDate(offsetDays = 0): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + offsetDays * 86_400_000),
  );
}

function thisMonday(): string {
  const today = new Date(`${localDate()}T00:00:00Z`);
  const back = (today.getUTCDay() + 6) % 7;
  return new Date(today.getTime() - back * 86_400_000).toISOString().slice(0, 10);
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

async function izzahsTask(title: string): Promise<string> {
  const { data, error } = await service()
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
      due_at: new Date(`${localDate(6)}T23:59:59.999+08:00`).toISOString(),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

async function removeTasks(...ids: string[]) {
  const admin = service();
  await admin.from('weekly_commitments').delete().in('task_id', ids);
  for (const id of ids) {
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (!error) continue;
    await admin
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZAH })
      .eq('id', id);
  }
}

/** Holds the server's answer for this task back, so the wait can be watched. */
async function holdBack(page: Page, taskId: string, ms: number) {
  await page.route(
    (url) => url.pathname === '/work' && url.searchParams.get('task') === taskId,
    async (route) => {
      if (route.request().headers()['rsc'] === '1') {
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
      await route.continue();
    },
  );
}

/** Notes where the real drawer's panel was on the first frame it existed. */
async function watchArrival(page: Page) {
  await page.evaluate(() => {
    const record = window as unknown as { __v195Arrival: string | null };
    record.__v195Arrival = null;
    const observer = new MutationObserver(() => {
      const panel = document.querySelector('.task-detail');
      if (!panel) return;
      record.__v195Arrival = getComputedStyle(panel).transform;
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

function offsetOf(transform: string | null): number {
  if (!transform || transform === 'none') return 0;
  const parts =
    transform
      .match(/matrix\(([^)]+)\)/)?.[1]
      ?.split(',')
      .map(Number) ?? [];
  return Math.abs(parts[4] ?? Number.NaN);
}

test('v195 the drawer starts on the press and the task takes its place', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  test.setTimeout(120_000);
  const title = `v195 open ${testInfo.project.name} ${crypto.randomUUID().slice(0, 6)}`;
  const taskId = await izzahsTask(title);
  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work?tab=active');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const row = page.getByRole('link', { name: `Open ${title}` });
    await expect(row).toBeVisible();

    await holdBack(page, taskId, 1_500);
    await watchArrival(page);
    await row.click();

    // At once, and before the server has said anything.
    const standIn = page.locator('.drawer-pending-layer');
    await expect(standIn).toBeVisible({ timeout: 700 });
    await expect(page.locator('.drawer-pending-title')).toHaveText(title);
    await expect(page.locator('.task-detail-layer')).toHaveCount(0);
    await expect(page.locator('.drawer-pending')).toHaveAttribute('data-open', 'true');

    // Then the task, in the same place, and the stand-in gone.
    await expect(page.getByRole('dialog', { name: title })).toBeVisible({ timeout: 15_000 });
    await expect(standIn).toHaveCount(0);
    const arrival = await page.evaluate(
      () => (window as unknown as { __v195Arrival: string | null }).__v195Arrival,
    );
    expect(
      offsetOf(arrival),
      `the drawer arrived at ${arrival}, not where the stand-in already was`,
    ).toBeLessThan(2);

    // And it is the ordinary drawer from here: it closes and leaves nothing.
    await page.keyboard.press('Escape');
    await expect(page.locator('.task-detail-layer')).toHaveCount(0, { timeout: 15_000 });
    await expect(standIn).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  } finally {
    await removeTasks(taskId);
  }
});

test('v195 Escape abandons an open that has not arrived', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The stand-in is the same on a phone.');
  test.setTimeout(120_000);
  const title = `v195 cancel ${crypto.randomUUID().slice(0, 6)}`;
  const taskId = await izzahsTask(title);
  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work?tab=active');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const row = page.getByRole('link', { name: `Open ${title}` });
    await expect(row).toBeVisible();

    await holdBack(page, taskId, 2_000);
    await row.click();
    await expect(page.locator('.drawer-pending-layer')).toBeVisible({ timeout: 700 });
    await page.keyboard.press('Escape');
    await expect(page.locator('.drawer-pending-layer')).toHaveCount(0);

    // Long after the held-back answer has come in, it has not been applied.
    await page.waitForTimeout(3_500);
    await expect(page.locator('.task-detail-layer')).toHaveCount(0);
    expect(page.url()).not.toContain(taskId);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  } finally {
    await removeTasks(taskId);
  }
});

test('v195 work that has gone by the time it is pressed leaves no stand-in', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The stand-in is the same on a phone.');
  test.setTimeout(120_000);
  const title = `v195 gone ${crypto.randomUUID().slice(0, 6)}`;
  const taskId = await izzahsTask(title);
  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work?tab=active');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const row = page.getByRole('link', { name: `Open ${title}` });
    await expect(row).toBeVisible();

    // Binned elsewhere while this list was open.
    await service()
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZAH })
      .eq('id', taskId);

    await holdBack(page, taskId, 800);
    await row.click();
    await expect(page.locator('.drawer-pending-layer')).toBeVisible({ timeout: 700 });

    // Cleared when the page lands without it — well before the safety limit.
    await expect(page.locator('.drawer-pending-layer')).toHaveCount(0, { timeout: 8_000 });
    await expect(page.locator('.task-detail-layer')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe('');
  } finally {
    await removeTasks(taskId);
  }
});

test('v195 pressing the same task after its close has set off brings it back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The race is the same on a phone.');
  test.setTimeout(120_000);
  const title = `v195 back ${crypto.randomUUID().slice(0, 6)}`;
  const taskId = await izzahsTask(title);
  try {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work?tab=active');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const row = page.getByRole('link', { name: `Open ${title}` });
    await row.click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible({ timeout: 15_000 });

    // The close's own navigation, held back so the press lands while it is
    // on its way: after the push, before the page underneath has changed.
    await page.route(
      (url) => url.pathname === '/work' && !url.searchParams.has('task'),
      async (route) => {
        if (route.request().headers()['rsc'] === '1') {
          await new Promise((resolve) => setTimeout(resolve, 2_000));
        }
        await route.continue();
      },
    );
    await page.keyboard.press('Escape');
    await page.waitForTimeout(450);
    expect(page.url(), 'the close has not landed yet').toContain(taskId);
    await row.click();

    await page.waitForTimeout(3_000);
    await expect(page.locator('.task-detail[data-open="true"]')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();
    expect(page.url()).toContain(taskId);
  } finally {
    await removeTasks(taskId);
  }
});

test('v195 a This week row opens its task without reloading the page', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The link is the same on a phone.');
  test.setTimeout(120_000);
  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `v195 week task ${stamp}`;
  const result = `v195 week result ${stamp}`;
  const taskId = await izzahsTask(title);
  try {
    const { error } = await service().from('weekly_commitments').insert({
      employee_id: IZZAH,
      week_start: thisMonday(),
      rank: 3,
      task_id: taskId,
      expected_result: result,
      state: 'proposed',
      proposed_by: IZZAH,
    });
    if (error) throw error;

    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work?tab=active');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const priority = page.getByRole('link', { name: result });
    await expect(priority).toBeVisible();

    await page.evaluate(() => {
      (window as unknown as { __v195Kept: string }).__v195Kept = 'same page';
    });
    await priority.click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible({ timeout: 15_000 });
    expect(
      await page.evaluate(() => (window as unknown as { __v195Kept?: string }).__v195Kept),
      'a full reload would have discarded this',
    ).toBe('same page');
  } finally {
    await removeTasks(taskId);
  }
});

test('v195 a client cannot tell the page who it is', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Server behaviour; one layout is enough.');
  test.setTimeout(120_000);
  const title = `v195 identity ${crypto.randomUUID().slice(0, 6)}`;
  const taskId = await izzahsTask(title);
  try {
    await signIn(page, 'izzah@tamco.local');
    // Signed in as Izzah, claiming to be Amer.
    await page.setExtraHTTPHeaders({ 'x-tamco-session-user': AMER });
    await page.goto('/work?tab=active');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    // Izzah's own list, read as Izzah: as Amer this task would not be on it.
    await expect(page.getByRole('link', { name: `Open ${title}` })).toBeVisible();

    // And signed out, the claim opens nothing.
    const stranger = await browser.newContext({
      baseURL: testInfo.project.use.baseURL,
      extraHTTPHeaders: { 'x-tamco-session-user': IZZAH },
    });
    const anonymous = await stranger.newPage();
    await anonymous.goto('/work?tab=active');
    await expect(anonymous).toHaveURL(/\/sign-in/);
    await stranger.close();
  } finally {
    await removeTasks(taskId);
  }
});
