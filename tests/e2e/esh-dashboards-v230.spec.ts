import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const OPS = 'f0c05100-0000-4000-a000-000000000002';

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

test('v230 the ESH dashboard is back in the sidebar and shows movement', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the panels is enough.');
  await signIn(page);
  await page.goto('/findings/register');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  // v227 took Overview out of the sidebar; v230 puts a dashboard worth having
  // back into it.
  const nav = page.locator('.esh-subnav, nav').filter({ hasText: 'Register' }).first();
  await nav.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/findings$/);
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();

  // Counters alone were the old Overview. These are the four that say how it
  // is going rather than how many there are.
  for (const heading of [
    'Recorded against closed',
    'Closed, and closed on time',
    'How long it has been open',
  ]) {
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(page.locator('.esh-dash-chart tbody tr')).toHaveCount(6);
});

test('v230 the public dashboard opens with no account and names nobody', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The page is the same at both widths.');
  test.setTimeout(120_000);
  const suffix = randomBytes(3).toString('hex');
  const title = `v230 public fixture ${suffix}`;
  const location = `BR9 Secret Yard ${suffix}`;

  // A finding with a distinctive title, place and owner, so the assertions
  // below are about this data and not about an empty page.
  const esh = await apiAs('izzul@tamco.local');
  const saved = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'Pallets across the fire exit.',
      reported_on: '2026-09-21',
      accountable_department_id: OPS,
      location,
      required_outcome: 'Clear it.',
      priority: 'high',
      risk_level: 'high',
      owner_email: `public.owner.${suffix}@example.com`,
      due_date: '2026-12-30',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
  });
  if (!saved.data?.ok) throw new Error(`assign failed: ${JSON.stringify(saved.data)}`);

  /*
   * A brand-new context with no cookies and no storage: this is a stranger
   * with the address and nothing else, which is exactly who the page is for.
   */
  const stranger = await browser.newContext();
  const page = await stranger.newPage();
  const response = await page.goto('/safety-performance');
  expect(response?.status(), 'the page must not redirect to sign-in').toBe(200);
  await expect(page).toHaveURL(/\/safety-performance$/);
  await expect(page.getByRole('heading', { name: 'Safety performance', level: 1 })).toBeVisible();

  // It shows the figures.
  await expect(page.locator('.public-dash-figure').first()).toContainText(/\d/);
  await expect(page.getByRole('heading', { name: 'Recorded against closed' })).toBeVisible();

  /*
   * And nothing else. This is the whole safety case for serving it without a
   * front door: the finding exists and is counted, but its title, its place,
   * its owner, its reference and its department must appear nowhere in what a
   * stranger receives.
   */
  const body = (await page.locator('body').innerText()).toLowerCase();
  for (const secret of [title.toLowerCase(), location.toLowerCase(), 'example.com', 'operations']) {
    expect(body, `the public page must not contain ${secret}`).not.toContain(secret);
  }
  expect(body).not.toMatch(/f-\d{3}/);

  // Search engines are told to leave it alone unless somebody decides otherwise.
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);

  // And it is a dead end: no route into the application from it.
  const hrefs = await page
    .locator('a')
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute('href') ?? ''),
    );
  expect(
    hrefs.filter((href) => href.startsWith('/findings') || href.startsWith('/respond')),
  ).toEqual([]);
  await stranger.close();
});
