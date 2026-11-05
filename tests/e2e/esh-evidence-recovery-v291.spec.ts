import { crc32, deflateSync } from 'node:zlib';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v291 — getting off the form after a photograph did not go up.
 *
 * v290 kept the form on screen when an upload failed, which was the right
 * call and left three ways to be stuck on it:
 *
 *  - the way out was drawn only while something was failing, so removing the
 *    last failed file took the Open button with it while Assign stayed
 *    disabled for good;
 *  - a replacement photograph chosen after the failure is `ready`, never
 *    `failed`, and the retry looked only for failures - so it was dropped as
 *    silently as the first one used to be;
 *  - Save draft stayed live and submits with no id, so a press after the save
 *    made a second finding carrying none of the evidence.
 *
 * Each one is a person standing in front of a hazard with a photograph the
 * system has just lost, so each gets its own case here.
 */

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * A real PNG, big enough that the form's own compression runs on it.
 *
 * Deflated at level 0, so the stored size is the raw size: about 1.9MB for
 * these dimensions, over the threshold at which staff evidence is shrunk.
 */
function photoPng(width = 900, height = 700, seedStart = 0x5eed1234): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let seed = seedStart;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed >>> 24;
  };
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0;
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      raw[at] = next();
      raw[at + 1] = next();
      raw[at + 2] = next();
    }
  }
  const chunk = (type: string, body: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const check = Buffer.alloc(4);
    check.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, check]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const FIRST = photoPng();
const SECOND = photoPng(880, 680, 0x1234abcd);

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function chooseDepartment(page: Page, name: string) {
  const field = page.getByLabel('Accountable department', { exact: true });
  const list = page.locator('[role="listbox"]');
  for (let attempt = 0; ; attempt += 1) {
    await field.click();
    try {
      await list.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch (cause) {
      if (attempt === 3) throw new Error('the department list never opened', { cause });
    }
  }
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}

const staged = (page: Page) => page.locator('.esh-staged-list .esh-file');

/** Choose files and wait for the re-encode, which the form will not save through. */
async function attach(page: Page, files: Array<{ name: string; buffer: Buffer }>) {
  const before = await staged(page).count();
  await page.getByLabel('Attach files').setInputFiles(
    files.map((file) => ({
      name: file.name,
      mimeType: 'image/png',
      buffer: file.buffer,
    })),
  );
  await expect(staged(page)).toHaveCount(before + files.length);
  // Per item, not across the list: `not.toContainText` on a locator that
  // matches several elements is a strict-mode violation.
  await expect(page.locator('.esh-staged-list .esh-file[data-status="preparing"]')).toHaveCount(0, {
    timeout: 30_000,
  });
}

/**
 * Back to the evidence, which lives on step 1.
 *
 * The failure notice is shown under step 2, where the files themselves are
 * hidden - so removing one or choosing another means stepping back first,
 * exactly as a person has to.
 */
async function backToEvidence(page: Page) {
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.esh-staged-list')).toBeVisible();
}

/** Everything up to the point of saving, with the upload about to fail. */
async function recordFinding(page: Page, title: string) {
  await signIn(page);
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  await page.getByLabel('Finding title').fill(title);
  await page.getByLabel('What was found').fill('A cable runs across the marked walkway.');
  await page.getByLabel('Location').fill('BR2 Warehouse');
  await chooseDepartment(page, 'Operations');
}

async function fillFollowUp(page: Page, tag: string) {
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Required outcome').fill('Route the cable.');
  await page.getByLabel('Action Owner email').fill(`owner.${tag}@example.com`);
  await page.getByLabel('Risk', { exact: true }).selectOption('high');
  await page.getByLabel('Due date').fill('2026-12-15');
  const level1 = page.getByRole('textbox', { name: 'Level 1', exact: true });
  await level1.fill(`supervisor.${tag}@example.com`);
  await level1.press('Enter');
}

const UPLOAD = '**/storage/v1/object/upload/sign/**';

async function findings(db: SupabaseClient, title: string) {
  const { data } = await db.from('esh_findings').select('id').eq('title', title);
  return data ?? [];
}

async function readyAssets(db: SupabaseClient, findingId: string) {
  const { data } = await db
    .from('esh_evidence_assets')
    .select('id, original_name')
    .eq('finding_id', findingId)
    .eq('state', 'ready');
  return data ?? [];
}

test('v291 removing the last failed photograph still leaves a way off the form', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(180_000);

  const tag = crypto.randomUUID().slice(0, 8);
  const title = `v291 stranded on the form ${tag}`;

  await recordFinding(page, title);
  await attach(page, [{ name: 'walkway.png', buffer: FIRST }]);
  await fillFollowUp(page, tag);

  await page.route(UPLOAD, (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page.getByText(/did not attach/)).toBeVisible({ timeout: 60_000 });

  /*
   * What a person does next: the message says to remove the file and open the
   * finding without it. Doing exactly that used to remove the only control
   * that opens it.
   */
  // Neither button can save this finding again, and both say so. Checked on
  // step 2, which is where Assign lives.
  await expect(page.getByRole('button', { name: 'Assign finding' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();

  await backToEvidence(page);
  await staged(page).getByRole('button', { name: 'Remove' }).click();
  await expect(staged(page)).toHaveCount(0);

  const panel = page.locator('.esh-attach-failed');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('The finding was saved.');
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();

  const db = service();
  const saved = await findings(db, title);
  expect(saved, 'the finding itself was saved').toHaveLength(1);

  await panel.getByRole('button', { name: 'Open the finding' }).click();
  await expect(page).toHaveURL(new RegExp(`/findings/${saved[0]!.id}`), { timeout: 60_000 });
  expect(await findings(db, title), 'and no second finding was made').toHaveLength(1);
});

test('v291 a replacement photograph chosen after a failure is sent, not ignored', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(240_000);

  const tag = crypto.randomUUID().slice(0, 8);
  const title = `v291 replacement photograph ${tag}`;

  await recordFinding(page, title);
  await attach(page, [{ name: 'walkway.png', buffer: FIRST }]);
  await fillFollowUp(page, tag);

  await page.route(UPLOAD, (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page.getByText(/did not attach/)).toBeVisible({ timeout: 60_000 });

  // The failed one goes, a fresh one is chosen in its place, and the signal
  // comes back.
  await backToEvidence(page);
  await staged(page).getByRole('button', { name: 'Remove' }).click();
  await expect(staged(page)).toHaveCount(0);
  await attach(page, [{ name: 'replacement.png', buffer: SECOND }]);
  await page.unroute(UPLOAD);

  const panel = page.locator('.esh-attach-failed');
  await expect(panel).toContainText('not attached to it yet');
  await panel.getByRole('button', { name: 'Try the attachments again' }).click();

  const db = service();
  const saved = await findings(db, title);
  expect(saved).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(`/findings/${saved[0]!.id}`), { timeout: 60_000 });

  const assets = await readyAssets(db, saved[0]!.id);
  expect(
    assets.map((asset) => String(asset.original_name)),
    'the replacement is on the finding',
    // `.jpg`: this path compresses like the other three, and the name follows
    // the bytes (v285).
  ).toEqual(['replacement.jpg']);
  expect(await findings(db, title), 'and still only one finding').toHaveLength(1);
});

test('v291 a retry sends the failed photograph and the one chosen since', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(240_000);

  const tag = crypto.randomUUID().slice(0, 8);
  const title = `v291 failed and ready together ${tag}`;

  await recordFinding(page, title);
  await attach(page, [{ name: 'walkway.png', buffer: FIRST }]);
  await fillFollowUp(page, tag);

  await page.route(UPLOAD, (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page.getByText(/did not attach/)).toBeVisible({ timeout: 60_000 });

  // The failed one is kept, and a second angle is added beside it.
  await backToEvidence(page);
  await attach(page, [{ name: 'second-angle.png', buffer: SECOND }]);
  await expect(staged(page)).toHaveCount(2);
  await page.unroute(UPLOAD);

  await page
    .locator('.esh-attach-failed')
    .getByRole('button', { name: 'Try the attachments again' })
    .click();

  const db = service();
  const saved = await findings(db, title);
  expect(saved).toHaveLength(1);
  await expect(page).toHaveURL(new RegExp(`/findings/${saved[0]!.id}`), { timeout: 60_000 });

  const assets = await readyAssets(db, saved[0]!.id);
  expect(
    assets.map((asset) => String(asset.original_name)).sort(),
    'both photographs are on the finding',
  ).toEqual(['second-angle.jpg', 'walkway.jpg']);
});
