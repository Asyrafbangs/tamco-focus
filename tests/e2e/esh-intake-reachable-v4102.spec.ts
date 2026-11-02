import { randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/*
 * Stage 2 built the private intake queue and never linked it. Nothing in the
 * application pointed at `/findings/intake` — the only references were a
 * `revalidatePath` call and this suite's own `page.goto` — so the queue
 * existed, worked, and could be reached only by typing the address. Today's
 * "Incoming reports" card, which exists to surface exactly these, was left
 * saying QR intake was not enabled.
 *
 * These cases hold the two rules Stage 1 established for this screen: a
 * counter links to a list holding exactly it, and a card that previews a queue
 * says how many it is not showing.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION_ID = 'e5e50000-0000-4000-8000-000000000001';

/** Today previews six; the fixture makes one more so the footer must appear. */
const TODAY_PREVIEW = 6;

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
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

/**
 * The browser suite shares one database and leaves its fixtures behind, so the
 * counter is never "how many this test made". It is read from the database
 * directly, which is a different path from the page's own query under RLS.
 */
async function waitingInDatabase(db: ReturnType<typeof service>) {
  const { count, error } = await db
    .from('esh_report_intake')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', ORGANIZATION_ID)
    .in('status', ['new', 'triaging']);
  expect(error).toBeNull();
  return count ?? 0;
}

test('v4.1 Today reaches the private intake queue and counts it exactly', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'The queue is validated at the supported desktop and phone layouts.',
  );
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
   * Seven, because Today shows six: six rows and silence reads as the whole
   * queue, which is the defect Stage 1 closed on the verification card.
   *
   * The text is long on purpose. A real report runs to paragraphs and the row
   * has one line for it, so a short fixture would prove nothing about either
   * the truncation or the crawl's overflow check.
   */
  const made = Array.from(
    { length: TODAY_PREVIEW + 1 },
    (_unused, index) =>
      `v4102 report ${index + 1} ${suffix} — the fixed guard on the number two press ` +
      'is missing again and the operator has been running the machine without it ' +
      'for most of the shift, which is the whole reason this queue has to show ' +
      'every row it holds rather than the first handful of them.',
  );
  const { error: insertError } = await db.from('esh_report_intake').insert(
    made.map((report_text) => ({
      organization_id: ORGANIZATION_ID,
      source: 'esh_manual' as const,
      report_text,
      reported_location: 'BR2 Workshop',
      department_id: department!.id,
    })),
  );
  expect(insertError).toBeNull();

  const waiting = await waitingInDatabase(db);
  expect(waiting).toBeGreaterThanOrEqual(made.length);

  await signIn(page);
  await page.goto('/findings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // The counter says what the database holds, read through a different path.
  const counter = page.locator('.esh-signal').filter({ hasText: 'New reports' });
  await expect(counter.locator('strong')).toHaveText(String(waiting));

  // Six previewed, and the card states the number it is not showing.
  const card = page.locator('section').filter({ hasText: 'Incoming reports' }).last();
  await expect(card.locator('.esh-today-list > li')).toHaveCount(TODAY_PREVIEW);
  await expect(card.getByRole('link', { name: `${waiting} waiting · see them all` })).toBeVisible();

  // The counter is a way in, not only a number.
  await counter.click();
  await expect(page).toHaveURL(/\/findings\/intake$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByRole('heading', { level: 1, name: 'Incoming reports' })).toBeVisible();

  // Every waiting report is here, including the one Today left out.
  const rows = page.locator('.esh-register-row');
  await expect(rows).toHaveCount(waiting);
  for (const report of made) {
    const beginning = report.slice(0, 40);
    await expect(rows.filter({ hasText: beginning })).toHaveCount(1);
  }
  await expect(page.getByText(`${waiting} reports waiting`, { exact: false })).toBeVisible();

  // The row shows the beginning of the report, not all four thousand characters.
  const summary = await rows
    .filter({ hasText: made[0]!.slice(0, 40) })
    .locator('.esh-register-finding strong')
    .innerText();
  expect(summary.length).toBeLessThan(made[0]!.length);
  expect(summary.endsWith('…')).toBe(true);
});

test('v4.1 the intake queue is reachable from the Incoming reports card', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One width is enough for a link.');

  await signIn(page);
  await page.goto('/findings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const card = page.locator('section').filter({ hasText: 'Incoming reports' }).last();
  await card.getByRole('link', { name: 'Open queue' }).click();
  await expect(page).toHaveURL(/\/findings\/intake$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Incoming reports' })).toBeVisible();
  // The form a coordinator records a verbal report with is on the page it
  // links to, with the department the database scopes the queue by.
  await expect(page.getByRole('heading', { name: 'Record a manual report' })).toBeVisible();
  await expect(page.getByLabel('Department responsible')).toBeVisible();
});
