import { crc32, deflateSync } from 'node:zlib';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

/*
 * v288 — the public form, from a stranger's phone.
 *
 * Everything else about this path is proven elsewhere: the procedures in
 * `esh_public_qr_reporting_v288.test.sql`, and the photograph's rebuild
 * against real storage in `esh-public-report-v288.test.ts`. What only a
 * browser can establish is whether somebody standing in front of a hazard,
 * with no account and no instructions, can actually send what they saw — and
 * whether the page tells them the truth about what it is while they do.
 *
 * The context is deliberately fresh and cookie-free: this is a stranger with
 * the address and nothing else, which is exactly who the sticker is for.
 */

const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * A photograph the browser can actually decode, draw and re-encode.
 *
 * Not the repository's 134-byte base64 JPEG: that one ends immediately after
 * its scan header, with no entropy data and no end marker, so the server's
 * rebuild refuses it as a file it cannot account for — which is the rebuild
 * working, not failing. A real camera file has none of those problems, and a
 * fixture that cannot stand in for one proves nothing about this path.
 *
 * Deterministic noise, 400x300, deflated at level 0 so the stored size is the
 * raw size (~360KB). Noise is what makes the canvas prefer JPEG, so the copy
 * the form sends is a complete browser-made JPEG — which is the real flow.
 */
function photoPng(width = 400, height = 300): Buffer {
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

async function open(code: string, label: string) {
  const db = service();
  const { data: departments } = await db.from('departments').select('id').eq('code', 'OPS');
  await db.from('esh_qr_locations').insert({
    organization_id: ORGANIZATION,
    public_code: code,
    display_label: label,
    department_id: departments?.[0]?.id ?? null,
    active: true,
  });
  await db
    .from('esh_qr_intake_settings')
    .update({ enabled: true })
    .eq('organization_id', ORGANIZATION);
  return db;
}

/**
 * Closed again, and the sticker removed. A shared local database left with
 * public reporting open would change what every other spec sees at `/report`.
 */
async function close(db: SupabaseClient, code: string) {
  await db
    .from('esh_qr_intake_settings')
    .update({ enabled: false })
    .eq('organization_id', ORGANIZATION);
  await db.from('esh_qr_locations').delete().eq('public_code', code);
}

test('v288 somebody with no account reports what they saw, with a photograph', async ({
  browser,
}, testInfo) => {
  // Mobile only: this form is reached by scanning a sticker with a phone, and
  // that is the width its layout is for.
  test.skip(testInfo.project.name !== 'mobile', 'The public form is a phone screen.');
  test.setTimeout(120_000);

  const code = `BR2-E2E-${Date.now().toString(36).toUpperCase()}`;
  const db = await open(code, 'BR2 Press line 2');
  const stranger = await browser.newContext();
  const page = await stranger.newPage();

  try {
    const response = await page.goto(`/report/${code}`);
    expect(response?.status()).toBe(200);
    /*
     * The address, not the status. A redirect to sign-in also answers 200 once
     * the browser has followed it, so the status alone does not prove this
     * page is reachable without an account - removing `/report` from the
     * public paths left the status assertion passing.
     */
    await expect(page, 'the page must not redirect to sign-in').toHaveURL(
      new RegExp(`/report/${code}$`),
    );

    await expect(page.getByRole('heading', { name: 'Report a safety concern' })).toBeVisible();
    // Where they are, read off the sticker rather than typed.
    await expect(page.getByText('BR2 Press line 2')).toBeVisible();
    /*
     * §6, and before anything is typed: this is not an emergency channel.
     * Somebody scanning a code while looking at something dangerous has to be
     * told that first, not in a paragraph underneath the send button.
     */
    await expect(page.getByText(/does not raise an alarm/)).toBeVisible();

    // Nothing is asked that ESH decides: no category, no severity, no owner.
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const absent of ['severity', 'hazard category', 'responsible person', 'department']) {
      expect(body, `the form must not ask for ${absent}`).not.toContain(absent);
    }

    await page
      .getByLabel('What did you see?')
      .fill('The guard is off the bench grinder by the press and it is still being used.');
    /*
     * The sticker's code goes in the field so this run's report can be found
     * by itself. The local database is shared and earlier runs leave reports
     * behind - a query on a fixed sentence matches all of them, and the test
     * then fails on its own history.
     */
    await page.getByLabel('Where exactly (optional)').fill(`Goods-in door ${code}`);
    await page.getByLabel('Photos (optional)').setInputFiles({
      name: 'grinder.png',
      mimeType: 'image/png',
      buffer: PHOTO,
    });
    // The thumbnail is the only confirmation that the photograph was taken up
    // by the form at all.
    await expect(page.locator('.public-report-photos img')).toHaveCount(1);

    await page.getByRole('button', { name: 'Send report' }).click();

    await expect(page.getByRole('heading', { name: /ESH has your report/ })).toBeVisible({
      timeout: 30_000,
    });
    const reference = await page.locator('.public-report-reference').innerText();
    expect(reference, 'a reference they can quote').toMatch(/^[0-9A-F]{8}$/);

    // What actually landed, read from the database rather than off the page.
    const { data: rows } = await db
      .from('esh_report_intake')
      .select('id, source, status, report_text, reported_location, reporter_contact')
      .eq('reported_location', `Goods-in door ${code}`);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      source: 'qr',
      status: 'new',
      // Nothing was asked and nothing was kept: the contact line was blank.
      reporter_contact: null,
    });

    const { data: photos } = await db
      .from('esh_report_intake_photos')
      .select('state, content_type')
      .eq('intake_id', rows![0]!.id);
    expect(photos).toHaveLength(1);
    // Sent as a PNG of noise, which the canvas re-encodes to JPEG because
    // JPEG wins decisively on a photograph - the v285 rule, in the real flow.
    expect(photos![0]).toMatchObject({ state: 'ready', content_type: 'image/jpeg' });
  } finally {
    await close(db, code);
    await stranger.close();
  }
});

test('v288 a closed channel says so, and submits nothing', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The public form is a phone screen.');

  const code = `BR2-SHUT-${Date.now().toString(36).toUpperCase()}`;
  const db = await open(code, 'BR2 Press line 2');
  // Open the sticker, then close the channel: the page must change its mind.
  await db
    .from('esh_qr_intake_settings')
    .update({ enabled: false })
    .eq('organization_id', ORGANIZATION);

  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  try {
    await page.goto(`/report/${code}`);
    await expect(page.getByRole('heading', { name: /not available from this link/ })).toBeVisible();
    // It must not imply that anything was received, and it must still say what
    // to do instead.
    await expect(page.getByText(/does not submit a report/)).toBeVisible();
    await expect(page.getByText(/emergency procedure/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send report' })).toHaveCount(0);

    // And a code nobody issued reaches the same page, which is deliberate:
    // telling a stranger which of the two it is tells them about the plant.
    await page.goto('/report/NOT-A-REAL-STICKER-CODE');
    await expect(page.getByRole('heading', { name: /not available from this link/ })).toBeVisible();
  } finally {
    await close(db, code);
    await stranger.close();
  }
});
