import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v223 — the workflow keeps its machinery underneath: a department added
 * where it is needed and followed by its usual route, a finding corrected from
 * its menu, and owner email as one Test/Live setting instead of a release per
 * finding.
 */

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
  if (error) throw new Error(error.message);
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

test('v223 a department is added where it is needed, and brings its route', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Staff configuration; one layout is enough.');
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const department = `Quality Lab ${suffix}`;
  const manager = `lab.manager.${suffix}@example.com`;

  await signIn(page, 'izzul@tamco.local');

  // Settings holds the department list and each department's usual route.
  await page.goto('/findings/settings');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const routes = page.getByRole('region', { name: 'Departments and follow-up' });
  await routes.getByLabel('Add a department').fill('operations');
  await expect(routes).toContainText('Already in the list');
  await routes.getByLabel('Add a department').fill(department);
  await routes.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(routes).toContainText(`${department} added to the department list.`, {
    timeout: 30_000,
  });
  await routes.getByRole('button', { name: `Change the route for ${department}` }).click();
  const level1 = routes.getByRole('textbox', { name: 'Level 1', exact: true });
  await level1.fill(manager);
  await level1.press('Enter');
  await routes.getByRole('button', { name: 'Save route' }).click();
  await expect(routes).toContainText(manager, { timeout: 30_000 });

  // Registering a finding: search, choose, and the route is one folded line.
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const form = page.locator('form.esh-finding-form');
  await form.getByLabel('Finding title', { exact: true }).fill(`v223 bench ${suffix}`);
  await form.getByLabel('What was found', { exact: true }).fill('Bench guard missing.');
  const picker = form.getByRole('combobox', { name: 'Accountable department' });
  // A near miss says so before anybody adds it.
  await picker.fill('Operatons');
  await expect(form.getByRole('option', { name: /Add “Operatons”/ })).toContainText(
    'Similar department exists: Operations',
  );
  await picker.fill(`Quality Lab ${suffix}`.slice(0, 11));
  await form.getByRole('option', { name: department, exact: true }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(form.locator('.esh-route-default')).toContainText(`${department} default`);
  await expect(form.locator('.esh-route-default')).toContainText(manager);
  await form.getByLabel('Required outcome', { exact: true }).fill('Refit the guard.');
  await form.getByLabel('Action Owner email', { exact: true }).fill(`bench.${suffix}@example.com`);
  await form.getByLabel('Due date', { exact: true }).fill('2026-12-15');
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page).toHaveURL(/\?saved=assigned/, { timeout: 30_000 });
  await expect(page.locator('.esh-detail-side details', { hasText: 'Full record' })).toContainText(
    manager,
  );

  // Corrected from the finding's menu, on the record.
  await page.getByRole('button', { name: 'More actions for this finding' }).click();
  const actions = page.getByRole('list', { name: 'Finding actions' });
  await actions.getByRole('button', { name: 'Edit finding' }).click();
  await page.getByLabel('Title').fill(`v223 bench ${suffix}, bay 2`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: `v223 bench ${suffix}, bay 2` })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole('button', { name: 'Back' }).click();
  await actions.getByRole('button', { name: 'Change risk' }).click();
  await page.getByLabel('Risk', { exact: true }).selectOption('high');
  await page.getByLabel('Why the risk changed').fill('Used by the night shift too');
  await page.getByRole('button', { name: 'Change risk' }).click();
  await expect(page.locator('.esh-context-facts')).toContainText('Risk High', {
    timeout: 30_000,
  });
});

test('v223 owner email is one setting, and Live sends without a release', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Administration; one layout is enough.');
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const admin = await apiAs('admin@tamco.local');

  try {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/more/admin/users');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    const setting = page.getByRole('region', { name: 'Owner email' });
    await expect(setting.getByRole('radio', { name: /Test mode/ })).toBeChecked();
    await setting.getByRole('radio', { name: /Live/ }).check();
    await setting.getByLabel('Reason for the change').fill('Pilot owners briefed');
    await setting.getByRole('button', { name: 'Save' }).click();
    await expect(setting).toContainText('Owner email is Live.', { timeout: 30_000 });

    // Assigning is now the whole act: the owner is emailed, nothing is held.
    const esh = await apiAs('izzul@tamco.local');
    const { data: saved } = await esh.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title: `v223 live ${suffix}`,
        description: 'Assigned while owner email is live.',
        reported_on: '2026-09-20',
        accountable_department_id: 'f0c05100-0000-4000-a000-000000000002',
        required_outcome: 'Put it right.',
        priority: 'normal',
        owner_email: `live.${suffix}@example.com`,
        due_date: '2026-12-15',
        escalation: [],
        no_further_escalation_reason: 'Fixture needs no route.',
      },
      p_assign: true,
    });
    if (!saved?.ok) throw new Error(JSON.stringify(saved));
    const { data: outbox } = await service()
      .from('esh_notification_outbox')
      .select('state')
      .eq('action_id', saved.action_id)
      .eq('event_type', 'owner_assignment')
      .single();
    expect(['queued', 'processing', 'provider_accepted']).toContain(outbox!.state);
  } finally {
    await admin.rpc('esh_set_owner_notices', {
      p_mode: 'held',
      p_reason: 'v223 e2e puts Test mode back',
    });
  }
});
