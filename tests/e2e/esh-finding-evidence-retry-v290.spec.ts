import { crc32, deflateSync } from 'node:zlib';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v290 — a photograph that did not go up is said so, and can be sent again.
 *
 * `attachStaged` used to `continue` past a refused upload and past a failed
 * one, then navigate to the finding as though everything had attached.
 * Evidence taken at the scene was discarded without a word, on the one screen
 * where somebody is standing in front of the hazard.
 *
 * This fails the upload on purpose — the request is aborted at the browser,
 * which is what a plant floor's signal does — and then holds three things:
 * the form stays, the failure is legible, and the retry attaches to the
 * finding already saved rather than saving a second one.
 */

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** A real PNG: large enough to be shrunk, decodable enough to be drawn. */
/*
 * 900x700 and deflated at level 0, so the stored size is the raw size: about
 * 1.9MB, over the 1.5MB threshold at which staff evidence is worth shrinking.
 * A smaller fixture is left alone by design, and would prove nothing about
 * this path now compressing like the other three.
 */
function photoPng(width = 900, height = 700): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  let seed = 0x5eed1234;
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

const PHOTO = photoPng();

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
  await field.click();
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}

test('v290 a failed photograph is visible, retried, and does not save a second finding', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(180_000);

  const tag = crypto.randomUUID().slice(0, 8);
  const title = `v290 trailing cable across the warehouse walkway ${tag}`;

  await signIn(page);
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  await page.getByLabel('Finding title').fill(title);
  await page.getByLabel('What was found').fill('A cable runs across the marked walkway.');
  await page.getByLabel('Location').fill('BR2 Warehouse');
  await chooseDepartment(page, 'Operations');

  await page.getByLabel('Attach files').setInputFiles({
    name: 'walkway.png',
    mimeType: 'image/png',
    buffer: PHOTO,
  });
  /*
   * Prepared before anything else happens: the re-encode is what shrinks a
   * phone photograph, and the form must not save through it.
   */
  const staged = page.locator('.esh-staged-list .esh-file');
  await expect(staged).toHaveCount(1);
  await expect(staged).not.toContainText('Preparing', { timeout: 30_000 });

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Required outcome').fill('Route the cable.');
  await page.getByLabel('Action Owner email').fill(`owner.${tag}@example.com`);
  await page.getByLabel('Risk', { exact: true }).selectOption('high');
  await page.getByLabel('Due date').fill('2026-12-15');
  const level1 = page.getByRole('textbox', { name: 'Level 1', exact: true });
  await level1.fill(`supervisor.${tag}@example.com`);
  await level1.press('Enter');

  // The signal goes while the bytes are in flight.
  await page.route('**/storage/v1/object/upload/sign/**', (route) => route.abort('failed'));

  await page.getByRole('button', { name: 'Assign finding' }).click();

  /*
   * The three things that were wrong. The form stays, the failure is said in
   * words, and the file itself is marked rather than quietly dropped.
   */
  await expect(page.getByText(/did not attach/)).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/findings\/new$/);
  await expect(staged).toContainText(/did not finish|refused|could not/i);

  const db = service();
  const { data: before } = await db.from('esh_findings').select('id').eq('title', title);
  expect(before, 'the finding itself was saved').toHaveLength(1);
  const findingId = before![0]!.id;
  const { data: noAssets } = await db
    .from('esh_evidence_assets')
    .select('id, state')
    .eq('finding_id', findingId);
  // The agreed record was released when the bytes did not arrive, so a retry
  // starts afresh rather than leaving a half-finished row behind.
  expect((noAssets ?? []).filter((one) => one.state === 'ready')).toHaveLength(0);

  // Signal back.
  await page.unroute('**/storage/v1/object/upload/sign/**');
  await page.getByRole('button', { name: 'Try the attachments again' }).click();

  await expect(page).toHaveURL(new RegExp(`/findings/${findingId}`), { timeout: 60_000 });

  // One finding, not two: the retry attached to the one already saved.
  const { data: after } = await db.from('esh_findings').select('id').eq('title', title);
  expect(after, 'the retry must not save a second finding').toHaveLength(1);

  const { data: assets } = await db
    .from('esh_evidence_assets')
    .select('id, state, original_name, size_bytes')
    .eq('finding_id', findingId)
    .eq('state', 'ready');
  expect(assets, 'the photograph arrived on the retry').toHaveLength(1);
  /*
   * Shrunk on the way, like every other evidence path. This form used to send
   * whatever came off the camera - twelve megabytes a picture from a plant
   * floor, where the other three paths send a few hundred kilobytes.
   */
  expect(Number(assets![0]!.size_bytes)).toBeLessThan(PHOTO.byteLength / 2);
  // And the camera's own file is kept beside it (v271).
  const { data: withSource } = await db
    .from('esh_evidence_assets')
    .select('source_state')
    .eq('id', assets![0]!.id)
    .single();
  expect(['pending', 'kept']).toContain(String(withSource?.source_state));
});
