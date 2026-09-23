import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v198 — an Action Owner's email links, My Actions and the conversation
 * (docs/specs/..._v1.3.md §9-§12, §18-§20, §43.4). FM03-FM09, FM11, FM40-FM45,
 * FM106.
 *
 * Owners have no account. Work is arranged through the procedures as the
 * local Verifier and administrator would; the email itself is covered by
 * tests/integration/esh-dispatch-v198, so here a link is minted the way the
 * worker mints one — a random secret whose hash is stored — and opened in a
 * browser that has never signed in.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

async function apiAs(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
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
  return `${project.slice(0, 1)}${crypto.randomUUID().slice(0, 6)}`;
}

interface Arranged {
  owner: string;
  principalId: string;
  walkway: { actionId: string; findingId: string; title: string };
  exit: { actionId: string; findingId: string; title: string };
}

/** Two actions for one owner, assigned by the local Verifier. */
async function arrange(id: string, options: { enable: boolean }): Promise<Arranged> {
  const owner = `owner.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const assign = async (title: string, priority: string, due: string) => {
    const { data, error } = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title,
        description: 'Materials extend into the marked walkway.',
        reported_on: '2026-09-18',
        accountable_department_id: departments?.[0]?.id,
        location: 'BR2 Warehouse',
        required_outcome: 'Keep the marked walkway clear.',
        priority,
        owner_email: owner,
        due_date: due,
        no_further_escalation_reason: 'e2e',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error || !data?.ok)
      throw new Error(`assign failed: ${error?.message ?? JSON.stringify(data)}`);
    return { actionId: data.action_id as string, findingId: data.finding_id as string, title };
  };
  const walkway = await assign(`v198 walkway ${id}`, 'normal', '2026-12-15');
  const exit = await assign(`v198 exit ${id}`, 'urgent', '2026-12-20');
  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  if (options.enable) {
    const admin = await apiAs('admin@tamco.local');
    const { data } = await admin.rpc('esh_set_contact_access', {
      p_principal_id: contact!.id,
      p_enabled: true,
      p_reason: 'e2e',
    });
    if (!data?.ok) throw new Error('enable failed');
  }
  return { owner, principalId: contact!.id, walkway, exit };
}

/** A link as the worker mints one: a random secret, of which only the hash is kept. */
async function mintLink(
  arranged: Arranged,
  purpose: 'owner_action' | 'owner_inbox',
  actionId?: string,
): Promise<{ secret: string; path: string }> {
  const secret = randomBytes(32).toString('base64url');
  const { error } = await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: arranged.principalId,
      purpose,
      action_id: purpose === 'owner_action' ? actionId : null,
      assignment_version: purpose === 'owner_action' ? 1 : null,
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
  if (error) throw new Error(`mint failed: ${error.message}`);
  return {
    secret,
    path: `/respond/access?for=${purpose === 'owner_inbox' ? 'actions' : 'action'}#${secret}`,
  };
}

async function consumedAt(secret: string) {
  const { data } = await service()
    .from('esh_access_grants')
    .select('consumed_at')
    .eq('token_hash', createHash('sha256').update(secret, 'utf8').digest('hex'))
    .single();
  return data?.consumed_at ?? null;
}

async function openLink(page: Page, path: string, button: 'Open action' | 'Open my actions') {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = page.getByRole('button', { name: button });
  await expect(open).toBeEnabled();
  await open.click();
}

test('v198 an owner opens their email link in a browser that never signed in', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
    'Two layouts.',
  );
  test.setTimeout(120_000);
  const arranged = await arrange(stamp(testInfo.project.name), { enable: true });
  const actionLink = await mintLink(arranged, 'owner_action', arranged.walkway.actionId);

  // A scanner fetching the address spends nothing (FM40).
  const fetched = await page.request.get(actionLink.path);
  expect(fetched.status()).toBe(200);
  await page.request.head(actionLink.path);
  expect(await consumedAt(actionLink.secret)).toBeNull();
  // And the page it gets carries no secret and no private content.
  expect(await fetched.text()).not.toContain(arranged.walkway.title);

  await openLink(page, actionLink.path, 'Open action');
  await expect(page).toHaveURL(new RegExp(`/respond/actions/${arranged.walkway.actionId}$`));
  // The secret has left the address bar (§18).
  expect(page.url()).not.toContain(actionLink.secret);
  await expect(page.getByRole('heading', { name: arranged.walkway.title })).toBeVisible();
  await expect(page.locator('.guest-chat-meta')).toContainText('Assigned');
  await expect(page.getByText('Keep the marked walkway clear.')).toBeVisible();
  await expect(page.locator('.guest-identity')).toContainText(arranged.owner);
  // No way into the staff application from here (§11).
  await expect(page.getByRole('link', { name: 'ESH Home' })).toHaveCount(0);
  await expect(page.locator('.esh-switcher, .rail')).toHaveCount(0);

  // An update is a message; it starts the work and submits nothing (FM16).
  await page.getByLabel('Message ESH').fill('Done. We are moving the materials this morning.');
  await page.getByRole('button', { name: 'Send update' }).click();
  await expect(page.locator('.esh-message.mine')).toContainText(
    'Done. We are moving the materials this morning.',
  );
  await expect(page.locator('.guest-chat-meta')).toContainText('In progress');

  // An action link is not an inbox, even by editing the address (FM09).
  await page.getByRole('link', { name: 'My Actions', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your link opens one action' })).toBeVisible();
  await page.goto(`/respond/my-actions?email=${encodeURIComponent('someone@example.com')}`);
  await expect(page.getByRole('heading', { name: 'Your link opens one action' })).toBeVisible();
  await expect(page.getByText(arranged.exit.title)).toHaveCount(0);

  // The inbox link, from the same email, opens on its own (FM11) and lists
  // every open action for this address, Urgent first (FM05, FM06).
  const inboxLink = await mintLink(arranged, 'owner_inbox');
  await openLink(page, inboxLink.path, 'Open my actions');
  await expect(page).toHaveURL(/\/respond\/my-actions$/);
  await expect(page.getByRole('heading', { name: 'My Actions' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Needs my action (2)' })).toBeVisible();
  const rows = page.locator('.guest-action-row');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(arranged.exit.title);
  await expect(rows.nth(0)).toContainText('Urgent priority');
  await expect(rows.nth(1)).toContainText(arranged.walkway.title);
  await expect(rows.nth(1)).toContainText('In progress');

  // Into a row and back again (FM08).
  await rows.nth(0).click();
  await expect(page.getByRole('heading', { name: arranged.exit.title })).toBeVisible();
  await page.getByRole('link', { name: 'My Actions', exact: true }).click();
  await expect(page.locator('.guest-action-row')).toHaveCount(2);

  // End access on a shared device (§10).
  await page.getByRole('button', { name: 'End access on this device' }).click();
  await expect(page.getByRole('heading', { name: 'Access ended on this device' })).toBeVisible();
  await page.goto('/respond/my-actions');
  await expect(
    page.getByRole('heading', { name: 'Your access on this device has ended' }),
  ).toBeVisible();
});

test('v198 a spent link elsewhere offers a fresh one, and nothing says who has work', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Server behaviour; one layout is enough.');
  test.setTimeout(120_000);
  const arranged = await arrange(stamp(testInfo.project.name), { enable: true });
  const link = await mintLink(arranged, 'owner_action', arranged.walkway.actionId);

  await openLink(page, link.path, 'Open action');
  await expect(page).toHaveURL(new RegExp(`/respond/actions/${arranged.walkway.actionId}$`));

  // The same link in a second browser (FM43).
  const other = await browser.newContext();
  const second = await other.newPage();
  await openLink(second, link.path, 'Open action');
  await expect(second.getByRole('heading', { name: 'Let’s get you a fresh link' })).toBeVisible();
  await expect(second.getByText(arranged.walkway.title)).toHaveCount(0);
  await second.getByRole('button', { name: 'Send me a new link' }).click();
  await expect(second.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  // Only to the address on record (§19).
  const { data: requested } = await service()
    .from('esh_notification_outbox')
    .select('recipient_principal_id, link_intents')
    .eq('event_type', 'access_link')
    .eq('action_id', arranged.walkway.actionId);
  expect(requested).toEqual([
    { recipient_principal_id: arranged.principalId, link_intents: ['owner_action'] },
  ]);

  // By email: the same words for an address with work and one without (FM44).
  const answers: string[] = [];
  for (const email of [arranged.owner, `nobody.${crypto.randomUUID().slice(0, 6)}@example.com`]) {
    await second.goto('/respond/request-link');
    await expect(second.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await second.getByLabel('Your email address').fill(email);
    await second.getByRole('button', { name: 'Send me a link' }).click();
    const answer = second.locator('.guest-sent');
    await expect(answer).toBeVisible();
    answers.push((await answer.textContent()) ?? '');
  }
  expect(answers[0]).toBe(answers[1]);
  await other.close();
});

test('v198 ESH writes to the owner; the email waits for access and a deliberate release', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Staff screens; one layout is enough.');
  test.setTimeout(150_000);
  const arranged = await arrange(stamp(testInfo.project.name), { enable: false });

  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${arranged.walkway.findingId}`);
  const notices = page.getByRole('region', { name: 'Notifications' });
  await expect(notices).toContainText('Held — access not enabled');
  await expect(notices.getByRole('button', { name: /^Release the/ })).toHaveCount(0);

  await page.getByLabel('Message the owner').fill('Please include the whole walkway in the photo.');
  await page.getByRole('button', { name: 'Send to owner' }).click();
  await expect(page.locator('.esh-message.mine')).toContainText(
    'Please include the whole walkway in the photo.',
  );

  // An administrator switches the contact on. Nothing is sent by that (FM106).
  await signIn(page, 'admin@tamco.local');
  await page.goto(`/more/admin/contacts?q=${encodeURIComponent(arranged.owner)}`);
  await page.getByRole('link', { name: new RegExp(arranged.owner) }).click();
  const access = page.getByRole('region', { name: 'Finding Management access' });
  await expect(access).toBeVisible();
  await access.getByLabel(/Enable email-link access/).check();
  await access.getByLabel('Reason (recorded in the audit)').fill('v198 e2e');
  await access.getByRole('button', { name: 'Save contact access' }).click();
  await expect(access.getByText(/Access on\. Nothing has been sent/)).toBeVisible();
  const { data: stillHeld } = await service()
    .from('esh_notification_outbox')
    .select('state')
    .eq('action_id', arranged.walkway.actionId)
    .eq('event_type', 'owner_assignment')
    .single();
  expect(stillHeld!.state).toBe('held_rollout');

  // ESH releases it, from the finding.
  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/findings/${arranged.walkway.findingId}`);
  await page
    .getByRole('button', { name: `Release the assignment email to ${arranged.owner}` })
    .click();
  await expect(notices).not.toContainText('Held —', { timeout: 30_000 });
  const { data: released } = await service()
    .from('esh_notification_outbox')
    .select('state, released_by')
    .eq('action_id', arranged.walkway.actionId)
    .eq('event_type', 'owner_assignment')
    .single();
  expect(['queued', 'processing', 'provider_accepted']).toContain(released!.state);
  expect(released!.released_by).toBe('f0c05000-0000-4000-a000-000000000002');
});

test('v198 a staff login and an owner link never lend each other anything', async ({
  page,
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Server behaviour; one layout is enough.');
  test.setTimeout(120_000);
  const arranged = await arrange(stamp(testInfo.project.name), { enable: true });

  // Signed in as staff, then opening an owner's link in the same browser (FM45).
  await signIn(page, 'izzul@tamco.local');
  const link = await mintLink(arranged, 'owner_action', arranged.walkway.actionId);
  await openLink(page, link.path, 'Open action');
  await expect(page.locator('.guest-identity')).toContainText(arranged.owner);
  // The staff login is untouched, and is still only itself.
  await page.goto('/findings/register');
  await expect(page.getByRole('heading', { name: 'Finding Register' })).toBeVisible();
  await expect(page.locator('.esh-account')).toContainText('Izzul');

  // A staff login alone opens no owner's page.
  const staffOnly = await browser.newContext();
  const fresh = await staffOnly.newPage();
  await signIn(fresh, 'izzul@tamco.local');
  await fresh.goto('/respond/my-actions');
  await expect(
    fresh.getByRole('heading', { name: 'Your access on this device has ended' }),
  ).toBeVisible();
  await fresh.goto(`/respond/actions/${arranged.walkway.actionId}`);
  await expect(fresh.getByText(arranged.walkway.title)).toHaveCount(0);
  await staffOnly.close();
});
