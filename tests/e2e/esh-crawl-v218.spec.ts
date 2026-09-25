import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const OPS = 'f0c05100-0000-4000-a000-000000000002';

/**
 * v218 — a crawl of the screens v214–v217 rebuilt.
 *
 * Five stages moved almost every surface in the module: the register's rows
 * and columns, a two-step form, a two-column finding page, a folded activity
 * trail, a new navigation. A suite that asserts behaviour does not notice a
 * page that scrolls sideways on a phone or a label that vanishes at night, so
 * each screen is opened again at both widths, in Day and in Night, and scanned.
 */

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

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function serious(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return result.violations
    .filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
    .flatMap((violation) =>
      violation.nodes.map((node) => `${violation.id}: ${node.target.join(' ')}`),
    );
}

/**
 * Whether the page really scrolls sideways.
 *
 * `documentElement.scrollWidth` is not the test: it counts the content of an
 * inner scroll container too, so a table that correctly scrolls inside its own
 * box reports the whole page as overflowing. This asks the page to scroll and
 * reads back whether it moved, which is what a person would experience.
 */
async function scrollsSideways(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const before = root.scrollLeft;
    root.scrollLeft = 9999;
    const moved = root.scrollLeft > 0;
    root.scrollLeft = before;
    return moved || document.body.scrollWidth > document.documentElement.clientWidth + 1;
  });
}

test('v218 every rebuilt Finding screen holds up at both widths, in Day and Night', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const suffix = randomBytes(3).toString('hex');
  const esh = await apiAs('izzul@tamco.local');
  const { data: saved } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v218 crawl finding ${suffix}`,
      description: 'Materials stored outside the designated zone, blocking the walkway.',
      reported_on: '2026-09-05',
      accountable_department_id: OPS,
      location: 'BR2 Warehouse',
      required_outcome: 'Clear the walkway and keep the route marked.',
      priority: 'normal',
      risk_level: 'high',
      owner_email: `crawl.${suffix}@example.com`,
      due_date: '2026-12-15',
      escalation: [{ level: 1, email: `lead.${suffix}@example.com` }],
    },
    p_assign: true,
  });
  if (!saved?.ok) throw new Error(JSON.stringify(saved));

  /*
   * Every tone on screen, rather than whichever the ambient data happens to
   * show. The first crawl passed locally and failed in the full suite because
   * this register held no owner-toned rows at the time.
   */
  const admin = await apiAs('admin@tamco.local');
  const { data: principal } = await esh
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', `crawl.${suffix}@example.com`)
    .single();
  await admin.rpc('esh_set_contact_access', {
    p_principal_id: principal!.id,
    p_enabled: true,
    p_reason: 'v218 crawl fixture',
  });
  const { data: settled } = await esh.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title: `v218 crawl settled ${suffix}`,
      description: 'A second finding, so the list carries more than one state.',
      reported_on: '2026-09-05',
      accountable_department_id: OPS,
      location: 'BR2 Workshop',
      required_outcome: 'Put it right.',
      priority: 'normal',
      risk_level: 'medium',
      owner_email: `crawl.${suffix}@example.com`,
      due_date: '2026-09-10',
      escalation: [],
      no_further_escalation_reason: 'Fixture needs no route.',
    },
    p_assign: true,
  });
  if (!settled?.ok) throw new Error(JSON.stringify(settled));

  await signIn(page);
  const paths = [
    '/findings',
    '/findings/register',
    '/findings/register?filter=open',
    '/findings/register?filter=overdue',
    '/findings/register?filter=closed',
    '/findings/new',
    `/findings/${saved.finding_id}`,
    '/findings/verification',
    '/findings/settings',
  ];

  for (const theme of ['light', 'dark'] as const) {
    await page.goto('/findings');
    await page.evaluate((value) => localStorage.setItem('tamco-focus-theme', value), theme);
    for (const path of paths) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      expect(await scrollsSideways(page), `${path} (${theme}) scrolls sideways`).toBe(false);
      expect(await serious(page), `${path} (${theme})`).toEqual([]);
    }
  }
});
