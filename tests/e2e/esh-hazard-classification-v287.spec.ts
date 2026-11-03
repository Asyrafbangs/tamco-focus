import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v287 — ESH classifies the hazard, and the classification reaches the three
 * screens that need it.
 *
 * The authorization boundary is proven in `esh_hazard_classification_v287.
 * test.sql`, which can grant and roll back a scoped coordinator's access
 * without disturbing a shared database. What only a browser can establish is
 * the part that has bitten this module twice: that a control which exists is
 * actually visible — not folded inside "Full record", not behind a status
 * branch — and that choosing a category changes what the register row and the
 * Patterns table say.
 */

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

/**
 * A finding with a title long enough to behave like a real one. Production
 * titles run past sixty characters, so a short fixture hides overflow that
 * only appears on the plant's own data.
 */
async function makeFinding(client: SupabaseClient, title: string, department: string, tag: string) {
  const saved = await client.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'v287 classification fixture',
      reported_on: '2026-11-03',
      accountable_department_id: department,
      required_outcome: 'Put it right',
      priority: 'normal',
      risk_level: 'high',
      owner_email: `hazard.owner.${tag}@example.com`,
      due_date: '2026-12-20',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (!saved.data?.ok) throw new Error(JSON.stringify(saved.data ?? saved.error));
  return saved.data as Saved;
}

test('v287 a coordinator classifies a finding, and the register and Patterns follow', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(180_000);

  const tag = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;
  expect(ops, 'the seed has an Operations department').toBeTruthy();

  const title = `v287 bench grinder wheel guard removed and the machine left running ${tag}`;
  const finding = await makeFinding(izzul, title, ops!, tag);

  await signIn(page);
  await page.goto(`/findings/${finding.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  /*
   * Visible, on the page, without opening anything. A control folded into the
   * "Full record" details element would pass a presence check and never be
   * used, which is how two drawer controls shipped unreachable.
   */
  await expect(page.getByRole('heading', { name: 'What kind of hazard' })).toBeVisible();
  const primary = page.getByLabel('Hazard category');
  await expect(primary).toBeVisible();
  await expect(primary).toHaveValue('');

  // The second category is offered only once there is a first one to add to.
  await expect(page.getByLabel('Also (optional)')).toHaveCount(0);

  await primary.selectOption('machinery');
  // The description of the chosen category, so nobody has to guess what it
  // covers from a two-word label.
  await expect(page.getByText(/Guarding, moving parts/)).toBeVisible();

  const second = page.getByLabel('Also (optional)');
  await expect(second).toBeVisible();
  await second.selectOption('electrical');
  await page.getByRole('button', { name: 'Save category' }).click();

  // Wait for the save to be acknowledged before navigating: a click followed
  // by a goto cancels the server action, which reads as a product bug.
  await expect(page.getByText('Category saved.')).toBeVisible({ timeout: 30_000 });

  // Read back from the database rather than from the page that wrote it.
  const { data: stored } = await izzul
    .from('esh_findings')
    .select('hazard_category, hazard_secondary')
    .eq('id', finding.finding_id)
    .single();
  expect(stored).toMatchObject({ hazard_category: 'machinery', hazard_secondary: 'electrical' });

  // The register row says what kind of hazard it is. Searched for by title,
  // because the register paginates at fifty and earlier runs leave fixtures
  // behind.
  /*
   * `filter=all`, deliberately. The register opens on "Needs attention", and
   * an assigned finding with nothing overdue is not in it — so searching the
   * default view for a fresh fixture finds nothing and reads like a broken
   * search.
   */
  await page.goto(`/findings/register?filter=all&q=${encodeURIComponent(tag)}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const row = page.locator('.esh-register-row', { hasText: tag });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Machinery and equipment');

  // And the register can be asked the question the other way round.
  await page.goto(`/findings/register?filter=all&hazard=machinery&q=${encodeURIComponent(tag)}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.esh-register-row', { hasText: tag })).toHaveCount(1);
  await page.goto(`/findings/register?filter=all&hazard=fire&q=${encodeURIComponent(tag)}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.esh-register-row', { hasText: tag })).toHaveCount(0);

  // Patterns counts it under its own category, and every category is a row
  // even at zero.
  await page.goto('/findings/patterns');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const table = page.locator('.esh-hazard-table');
  await expect(table).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Machinery and equipment' })).toBeVisible();
  await expect(table.getByRole('rowheader', { name: 'Fire and explosion' })).toBeVisible();
});

test('v287 a classification can be withdrawn, and the finding goes back to uncategorised', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(150_000);

  const tag = crypto.randomUUID().slice(0, 8);
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id,code');
  const ops = departments?.find((department) => department.code === 'OPS')?.id;

  const finding = await makeFinding(
    izzul,
    `v287 chemical drum left open beside the goods-in door overnight ${tag}`,
    ops!,
    tag,
  );
  const set = await izzul.rpc('esh_set_finding_hazard', {
    p_finding_id: finding.finding_id,
    p_primary: 'chemical',
    p_secondary: null,
  });
  expect(set.data?.ok, JSON.stringify(set.data ?? set.error)).toBe(true);

  await signIn(page);
  await page.goto(`/findings/${finding.finding_id}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const primary = page.getByLabel('Hazard category');
  await expect(primary).toHaveValue('chemical');

  /*
   * A judgement that cannot be corrected is a judgement people avoid making.
   * "Not categorised" is offered as a choice for that reason, and the state it
   * returns to is a real one the distribution counts.
   */
  await primary.selectOption('');
  await page.getByRole('button', { name: 'Save category' }).click();
  await expect(page.getByText('Category saved.')).toBeVisible({ timeout: 30_000 });

  const { data: stored } = await izzul
    .from('esh_findings')
    .select('hazard_category, hazard_set_at')
    .eq('id', finding.finding_id)
    .single();
  expect(stored).toMatchObject({ hazard_category: null, hazard_set_at: null });

  // And it is findable as such, which is what makes the gap closable.
  await page.goto(`/findings/register?filter=all&hazard=none&q=${encodeURIComponent(tag)}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.esh-register-row', { hasText: tag })).toHaveCount(1);
});
