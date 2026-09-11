import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
/** Somebody the fixture leaves with nothing outstanding, so a seeded decision
    is unambiguously their top attention item. */
const LIM = 'f0c05000-0000-4000-a000-000000000006';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * One open decision addressed to the manager, created by this test.
 *
 * It used to rely on whatever the fixture happened to leave in Needs
 * Attention. Every viewport project shares one database, and other specs
 * answer barriers as part of what they are testing — so by the time this ran
 * in a full suite the row it was written against had been resolved and the
 * test failed on its fixture rather than its subject.
 */
async function seedDecision(marker: string) {
  const client = admin();
  const { data: task, error: taskError } = await client
    .from('tasks')
    .insert({
      title: `Filter survival ${marker}`,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: LIM,
      created_by: LIM,
    })
    .select('id')
    .single();
  if (taskError || !task) throw new Error(`Could not seed task: ${taskError?.message}`);

  const { data: barrier, error: barrierError } = await client
    .from('barriers')
    .insert({
      task_id: task.id,
      raised_by: LIM,
      description: `Blocked pending a decision ${marker}`,
      support_needed: `${marker} confirm the approach before Friday`,
      impact: 'may_delay' as const,
      status: 'open' as const,
      action_pending: true,
      action_required_from: IZZUL,
      action_type: 'decision' as const,
      raised_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (barrierError || !barrier) throw new Error(`Could not seed barrier: ${barrierError?.message}`);
  return { taskId: String(task.id), barrierId: String(barrier.id) };
}

async function cleanupDecision(seed: { taskId: string; barrierId: string }) {
  const client = admin();
  const barrier = await client.from('barriers').delete().eq('id', seed.barrierId);
  if (barrier.error) throw new Error(`Could not clean barrier: ${barrier.error.message}`);
  const task = await client.from('tasks').delete().eq('id', seed.taskId);
  if (task.error) throw new Error(`Could not clean task: ${task.error.message}`);
}

async function signInAsManager(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Navigate, then wait for hydration before touching anything.
 *
 * A My Team row is opened by a click handler rather than a link, so a click
 * that lands on the server-rendered markup does nothing and the drawer never
 * appears — which reads as "the drawer will not open" when the row simply was
 * not listening yet.
 */
async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Closes the topmost drawer the way a person does.
 *
 * Via the Close button rather than the backdrop: on a phone the panel fills the
 * screen, so there is no backdrop left to click — which is exactly why the
 * button exists.
 */
async function closeTopDrawer(page: Page) {
  const layers = page.locator('.task-detail-layer');
  await expect(layers.last()).toHaveAttribute('data-open', 'true');
  // Scoped to the dialog: the backdrop carries the same accessible name and,
  // on a phone, sits underneath the panel where nobody can reach it.
  await layers
    .last()
    .getByRole('dialog')
    .getByRole('button', { name: /^Close/ })
    .click();
}

/**
 * v48 §67-69 — a drawer returns you to where you opened it.
 *
 * The Task Detail drawer used to close to a hardcoded `/work`, so a manager who
 * opened a team member's task from My Team landed in My Work: not the wrong
 * tab, a different person's workspace, with the filter and the person they had
 * selected both gone.
 */
test('closing a drawer returns one layer, to the context it was opened from', async ({ page }) => {
  await signInAsManager(page);

  // --- Everyone → task → back to Everyone ------------------------------------
  await gotoHydrated(page, '/work?scope=team');
  const firstRow = page.getByTestId('my-team-person-row').first();
  await expect(firstRow).toBeVisible();

  /*
   * Raw coordinates, deliberately: the point is that blank space inside the
   * row opens the person, not only its links. They have to be measured with
   * the row actually on screen — `page.mouse.click` does not scroll the way
   * `locator.click` does, so anything added above this list silently moves the
   * target out from under it.
   */
  await firstRow.scrollIntoViewIfNeeded();
  const firstBox = (await firstRow.boundingBox())!;
  await page.mouse.click(firstBox.x + 20, firstBox.y + firstBox.height / 2);

  const personPanel = page.getByTestId('my-team-person-panel');
  await expect(personPanel).toBeVisible();
  await expect(page).toHaveURL(new RegExp('person='));
  const personHref = page.url();

  // --- Person → task ---------------------------------------------------------
  const taskRow = personPanel.locator('.member-work-row').first();
  if (await taskRow.count()) {
    await taskRow.click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    /*
     * v143 §6 — one layer, not two. The person is an expansion in the list
     * now, so a task opens over the list rather than over a second drawer, and
     * "do not open another person drawer on top" is a thing the shape of the
     * page makes impossible rather than a rule somebody has to remember.
     */
    await expect(page.locator('.task-detail-layer')).toHaveCount(1);

    // §69, and §6 A02 — closing the task reveals the person, still expanded,
    // still filtered, in the same list.
    await closeTopDrawer(page);
    await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
    await expect(personPanel).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`person=`));
    await expect(page).not.toHaveURL(/task=/);
  }

  // §69 — collapsing the person leaves My Team, still in team scope. The
  // header that opened them is the control that closes them.
  await firstRow.locator('[data-cell="person"] strong').click();
  await expect(personPanel).toHaveCount(0);
  await expect(page).toHaveURL(/scope=team/);
  await expect(page).not.toHaveURL(/person=/);
  expect(personHref).toContain('scope=team');
});

/**
 * §68 — the same, from the Needs Attention filter, which is the case where
 * losing the context costs the most: the manager was part-way through a list of
 * things needing them.
 */
test('the Needs Attention filter survives opening and closing a task', async ({
  page,
}, testInfo) => {
  /*
   * Its own decision, marked per project and per run, because every viewport
   * shares one database.
   *
   * v130 — the action button sits with the reason it answers rather than in a
   * column of its own, and only rows where the manager owes a decision carry
   * one at all. Before that every row had a button, so `.first()` always found
   * one; now the first row is an overdue routine, which is the person's own
   * work to catch up on and asks the manager for nothing.
   *
   * A decision rather than a goal, because this is about a TASK layer opening
   * and closing, and a goal action leaves My Team altogether.
   */
  const marker = `V48F${testInfo.project.name}${Date.now()}`;
  const seeded = await seedDecision(marker);

  try {
    await signInAsManager(page);
    await gotoHydrated(page, '/work?scope=team&filter=attention');

    const action = page
      .getByTestId('my-team-person-row')
      .filter({ hasText: marker })
      .locator('[data-cell="needs-you"] button');
    await expect(action).toBeVisible();

    await action.click();
    await expect(page.locator('.task-detail-layer').first()).toBeVisible();
    // Straight to the decision. No person expands on the way.
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(0);

    await closeTopDrawer(page);
    await expect(page).toHaveURL(/scope=team/);
    await expect(page).not.toHaveURL(/[?&]task=/);
  } finally {
    await cleanupDecision(seeded);
  }
});

/**
 * §34, §73 — the name is the obvious target and it has to work.
 */
test('a team member name opens their detail without leaving My Team', async ({ page }) => {
  await signInAsManager(page);
  await gotoHydrated(page, '/work?scope=team');

  const row = page.getByTestId('my-team-person-row').first();
  await row.locator('[data-cell="person"] strong').click();

  const panel = page.getByTestId('my-team-person-panel');
  await expect(panel).toBeVisible();
  // §35, and v143 §6 — in place, not over the top: My Team is still readable,
  // and the row above the expansion is still the person it belongs to.
  await expect(page.locator('.focus-panel')).toBeVisible();
  await expect(row).toHaveAttribute('aria-expanded', 'true');

  /*
   * §74 — the sections that answer the manager's questions, under the names
   * §6 gives them. "Needs your attention" is not among them: it is rendered
   * only where a decision is actually owed, so a person with none has no such
   * section rather than an empty one.
   */
  await expect(panel.getByRole('heading', { name: 'This week’s priorities' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: /Other active work/ })).toBeVisible();
  await expect(
    panel.locator('.team-person-section[data-section="details"] > summary'),
  ).toContainText('Recent updates');
});

/**
 * §78 — the validity gate, seen from the outside.
 *
 * Mandatory work that is simply being done must not appear as something the
 * manager has to act on, and no CTA anywhere may say "Review controlled
 * action" — the label that could not say what it wanted.
 */
test('mandatory work running normally is not manager attention', async ({ page }) => {
  await signInAsManager(page);
  await gotoHydrated(page, '/work?scope=team&filter=attention');

  await expect(page.getByText('Review controlled action')).toHaveCount(0);
  await expect(page.getByText('Controlled work', { exact: true })).toHaveCount(0);

  // §52 — whatever does appear must name an action, not a status.
  const actions = page.locator('[data-testid="my-team-person-row"] [data-cell="needs-you"] button');
  const count = await actions.count();
  for (let index = 0; index < count; index += 1) {
    const label = (await actions.nth(index).textContent())?.trim() ?? '';
    expect(label.length, 'every manager row must offer a named action').toBeGreaterThan(0);
    expect(label).not.toBe('Review controlled action');
  }
});

/**
 * v49 — the row stays one compact line, with its action on the right.
 *
 * The row is a four-column grid that drops columns as the window narrows. When
 * the column count fell below the number of visible children, the action
 * wrapped onto a second grid row in the first column: a button flush against
 * the left edge, under a row that had grown half as tall again. Browser zoom
 * puts a large window into that band, which is how it reached a real screen
 * while every functional test still passed.
 */
test('the team row contains every cell without overlap at each viewport and zoom pressure', async ({
  page,
}) => {
  await signInAsManager(page);
  await gotoHydrated(page, '/work?scope=team');

  const row = page.getByTestId('my-team-person-row').first();
  await expect(row).toBeVisible();

  const cases = [
    ['1440', 1440],
    ['1280', 1280],
    ['1024', 1024],
    ['768', 768],
    ['430', 430],
    ['390', 390],
    ['125% zoom pressure', 1152],
    ['150% zoom pressure', 960],
  ] as const;

  for (const [label, width] of cases) {
    await page.setViewportSize({ width, height: 900 });

    const report = await row.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const action = element.querySelector('[data-cell="action"]')!.getBoundingClientRect();
      const textCells = [...element.querySelectorAll('[data-cell]:not([data-cell="action"])')];
      return {
        height: Math.round(box.height),
        rightGap: Math.round(box.right - action.right),
        actionInside:
          action.left >= box.left - 1 &&
          action.right <= box.right + 1 &&
          action.top >= box.top - 1 &&
          action.bottom <= box.bottom + 1,
        overlap: textCells.some((cell) => {
          const text = cell.getBoundingClientRect();
          return !(
            text.right <= action.left + 1 ||
            text.left >= action.right - 1 ||
            text.bottom <= action.top + 1 ||
            text.top >= action.bottom - 1
          );
        }),
        clipped: element.scrollHeight > element.clientHeight + 1,
      };
    });

    const pageScrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );

    expect(pageScrolls, `horizontal page scroll at ${label}`).toBe(false);
    expect(report.actionInside, `action escaped its row at ${label}`).toBe(true);
    expect(report.overlap, `action overlaps row text at ${label}`).toBe(false);
    expect(report.clipped, `row clips content at ${label}`).toBe(false);
    expect(report.rightGap, `action drifted from the right edge at ${label}`).toBeLessThan(30);
    expect(report.height, `row is excessively tall at ${label}`).toBeLessThan(
      width <= 640 ? 230 : 140,
    );
  }
});
