import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/*
 * v293 — the triage workspace, on a day's worth of reports.
 *
 * The queue used to be a list whose only real action was a link to a second
 * page. Twenty reports a day meant twenty page loads, twenty returns, and the
 * report itself out of sight while somebody typed the finding it described.
 *
 * What these hold is the part that can go wrong when a screen gets faster:
 * that the count is the real one and not the page size, that assigning
 * actually accepts the report it is looking at, that pressing it twice does
 * not make two findings, that another coordinator holding the report is said
 * out loud rather than silently overwritten, and that the provenance of an
 * employee's observation survives into the finding.
 */

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page, email = 'izzul@tamco.local') {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** A day's reports, oldest first, each one findable by its own tag. */
async function arrive(db: SupabaseClient, tag: string, howMany: number) {
  const rows = Array.from({ length: howMany }, (_, index) => ({
    organization_id: ORGANIZATION,
    source: 'qr',
    status: 'new',
    report_text: `${tag} report ${index + 1} — the fixed guard on the number two press is missing again and the operator has been running the machine without it for most of the shift, which is the whole reason this queue has to show every row it holds rather than the first handful of them.`,
    reported_location: 'BR2 Workshop',
    received_at: new Date(Date.now() - (howMany - index) * 60_000).toISOString(),
  }));
  const { data, error } = await db.from('esh_report_intake').insert(rows).select('id, report_text');
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => String(row.id));
}

async function clear(db: SupabaseClient, tag: string) {
  await db.from('esh_report_intake').delete().like('report_text', `${tag}%`);
}

/** The five decisions, filled in the order a coordinator reads them. */
async function decide(page: Page, owner: string, risk = 'high') {
  const department = page.getByLabel('Accountable department', { exact: true });
  const list = page.locator('[role="listbox"]');
  for (let attempt = 0; ; attempt += 1) {
    await department.click();
    try {
      await list.waitFor({ state: 'visible', timeout: 3_000 });
      break;
    } catch (cause) {
      if (attempt === 3) throw new Error('the department list never opened', { cause });
    }
  }
  await department.fill('Operations');
  /*
   * Inside the listbox. The manual-report card further down the page carries
   * a department `select`, whose `option` elements answer to the same role -
   * two matches, and a strict-mode violation that reads like the combobox is
   * broken.
   */
  await list.getByRole('option', { name: 'Operations', exact: true }).click();
  await page.getByLabel('Required outcome').fill('Refit the guard and check it before each shift.');
  await page.getByLabel('Action Owner email').fill(owner);
  await page.getByLabel('Risk', { exact: true }).selectOption(risk);
  await page.getByLabel('Due date').fill('2026-12-18');
  const level1 = page.getByRole('textbox', { name: 'Level 1', exact: true });
  if (await level1.isVisible()) {
    await level1.fill(`supervisor.${owner}`);
    await level1.press('Enter');
  }
}

test('v293 a day of reports is one workspace: the queue, the report and the decision', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The two-column workspace; mobile has its own.');
  test.setTimeout(240_000);

  const tag = `v293-${crypto.randomUUID().slice(0, 6)}`;
  const db = service();
  const ids = await arrive(db, tag, 22);

  try {
    await signIn(page);
    await page.goto(`/findings/intake?report=${ids[0]}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    // The count is what is waiting, not what fits on the page.
    const { count } = await db
      .from('esh_report_intake')
      .select('id', { count: 'exact', head: true })
      .in('status', ['new', 'triaging']);
    await expect(page.locator('.esh-intake-queue-head')).toContainText(`${count} waiting`);

    // The report is beside the form, whole, and marked as the employee's.
    const original = page.locator('.esh-intake-original');
    await expect(original).toContainText(`${tag} report 1`);
    await expect(original).toContainText('BR2 Workshop');
    // The selected row is the one the address names.
    await expect(page.locator('.esh-intake-item[data-selected]')).toContainText(`${tag} report 1`);

    // No stepper in here: it is one column of decisions.
    await expect(page.getByRole('button', { name: /^Step 1 of 2/ })).toHaveCount(0);

    await decide(page, `owner.${tag}@example.com`);
    await page.getByRole('button', { name: 'Assign & next' }).click();

    // The next report, not the finding: this is a queue being worked through.
    await expect(page).toHaveURL(new RegExp(`/findings/intake\\?report=${ids[1]}`), {
      timeout: 60_000,
    });
    await expect(page.locator('.esh-intake-original')).toContainText(`${tag} report 2`);

    // What the database holds, rather than what the screen said.
    const { data: accepted } = await db
      .from('esh_report_intake')
      .select('status, accepted_finding_id')
      .eq('id', ids[0]!)
      .single();
    expect(accepted?.status).toBe('accepted');
    expect(accepted?.accepted_finding_id).toBeTruthy();

    const { data: finding } = await db
      .from('esh_findings')
      .select('id, source, source_reference, description, location, risk_level, status')
      .eq('id', String(accepted!.accepted_finding_id))
      .single();
    /*
     * An employee's observation is not an ESH inspection. The procedure has
     * always stored it as one; what changed is that the screen now says so
     * too, and this is the assertion that keeps the two agreeing.
     */
    expect(finding?.source).toBe('observation');
    expect(String(finding?.source_reference)).toContain(`private-intake:${ids[0]}`);
    expect(String(finding?.description)).toContain(`${tag} report 1`);
    expect(finding?.risk_level).toBe('high');
    // Open, with an owner action against it: assigning is what the press did.
    expect(finding?.status).toBe('open');
    const { count: actions } = await db
      .from('esh_finding_actions')
      .select('id', { count: 'exact', head: true })
      .eq('finding_id', String(finding!.id));
    expect(actions, 'the corrective action exists too').toBe(1);
  } finally {
    await clear(db, tag);
  }
});

test('v293 the same report assigned twice makes one finding, not two', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; no layout in it.');
  test.setTimeout(240_000);

  const tag = `v293d-${crypto.randomUUID().slice(0, 6)}`;
  const db = service();
  const ids = await arrive(db, tag, 2);

  try {
    await signIn(page);
    await page.goto(`/findings/intake?report=${ids[0]}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await decide(page, `owner.${tag}@example.com`);

    /*
     * Two presses in the time one save takes - a double tap, or an impatient
     * second click on a slow connection. The form disables itself after the
     * first, and the server carries an idempotency key behind that, so this
     * holds the outcome rather than the mechanism.
     */
    const assign = page.getByRole('button', { name: 'Assign & next' });
    await assign.click();
    await assign.click({ force: true, timeout: 2_000 }).catch(() => {});

    await expect(page).toHaveURL(new RegExp(`/findings/intake\\?report=${ids[1]}`), {
      timeout: 60_000,
    });

    const { count } = await db
      .from('esh_findings')
      .select('id', { count: 'exact', head: true })
      .like('description', `${tag} report 1%`);
    expect(count, 'one press or two, one finding').toBe(1);
  } finally {
    await clear(db, tag);
  }
});

test('v293 a report another coordinator is holding is said so, not taken', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; no layout in it.');
  test.setTimeout(240_000);

  const tag = `v293c-${crypto.randomUUID().slice(0, 6)}`;
  const db = service();
  const ids = await arrive(db, tag, 1);

  try {
    // Somebody else got there first and is working on it.
    const { data: other } = await db
      .from('user_profiles')
      .select('id')
      .neq('email', 'izzul@tamco.local')
      .limit(1)
      .single();
    await db
      .from('esh_report_intake')
      .update({ status: 'triaging', assigned_triager_id: other!.id })
      .eq('id', ids[0]!);

    await signIn(page);
    await page.goto(`/findings/intake?report=${ids[0]}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await decide(page, `owner.${tag}@example.com`);
    await page.getByRole('button', { name: 'Assign & next' }).click();

    await expect(page.getByText(/Another coordinator is working on this report/)).toBeVisible({
      timeout: 60_000,
    });
    const { count } = await db
      .from('esh_findings')
      .select('id', { count: 'exact', head: true })
      .like('description', `${tag}%`);
    expect(count, 'and nothing was created behind their back').toBe(0);
  } finally {
    await clear(db, tag);
  }
});

test('v293 the workspace stays closed to somebody without triage authority', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Authorisation; one layout is enough.');
  test.setTimeout(120_000);

  await signIn(page, 'lim@tamco.local');
  const response = await page.goto('/findings/intake');
  // Either refused outright or taken somewhere else - never the queue.
  expect(page.url()).not.toContain('/findings/intake?report=');
  await expect(page.locator('.esh-intake-workspace')).toHaveCount(0);
  expect(response?.status()).toBeLessThan(500);
});
