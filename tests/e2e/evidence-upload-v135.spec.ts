import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v135 — evidence goes up one file at a time.
 *
 * A single request carrying five photographs fails as one thing: everything is
 * discarded, and somebody on a plant network starts again from the camera roll
 * — which is where people give up and complete the work with no evidence at
 * all. Per file, a failure names itself, offers Retry, and leaves the ones
 * that worked attached.
 *
 * ---
 *
 * Each test brings its own work, because hunting the seed for it does not
 * survive a second viewport.
 *
 * These tests used to look through Izzah's lists for anything that could still
 * be completed, and skip when they found nothing. The seed gives her exactly
 * two such tasks; one of the tests below completes the work it opens; and the
 * viewport projects share one database, running one after another. So desktop
 * consumed one task, mobile consumed the other, and the last three tests on
 * mobile found nothing and stopped running — while the run reported green,
 * because a skip prints a dash and no reason. The guard has been here since
 * v135 itself.
 *
 * Seeding Izzah more work is not available: `scripts/check-schema.mjs` holds
 * her active count as a fixture invariant. So the work is created here, one
 * task per test, and removed afterwards.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const ZONE = 'Asia/Kuala_Lumpur';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function dueInDays(offset: number): string {
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + offset * 86_400_000),
  );
  return new Date(`${day}T23:59:59.999+08:00`).toISOString();
}

/**
 * Work Izzah can complete, belonging to one test.
 *
 * Active and hers, with no steps and no evidence rule of its own, so `Complete
 * work` is enabled for the reason under test rather than for whatever the seed
 * happened to leave lying about.
 */
async function izzahsWork(title: string): Promise<string> {
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
      due_at: dueInDays(6),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  return String(data!.id);
}

/** Deleted where possible; binned where the audit trail forbids it (see v153). */
async function removeWork(taskId: string) {
  const admin = service();
  const { error } = await admin.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  const { error: binError } = await admin
    .from('tasks')
    .update({ deleted_at: new Date().toISOString(), deleted_by: IZZAH })
    .eq('id', taskId);
  if (binError) throw new Error(`Could not remove fixture ${taskId}: ${binError.message}`);
}

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Opens the completion form of this test's own work, by id rather than by hunt. */
async function openCompletion(page: Page, taskId: string, title: string) {
  await page.goto(`/work?tab=active&task=${taskId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  // By title, so this is the work this test created and not whatever else opened.
  await expect(page.getByRole('dialog', { name: title })).toBeVisible({ timeout: 15_000 });

  /*
   * The drawer's own footer button. The dialog it opens carries the same
   * accessible name, and so does that dialog's submit, so an unscoped locator
   * resolves to a different control depending on when it is read.
   */
  const complete = page.locator('.task-detail-footer').getByRole('button', {
    name: 'Complete work',
  });
  await expect(
    complete,
    'the work this test created must be completable, or the test proves nothing',
  ).toBeEnabled();
  await complete.click();
  await expect(page.locator('.evidence-target')).toBeVisible();
}

/*
 * One task per test, signed in and open at the completion form.
 *
 * Held in a module variable rather than a Playwright fixture to match the rest
 * of the suite; the runner is serial (`workers: 1`, `fullyParallel: false`) and
 * each worker loads its own copy of this module, so there is nothing to race.
 */
let work: { id: string; title: string } | null = null;

test.beforeEach(async ({ page }, testInfo) => {
  const title = `v135 ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  work = { id: await izzahsWork(title), title };
  await signIn(page, 'izzah@tamco.local');
  await openCompletion(page, work.id, title);
});

test.afterEach(async () => {
  if (!work) return;
  const created = work;
  work = null;
  await removeWork(created.id);
});

const csv = (name: string, body: string) => ({
  name,
  mimeType: 'text/csv',
  buffer: Buffer.from(body),
});

test('several files at once, each reporting its own outcome', async ({ page }) => {
  // Multi-select, not one at a time: nobody should choose, add, choose, add.
  await page
    .locator('.evidence-zone input[type="file"]')
    .first()
    .setInputFiles([csv('reading-one.csv', 'a,b\n1,2\n'), csv('reading-two.csv', 'c,d\n3,4\n')]);

  await expect(page.locator('.evidence-list-head')).toContainText('2 files attached', {
    timeout: 20_000,
  });

  const rows = page.locator('.evidence-item');
  await expect(rows).toHaveCount(2);
  // Each row states where that file got to, rather than one status for the batch.
  await expect(rows.first()).toContainText('Attached');
  await expect(rows.nth(1)).toContainText('Attached');
});

test('a file already on the record cannot be tidied away from the form', async ({ page }) => {
  await page
    .locator('.evidence-zone input[type="file"]')
    .first()
    .setInputFiles([csv('attached.csv', 'a\n1\n')]);
  await expect(page.locator('.evidence-item')).toContainText('Attached', { timeout: 20_000 });

  /*
   * Removing evidence from the work is an operation on the record, with its
   * own authority and its own audit entry. Offering × here would make it look
   * like a tidy-up of a form, and quietly leave the file attached anyway.
   */
  await expect(page.locator('.evidence-item .evidence-remove')).toHaveCount(0);
});

test('the completion counts what is attached, not what was chosen', async ({ page }) => {
  await page
    .locator('.evidence-zone input[type="file"]')
    .first()
    .setInputFiles([csv('proof.csv', 'a\n1\n')]);
  await expect(page.locator('.evidence-item')).toContainText('Attached', { timeout: 20_000 });

  /*
   * The files were uploaded as they arrived, so the form must not post them a
   * second time. A hidden input still named `files` would attach every one of
   * them twice — once here and once again on submit.
   */
  const named = await page.locator('.evidence-zone input[type="file"][name]').count();
  expect(named, 'the zone still posts its files with the form').toBe(0);

  // The dialog's submit, not the drawer's button that opened it, nor the
  // backdrop that shares the accessible name.
  await page
    .getByRole('dialog', { name: 'Complete work' })
    .getByRole('button', { name: 'Complete work' })
    .click();
  await expect(page.getByRole('dialog', { name: 'Complete work' })).toHaveCount(0, {
    timeout: 20_000,
  });
});

/**
 * v151 §18 — a refused upload holds the completion, and says which file.
 *
 * "Do not complete while any selected file is pending, failed or rejected.
 * Explain the specific blocker. The employee may retry or explicitly remove
 * the failing file, after which remaining files must still satisfy the rule."
 *
 * The form used to count only the files that had succeeded, so somebody could
 * attach three, watch two be refused, and complete on the strength of the one
 * that landed — with the record then claiming evidence nobody could find.
 *
 * The refusal is forced by the allow-list rather than by timing: an executable
 * is exactly what §19 says must never be stored, so this is a real rejection
 * rather than a simulated one.
 */
test('§18 completion waits for a file that was refused, and says which', async ({ page }) => {
  const dialog = page.getByRole('dialog', { name: 'Complete work' });
  /*
   * By type, not by name: the submit relabels itself to "N requirements
   * remaining" while anything is outstanding, which is the behaviour under
   * test and would make a name-based locator resolve to nothing exactly when
   * it matters.
   */
  const complete = dialog.locator('button[type="submit"]');
  const chooser = page.locator('.evidence-zone input[type="file"]').first();

  // One good file and one the server will not store.
  await chooser.setInputFiles([
    csv('readings.csv', 'a\n1\n'),
    { name: 'tool.exe', mimeType: 'application/x-msdownload', buffer: Buffer.from('MZ') },
  ]);

  const refused = page.locator('.evidence-item', { hasText: 'tool.exe' });
  await expect(refused).toContainText(/not|refus|fail/i, { timeout: 20_000 });

  /*
   * §18 — blocked, and specific about why. "You cannot complete yet" leaves
   * somebody unable to tell whether to wait or to act, and those are different
   * sentences.
   */
  await expect(complete).toBeDisabled();
  await expect(dialog).toContainText(/could not be uploaded/i);

  // The good one is untouched, which is the other half of the rule: a refusal
  // must not throw away the files that landed.
  await expect(page.locator('.evidence-item', { hasText: 'readings.csv' })).toContainText(
    'Attached',
    { timeout: 20_000 },
  );

  // Removing the refused file leaves a selection that satisfies the rule.
  await refused.getByRole('button', { name: /Remove/i }).click();
  await expect(refused).toHaveCount(0);
  await expect(complete).toBeEnabled();
});

/**
 * v151 §18, A22 — a file dropped anywhere on the panel is uploaded once.
 *
 * The whole completion panel is the drop target, not the bordered evidence
 * box inside it: somebody dragging a photograph aims at what they have been
 * reading, not at a control. Two things have to hold for that to be safe —
 * the browser must not navigate away from the page (its default for a dropped
 * file, which would throw away the note), and the nested handlers must not
 * take the same file twice.
 */
test('§18 a file dropped on the panel uploads once and does not navigate', async ({ page }) => {
  const before = page.url();

  // Dropped on the note area, which is inside the panel and outside the
  // bordered evidence box.
  const target = page.locator('.completion-form');
  await expect(target).toBeVisible();

  await target.evaluate((zone) => {
    const data = new DataTransfer();
    data.items.add(new File(['a,b\n1,2\n'], 'dropped.csv', { type: 'text/csv' }));
    zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, dataTransfer: data }));
    zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, dataTransfer: data }));
    zone.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: data }));
  });

  const rows = page.locator('.evidence-item', { hasText: 'dropped.csv' });
  await expect(rows).toContainText('Attached', { timeout: 20_000 });
  // Once, not once per handler it passed through on the way up.
  await expect(rows).toHaveCount(1);

  // And the page is still the page: the browser's default for a dropped file
  // is to open it, which would take the note with it.
  expect(page.url()).toBe(before);
  await expect(page.getByRole('dialog', { name: 'Complete work' })).toBeVisible();
});

/**
 * v151 §19, A25 — the camera is an extra route, not the only one.
 *
 * `capture` is what turns a chooser into the camera on a phone, and putting it
 * on the one input would constrain every upload to a photograph — so somebody
 * whose evidence is the completed assessment workbook would have no way to
 * attach it. Two inputs: one for the camera, one for everything.
 */
test('§19 the camera route does not become the only route', async ({ page }) => {
  const zone = page.locator('.evidence-zone');
  const camera = zone.locator('input[type="file"][capture]');
  const chooser = zone.locator('input[type="file"]:not([capture])');

  await expect(camera).toHaveCount(1);
  await expect(chooser).toHaveCount(1);

  // The general chooser takes documents and takes several at once. A single
  // input carrying `capture` could do neither.
  await expect(chooser).toHaveAttribute('multiple', '');
  const accept = (await chooser.getAttribute('accept')) ?? '';
  for (const kind of ['pdf', '.xls', '.doc']) {
    expect(accept.toLowerCase(), `the chooser refuses ${kind} files`).toContain(kind);
  }

  // And it still works after the camera has been offered.
  await chooser.setInputFiles([csv('workbook.csv', 'a\n1\n')]);
  await expect(page.locator('.evidence-item', { hasText: 'workbook.csv' })).toContainText(
    'Attached',
    { timeout: 20_000 },
  );
});
