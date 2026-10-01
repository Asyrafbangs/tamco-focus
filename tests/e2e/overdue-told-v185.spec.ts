import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v185 — Overdue, told, and counted the same way everywhere.
 *
 * Found by a sweep of every screen that shows lateness: work due 13 September
 * read "overdue by 1 day" on My Day while a step due the same day read "2 days
 * late" beside it; the drawer called work due yesterday "11h overdue"; My Team
 * said "5 overdue" above five rows that were all on time, and never listed
 * paused work at all. Nobody was told when their own work fell overdue, and a
 * due date could be pushed back without the manager hearing.
 *
 * Lim owns the fixtures because he has no other work, so every count is his.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ZONE = 'Asia/Kuala_Lumpur';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
const LIM = 'f0c05000-0000-4000-a000-000000000006';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function localDate(days: number) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
}

/** End of the local day, which is how a date-only commitment is stored. */
function endOfDay(days: number) {
  return new Date(`${localDate(days)}T23:59:59.999+08:00`).toISOString();
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

async function visit(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function createWork(title: string, fields: Record<string, unknown>) {
  const { data, error } = await service()
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: LIM,
      created_by: LIM,
      due_is_date_only: true,
      ...fields,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

/** Deleted where possible; binned where history forbids it (see v153). */
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

test('v185 every screen counts days late the same way', async ({ page }, testInfo) => {
  const stamp = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 5)}`;
  const three = `Calibrate the gas detectors ${stamp}`;
  const one = `Renew the forklift permits ${stamp}`;
  const today = `Post the toolbox talk ${stamp}`;
  const ids = [
    await createWork(three, { due_at: endOfDay(-3) }),
    await createWork(one, { due_at: endOfDay(-1) }),
    await createWork(today, { due_at: endOfDay(0) }),
  ];

  try {
    await signIn(page, 'lim@tamco.local');

    await visit(page, '/work');
    const row = (title: string) => page.locator('.task-row-lean', { hasText: title });
    await expect(row(three)).toContainText('Overdue 3 days');
    // Due yesterday is a day late, not "Overdue" with no number.
    await expect(row(one)).toContainText('Overdue 1 day');
    await expect(row(today)).toContainText('Due today');

    await visit(page, '/today');
    // v188 — My Day's card for it says the same.
    await expect(page.locator('.day-card', { hasText: three })).toContainText('Overdue 3 days');
    await expect(page.locator('.day-card', { hasText: one })).toContainText('Overdue 1 day');

    await visit(page, `/work?task=${ids[1]}`);
    const drawer = page.getByRole('dialog', { name: one });
    await expect(drawer.locator('.task-status-line')).toContainText('Overdue 1 day');
    await visit(page, `/work?task=${ids[0]}`);
    await expect(
      page.getByRole('dialog', { name: three }).locator('.task-status-line'),
    ).toContainText('Overdue 3 days');
  } finally {
    await removeTasks(ids);
  }
});

test('v185 My Team lists late work first, paused work included', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  test.setTimeout(90_000);
  const stamp = crypto.randomUUID().slice(0, 5);
  const recent = new Date().toISOString();
  const older = new Date(Date.now() - 6 * 86_400_000).toISOString();
  const ids: string[] = [];

  try {
    // Six on time, touched most recently, so the old order put them first.
    for (let index = 0; index < 6; index += 1) {
      ids.push(
        await createWork(`On time ${index + 1} ${stamp}`, {
          due_at: endOfDay(10 + index),
          last_meaningful_update_at: recent,
        }),
      );
    }
    ids.push(
      await createWork(`Late active ${stamp}`, {
        due_at: endOfDay(-2),
        last_meaningful_update_at: older,
      }),
      await createWork(`Late paused ${stamp}`, {
        status: 'paused',
        paused_reason: 'Waiting for the vendor',
        due_at: endOfDay(-4),
        last_meaningful_update_at: older,
      }),
    );

    await signIn(page, 'izzul@tamco.local');
    await visit(page, `/work?scope=team&person=${LIM}`);
    const personRow = page.getByTestId('my-team-person-row').filter({ hasText: 'Lim Wei Sheng' });
    await expect(personRow).toContainText('2 overdue');

    const panel = page.getByTestId('my-team-person-panel');
    // v236 folded this section, so it is a <details> and the count is on its
    // summary rather than on a heading.
    const section = panel.locator('.team-person-section[data-section="active"]');
    await expect(section.locator('> summary')).toContainText('Other active work');
    await expect(section.locator('> summary')).toContainText('8');
    await expect(section.locator('.member-signals')).toContainText('2 overdue');

    // Visible without "Show more", earliest due first, and saying it is paused.
    const rows = section.locator(':scope > .member-work-list > .member-work-row');
    await expect(rows.nth(0)).toContainText(`Late paused ${stamp}`);
    await expect(rows.nth(0)).toContainText('Paused');
    await expect(rows.nth(0)).toContainText('Overdue');
    await expect(rows.nth(1)).toContainText(`Late active ${stamp}`);
    await expect(rows.nth(2)).toContainText(`On time`);
  } finally {
    await removeTasks(ids);
  }
});

test('v185 pushing a late due date back tells the manager, and the owner hears about late work', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  test.setTimeout(150_000);
  const stamp = crypto.randomUUID().slice(0, 5);
  const title = `Replace the eyewash station ${stamp}`;
  const undated = `Tidy the store room ${stamp}`;
  const taskId = await createWork(title, { due_at: endOfDay(-2) });
  const undatedId = await createWork(undated, { due_at: null });
  const admin = service();

  try {
    // The morning job tells Lim, once.
    const { data: run } = await admin.rpc('notify_overdue_work', {
      p_task_ids: [taskId, undatedId],
    });
    expect(run).toMatchObject({ ok: true, notified: 1, work: 1 });

    await signIn(page, 'lim@tamco.local');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const bell = page.getByRole('dialog', { name: 'Notifications' });
    const overdue = bell.locator('li', { hasText: title });
    await expect(overdue).toContainText('Work overdue');
    await overdue.getByRole('button').click();

    // He pushes it back from the drawer, with a reason.
    const drawer = page.getByRole('dialog', { name: title });
    await expect(drawer.locator('.task-status-line')).toContainText('Overdue 2 days');
    await drawer.getByRole('button', { name: 'More task actions' }).click();
    await page.getByRole('button', { name: 'Change due date' }).click();
    const editor = page.getByRole('dialog', { name: 'Edit due date' });
    await editor.getByLabel('New due date').fill(localDate(5));
    await editor.getByLabel('Reason (optional)').fill('Vendor delivery moved');
    await editor.getByRole('button', { name: 'Save' }).click();
    await expect(editor).toHaveCount(0);
    await expect(drawer.locator('.task-status-line')).not.toContainText('Overdue');

    // Izzul is told, by email as well as the bell.
    const { data: moved } = await admin
      .from('notifications')
      .select('id,title,body')
      .eq('recipient_id', IZZUL)
      .eq('task_id', taskId)
      .eq('kind', 'due_date_changed');
    expect(moved).toHaveLength(1);
    expect(moved![0]!.title).toBe(`Due date moved: ${title}`);
    expect(moved![0]!.body).toContain('Lim Wei Sheng moved it from');
    expect(moved![0]!.body).toContain('It was 2 days overdue. Reason: "Vendor delivery moved".');
    await expect
      .poll(async () => {
        const { data } = await admin
          .from('notification_email_deliveries')
          .select('recipient_email,status')
          .eq('notification_id', moved![0]!.id);
        return data;
      })
      .toEqual([{ recipient_email: 'izzul@tamco.local', status: 'sent' }]);

    // Lim's own overdue notice is answered by the new date.
    const { data: limNotice } = await admin
      .from('notifications')
      .select('read_at')
      .eq('recipient_id', LIM)
      .eq('task_id', taskId)
      .eq('kind', 'work_overdue');
    expect(limNotice![0]!.read_at).not.toBeNull();

    await signIn(page, 'izzul@tamco.local');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    const managerBell = page.getByRole('dialog', { name: 'Notifications' });
    const entry = managerBell.locator('li', { hasText: `Due date moved: ${title}` });
    await expect(entry).toContainText('Vendor delivery moved');
    await entry.getByRole('button').click();
    await expect(page.getByRole('dialog', { name: title })).toBeVisible();

    // Work with no date says so, rather than "Due No date yet".
    await visit(page, `/work?task=${undatedId}`);
    const plain = page.getByRole('dialog', { name: undated }).locator('.task-status-line');
    await expect(plain).toContainText('No due date');
    await expect(plain).not.toContainText('No date yet');
  } finally {
    await removeTasks([taskId, undatedId]);
  }
});
