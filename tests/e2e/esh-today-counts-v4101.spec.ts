import { createHash, randomBytes } from 'node:crypto';

import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/** Today shows six submissions before sending the reader to the full queue. */
const PREVIEW = 6;

/** A one-pixel JPEG: evidence has to be a real file for a real submission. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a' +
    'HBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAA' +
    'AAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/E' +
    'ABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJQA/9k=',
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
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

/** A guest session for the owner, opened the way a mailed link opens one. */
async function ownerSession(principalId: string, actionId: string) {
  const secret = randomBytes(32).toString('base64url');
  await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: principalId,
      purpose: 'owner_action',
      action_id: actionId,
      assignment_version: 1,
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
  const session = randomBytes(32).toString('base64url');
  const { data } = await service().rpc('esh_guest_exchange', {
    p_token: secret,
    p_new_session: session,
    p_existing_session: null,
    p_challenge: null,
    p_consume: true,
  });
  if (!data?.ok) throw new Error(`exchange failed: ${JSON.stringify(data)}`);
  return session;
}

/**
 * One finding, assigned, with its owner's correction waiting for ESH.
 *
 * The submission travels the owner's own path — grant, session, upload,
 * submit — because a row written straight into the table obeys none of the
 * rules a real submission does, and the queue being tested here is a queue of
 * real submissions.
 */
async function waitingForVerification(id: string, risk: 'high' | 'medium') {
  const owner = `today.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const title = `v4101 submitted correction ${id}`;
  const { data: saved, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title,
      description: 'A correction is waiting for ESH to check it.',
      reported_on: '2026-10-20',
      accountable_department_id: departments?.[0]?.id,
      location: 'Workshop',
      required_outcome: 'Refit the guard.',
      priority: 'normal',
      risk_level: risk,
      owner_email: owner,
      due_date: '2026-12-15',
      escalation: [],
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !saved?.ok)
    throw new Error(`assign failed: ${error?.message ?? JSON.stringify(saved)}`);

  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner.toLowerCase())
    .single();
  const admin = await apiAs('admin@tamco.local');
  await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'e2e',
  });

  const session = await ownerSession(contact!.id as string, saved.action_id as string);
  const client = service();
  const { data: started } = await client.rpc('esh_guest_start_upload', {
    p_session: session,
    p_action_id: saved.action_id as string,
    p_name: 'after.jpg',
    p_size: JPEG.byteLength,
  });
  const assetId = (started as { asset_id: string }).asset_id;
  const objectKey = (started as { object_key: string }).object_key;
  const { data: signed } = await client.storage
    .from('finding-evidence')
    .createSignedUploadUrl(objectKey);
  await client.storage
    .from('finding-evidence')
    .uploadToSignedUrl(signed!.path, signed!.token, JPEG, { contentType: 'image/jpeg' });
  await client.rpc('esh_guest_finish_upload', {
    p_session: session,
    p_asset_id: assetId,
    p_ok: true,
    p_type: 'image/jpeg',
    p_size: JPEG.byteLength,
    p_sha256: createHash('sha256').update(JPEG).digest('hex'),
    p_reason: null,
  });
  const { data: submission } = await client.rpc('esh_guest_submit', {
    p_session: session,
    p_action_id: saved.action_id as string,
    p_body: 'Guard refitted.',
    p_asset_ids: [assetId],
    p_reuse_message_id: null,
    p_client_key: `v4101-${id}-${crypto.randomUUID().slice(0, 8)}`,
  });
  if (!submission?.ok) throw new Error(`submit failed: ${JSON.stringify(submission)}`);

  return {
    title,
    findingId: saved.finding_id as string,
    actionId: saved.action_id as string,
    submissionId: submission.submission_id as string,
  };
}

/** Accept the correction, which closes a finding with nothing else open. */
async function accept(submissionId: string) {
  const izzul = await apiAs('izzul@tamco.local');
  const { data } = await izzul.rpc('esh_verify_submission', {
    p_submission_id: submissionId,
    p_decision: 'accepted',
    p_method: 'document_review',
    p_note: 'Proof is clear.',
    p_keep_due: true,
    p_due_date: null,
    p_due_time: null,
  });
  if (!data?.ok) throw new Error(`accept failed: ${JSON.stringify(data)}`);
  if (!data.closed) throw new Error('the fixture finding did not close on acceptance');
}

/** The number a Today counter is showing. */
async function counter(page: Page, label: string) {
  const signal = page.locator('.esh-signal').filter({ hasText: label }).first();
  await expect(signal).toBeVisible();
  return Number((await signal.locator('strong').innerText()).trim());
}

/** The total the register reports for the view it is showing. */
async function registerTotal(page: Page) {
  const foot = page.locator('.esh-register-foot p').first();
  await expect(foot).toContainText(/in this view/);
  const text = await foot.innerText();
  const match = /^(\d+)/.exec(text.trim());
  if (!match) throw new Error(`no total in "${text}"`);
  return Number(match[1]);
}

/*
 * Stage 1's own gate: "counts exactly match their drill-down rows".
 *
 * The number and the list are read through genuinely different paths — the
 * counter comes from the `esh_dashboard` procedure, the list from the register
 * views under the reader's own row-level security — so this compares two
 * independent answers to the same question rather than an assertion with
 * itself. Before this was fixed the protection counter linked to every open
 * finding: it said three and the page behind it held forty.
 */
test('v4101 every Today counter lands on a list holding exactly what it counted', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the counters is enough.');

  const id = `d${crypto.randomUUID().slice(0, 6)}`;
  // High risk, assigned, and nothing verified standing in the way: this is one
  // of the findings the protection counter is about.
  const significant = await waitingForVerification(id, 'high');

  await signIn(page);
  await page.goto('/findings');
  await expect(page.getByRole('heading', { name: 'Today', level: 1 })).toBeVisible();

  const protection = await counter(page, 'Significant risks without verified protection');
  const overdue = await counter(page, 'Overdue owner actions');
  const awaiting = await counter(page, 'Waiting for ESH verification');
  expect(protection).toBeGreaterThan(0);
  expect(awaiting).toBeGreaterThan(0);

  await page.locator('.esh-signal').filter({ hasText: 'without verified protection' }).click();
  await expect(page).toHaveURL(/filter=unprotected/);
  expect(await registerTotal(page)).toBe(protection);
  // And the finding that put it there is in the list that the number opened.
  await page.goto(
    `/findings/register?filter=unprotected&q=${encodeURIComponent(significant.title)}`,
  );
  await expect(page.getByText(significant.title, { exact: true })).toBeVisible();

  await page.goto('/findings');
  await page.locator('.esh-signal').filter({ hasText: 'Overdue owner actions' }).click();
  await expect(page).toHaveURL(/filter=overdue/);
  expect(await registerTotal(page)).toBe(overdue);

  await page.goto('/findings');
  await page.locator('.esh-signal').filter({ hasText: 'Waiting for ESH verification' }).click();
  await expect(page).toHaveURL(/queue=verification/);
  await expect(page.getByRole('heading', { name: 'To verify', level: 1 })).toBeVisible();
  const waiting = page.getByRole('list', { name: 'Waiting for verification' }).locator('> li');
  await expect(waiting).toHaveCount(awaiting);

  // The disabled counter has no drill-down, and says why rather than inviting
  // a click that would go nowhere.
  const reports = page.locator('.esh-signal').filter({ hasText: 'New reports' });
  await page.goto('/findings');
  await expect(reports).toHaveAttribute('data-disabled', 'true');
  await expect(reports.locator('a')).toHaveCount(0);
});

/*
 * The queue is the only place a submitted correction can be seen, so it shows
 * all of them.
 *
 * Today's card shows six. When the card was the queue as well, submission
 * seven onwards existed in the database and nowhere on screen, and the card
 * gave no sign that it was holding anything back.
 */
test('v4101 the verification queue shows every waiting submission, not a page of six', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the queue is enough.');
  test.setTimeout(180_000);

  const base = `q${crypto.randomUUID().slice(0, 5)}`;
  const made: string[] = [];
  for (let index = 0; index < PREVIEW + 1; index += 1) {
    const arranged = await waitingForVerification(`${base}${index}`, 'medium');
    made.push(arranged.title);
  }

  await signIn(page);
  await page.goto('/findings');
  const awaiting = await counter(page, 'Waiting for ESH verification');
  expect(awaiting).toBeGreaterThan(PREVIEW);

  // The card is a preview, and it says so with the number it is not showing.
  const card = page
    .locator('section')
    .filter({ has: page.getByRole('heading', { name: 'To verify' }) });
  await expect(card.locator('.esh-today-list > li')).toHaveCount(PREVIEW);
  await expect(
    card.getByRole('link', { name: `${awaiting} waiting · see them all` }),
  ).toBeVisible();

  await card.getByRole('link', { name: 'Open queue' }).click();
  await expect(page).toHaveURL(/queue=verification/);
  const rows = page.getByRole('list', { name: 'Waiting for verification' }).locator('> li');
  await expect(rows).toHaveCount(awaiting);
  await expect(page.locator('.esh-register-foot')).toContainText(`${awaiting} waiting`);
  // Every one of this test's own submissions is on the page, including the
  // ones past the preview.
  for (const title of made) {
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  }

  // What the old page could do, this one still can: choose a department, read
  // the version and the file count, and see an urgent one marked.
  await expect(page.getByLabel('Department')).toBeVisible();
  // This test's own row, not whichever row happens to be first: the queue is
  // oldest-first and holds every other spec's fixtures too.
  const mine = rows.filter({ hasText: made[0] });
  await expect(mine).toHaveCount(1);
  await expect(mine).toContainText('Version 1');
  await expect(mine).toContainText('1 file');
  await page.getByLabel('Department').selectOption('unassigned');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/department=unassigned/);
  await expect(page.getByRole('heading', { name: 'To verify', level: 1 })).toBeVisible();
});

/*
 * A menu item has to arrive where its own label says.
 *
 * `/findings` became Today, and "Overview by department" in the register's
 * tools still pointed at it: the reader asked for a department breakdown and
 * got the day's queues, which carry no departments at all.
 */
test('v4101 the register tools reach the department overview they name', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the menu is enough.');

  await signIn(page);
  await page.goto('/findings/register?filter=open');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.getByRole('button', { name: 'More register tools' }).click();
  await page.getByRole('menuitem', { name: 'Overview by department' }).click();
  await expect(page).toHaveURL(/\/findings\/patterns\/insights/);
  await expect(page.getByText('By accountable department')).toBeVisible();
});

/*
 * The records views Stage 1 asks the canonical list to offer.
 *
 * "All records" is the one people reach for when they are looking something up
 * rather than working through a queue, so it must hold closed findings too.
 */
test('v4101 Findings offers waiting verification and all records as named views', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One reading of the views is enough.');

  const id = `r${crypto.randomUUID().slice(0, 6)}`;
  const arranged = await waitingForVerification(id, 'medium');
  // One record that no open view can carry, so "All records" has something to
  // prove it is not just another name for the open list.
  const settled = await waitingForVerification(`${id}z`, 'medium');
  await accept(settled.submissionId);

  await signIn(page);
  await page.goto('/findings/register?filter=open');
  const views = page.getByRole('navigation', { name: 'Register views' }).getByRole('link');
  for (const view of [
    'Needs attention',
    'All open',
    'Overdue',
    'Waiting verification',
    'Not assessed',
    'All records',
  ]) {
    await expect(views.filter({ hasText: view })).toHaveCount(1);
  }

  await views.filter({ hasText: 'Waiting verification' }).click();
  await expect(page).toHaveURL(/filter=verification/);
  const verification = await registerTotal(page);
  await expect(page.locator('.esh-register-foot p').first()).toContainText(/actions? in this view/);
  await page.goto(`/findings/register?filter=verification&q=${encodeURIComponent(arranged.title)}`);
  await expect(page.getByText(arranged.title, { exact: true })).toBeVisible();

  // The same obligation the counter reports, counted the same way.
  await page.goto('/findings');
  expect(await counter(page, 'Waiting for ESH verification')).toBe(verification);

  await page.goto('/findings/register?filter=all');
  const everything = await registerTotal(page);
  const closedQuery = `q=${encodeURIComponent(settled.title)}`;
  await page.goto(`/findings/register?filter=all&${closedQuery}`);
  await expect(page.getByText(settled.title, { exact: true })).toBeVisible();

  await page.goto('/findings/register?filter=open');
  const open = await registerTotal(page);
  // The closed one is the difference: present in every record, absent from
  // the open list, and the totals say the same thing.
  await page.goto(`/findings/register?filter=open&${closedQuery}`);
  await expect(page.getByText(settled.title, { exact: true })).toHaveCount(0);
  expect(everything).toBeGreaterThan(open);
});
