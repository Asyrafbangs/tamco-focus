import { createHash, randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v271 — the photograph that came off the camera is kept.
 *
 * v270 shrinks a photograph in the browser before sending it, which is what
 * makes a plant floor usable and what costs the EXIF block and every pixel
 * past 2000px. This proves the second half: the untouched file follows in the
 * background, into the same private bucket, and ESH can fetch it.
 *
 * Everything here runs through a real browser because the compression is a
 * canvas re-encode — there is no way to assert it from Node without asserting
 * something other than what ships.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/**
 * A PNG too big to send as it is. Two kinds, because v285 stopped treating
 * them the same.
 *
 * Deflated at level 0 either way, so the stored size is the raw size: 1000x600
 * RGB comes to about 1.8MB, over v270's 1.5MB threshold.
 *
 * `photo` is deterministic noise, which is what a photograph of a machine
 * actually looks like to an encoder: PNG cannot compress it, JPEG can, so the
 * copy becomes a JPEG. This fixture was a smooth gradient until v285, and a
 * gradient is now the other case — JPEG saves almost nothing on flat tone, so
 * the copy stays a PNG. The test's subject is the kept original, not the
 * format, and a photograph that behaves like a photograph is the fixture it
 * should always have had.
 *
 * `flat` is thin black lines on white: a screenshot of a permit, which is how
 * half the PNGs in this module arrive. JPEG puts a coloured halo on every edge
 * and barely saves a byte, so v285 leaves it as a PNG.
 */
function bigPng(width = 1000, height = 600, kind: 'photo' | 'flat' = 'photo'): Buffer {
  const raw = Buffer.alloc(height * (1 + width * 3));
  // A fixed sequence rather than Math.random: a fixture that differs between
  // runs cannot be reasoned about when it fails.
  let seed = 0x5eed1234;
  const clamp = (value: number) => Math.max(0, Math.min(255, value));
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed >>> 24;
  };
  for (let y = 0; y < height; y += 1) {
    const row = y * (1 + width * 3);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x += 1) {
      const at = row + 1 + x * 3;
      if (kind === 'flat') {
        const ink = x % 37 === 0 || y % 23 === 0 ? 0 : 255;
        raw[at] = ink;
        raw[at + 1] = ink;
        raw[at + 2] = ink;
      } else {
        /*
         * A gradient with fine grain on top, which is what a photograph of a
         * machine is to an encoder: smooth enough that JPEG throws most of it
         * away, grainy enough that PNG's deflate cannot. Pure noise would
         * satisfy the format rule and then fail the size one, because nothing
         * compresses random bytes - and a real photograph is not random.
         */
        const grain = (next() % 25) - 12;
        raw[at] = clamp(Math.round((x / width) * 255) + grain);
        raw[at + 1] = clamp(Math.round((y / height) * 255) + grain);
        raw[at + 2] = clamp(128 + grain);
      }
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 0 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const BIG = bigPng();
const FLAT = bigPng(1000, 600, 'flat');

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function apiAs(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
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

/** One action for one owner, their access on, assigned by the local Verifier. */
async function arrange(id: string) {
  const owner = `source.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v271 the guard on press 2 is missing its interlock, ${id}`,
      description: 'The interlock has been removed and the guard swings freely.',
      reported_on: '2026-10-20',
      accountable_department_id: departments?.[0]?.id,
      location: 'Workshop',
      required_outcome: 'Refit the interlock and prove it stops the press.',
      evidence_instruction: 'Photograph of the refitted interlock.',
      priority: 'high',
      owner_email: owner,
      due_date: '2026-12-15',
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.ok) {
    throw new Error(`assign failed: ${error?.message ?? JSON.stringify(data)}`);
  }
  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  const admin = await apiAs('admin@tamco.local');
  await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'e2e',
  });
  return {
    owner,
    principalId: contact!.id as string,
    actionId: data.action_id as string,
    findingId: data.finding_id as string,
  };
}

async function openAsOwner(page: Page, principalId: string, actionId: string) {
  const secret = randomBytes(32).toString('base64url');
  await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: principalId,
      purpose: 'owner_action',
      action_id: actionId,
      assignment_version: 1,
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  await page.goto(`/respond/access?for=action#${secret}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = page.getByRole('button', { name: 'Open action' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page).toHaveURL(new RegExp(`/respond/actions/${actionId}$`));
  /*
   * v290 - and on the page it lands on, not only on the one it left. This is a
   * form POST, so the owner's screen is a new document with its own hydration:
   * a file set on an input React has not yet bound is never noticed at all,
   * and the page then looks as though it dropped the attachment.
   */
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** The one asset on this action, whichever row the browser ended up making. */
async function asset(actionId: string) {
  const { data } = await service()
    .from('esh_evidence_assets')
    .select(
      'id, original_name, content_type, size_bytes, state, scan_state, source_state, source_file_name, source_size_bytes',
    )
    .eq('action_id', actionId)
    .eq('purpose', 'message')
    .order('created_at')
    .limit(1);
  return data?.[0] ?? null;
}

test('v271 an owner sends a compressed photograph and the camera original is kept', async ({
  page,
}, testInfo) => {
  const id = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 6)}`;
  const { principalId, actionId } = await arrange(id);
  await openAsOwner(page, principalId, actionId);

  await page.getByLabel('Attach files').setInputFiles({
    name: 'Interlock refitted.png',
    mimeType: 'image/png',
    buffer: BIG,
  });

  /*
   * Renamed, because it is a JPEG now. The owner sees the file they are about
   * to send rather than the one they chose, and the name should not disagree
   * with the bytes.
   */
  const staged = page.locator('.esh-upload');
  await expect(staged).toContainText('Interlock refitted.jpg');
  await expect(staged).toContainText('Ready to send', { timeout: 30_000 });

  await expect
    .poll(async () => (await asset(actionId))?.state ?? null, { timeout: 30_000 })
    .toBe('ready');
  const copy = await asset(actionId);

  /*
   * What the owner actually sent is a fraction of what they chose. The ratio
   * rather than a byte count: the exact JPEG size is the encoder's business,
   * but a gradient that did not shrink tenfold was not compressed at all.
   */
  expect(copy!.size_bytes!).toBeLessThan(BIG.byteLength / 10);

  /*
   * And the original follows, without the owner waiting for it. This is the
   * assertion the feature exists for, and it polls because the second upload
   * is deliberately not awaited by anything on screen.
   */
  await expect
    .poll(async () => (await asset(actionId))?.source_state ?? null, { timeout: 60_000 })
    .toBe('kept');

  const kept = await asset(actionId);
  expect(kept!.source_file_name).toBe('Interlock refitted.png');
  expect(kept!.source_size_bytes).toBe(BIG.byteLength);
  expect(kept!.source_size_bytes!).toBeGreaterThan(kept!.size_bytes!);

  /*
   * Keeping it sends the scanner back. The copy may already have been looked
   * at, but a canvas re-encode cannot carry what the camera's file carried,
   * so these are not bytes anybody has scanned.
   */
  expect(kept!.scan_state).toBe('not_scanned');

  // Sent, and shown back in the conversation as the small one.
  await page.getByRole('button', { name: 'Send update' }).click();
  const shown = page.locator('.esh-message .esh-file').last();
  await expect(shown).toContainText('Interlock refitted.jpg', { timeout: 30_000 });

  /*
   * And the owner is told nothing about originals, on a file that certainly
   * has one. It is ESH who verifies a photograph and ESH who can fetch the
   * full-size copy; the owner's own procedures do not return the state, so
   * the markup cannot appear here even by mistake.
   */
  await expect(page.locator('.esh-file-source')).toHaveCount(0);
});

test('v271 ESH can fetch the full-size original, and nobody else can', async ({
  page,
}, testInfo) => {
  const id = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 6)}`;
  const { principalId, actionId, findingId } = await arrange(id);
  await openAsOwner(page, principalId, actionId);
  await page.getByLabel('Attach files').setInputFiles({
    name: 'Interlock refitted.png',
    mimeType: 'image/png',
    buffer: BIG,
  });
  await expect(page.locator('.esh-upload')).toContainText('Ready to send', { timeout: 30_000 });
  await expect
    .poll(async () => (await asset(actionId))?.source_state ?? null, { timeout: 60_000 })
    .toBe('kept');
  await page.getByRole('button', { name: 'Send update' }).click();
  await expect(page.locator('.esh-message .esh-file').last()).toContainText(
    'Interlock refitted.jpg',
    { timeout: 30_000 },
  );
  const sent = await asset(actionId);

  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${findingId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // A verifier looking at a 2000px re-encode can tell, and can get the
  // camera's own file from the same line that tells them.
  const note = page.locator('.esh-file-source');
  await expect(note).toContainText('Full-size original kept');
  await expect(note.getByRole('link')).toHaveAttribute(
    'href',
    `/findings/files/${sent!.id}?source=1`,
  );

  const original = await page.request.get(`/findings/files/${sent!.id}?source=1`);
  expect(original.status()).toBe(200);
  expect((await original.body()).byteLength).toBe(BIG.byteLength);

  // The same route without the flag is still the small one everybody views.
  const small = await page.request.get(`/findings/files/${sent!.id}`);
  expect((await small.body()).byteLength).toBe(sent!.size_bytes);

  /*
   * And somebody with no Finding access gets the same 404 for the original as
   * for the copy. The row is invisible to them, so asking for a different
   * object on it reveals nothing -- including whether an original exists.
   */
  await signIn(page, 'amer@tamco.local');
  expect(
    (await page.request.get(`/findings/files/${sent!.id}?source=1`, { maxRedirects: 0 })).status(),
  ).toBe(404);
  expect(
    (await page.request.get(`/findings/files/${sent!.id}`, { maxRedirects: 0 })).status(),
  ).toBe(404);
});

test('v285 a screenshot stays a PNG, and its original is still kept', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; the format rule is width-independent.');

  /*
   * The other half of v285's rule, on the real screen. Half the PNGs in this
   * module are screenshots of permits and labels: thin dark text on white,
   * where JPEG puts a coloured halo on every character and saves almost
   * nothing. The copy must stay a PNG - and the original must still be kept,
   * because the rule changed the format, not the promise.
   */
  const id = `${testInfo.project.name.slice(0, 1)}${crypto.randomUUID().slice(0, 6)}`;
  const { principalId, actionId } = await arrange(id);
  await openAsOwner(page, principalId, actionId);

  await page.getByLabel('Attach files').setInputFiles({
    name: 'Permit to work.png',
    mimeType: 'image/png',
    buffer: FLAT,
  });

  const staged = page.locator('.esh-upload');
  await expect(staged).toContainText('Permit to work.png');
  await expect(staged).toContainText('Ready to send', { timeout: 30_000 });
  // Not renamed, because it was not converted.
  await expect(staged).not.toContainText('Permit to work.jpg');

  await expect
    .poll(async () => (await asset(actionId))?.source_state ?? null, { timeout: 60_000 })
    .toBe('kept');

  const kept = await asset(actionId);
  expect(kept!.content_type).toBe('image/png');
  // Smaller than what was chosen - a re-encode that saved nothing is refused -
  // and the full-size original is beside it either way.
  expect(kept!.size_bytes!).toBeLessThan(FLAT.byteLength);
  expect(kept!.source_file_name).toBe('Permit to work.png');
  expect(kept!.source_size_bytes).toBe(FLAT.byteLength);
});
