import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v184 — Ask for an update, end to end.
 *
 * Izzul opens Amer's work from My Team and asks how it is going. Amer is told
 * in the bell (and by email), lands on the work with the request in front of
 * him and the composer open, and answers. Izzul is told, and lands on the
 * reply. The same on a step: Izzah asks Amer about the step she handed him,
 * and Amer completing it is the answer.
 *
 * The control is a line of small text, not a button, on the work and on the
 * step — and on a phone its touch area is still 44px.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
const AMER = 'f0c05000-0000-4000-a000-000000000003';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';

function service() {
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

async function createWork(owner: string, title: string) {
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
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

async function addStep(taskId: string, action: string, assignee: string) {
  const { data, error } = await service()
    .from('task_checklist_items')
    .insert({
      task_id: taskId,
      position: 1,
      action,
      assigned_to: assignee,
      evidence_rule: 'not_required',
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

/** Deleted where possible; binned where history forbids it (see v153). */
async function removeTasks(...ids: string[]) {
  const admin = service();
  for (const id of ids) {
    const { error } = await admin.from('tasks').delete().eq('id', id);
    if (!error) continue;
    await admin
      .from('tasks')
      .update({ deleted_at: new Date().toISOString(), deleted_by: IZZUL })
      .eq('id', id);
    await admin.from('notifications').delete().eq('task_id', id);
  }
}

async function openBellEntry(page: Page, text: string) {
  await page.getByRole('button', { name: /^Notifications/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  const entry = panel.locator('li', { hasText: text }).first();
  await expect(entry).toBeVisible();
  return entry;
}

test('v184 a manager asks for an update from My Team, and the owner answers it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  test.setTimeout(150_000);

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `Scaffold inspection ${stamp}`;
  const taskId = await createWork(AMER, title);

  try {
    await signIn(page, 'izzul@tamco.local');
    await page.goto(`/work?scope=team&person=${AMER}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const panel = page.getByTestId('my-team-person-panel');
    await panel.locator('.member-work-row', { hasText: title }).click();

    const drawer = page.getByRole('dialog', { name: title });
    await expect(drawer).toBeVisible();

    // A line of text, not a button: no .btn, and no taller than a text line.
    const ask = drawer.getByRole('button', { name: 'Ask for update', exact: true });
    await expect(ask).toBeVisible();
    await expect(ask).not.toHaveClass(/\bbtn\b/);
    expect((await ask.boundingBox())!.height).toBeLessThanOrEqual(24);

    await ask.click();
    const dialog = page.getByRole('dialog', { name: 'Ask for an update' });
    await expect(dialog.getByText('Ask Amer Hakim for an update')).toBeVisible();
    await dialog.getByLabel(/What do you want to know\?/).fill('Is the east scaffold tagged?');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toHaveCount(0);

    await expect(drawer.getByText(/Update requested\. Amer Hakim has been emailed/)).toBeVisible();
    const waiting = drawer.getByRole('region', { name: 'Update request status' });
    await expect(waiting).toContainText('Waiting for Amer Hakim’s update');
    await expect(waiting).toContainText('Is the east scaffold tagged?');
    await expect(waiting).toContainText('You can ask again after');
    // Asked today, so nothing offers to ask again.
    await expect(drawer.getByRole('button', { name: /^Ask (for update|again)$/ })).toHaveCount(0);

    // Recorded, and on its way to Amer's inbox.
    const admin = service();
    const { data: requestRows } = await admin
      .from('task_update_requests')
      .select('requested_of,message')
      .eq('task_id', taskId);
    expect(requestRows).toEqual([{ requested_of: AMER, message: 'Is the east scaffold tagged?' }]);
    await expect
      .poll(async () => {
        const { data: notices } = await admin
          .from('notifications')
          .select('id')
          .eq('task_id', taskId)
          .eq('kind', 'update_requested');
        const { data } = await admin
          .from('notification_email_deliveries')
          .select('recipient_email,status')
          .in(
            'notification_id',
            (notices ?? []).map((row) => row.id),
          );
        return data;
      })
      .toEqual([{ recipient_email: 'amer@tamco.local', status: 'sent' }]);

    // Amer: the bell, then the work with the request and the composer open.
    await signIn(page, 'amer@tamco.local');
    const entry = await openBellEntry(page, title);
    await expect(entry).toContainText('Izzul Asyraf asked you for an update');
    await entry.getByRole('button').click();
    await expect(page).toHaveURL(/respond=update/);

    const own = page.getByRole('dialog', { name: title });
    const banner = own.getByRole('region', { name: 'Update requested' });
    await expect(banner).toContainText('Izzul Asyraf asked for an update');
    await expect(banner).toContainText('“Is the east scaffold tagged?”');
    await expect(own.getByText('Izzul Asyraf is waiting for this update')).toBeVisible();
    const box = own.getByLabel('What changed?');
    await expect(box).toBeFocused();
    await box.fill('East scaffold tagged green at 10:40.');
    await own.getByRole('button', { name: 'Post update' }).click();
    await expect(own.getByText('Update posted. Izzul Asyraf has been told.')).toBeVisible();
    await expect(own.getByRole('region', { name: 'Update requested' })).toHaveCount(0);

    // Izzul: told, and opened at the reply.
    await signIn(page, 'izzul@tamco.local');
    const reply = await openBellEntry(page, `Update received: ${title}`);
    await expect(reply).toContainText('Amer Hakim replied: "East scaffold tagged green at 10:40."');
    await reply.getByRole('button').click();
    await expect(page).toHaveURL(/section=updates/);
    const answered = page.getByRole('dialog', { name: title });
    await expect(answered.locator('.task-written-update')).toContainText(
      'East scaffold tagged green at 10:40.',
    );
    await expect(answered.getByRole('region', { name: 'Update request status' })).toHaveCount(0);
    await expect(
      answered.getByRole('button', { name: 'Ask for update', exact: true }),
    ).toBeVisible();
  } finally {
    await removeTasks(taskId);
  }
});

test('v184 asking about a step asks its assignee, and completing the step answers', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  test.setTimeout(150_000);

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `Quarterly ESH report ${stamp}`;
  const action = `Send the incident figures ${stamp}`;
  const taskId = await createWork(IZZAH, title);
  const stepId = await addStep(taskId, action, AMER);

  try {
    // Izzah, the owner, asks about the step she handed to Amer.
    await signIn(page, 'izzah@tamco.local');
    await page.goto(`/work?task=${taskId}&step=${stepId}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const drawer = page.getByRole('dialog', { name: title });
    const row = drawer.locator('.task-checklist-row', { hasText: action });
    await expect(row).toBeVisible();
    // Her own work: nothing to ask about the work itself.
    await expect(drawer.getByRole('button', { name: 'Ask for update', exact: true })).toHaveCount(
      0,
    );

    const ask = row.getByRole('button', { name: `Ask for update on ${action}` });
    await expect(ask).toHaveText('Ask for update');
    expect((await ask.boundingBox())!.height).toBeLessThanOrEqual(24);
    await ask.click();

    const dialog = page.getByRole('dialog', { name: 'Ask for an update' });
    await expect(dialog.getByText('Ask Amer Hakim for an update')).toBeVisible();
    await expect(dialog.getByText(`About the step “${action}”.`)).toBeVisible();
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toContainText(/You asked Amer for an update ·/);
    await expect(row.getByRole('button', { name: /^Ask/ })).toHaveCount(0);

    // Amer: flagged on his Shared list, and asked at the step.
    await signIn(page, 'amer@tamco.local');
    await page.goto('/work?tab=shared');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const shared = page.locator('.task-row-lean', { hasText: action });
    await expect(shared.locator('.row-flag')).toContainText(['Update requested']);

    const entry = await openBellEntry(page, action);
    await expect(entry).toContainText(
      `Izzah Nurul asked you for an update on this step of ${title}.`,
    );
    await entry.getByRole('button').click();
    await expect(page).toHaveURL(new RegExp(`step=${stepId}.*respond=update`));
    const his = page.getByRole('dialog', { name: title });
    await expect(his.getByRole('region', { name: 'Update requested' })).toContainText(
      `On the step “${action}”`,
    );
    const hisRow = his.locator('.task-checklist-row', { hasText: action });
    await expect(hisRow).toContainText('Izzah Nurul asked for an update');
    await hisRow
      .getByRole('button', { name: `Complete ${action}` })
      .first()
      .click();
    await expect(his.getByRole('region', { name: 'Update requested' })).toHaveCount(0);

    // Izzah: told the step is done.
    await signIn(page, 'izzah@tamco.local');
    const done = await openBellEntry(page, `Step completed: ${action}`);
    await expect(done).toContainText(`Amer Hakim completed this step of ${title}.`);
  } finally {
    await removeTasks(taskId);
  }
});

test('v184 on a phone the link stays one line of text with a full touch area', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Touch sizing applies to the mobile build.');
  test.setTimeout(90_000);

  const stamp = crypto.randomUUID().slice(0, 6);
  const title = `Forklift check ${stamp}`;
  const action = `Photograph the tags ${stamp}`;
  const taskId = await createWork(AMER, title);
  await addStep(taskId, action, AMER);

  try {
    await signIn(page, 'izzul@tamco.local');
    await page.goto(`/work?task=${taskId}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const drawer = page.getByRole('dialog', { name: title });
    const ask = drawer.getByRole('button', { name: 'Ask for update', exact: true });
    await expect(ask).toBeVisible();

    const measured = await ask.evaluate((element) => {
      const after = getComputedStyle(element, '::after');
      const box = (element as HTMLElement).offsetHeight;
      return { box, touch: box - 2 * parseFloat(after.top) };
    });
    expect(measured.box).toBeLessThanOrEqual(24);
    expect(measured.touch).toBeGreaterThanOrEqual(44);

    await drawer.getByRole('button', { name: /^Steps/ }).click();
    const stepAsk = drawer.getByRole('button', { name: `Ask for update on ${action}` });
    await expect(stepAsk).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  } finally {
    await removeTasks(taskId);
  }
});
