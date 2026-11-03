import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v279 — the connections a finding has, and whether a reader can follow them.
 *
 * Two directed links already existed and were already on the page, as plain
 * text: "Duplicate of ESH-…" and "Raised again as ESH-…". A coordinator who
 * read either had to go and search for the reference by hand, and nothing in
 * the application connected two findings that merely inform each other.
 *
 * These cases hold the part a database test cannot: that the link is on both
 * findings, that it can be followed, and that removing it from the far end
 * removes the one row there is. The authorization boundary is proven in
 * `esh_related_findings_v279.test.sql`, which can grant and roll back a
 * viewer's access without disturbing a shared database.
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
        description: 'v279 link fixture',
        reported_on: '2026-11-03',
        accountable_department_id: department,
        required_outcome: 'Put it right',
        priority: 'normal',
        owner_email: `related.owner.${suffix}@example.com`,
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

test('v279 a related finding appears on both findings and can be followed', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(150_000);

  const suffix = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;
  expect(ops, 'the seed has an Operations department').toBeTruthy();

  const make = await maker(izzul, suffix, ops!);
  const press = await make(`v279 fixed guard removed from press line 2 ${suffix}`);
  const sister = await make(`v279 guard interlock bypassed on the sister press ${suffix}`);

  await signIn(page);
  await page.goto(`/findings/${press.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Related findings' }),
  });
  await expect(section.getByText('No other finding is related to this one.')).toBeVisible();

  await section.getByLabel('Relate another finding').fill(sister.reference);
  await section
    .getByLabel('How they are related (optional)')
    .fill('Same guard design on both presses.');
  await section.getByRole('button', { name: 'Relate' }).click();

  const forward = section.getByRole('link', { name: new RegExp(sister.reference) });
  await expect(forward).toBeVisible({ timeout: 30_000 });
  await expect(section.getByText('Same guard design on both presses.')).toBeVisible();

  // Stored once, counted in the database rather than read back off the page
  // that wrote it.
  const db = service();
  const { data: rows, error } = await db
    .from('esh_finding_links')
    .select('finding_id, related_finding_id, note')
    .in('finding_id', [press.finding_id, sister.finding_id]);
  expect(error).toBeNull();
  expect(rows).toHaveLength(1);

  // The reference is a way in, not a string to go and search for.
  await forward.click();
  await expect(page).toHaveURL(new RegExp(`/findings/${sister.finding_id}`), { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // Symmetric: the far finding shows the link back, without anybody adding it.
  const farSection = page.locator('section', {
    has: page.getByRole('heading', { name: 'Related findings' }),
  });
  const back = farSection.getByRole('link', { name: new RegExp(press.reference) });
  await expect(back).toBeVisible();

  // And removing it from this end removes the one row there is.
  await farSection.getByRole('button', { name: 'Remove' }).click();
  await expect(farSection.getByText('No other finding is related to this one.')).toBeVisible({
    timeout: 30_000,
  });

  await page.goto(`/findings/${press.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(section.getByText('No other finding is related to this one.')).toBeVisible();

  const { data: afterRows } = await db
    .from('esh_finding_links')
    .select('id')
    .in('finding_id', [press.finding_id, sister.finding_id]);
  expect(afterRows ?? []).toHaveLength(0);
});

test('v279 the duplicate reference is a link to the finding it repeats', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(120_000);

  const suffix = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;
  expect(ops, 'the seed has an Operations department').toBeTruthy();

  const make = await maker(izzul, suffix, ops!);
  const kept = await make(`v279 the one that was kept ${suffix}`);
  const twice = await make(`v279 the one typed twice ${suffix}`);

  const resolved = await izzul.rpc('esh_resolve_finding', {
    p_finding_id: twice.finding_id,
    p_outcome: 'duplicate',
    p_reason: 'Recorded twice from one walk.',
    p_duplicate_of: kept.finding_id,
  });
  expect(resolved.data?.ok, JSON.stringify(resolved.data ?? resolved.error)).toBe(true);

  await signIn(page);
  await page.goto(`/findings/${twice.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // It used to render as text inside the outcome notice, so a coordinator had
  // to search for the reference by hand.
  const toKept = page.getByRole('link', { name: kept.reference });
  await expect(toKept).toBeVisible();
  await toKept.click();
  await expect(page).toHaveURL(new RegExp(`/findings/${kept.finding_id}`), { timeout: 30_000 });

  // And the finding that was kept says what came back, which nothing showed
  // before: the duplicate link was readable in one direction only.
  const section = page.locator('section', {
    has: page.getByRole('heading', { name: 'Related findings' }),
  });
  await expect(section.getByRole('heading', { name: 'Reported again as' })).toBeVisible();
  await expect(section.getByRole('link', { name: new RegExp(twice.reference) })).toBeVisible();
});
