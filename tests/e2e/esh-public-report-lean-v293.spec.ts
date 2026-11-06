import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/*
 * v293 — the employee's page, after the lean pass.
 *
 * What is held here is the part a redesign can quietly break: that the
 * required field says so, that an extension number is an acceptable way to be
 * reached, that the page no longer promises an anonymity it cannot deliver,
 * and that the sticker's location is stated rather than asked for.
 */

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function open(db: SupabaseClient, code: string, label: string) {
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
}

async function close(db: SupabaseClient, code: string) {
  await db
    .from('esh_qr_intake_settings')
    .update({ enabled: false })
    .eq('organization_id', ORGANIZATION);
  await db.from('esh_qr_locations').delete().eq('public_code', code);
}

async function ready(page: Page, code: string) {
  await page.goto(`/report/${code}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('v293 the sticker answers where, the form asks what — and says when it needs it', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This page is a phone screen.');
  test.setTimeout(150_000);

  const code = `BR2-LEAN-${Date.now().toString(36).toUpperCase()}`;
  const db = service();
  await open(db, code, 'Office 1st Floor');
  const stranger = await browser.newContext();
  const page = await stranger.newPage();

  try {
    await ready(page, code);

    // Where, from the sticker, with no department to choose and no location
    // to recognise in a list.
    await expect(page.locator('.public-report-where')).toContainText('Office 1st Floor');
    await expect(page.locator('.public-report-where')).toContainText(
      'Location identified from QR code',
    );
    const body = (await page.locator('body').innerText()).toLowerCase();
    for (const absent of ['department', 'severity', 'hazard category']) {
      expect(body, `the form must not ask for ${absent}`).not.toContain(absent);
    }

    // Required, and said so once somebody has been in the box and left it.
    const send = page.getByRole('button', { name: 'Send report' });
    await expect(send).toBeDisabled();
    const observation = page.getByLabel('What did you see?');
    await observation.click();
    await observation.blur();
    await expect(page.getByText('Say what you saw before sending.')).toBeVisible();

    await observation.fill('The guard is off the bench grinder by the stairwell.');
    await expect(page.getByText('Say what you saw before sending.')).toHaveCount(0);
    await expect(send).toBeEnabled();

    /*
     * An extension is a perfectly good way to be reached in a plant. This
     * used to be "your name or extension" in a field the browser was free to
     * treat as an email address; it is text, and it goes through.
     */
    await page.getByLabel('Contact for follow-up (Optional)').fill('ext 4412');
    await send.click();

    await expect(page.getByRole('heading', { name: /ESH has your report/ })).toBeVisible({
      timeout: 60_000,
    });

    const { data: arrived } = await db
      .from('esh_report_intake')
      .select('reporter_contact, reported_location, report_text')
      .like('report_text', 'The guard is off the bench grinder by the stairwell%')
      .order('received_at', { ascending: false })
      .limit(1)
      .single();
    expect(arrived?.reporter_contact).toBe('ext 4412');
    expect(arrived?.reported_location).toBe('Office 1st Floor');
  } finally {
    await stranger.close();
    await db
      .from('esh_report_intake')
      .delete()
      .like('report_text', 'The guard is off the bench grinder by the stairwell%');
    await close(db, code);
  }
});

test('v293 the page does not promise an anonymity it cannot keep', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'This page is a phone screen.');
  test.setTimeout(120_000);

  const code = `BR2-PRIV-${Date.now().toString(36).toUpperCase()}`;
  const db = service();
  await open(db, code, 'Office 1st Floor');
  const stranger = await browser.newContext();
  const page = await stranger.newPage();

  try {
    await ready(page, code);
    // The summary, not the `details` around it: clicking the group does not
    // open it, and a closed disclosure keeps its text out of `innerText`.
    await page.locator('.public-report-privacy summary').click();
    await expect(page.locator('.public-report-privacy ul')).toBeVisible();
    const text = await page.locator('.public-report-privacy').innerText();

    /*
     * The three sentences that were removed. A description can name the
     * writer, a photograph can show a face, and the sticker records where the
     * report came from — so none of these could be guaranteed, and somebody
     * deciding what to write deserves to know that.
     */
    expect(text).not.toContain('Nobody else sees it');
    expect(text).not.toContain('nothing in the report identifies you');
    expect(text).not.toContain('no device, no location data');

    // And what replaced them: what is true, and what it asks of the reader.
    expect(text).toContain('Contact details are optional');
    expect(text.toLowerCase()).toContain('avoid putting names, faces or badges');
    expect(text.toLowerCase()).toContain('which location the report came from');
  } finally {
    await stranger.close();
    await close(db, code);
  }
});
