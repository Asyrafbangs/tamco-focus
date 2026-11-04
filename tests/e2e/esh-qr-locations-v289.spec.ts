import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v289 — a coordinator creates the place a sticker points at.
 *
 * The procedure's rules are held by `esh_qr_locations_v289.test.sql`. What
 * only a browser can establish is the part that was missing entirely until
 * now: that there is a screen at all, that it hands back an address somebody
 * can print, and that retiring one is a button rather than a database query.
 *
 * The address matters more than it looks. A sticker is printed from it, so it
 * has to be complete and visible — a truncated URL on screen is a QR code
 * that points nowhere.
 */

function service(): SupabaseClient {
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
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test('v289 a coordinator adds a QR location, gets its address, and retires it', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One flow; layout is covered by the crawl.');
  test.setTimeout(150_000);

  const label = `v289 Press line ${crypto.randomUUID().slice(0, 8)}`;

  await signIn(page, 'izzul@tamco.local');
  await page.goto('/findings/settings?tab=qr-locations');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const card = page.locator('.esh-qr-locations');
  await expect(card.getByRole('heading', { name: 'QR locations' })).toBeVisible();

  await card.getByLabel('Where the sticker goes').fill(label);
  await card.getByRole('button', { name: 'Add location' }).click();

  // Wait for the save to be acknowledged before reading anything back: a
  // click followed by a navigation cancels the server action.
  await expect(card.getByText(/Location added/)).toBeVisible({ timeout: 30_000 });

  const row = card.locator('.esh-qr-list > li', { hasText: label });
  await expect(row).toHaveCount(1);

  /*
   * The whole address, visible. This is what is printed onto a sticker, and
   * the code in it must not be derivable from the label — a code anybody who
   * has walked through the building could guess is a code they can post to.
   */
  const address = await row.locator('code').innerText();
  expect(address).toMatch(/\/report\/[A-Za-z0-9_-]{16}$/);
  const code = address.split('/report/')[1]!;
  expect(code.toLowerCase()).not.toContain('press');

  // What the database holds, rather than what the page says it does.
  const db = service();
  const { data: rows } = await db
    .from('esh_qr_locations')
    .select('id, public_code, active')
    .eq('display_label', label);
  expect(rows).toHaveLength(1);
  expect(rows![0]).toMatchObject({ public_code: code, active: true });

  // Retiring is a button, and it is the only way a sticker goes out of use.
  await row.getByRole('button', { name: 'Retire' }).click();
  await expect(card.getByText(new RegExp(`${label} will no longer accept reports`))).toBeVisible({
    timeout: 30_000,
  });

  const { data: after } = await db
    .from('esh_qr_locations')
    .select('active, retired_at')
    .eq('display_label', label)
    .single();
  // Kept, not deleted: a sticker already on a machine cannot be recalled.
  expect(after?.active).toBe(false);
  expect(after?.retired_at).not.toBeNull();

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.esh-qr-list > li', { hasText: label })).toHaveCount(0);
  await expect(page.locator('.esh-qr-retired')).toContainText(label);
});
