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

/**
 * v228 — settings is one section at a time, and departments are kept here (§31.2).
 */
test('v228 settings opens one section at a time, and departments are maintained there', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The tabs are the same control at both widths.');
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const fresh = `Facilities ${suffix}`;

  // A Verifier who is not an administrator: the list, and who maintains it.
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/findings/settings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const tabs = page.getByRole('navigation', { name: 'Settings sections' });
  await expect(tabs).toContainText('Departments');
  await expect(tabs).toContainText('Follow-up defaults');
  await expect(tabs).toContainText('Owner access');

  const list = page.locator('.esh-department-chips');
  await expect(list).toContainText('Operations');
  await expect(page.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await expect(page.getByText('An administrator adds a department')).toBeVisible();

  // One section at a time: follow-up policy is not on this tab.
  await expect(page.getByRole('heading', { name: 'Follow-up settings' })).toHaveCount(0);
  await tabs.getByRole('link', { name: 'Follow-up defaults' }).click();
  await expect(page.getByRole('heading', { name: 'Follow-up settings' })).toBeVisible();
  await expect(page.locator('.esh-department-chips')).toHaveCount(0);

  // Owner access is read here and changed where it is signed for (§43.2).
  await tabs.getByRole('link', { name: 'Owner access' }).click();
  await expect(page.getByText('An administrator changes this')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Identity and access' })).toBeVisible();

  /*
   * The administrator's half. Access is lent for the check and taken back
   * whatever happens: left on, it puts a module switcher in the chrome, which
   * is how v203 came to find two "Finding Management" on one page.
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
      p_reason: 'v228 fixture: an administrator who is also ESH',
    });
  const granted = await staffAccess(true);
  if (!granted.data?.ok) throw new Error(`staff access failed: ${JSON.stringify(granted.data)}`);

  try {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/findings/settings');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    // A name close to one that exists is questioned before anything is created.
    await page.getByLabel('New department name').fill('Operation');
    await expect(page.getByText('already exists')).toBeVisible();

    await page.getByLabel('New department name').fill(fresh);
    await expect(page.getByText('already exists')).toHaveCount(0);
    // The code is offered, spelled the way somebody would have typed it.
    await expect(page.getByLabel('Short code')).toHaveValue(`FACILITIES-${suffix.toUpperCase()}`);
    await page.getByRole('button', { name: 'Add', exact: true }).click();

    // The list is the proof, not the message: it is what the next finding offers.
    await expect(page.locator('.esh-department-chips')).toContainText(fresh, { timeout: 15_000 });
    const { data: created, error } = await service()
      .from('departments')
      .select('code')
      .eq('name', fresh)
      .single();
    if (error) throw new Error(`department read failed: ${error.message}`);
    expect(created!.code).toBe(`FACILITIES-${suffix.toUpperCase()}`);
  } finally {
    await staffAccess(false);
    await service().from('departments').delete().eq('name', fresh);
  }
});
