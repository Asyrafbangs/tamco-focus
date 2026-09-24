import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v197 — ESH Home, the module switcher and Finding Management's first screens,
 * behind the restricted rollout (docs/specs/..._v1.3.md §4, §7, §24, §43).
 *
 * Locally, Izzul's account stands in for the one identity Production's first
 * setup enables; everybody else starts Off. FM01, FM02, FM03, FM103, FM104.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const LIM = 'f0c05000-0000-4000-a000-000000000006';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

function stamp(project: string) {
  return `${project.slice(0, 1)}${crypto.randomUUID().slice(0, 5)}`;
}

test('v197 ESH Home offers both modules to someone with Finding access', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  await signIn(page, 'izzul@tamco.local');

  // In TAMCO Focus, the switcher sits where the product name was.
  await expect(page.locator('.esh-switcher summary')).toHaveText('TAMCO Focus');
  await expect(page.getByRole('link', { name: 'ESH Home' })).toBeVisible();

  await page.goto('/esh');
  await expect(page.getByRole('heading', { name: 'Your ESH workspace' })).toBeVisible();
  const cards = page.locator('.esh-module-card');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('TAMCO Focus');
  await expect(cards.nth(1)).toContainText('Finding Management');

  await cards.nth(1).click();
  await expect(page).toHaveURL(/\/findings$/);
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
  // The Finding menu replaces Focus's: none of Focus's destinations are here.
  await expect(page.getByRole('navigation', { name: 'Finding Management' })).toBeVisible();
  await expect(page.locator('.rail')).toHaveCount(0);

  // And back: the switcher opens TAMCO Focus with its own menu.
  await page.locator('.esh-switcher summary').click();
  await page.getByRole('link', { name: /TAMCO Focus/ }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/);
});

test('v197 somebody without access sees TAMCO Focus exactly as before', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Server behaviour; one layout is enough.');
  await signIn(page, 'amer@tamco.local');

  await expect(page.locator('.product strong')).toHaveText('TAMCO Focus');
  await expect(page.locator('.esh-switcher')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'ESH Home' })).toHaveCount(0);

  await page.goto('/esh');
  // No teaser for a module they cannot open (§43.3).
  await expect(page.locator('.esh-module-card')).toHaveCount(1);
  await expect(page.getByText('Finding Management')).toHaveCount(0);

  for (const path of ['/findings', '/findings/register', '/findings/new', '/findings/closed']) {
    const response = await page.goto(path);
    expect(response?.status(), `${path} must not exist for him`).toBe(404);
  }
});

test('v197 a Verifier records and assigns a finding to an email address', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  test.setTimeout(120_000);
  const id = stamp(testInfo.project.name);
  const title = `v197 walkway ${id}`;
  const owner = `owner.${id}@example.com`;

  await signIn(page, 'izzul@tamco.local');
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // Assign with only a title: every missing part is named, and nothing saved.
  await page.getByLabel('Finding title').fill(title);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Assign finding' }).click();
  const summary = page.locator('.notice.error');
  await expect(summary).toContainText('Describe what was found.');
  await expect(summary).toContainText('Enter the Action Owner’s email.');
  await expect(summary).toContainText(
    'Add at least one Level 1 address, or record why there is no further escalation.',
  );
  await expect(page).toHaveURL(/\/findings\/new$/);

  // What was typed survives the refusal.
  await expect(page.getByLabel('Finding title')).toHaveValue(title);

  await page.getByLabel('What was found').fill('Materials extend into the marked walkway.');
  await page.getByLabel('Location').fill('BR2 Warehouse');
  await page.getByLabel('Accountable department').selectOption({ label: 'Operations' });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Required outcome').fill('Clear the walkway.');
  await page.getByLabel('Action Owner email').fill(`  ${owner.toUpperCase()} `);
  // The whole address, spelled out before assignment (§7).
  await expect(page.locator('.esh-recipient-confirm')).toContainText(owner.toUpperCase());
  await page.getByLabel('Risk', { exact: true }).selectOption('high');
  await page.getByLabel('Due date').fill('2026-12-15');
  const level1 = page.getByRole('textbox', { name: 'Level 1', exact: true });
  await level1.fill(`supervisor.${id}@example.com, SUPERVISOR.${id}@example.com`);
  await level1.press('Enter');
  await expect(page.locator('.esh-chip')).toHaveCount(1);

  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}\?saved=assigned/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText(owner.toUpperCase(), { exact: false }).first()).toBeVisible();
  await expect(page.locator('.esh-detail')).toContainText('Held — access not enabled');
  await expect(page.locator('.esh-detail')).toContainText(`supervisor.${id}@example.com`);

  // The register shows it where ESH has to act: the owner has not been told.
  await page.goto('/findings/register');
  const row = page.locator('.esh-register-row').filter({ hasText: title });
  await expect(row.locator('.esh-next-chip')).toHaveText('Owner not told yet');
  await expect(row).toContainText('High risk');
  await page.goto(`/findings/register?filter=open&q=${encodeURIComponent(id)}`);
  await expect(page.locator('.esh-register-row')).toHaveCount(1);
  await expect(page.getByText('1 finding in this view')).toBeVisible();
});

test('v197 a draft keeps what was entered and can be finished later', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The form is the same on a phone.');
  test.setTimeout(120_000);
  const id = stamp(testInfo.project.name);
  const title = `v197 draft ${id}`;

  await signIn(page, 'izzul@tamco.local');
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.getByLabel('Finding title').fill(title);
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Action Owner email').fill(`draft.${id}@example.com`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page).toHaveURL(/\?saved=draft/, { timeout: 30_000 });
  await expect(page.getByText('Nothing has been sent.')).toBeVisible();

  // Reopened from the register, the draft is the same form, filled in.
  await page.goto('/findings/register');
  await page.locator('.esh-register-row').filter({ hasText: title }).click();
  await page.getByLabel('What was found').fill('Found during the weekly walk.');
  await page.getByLabel('Accountable department').selectOption({ label: 'Operations' });
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByLabel('Action Owner email')).toHaveValue(`draft.${id}@example.com`);
  await page.getByLabel('Required outcome').fill('Put it right.');
  await page.getByLabel('Due date').fill('2026-12-20');
  await page.getByText('Stop escalation after this level').click();
  await page.getByLabel('Reason', { exact: true }).fill('Single-level route agreed');
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page).toHaveURL(/\?saved=assigned/, { timeout: 30_000 });
  await expect(page.locator('.esh-detail')).toContainText('Single-level route agreed');
});

test('v197 an administrator enables one person, with a department scope', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Administration; one layout is enough.');
  test.setTimeout(150_000);
  try {
    await signIn(page, 'admin@tamco.local');
    await page.goto(`/more/admin/users?user=${LIM}`);
    const section = page.getByRole('region', { name: 'Finding Management access' });
    await expect(section).toContainText('Off. Finding Management is hidden from this person.');

    await section.getByLabel(/Enable Finding Management for/).check();
    await section.getByLabel(/^Coordinator/).check();
    await section.getByLabel('Environment, Health & Safety').check();
    await section.getByLabel('Reason (recorded in the audit)').fill('v197 test');
    await section.getByRole('button', { name: 'Save Finding Management access' }).click();
    await expect(section.getByText('Finding Management access saved.')).toBeVisible();

    // The administrator has changed nothing about their own access.
    await page.goto('/findings/register');
    await expect(page.getByRole('heading', { name: 'Finding Register' })).toHaveCount(0);

    // Lim now has the module, within his scope.
    await signIn(page, 'lim@tamco.local');
    await expect(page.locator('.esh-switcher summary')).toHaveText('TAMCO Focus');
    await page.goto('/findings/new');
    const department = page.getByLabel('Accountable department');
    await expect(department.locator('option')).toHaveText([
      'Choose a department',
      'Environment, Health & Safety',
    ]);
  } finally {
    await service().from('esh_staff_access').update({ enabled: false }).eq('user_id', LIM);
  }
});
