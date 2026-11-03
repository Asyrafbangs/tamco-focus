import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION_ID = 'e5e50000-0000-4000-8000-000000000001';

/*
 * Stage 4 — Patterns, and the reconciliation Stage 4 actually asks for.
 *
 * The Patterns page promised for two stages that recurring issues would appear
 * "after ESH has reviewed categories and links", and showed nothing. Links now
 * exist, and every one of the three kinds is a decision a coordinator recorded
 * rather than something inferred from a title or a location.
 *
 * The second case is Stage 4's stated requirement: counts reconcile with their
 * scoped source rows. Two of the insights columns count actions and two count
 * findings, which diverges silently the day a finding carries two overdue
 * actions — every creation path makes one, with `sequence` hardcoded to 1, but
 * nothing enforces it.
 */

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
  if (error) throw new Error(error.message);
  return client;
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

interface Saved {
  finding_id: string;
  action_id: string;
  reference: string;
}

async function maker(client: SupabaseClient, suffix: string, department: string) {
  return async (title: string): Promise<Saved> => {
    const saved = await client.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title,
        description: 'v280 pattern fixture',
        reported_on: '2026-11-03',
        accountable_department_id: department,
        required_outcome: 'Put it right',
        priority: 'normal',
        owner_email: `pattern.owner.${suffix}@example.com`,
        due_date: '2026-12-20',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (!saved.data?.ok) throw new Error(JSON.stringify(saved.data ?? saved.error));
    return saved.data as Saved;
  };
}

test('v280 Patterns reports the links a coordinator reviewed, and nothing else', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(180_000);

  const suffix = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;
  expect(ops, 'the seed has an Operations department').toBeTruthy();

  const make = await maker(izzul, suffix, ops!);
  const kept = await make(`v280 press guard removed ${suffix}`);
  const again = await make(`v280 press guard, reported twice ${suffix}`);
  const sister = await make(`v280 sister press interlock ${suffix}`);
  const raised = await make(`v280 press guard off again in February ${suffix}`);

  // A duplicate, through the ordinary outcome procedure.
  const duplicate = await izzul.rpc('esh_resolve_finding', {
    p_finding_id: again.finding_id,
    p_outcome: 'duplicate',
    p_reason: 'Recorded twice from one walk.',
    p_duplicate_of: kept.finding_id,
  });
  expect(duplicate.data?.ok, JSON.stringify(duplicate.data ?? duplicate.error)).toBe(true);

  // A related link, through the v279 procedure.
  const related = await izzul.rpc('esh_link_related_findings', {
    p_finding_id: kept.finding_id,
    p_related_finding_id: sister.finding_id,
    p_note: `Same guard design on both presses ${suffix}.`,
  });
  expect(related.data?.ok, JSON.stringify(related.data ?? related.error)).toBe(true);

  // An effectiveness check that failed and raised a new finding. Written with
  // the service client because the decision procedures need a verified
  // submission first, and the view is what is under test here.
  const db = service();
  const { error: checkError } = await db.from('esh_effectiveness_checks').insert({
    organization_id: ORGANIZATION_ID,
    finding_id: kept.finding_id,
    action_id: kept.action_id,
    due_on: '2027-02-01',
    pass_criteria: 'The guard is on the machine and interlocked.',
    state: 'failed',
    scheduled_by: (await izzul.auth.getUser()).data.user!.id,
    decided_by: (await izzul.auth.getUser()).data.user!.id,
    decided_at: new Date().toISOString(),
    decision_note: 'Guard was off again in February.',
    follow_up_finding_id: raised.finding_id,
  });
  expect(checkError).toBeNull();

  await signIn(page);
  await page.goto('/findings/patterns');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const cameBack = page.locator('section', {
    has: page.getByRole('heading', { name: 'Came back after a correction' }),
  });
  await expect(cameBack.getByRole('link', { name: new RegExp(kept.reference) })).toBeVisible();
  await expect(cameBack.getByRole('link', { name: raised.reference })).toBeVisible();

  const reportedAgain = page.locator('section', {
    has: page.getByRole('heading', { name: 'Reported more than once' }),
  });
  await expect(reportedAgain.getByRole('link', { name: new RegExp(kept.reference) })).toBeVisible();
  await expect(reportedAgain.getByRole('link', { name: again.reference })).toBeVisible();

  const relatedSection = page.locator('section', {
    has: page.getByRole('heading', { name: 'Related by a coordinator' }),
  });
  await expect(
    relatedSection.getByText(`Same guard design on both presses ${suffix}.`),
  ).toBeVisible();

  // Symmetric links are stored once and read from both ends, so the page must
  // list each pair once rather than twice.
  const relatedRows = relatedSection.locator('.esh-link-list > li').filter({
    hasText: new RegExp(`${kept.reference}|${sister.reference}`),
  });
  expect(await relatedRows.count()).toBe(1);

  /*
   * And the page is still explicit about what it does not do. v287 settled the
   * categories, so the sentence this used to assert - "Hazard categories are
   * not yet agreed" - is no longer true and the page no longer says it. What
   * has to stay said is the part that is still a deliberate absence:
   * historical findings are not classified after the fact, and there is no
   * predictive score.
   */
  await expect(page.getByRole('heading', { name: 'What is not here' })).toBeVisible();
  await expect(page.getByText(/not classified after the fact/)).toBeVisible();
  await expect(page.getByText(/no predictive score/)).toBeVisible();
});

/** The total the register reports for the view it is showing. */
async function registerTotal(page: Page) {
  const foot = page.locator('.esh-register-foot p').first();
  await expect(foot).toContainText(/in this view/);
  const text = await foot.innerText();
  const match = /^(\d+)/.exec(text.trim());
  if (!match) throw new Error(`no total in "${text}"`);
  return Number(match[1]);
}

interface Cell {
  value: number;
  href: string;
}

/** Every department row, as its four counts and the links they open. */
async function departmentRows(page: Page) {
  // The accessible name is on the scroll region v218 added, not on the table
  // itself, which has no caption and no name of its own.
  const table = page
    .getByRole('region', { name: 'Findings by department' })
    .locator('table.esh-overview-table');
  await expect(table).toBeVisible();
  const rows = table.locator('tbody tr');
  const count = await rows.count();
  const read: Array<{ department: string; cells: Cell[] }> = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const department = (await row.locator('th').innerText()).trim();
    const links = row.locator('td a');
    const cells: Cell[] = [];
    const total = await links.count();
    for (let cell = 0; cell < total; cell += 1) {
      const link = links.nth(cell);
      cells.push({
        value: Number((await link.locator('strong').innerText()).trim()),
        href: (await link.getAttribute('href')) ?? '',
      });
    }
    read.push({ department, cells });
  }
  return read;
}

test('v4.4 every insights count lands on a list holding exactly what it counted', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'One reconciliation; layout is covered elsewhere.',
  );
  test.setTimeout(240_000);

  // Two departments, because a single-row table reconciles trivially. The
  // seed concentrates its findings in one, so the fixture provides the second.
  const suffix = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;
  const ehs = departments?.find((department) => department.code === 'EHS')?.id;
  expect(ops && ehs, 'the seed has Operations and EHS departments').toBeTruthy();
  await (
    await maker(izzul, suffix, ops!)
  )(`v4.4 reconcile operations ${suffix}`);
  await (
    await maker(izzul, `${suffix}b`, ehs!)
  )(`v4.4 reconcile ehs ${suffix}`);

  await signIn(page);
  await page.goto('/findings/patterns/insights');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const rows = await departmentRows(page);

  // A single-department table would reconcile trivially and prove nothing
  // about scope, which is half of what this stage asks.
  expect(rows.length, 'the insights table covers more than one department').toBeGreaterThan(1);

  for (const row of rows) {
    expect(row.cells, `${row.department} has four counts`).toHaveLength(4);
    const [open, overdue, awaiting, closed] = row.cells;

    for (const [name, cell] of [
      ['open findings', open!],
      ['closed findings', closed!],
    ] as Array<[string, Cell]>) {
      await page.goto(cell.href);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      expect(await registerTotal(page), `${row.department} ${name}`).toBe(cell.value);
    }

    expect(overdue!.href, 'overdue opens the overdue register view').toContain('filter=overdue');

    // Overdue is the one column whose value depends on the clock: both sides
    // count `due_at < now()`, read from two pages seconds apart, so an action
    // falling due in between differs by one with nothing wrong. Read the pair
    // again rather than once — a real divergence does not resolve itself.
    await expect
      .poll(
        async () => {
          await page.goto('/findings/patterns/insights');
          const again = await departmentRows(page);
          const mine = again.find((candidate) => candidate.department === row.department);
          if (!mine) return -1;
          await page.goto(mine.cells[1]!.href);
          return (await registerTotal(page)) - mine.cells[1]!.value;
        },
        { timeout: 30_000, intervals: [0, 1_000, 2_000] },
      )
      .toBe(0);

    // Awaiting review opens the verification queue, which counts its own rows.
    await page.goto(awaiting!.href);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    expect(
      await page.locator('.esh-register-row').count(),
      `${row.department} awaiting review`,
    ).toBe(awaiting!.value);
  }
});
