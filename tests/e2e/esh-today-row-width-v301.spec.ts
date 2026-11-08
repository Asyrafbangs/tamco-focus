import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/*
 * v301 - the squeeze an overflow check cannot see.
 *
 * Today's "Incoming reports" and "To verify" cards put `esh-register-row` on
 * their list items. That class is the register's four-column grid
 * (1.6fr 1fr 1.2fr auto), written for a full-width table of findings. Each of
 * these rows holds a single child, so the child took the 1.6fr track - about
 * 93px of a 305px card - while the other three tracks held nothing at all.
 * The title ellipsised after ten characters ("Oil spilla...") and the meta
 * line wrapped four times, beside two thirds of a card that was empty.
 *
 * `esh-narrow-widths-v290` could not see it, and no amount of widening its
 * net would have: its entire method is to ask which elements have a right
 * edge past the viewport, and squeezed content is the opposite failure. The
 * words were inside the box. The box was simply far smaller than the card
 * around it, which reads as a deliberately narrow column until somebody
 * measures one against the other.
 *
 * So this measures the row against the card, and asserts the mechanism beside
 * the symptom: the number says the layout is right today, and the class count
 * says a later edit cannot quietly put the grid back.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION_ID = 'e5e50000-0000-4000-8000-000000000001';

/**
 * A row that is laid out correctly spans its card. The defect measured 0.35,
 * so anything near 1 passes and anything near a third fails, with no band in
 * between where the answer is a judgement call.
 */
const MUST_SPAN = 0.9;

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
}

test('v301 a Today queue row spans the card it sits in', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'A column-width defect, at the width it had.');
  test.setTimeout(120_000);

  const suffix = randomBytes(3).toString('hex');
  const db = service();
  const { data: department, error: departmentError } = await db
    .from('departments')
    .select('id')
    .eq('code', 'OPS')
    .single();
  expect(departmentError).toBeNull();

  /*
   * Long on purpose, and dated far enough back to be first.
   *
   * Today previews six rows ordered by `received_at` ascending, and the
   * browser suite leaves its fixtures behind, so a row inserted at "now" lands
   * at the end of a queue that may already be longer than the preview. An old
   * date puts this one at the top, where it is certain to be measured. The
   * text is longer than any card so the row genuinely wants the full width:
   * measuring a row whose content fits in a third of the card would prove
   * nothing, because the correct layout and the broken one look alike.
   */
  const reportText =
    `v301 ${suffix} - the walkway beside the number three press is blocked with ` +
    'offcuts again and the guard fence has been pushed aside to reach past them, ' +
    'so anybody walking that line is passing an unguarded machine while it runs.';

  const { data: made, error: insertError } = await db
    .from('esh_report_intake')
    .insert({
      organization_id: ORGANIZATION_ID,
      source: 'esh_manual' as const,
      report_text: reportText,
      reported_location: 'BR2 Workshop',
      department_id: department!.id,
      received_at: '2020-01-02T01:00:00Z',
    })
    .select('id')
    .single();
  expect(insertError).toBeNull();
  expect(made?.id, 'the fixture report must exist to be measured').toBeTruthy();

  try {
    await signIn(page);
    await page.goto('/findings');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    /*
     * The mechanism. The register's grid belongs on the register, where a row
     * really does carry four columns of content.
     */
    await expect(
      page.locator('.esh-today-columns .esh-register-row'),
      'the register grid is back on a Today row, so its content has a third of the card',
    ).toHaveCount(0);

    // The symptom, measured against the card rather than against itself: the
    // squeezed element was the link, so comparing the link to its own content
    // box would read as full in either layout.
    const row = page
      .locator('.esh-today-columns .esh-today-list li')
      .filter({ hasText: suffix })
      .first();
    await expect(row, 'the fixture report should be in the Incoming reports card').toHaveCount(1);

    const span = await row.evaluate((item) => {
      const link = item.querySelector('a');
      const outer = item.getBoundingClientRect().width;
      if (!link || outer <= 0) return null;
      return link.getBoundingClientRect().width / outer;
    });

    expect(span, 'the row could not be measured against its card').not.toBeNull();
    expect(
      span!,
      `the incoming report spans ${Math.round(span! * 100)}% of its card; a squeezed row reads as a column of ten-character words beside empty space`,
    ).toBeGreaterThanOrEqual(MUST_SPAN);
  } finally {
    await db.from('esh_report_intake').delete().eq('id', made!.id);
  }
});
