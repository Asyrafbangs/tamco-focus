import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ADMIN = 'f0c05000-0000-4000-a000-000000000001';

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

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

test('v225 the department is chosen by typing, and a missing one is added without leaving the form', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The list is the same control at both widths.');
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const fresh = `Facilities ${suffix}`;

  // ------------------------------------------------------------------
  // A Coordinator who is not an administrator: the list, and who to ask.
  // ------------------------------------------------------------------
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const field = page.getByLabel('Accountable department', { exact: true });

  await field.click();
  await expect(page.getByRole('option')).toHaveText([
    'Administration',
    'Environment, Health & Safety',
    'Operations',
  ]);

  // Typing narrows it, on any part of the name rather than only the start.
  await field.fill('health');
  await expect(page.getByRole('option')).toHaveText(['Environment, Health & Safety']);

  // Chosen with the keyboard, and it is the name that appears, not an id.
  await field.fill('oper');
  await field.press('ArrowDown');
  await field.press('Enter');
  await expect(field).toHaveValue('Operations');
  // The form submits an id, and the visible box never holds one.
  await expect(page.locator('input[name="accountable_department_id"]')).toHaveValue(
    /^[0-9a-f-]{36}$/,
  );

  // Nothing matches, and this person cannot add one: they are told who can.
  await field.click();
  await field.fill(fresh);
  await expect(page.locator('.esh-combobox-empty')).toContainText('An administrator can add it');
  await expect(page.getByRole('button', { name: /^\+ Add/ })).toHaveCount(0);

  /*
   * The rest is an administrator's, and in production the person who records
   * findings is both. This suite's administrator is not in ESH, so the access
   * is lent for the check and taken back whatever happens: left on, it puts a
   * module switcher in the chrome, which is how v203 came to find two
   * "Finding Management" on one page several specs later.
   */
  const admin = await apiAs('admin@tamco.local');
  const staffAccess = (enabled: boolean) =>
    admin.rpc('esh_set_staff_access', {
      p_user_id: ADMIN,
      p_enabled: enabled,
      p_preset: 'verifier',
      p_scope_all: true,
      p_department_ids: [],
      p_include_descendants: true,
      p_can_manage_reports: false,
      p_reason: 'v225 fixture: an administrator who is also ESH',
    });
  const granted = await staffAccess(true);
  if (!granted.data?.ok) throw new Error(`staff access failed: ${JSON.stringify(granted.data)}`);

  try {
    await runTheCheck();
  } finally {
    await staffAccess(false);
    await service().from('departments').delete().eq('name', fresh);
  }

  async function runTheCheck() {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/findings/new');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const box = page.getByLabel('Accountable department', { exact: true });

    // A name a keystroke away from one that exists is questioned, not refused.
    await box.click();
    await box.fill('Operation');
    await page.getByRole('button', { name: /^\+ Add/ }).click();
    const panel = page.locator('.esh-combobox-panel');
    await expect(panel).toContainText('already exists');
    await expect(panel.getByRole('button', { name: 'Use Operations' })).toBeVisible();
    // Taking the near match is one press, and it is the one that was meant.
    await panel.getByRole('button', { name: 'Use Operations' }).click();
    await expect(box).toHaveValue('Operations');

    // A department that genuinely is not there is added from here.
    await box.click();
    await box.fill(fresh);
    await page.getByRole('button', { name: /^\+ Add/ }).click();
    // The code is offered, spelled the way somebody would have typed it.
    await expect(page.getByLabel(/^Short code for/)).toHaveValue(
      `FACILITIES-${suffix.toUpperCase()}`,
    );
    await expect(page.locator('.esh-combobox-panel')).not.toContainText('already exists');
    const hidden = page.locator('input[name="accountable_department_id"]');
    const before = await hidden.inputValue();
    await page.getByRole('button', { name: 'Add department' }).click();

    /*
     * Not the visible box: while the list is open it shows what was typed, and
     * what was typed is the new department's name — so waiting for it passes
     * before anything has been created, and the read below then finds nothing.
     * The panel closing and the submitted id changing happen only on success.
     */
    await expect(page.locator('.esh-combobox-panel')).toHaveCount(0, { timeout: 15_000 });
    await expect(hidden).not.toHaveValue(before);

    const { data: created } = await service()
      .from('departments')
      .select('id, code')
      .eq('name', fresh)
      .single();
    expect(created?.code).toBe(`FACILITIES-${suffix.toUpperCase()}`);
    await expect(hidden).toHaveValue(String(created!.id));
    // And it is chosen: the half-written finding is still here, on the same step.
    await expect(box).toHaveValue(fresh);

    // And the finding records against it, which is what all of this was for.
    await page.getByLabel('Finding title', { exact: true }).fill(`v225 new department ${suffix}`);
    await page
      .getByLabel('What was found', { exact: true })
      .fill('Extinguisher past its service date.');
    await page.getByLabel('Location', { exact: true }).fill('BR2 Plant room');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Required outcome', { exact: true }).fill('Service or replace it.');
    await page.getByRole('button', { name: 'Save draft' }).click();

    await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}/, { timeout: 30_000 });
    const { data: finding } = await service()
      .from('esh_findings')
      .select('accountable_department_id')
      .eq('title', `v225 new department ${suffix}`)
      .single();
    expect(finding?.accountable_department_id).toBe(created!.id);

    // The findings recorded against it go with it, or the cleanup cannot run.
    await service()
      .from('esh_findings')
      .update({ accountable_department_id: null })
      .eq('title', `v225 new department ${suffix}`);
  }
});
