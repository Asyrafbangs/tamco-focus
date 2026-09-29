import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function apiAs(email: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed: ${error.message}`);
  return client;
}

async function signIn(page: Page, email = 'izzul@tamco.local') {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

async function chooseDepartment(page: Page, name: string) {
  const field = page.getByLabel('Accountable department', { exact: true });
  await field.click();
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}

/**
 * v228 — a department's own escalation route arrives folded (§7).
 *
 * ESH read and re-approved the same two addresses on every finding for the
 * same warehouse. The route now states who would be told and when; the boxes
 * are one press away for the finding that needs somebody else.
 */
test('v228 the department route is a summary, and the finding still carries it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fold is the same control at both widths.');
  test.setTimeout(120_000);
  const suffix = randomBytes(3).toString('hex');
  const level1 = `lead.${suffix}@example.com`;
  const level2 = `boss.${suffix}@example.com`;
  const title = `v228 folded route ${suffix}`;

  const esh = await apiAs('izzul@tamco.local');
  const { data: ops } = await service().from('departments').select('id').eq('code', 'OPS').single();
  const saved = await esh.rpc('esh_set_department_escalation', {
    p_department_id: ops!.id,
    p_levels: [
      { level: 1, email: level1 },
      { level: 2, email: level2 },
    ],
  });
  if (!saved.data?.ok) throw new Error(`route failed: ${JSON.stringify(saved.data)}`);

  try {
    await signIn(page);
    await page.goto('/findings/new');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const form = page.locator('form.esh-finding-form');

    await form.getByLabel('Finding title', { exact: true }).fill(title);
    await form.getByLabel('What was found', { exact: true }).fill('Pallets across the fire exit.');
    await form.getByLabel('Location', { exact: true }).fill('BR2 Warehouse');
    await chooseDepartment(page, 'Operations');
    await page.getByRole('button', { name: 'Next' }).click();

    // Folded: it says who and when, and the boxes are not asking to be read.
    const summary = page.locator('.esh-route-summary');
    await expect(summary).toContainText('Level 1');
    await expect(summary).toContainText('after 1 day overdue');
    await expect(summary).toContainText(level1);
    await expect(summary).toContainText(level2);
    await expect(form).toContainText('(Operations default)');
    await expect(form.getByLabel('Level 1', { exact: true })).not.toBeVisible();

    /*
     * The finding has to carry the folded route. Each level's value is a hidden
     * input inside the editor, so an editor that was unmounted rather than
     * hidden would save a finding with no escalation at all and nothing on the
     * screen would say so.
     */
    await form.getByLabel('Required outcome', { exact: true }).fill('Clear the exit.');
    await form
      .getByLabel('Action Owner email', { exact: true })
      .fill(`owner.${suffix}@example.com`);
    await form.getByLabel('Due date', { exact: true }).fill('2026-12-30');
    await page.getByRole('button', { name: 'Assign finding' }).click();
    await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}/, { timeout: 30_000 });

    const { data: finding, error: findingError } = await service()
      .from('esh_findings')
      .select('id')
      .eq('title', title)
      .single();
    if (findingError) throw new Error(`finding read failed: ${findingError.message}`);
    const { data: action, error: actionError } = await service()
      .from('esh_finding_actions')
      .select('id')
      .eq('finding_id', finding!.id)
      .single();
    if (actionError) throw new Error(`action read failed: ${actionError.message}`);
    // The route belongs to the action, not the finding. Read the error: a
    // filter on a column that does not exist comes back as an empty result,
    // which reads exactly like a route that was never saved.
    const { data: route, error: routeError } = await service()
      .from('esh_action_escalation_recipients')
      .select('level, esh_email_principals(canonical_email)')
      .eq('action_id', action!.id);
    if (routeError) throw new Error(`route read failed: ${routeError.message}`);
    // Not the count alone: the right addresses at the right levels.
    const byLevel = Object.fromEntries(
      (route ?? []).map((row) => [
        Number(row.level),
        (row.esh_email_principals as unknown as { canonical_email: string }).canonical_email,
      ]),
    );
    expect(byLevel).toEqual({ 1: level1, 2: level2 });

    // And Change route opens the boxes for a finding that needs another one.
    await page.goto('/findings/new');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await chooseDepartment(page, 'Operations');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: 'Change route' }).click();
    await expect(form.getByLabel('Level 1', { exact: true })).toBeVisible();
    await expect(page.locator('.esh-route-summary')).toHaveCount(0);
  } finally {
    /*
     * This suite shares one database, and a route left on Operations is offered
     * to every later finding recorded there — which is how v223 came to add an
     * escalation contact to specs that never asked for one.
     */
    await esh.rpc('esh_set_department_escalation', {
      p_department_id: ops!.id,
      p_levels: [],
    });
  }
});
