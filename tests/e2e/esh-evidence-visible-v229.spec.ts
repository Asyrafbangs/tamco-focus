import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/** A real 1x1 PNG, so the browser has actual bytes to decode. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

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
 * v229 — a finding's own photograph is shown as a photograph.
 *
 * The conversation already rendered image attachments as pictures; the lists
 * carrying the finding's original evidence showed a filename and a grey icon,
 * so the Action Owner could not see the thing they were being asked to put
 * right. Reported from production on F-005.
 */
test('v229 the original photograph is visible to ESH and to the owner', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One pass over the two screens is enough.');
  test.setTimeout(150_000);
  const suffix = randomBytes(3).toString('hex');
  const title = `v229 blocked walkway ${suffix}`;
  const owner = `photo.owner.${suffix}@example.com`;

  await signIn(page);
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const form = page.locator('form.esh-finding-form');

  await form.getByLabel('Finding title', { exact: true }).fill(title);
  await form.getByLabel('What was found', { exact: true }).fill('Pallets across the walkway.');
  await form.getByLabel('Location', { exact: true }).fill('BR2 Warehouse');
  await chooseDepartment(page, 'Operations');
  await form
    .locator('input[type=file]')
    .first()
    .setInputFiles({ name: 'walkway.png', mimeType: 'image/png', buffer: PNG });
  await expect(form.getByText('walkway.png')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await form.getByLabel('Required outcome', { exact: true }).fill('Clear the walkway.');
  await form.getByLabel('Action Owner email', { exact: true }).fill(owner);
  await form.getByLabel('Due date', { exact: true }).fill('2026-12-30');
  // Operations carries no route in this fixture, so the finding states its own
  // reason for stopping — a finding must have a route or say why it has none.
  await form.getByText('Stop escalation after this level').click();
  await form.getByLabel('Reason', { exact: true }).fill('Single-level route agreed.');
  await page.getByRole('button', { name: 'Assign finding' }).click();
  await expect(page).toHaveURL(/\/findings\/[0-9a-f-]{36}/, { timeout: 30_000 });

  /*
   * Not that an <img> exists — that passed the whole time the picture was a
   * grey icon somewhere else on the page. `naturalWidth` is only non-zero once
   * the browser has fetched and decoded the bytes, which is the whole claim:
   * the file route signed a URL and the image came back.
   */
  const thumb = page.locator('.esh-original-evidence img.esh-file-thumb').first();
  await expect(thumb).toBeVisible();
  await expect
    .poll(() => thumb.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 15_000 })
    .toBeGreaterThan(0);

  // The owner sees it too, which is the half that actually matters.
  const db = service();
  const { data: action, error } = await db
    .from('esh_finding_actions')
    .select('id, esh_findings!inner(title)')
    .eq('esh_findings.title', title)
    .single();
  if (error) throw new Error(`action read failed: ${error.message}`);

  const { data: principal } = await db
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  // The rollout is restricted, so this contact is cleared before a link can be
  // used at all — the same two deliberate acts §43 requires in production.
  const admin = await apiAs('admin@tamco.local');
  const cleared = await admin.rpc('esh_set_contact_access', {
    p_principal_id: principal!.id,
    p_enabled: true,
    p_reason: 'v229 fixture: owner of this action',
  });
  if (!cleared.data?.ok) throw new Error(`clearing failed: ${JSON.stringify(cleared.data)}`);

  const secret = randomBytes(32).toString('base64url');
  await db.from('esh_access_grants').insert({
    organization_id: ORGANIZATION,
    principal_id: principal!.id,
    purpose: 'owner_action',
    action_id: action!.id,
    assignment_version: 1,
    token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
    issued_reason: 'notification',
    expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
  });

  const guest = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const ownerPage = await guest.newPage();
  await ownerPage.goto(`/respond/access?for=action#${secret}`);
  await expect(ownerPage.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = ownerPage.getByRole('button', { name: 'Open action' });
  if (await open.count()) await open.click();
  await expect(ownerPage.locator('.guest-chat-head')).toBeVisible({ timeout: 30_000 });

  const ownerThumb = ownerPage.locator('.guest-original-files img.esh-file-thumb').first();
  await expect(ownerThumb).toBeVisible();
  await expect
    .poll(() => ownerThumb.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  await guest.close();
});
