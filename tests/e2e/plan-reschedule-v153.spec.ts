import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v153 — the Monthly Plan moves like Outlook's: drag a due date to another
 * day, or use "Move to…" beside it.
 *
 * §17.3 forbids UNGOVERNED drag-and-drop changes to a due date, and the tests
 * below are the evidence that this one is governed: the move lands in the
 * database through the same action as the drawer, it is written to the audit
 * trail, Undo is a second audited change rather than an erasure, a stale
 * calendar is refused instead of obeyed, and nothing the viewer may not change
 * can be picked up at all.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const LIM = 'f0c05000-0000-4000-a000-000000000006';
const ORG_TIME_ZONE = 'Asia/Kuala_Lumpur';

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

/** The organisation-local month the calendar opens on, as `YYYY-MM`. */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts.slice(0, 7);
}

/**
 * A date-only commitment on `date`, stored the way the application stores
 * one: the last instant of that local day. Kuala Lumpur keeps no daylight
 * saving, so the offset is fixed.
 */
function endOfDay(date: string): string {
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
}

async function dueTask(
  title: string,
  date: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await serviceClient()
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
      due_at: endOfDay(date),
      due_is_date_only: true,
      ...overrides,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

/**
 * Removes the fixtures the way the product removes audited work.
 *
 * A task with history cannot be hard-deleted: `audit_events` cascades from
 * `tasks`, and `audit_events_no_delete` refuses to let the cascade erase
 * anything. Every fixture this spec moves has history by the time it is
 * cleaned up — that is the point of the test — so a plain delete failed,
 * silently, and left active tasks in Izzah's lists for every spec after this
 * one. Deleted where possible; otherwise sent to the Bin; and loudly if even
 * that is refused.
 */
async function removeTasks(...ids: string[]) {
  const service = serviceClient();
  for (const id of ids) {
    const { error } = await service.from('tasks').delete().eq('id', id);
    if (!error) continue;
    const { error: binError } = await service
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZAH })
      .eq('id', id);
    if (binError) throw new Error(`Could not remove fixture ${id}: ${binError.message}`);
  }
}

/** Where the database says the task is due, as an organisation-local date. */
async function localDueDate(taskId: string): Promise<string> {
  const { data } = await serviceClient().from('tasks').select('due_at').eq('id', taskId).single();
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ORG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(String(data!.due_at)));
}

async function dueDateChanges(taskId: string): Promise<number> {
  const { data } = await serviceClient()
    .from('audit_events')
    .select('id')
    .eq('task_id', taskId)
    .eq('event_type', 'task_due_date_changed');
  return data?.length ?? 0;
}

async function openPlan(page: Page) {
  await page.goto(`/plan?month=${currentMonth()}&scope=mine`);
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

function entryOn(page: Page, date: string, title: string) {
  return page.locator(`.day[data-date="${date}"]`).locator('.cal-item', { hasText: title });
}

test('v153 a due date dragged to another day moves, and Undo moves it back', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const month = currentMonth();
  const from = `${month}-10`;
  const to = `${month}-20`;
  const title = `Drag me ${crypto.randomUUID().slice(0, 8)}`;
  const taskId = await dueTask(title, from);

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);

    const item = entryOn(page, from, title);
    await expect(item).toHaveAttribute('draggable', 'true');

    await item.dragTo(page.locator(`.day[data-date="${to}"]`));

    const toast = page.locator('.toast');
    await expect(toast).toContainText('Due date moved to');
    await expect(entryOn(page, to, title)).toBeVisible();
    await expect(entryOn(page, from, title)).toHaveCount(0);

    // In the database, not just on the screen, and in the history.
    await expect.poll(() => localDueDate(taskId)).toBe(to);
    await expect.poll(() => dueDateChanges(taskId)).toBe(1);

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.toast')).toContainText('moved back');
    await expect(entryOn(page, from, title)).toBeVisible();

    await expect.poll(() => localDueDate(taskId)).toBe(from);
    // Moved, then moved back: two entries, not an erased one.
    await expect.poll(() => dueDateChanges(taskId)).toBe(2);
  } finally {
    await removeTasks(taskId);
  }
});

test('v153 Move to… moves a date without dragging', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const month = currentMonth();
  const from = `${month}-12`;
  const to = `${month}-14`;
  const title = `Keyboard move ${crypto.randomUUID().slice(0, 8)}`;
  const taskId = await dueTask(title, from);

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);

    // Before anything opens: the new controls must not cost the page its
    // accessibility.
    const scan = await new AxeBuilder({ page })
      .include('.calendar')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(scan.violations).toEqual([]);

    /*
     * WCAG 2.5.7 — anything that can be dragged must be possible without
     * dragging. Reached by keyboard, not clicked, because a keyboard is the
     * reason the control exists.
     */
    const move = page.getByRole('button', { name: `Move due date: ${title}` });
    await move.focus();
    await expect(move).toBeFocused();
    await page.keyboard.press('Enter');

    const dialog = page.getByRole('dialog', { name: 'Move due date' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(title);
    await dialog.getByLabel('New due date').fill(to);
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Due date moved to');
    // Undo is where the keyboard lands, as it is everywhere else Undo appears.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
    await expect(entryOn(page, to, title)).toBeVisible();
    await expect.poll(() => localDueDate(taskId)).toBe(to);
  } finally {
    await removeTasks(taskId);
  }
});

test('v153 nothing the viewer may not change can be picked up', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');

  const month = currentMonth();
  const stamp = crypto.randomUUID().slice(0, 8);
  const service = serviceClient();

  // Shared with Izzah by its owner: on her calendar, not hers to move.
  const sharedTitle = `Shared date ${stamp}`;
  const sharedId = await dueTask(sharedTitle, `${month}-15`, {
    primary_owner_id: LIM,
    created_by: LIM,
  });
  const { error: shareError } = await service
    .from('task_collaborators')
    .insert({ task_id: sharedId, user_id: IZZAH, added_by: LIM });
  if (shareError) throw shareError;

  // Her own, as the control: without it, a calendar where nothing could move
  // would pass every assertion below.
  const ownTitle = `Own date ${stamp}`;
  const ownId = await dueTask(ownTitle, `${month}-15`);

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);

    const shared = entryOn(page, `${month}-15`, sharedTitle);
    await expect(shared).toBeVisible();
    await expect(shared).toHaveAttribute('draggable', 'false');
    await expect(page.getByRole('button', { name: `Move due date: ${sharedTitle}` })).toHaveCount(
      0,
    );

    const own = entryOn(page, `${month}-15`, ownTitle);
    await expect(own).toHaveAttribute('draggable', 'true');
    await expect(page.getByRole('button', { name: `Move due date: ${ownTitle}` })).toHaveCount(1);

    // Routine occurrences and review deadlines render as they always did.
    for (const fixed of await page.locator('.cal-item.routine, .cal-item.review').all()) {
      await expect(fixed).toHaveAttribute('draggable', 'false');
    }
  } finally {
    await removeTasks(sharedId, ownId);
  }
});

test('v153 a move made on a stale calendar is refused, and the calendar catches up', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The mutation runs once.');

  const month = currentMonth();
  const shownOn = `${month}-11`;
  const changedTo = `${month}-13`;
  const droppedOn = `${month}-21`;
  const title = `Stale calendar ${crypto.randomUUID().slice(0, 8)}`;
  const taskId = await dueTask(title, shownOn);
  const service = serviceClient();

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);
    await expect(entryOn(page, shownOn, title)).toBeVisible();

    // Somebody else moves it while this calendar sits open.
    const { data: current } = await service
      .from('tasks')
      .select('version')
      .eq('id', taskId)
      .single();
    const { error } = await service
      .from('tasks')
      .update({ due_at: endOfDay(changedTo), version: Number(current!.version) + 1 })
      .eq('id', taskId);
    if (error) throw error;

    await entryOn(page, shownOn, title).dragTo(page.locator(`.day[data-date="${droppedOn}"]`));

    // Refused, and said plainly — not quietly applied over their change.
    await expect(page.locator('.toast.error')).toContainText('changed while it was open');
    // The calendar fetches the real date rather than leaving a grid that will
    // refuse every further move of this item.
    await expect(entryOn(page, changedTo, title)).toBeVisible();
    await expect(entryOn(page, droppedOn, title)).toHaveCount(0);
    expect(await localDueDate(taskId)).toBe(changedTo);
  } finally {
    await removeTasks(taskId);
  }
});

test('v153 on a phone, Move to… is the way to move a date', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The phone layout runs once.');

  const month = currentMonth();
  const from = `${month}-16`;
  const to = `${month}-18`;
  const title = `Phone move ${crypto.randomUUID().slice(0, 8)}`;
  const taskId = await dueTask(title, from);

  try {
    await signIn(page, 'izzah@tamco.local');
    await openPlan(page);

    const move = page.getByRole('button', { name: `Move due date: ${title}` });
    // Centred first: the bottom navigation is fixed, and an element scrolled
    // only just into view sits underneath it.
    await move.evaluate((element) => element.scrollIntoView({ block: 'center' }));

    /*
     * A touch screen cannot hover to reveal the control, so it must already be
     * showing — `toBeVisible` would pass on a fully transparent button, which
     * is exactly the failure this is here to catch.
     */
    await expect(move).toHaveCSS('opacity', '1');
    const box = await move.boundingBox();
    expect(box!.height, 'the Move control is smaller than a fingertip').toBeGreaterThanOrEqual(44);

    await move.click();
    const dialog = page.getByRole('dialog', { name: 'Move due date' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('New due date').fill(to);
    await dialog.getByRole('button', { name: 'Move', exact: true }).click();

    await expect(page.locator('.toast')).toContainText('Due date moved to');
    await expect.poll(() => localDueDate(taskId)).toBe(to);
  } finally {
    await removeTasks(taskId);
  }
});
