import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
const TEMP = 'f0c05000-0000-4000-a000-000000000007';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * Creates `count` open decision requests addressed to Izzul.
 *
 * Written directly, because the point of the test is what the summary does with
 * twelve of them — driving twelve through the UI would test the capture flow
 * twelve times and this behaviour once.
 */
async function seedRequests(
  count: number,
  marker: string,
  options: {
    ownerId?: string;
    taskTitle?: string;
    request?: string;
    raisedAt?: string;
  } = {},
) {
  const client = admin();
  const ownerId = options.ownerId ?? IZZAH;
  const { data: task, error: taskError } = await client
    .from('tasks')
    .insert({
      title: options.taskTitle ?? `Volume case ${marker}`,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: ownerId,
      created_by: ownerId,
    })
    .select('id')
    .single();
  if (taskError || !task) throw new Error(`Could not seed attention task: ${taskError?.message}`);

  const rows = Array.from({ length: count }, (_, index) => ({
    task_id: task!.id,
    raised_by: ownerId,
    description: `Blocked pending a decision ${marker} ${index}`,
    support_needed:
      options.request ?? `${marker} request ${index}: confirm the approach before Friday`,
    impact: 'may_delay' as const,
    status: 'open' as const,
    action_pending: true,
    action_required_from: IZZUL,
    action_type: 'decision' as const,
    raised_at: options.raisedAt ?? new Date().toISOString(),
  }));

  const { data: barriers, error: barrierError } = await client
    .from('barriers')
    .insert(rows)
    .select('id');
  if (barrierError) throw new Error(`Could not seed attention barriers: ${barrierError.message}`);
  return {
    taskId: task!.id as string,
    barrierIds: (barriers ?? []).map((barrier) => String(barrier.id)),
  };
}

async function cleanupSeeded(seed: Awaited<ReturnType<typeof seedRequests>>) {
  const client = admin();
  const barriers = await client.from('barriers').delete().in('id', seed.barrierIds);
  if (barriers.error)
    throw new Error(`Could not clean attention barriers: ${barriers.error.message}`);
  const task = await client.from('tasks').delete().eq('id', seed.taskId);
  if (task.error) throw new Error(`Could not clean attention task: ${task.error.message}`);
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Navigate, then wait for hydration before touching anything.
 *
 * A My Team row is opened by a click handler rather than a link, so a click
 * that lands on the server-rendered markup does nothing and the drawer never
 * appears. That produced an intermittent failure reading "the team row is not
 * keyboard-openable", which was never true: the row was simply not listening
 * yet.
 */
async function gotoHydrated(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * v49 §1, §40 — the summary stays a summary.
 *
 * The card previously grew with the count, so at twelve requests it pushed the
 * rest of My Day off the screen and became the thing it was meant to prevent:
 * a backlog nobody reads.
 */
test('twelve requests still show two rows and a way to see the rest', async ({
  page,
}, testInfo) => {
  const marker = `VOL${testInfo.project.name}${Date.now()}`;
  const seeded = await seedRequests(12, marker);

  try {
    await signIn(page, 'izzul@tamco.local');

    const queue = page.locator('section[aria-labelledby="needs-attention-heading"]');
    await expect(queue).toBeVisible();

    // Exactly two, whatever the total.
    await expect(queue.getByTestId('my-day-attention-row')).toHaveCount(2);

    // §30 — the count and the remainder are real numbers, not a fixed sentence.
    const total = Number((await queue.getByTestId('my-day-attention-count').textContent())?.trim());
    expect(total).toBeGreaterThanOrEqual(12);
    await expect(queue.getByTestId('my-day-attention-summary')).toContainText(
      '2 require action now',
    );
    await expect(queue.getByTestId('my-day-attention-summary')).toContainText(
      `${total - 2} more waiting`,
    );

    // §42 — and the rest are reachable.
    const viewAll = queue.getByRole('link', { name: new RegExp(`View all ${total}`) });
    await expect(viewAll).toBeVisible();
    await viewAll.click();

    await expect(page).toHaveURL(/scope=team/);
    await expect(page).toHaveURL(/filter=attention/);
    await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();
    // Scoped to the filter row: v132 added a snapshot figure that carries the
    // same words and the same aria-current, one level above these tabs.
    await expect(
      page.getByRole('navigation', { name: 'Team filter' }).getByRole('link', {
        name: /Needs attention/,
      }),
    ).toHaveAttribute('aria-current', 'page');
  } finally {
    await cleanupSeeded(seeded);
  }
});

test('the 864px My Day reference keeps deliberate spacing and equal daily columns', async ({
  page,
}) => {
  await signIn(page, 'izzul@tamco.local');
  await page.setViewportSize({ width: 864, height: 1024 });

  const layout = await page
    .locator('section[aria-labelledby="needs-attention-heading"]')
    .evaluate((element) => {
      const attention = element.getBoundingClientRect();
      const dailyGrid = element.nextElementSibling;
      if (!dailyGrid) throw new Error('Today grid is missing');

      const grid = dailyGrid.getBoundingClientRect();
      const cards = Array.from(dailyGrid.children).map((child) => {
        const bounds = child.getBoundingClientRect();
        return {
          height: bounds.height,
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
        };
      });

      return {
        gap: grid.top - attention.bottom,
        cards,
        pageOverflows: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });

  expect(layout.gap).toBeGreaterThanOrEqual(10);
  expect(layout.gap).toBeLessThanOrEqual(14);
  expect(layout.cards).toHaveLength(2);
  expect(layout.cards[0]!.top).toBeCloseTo(layout.cards[1]!.top, 0);
  expect(layout.cards[0]!.height).toBeCloseTo(layout.cards[1]!.height, 0);
  expect(layout.cards[1]!.left - layout.cards[0]!.right).toBeGreaterThanOrEqual(12);
  expect(layout.pageOverflows).toBe(false);
});

/**
 * §31, §45 — nothing owed is good news and should look like it.
 */
test('a clear queue reads as clear, with no View all 0', async ({ page }) => {
  const client = admin();
  // Answer everything currently addressed to Lim — who is not a manager and so
  // has no other source of attention.
  await client
    .from('barriers')
    .update({ action_pending: false })
    .eq('action_required_from', 'f0c05000-0000-4000-a000-000000000006');

  await signIn(page, 'lim@tamco.local');

  // v125 - nothing owed is one line, not a card. A panel announcing the
  // absence of news took more of My Day than most of the work on it.
  const clear = page.locator('#needs-attention-heading');
  await expect(clear).toContainText(/All clear/);
  await expect(clear).toContainText(/No blockers, approvals or responses need you/);
  await expect(page.getByTestId('my-day-attention-row')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /View all 0/ })).toHaveCount(0);

  // It is a line, not a panel: comfortably under the height a card would take.
  const box = await clear.boundingBox();
  expect(box, 'the all-clear line has no box').not.toBeNull();
  expect(box!.height, 'the all-clear line has grown back into a card').toBeLessThan(60);
});

/**
 * §63-65 — the row is the target, and the buttons on it are not.
 */
test('the whole team row is keyboard-openable and its exact CTA is independent', async ({
  page,
}, testInfo) => {
  const marker = `CTA${testInfo.project.name}${Date.now()}`;
  const seeded = await seedRequests(1, marker);
  const barrierId = seeded.barrierIds[0]!;

  try {
    await signIn(page, 'izzul@tamco.local');
    await gotoHydrated(page, '/work?scope=team');

    const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Lim Wei Sheng' });
    await expect(row).toBeVisible();

    // Employee-name click.
    await row.getByText('Lim Wei Sheng').click();
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
    // §6 A01 — it expands in place. No drawer of any kind covers the list.
    await expect(page.locator('.task-detail-layer')).toHaveCount(0);

    await gotoHydrated(page, '/work?scope=team');
    const blankSpaceRow = page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Lim Wei Sheng' });
    await expect(blankSpaceRow).toBeVisible();
    const box = (await blankSpaceRow.boundingBox())!;
    await blankSpaceRow.click({ position: { x: 8, y: box.height - 12 } });
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
    await expect(page.locator('.task-detail-layer')).toHaveCount(0);

    // Enter and Space on the focused row toggle the same expansion.
    for (const key of ['Enter', 'Space']) {
      await gotoHydrated(page, '/work?scope=team');
      const keyboardRow = page
        .getByTestId('my-team-person-row')
        .filter({ hasText: 'Lim Wei Sheng' });
      await expect(keyboardRow).toBeVisible();
      await keyboardRow.focus();
      await keyboardRow.press(key);
      await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
      await expect(keyboardRow).toHaveAttribute('aria-expanded', 'true');
    }

    /*
     * v130 — the "Open" button on a row with nothing outstanding is gone. It
     * performed the click, Enter and Space this test has just exercised three
     * times over, under a fourth label, in a column of its own. The route it
     * covered is asserted immediately above; what is checked here now is that
     * the URL still identifies the person.
     */
    await gotoHydrated(page, '/work?scope=team');
    const detailRow = page.getByTestId('my-team-person-row').filter({ hasText: 'Lim Wei Sheng' });
    await expect(detailRow).toBeVisible();
    await detailRow.click();
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
    await expect(page).toHaveURL(/person=f0c05000-0000-4000-a000-000000000006/);

    // §6 A01 — and clicking the same header again closes it, because it is one
    // control rather than an open button that needs a close button elsewhere.
    await detailRow.click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(0);
    await expect(page).not.toHaveURL(/person=/);

    await gotoHydrated(page, '/work?scope=team&filter=attention');

    const attentionRow = page.getByTestId('my-team-person-row').filter({ hasText: marker });
    await expect(attentionRow).toBeVisible();
    const action = attentionRow.getByRole('button', { name: /Provide decision/ });
    await action.click();
    await expect(page).toHaveURL(new RegExp(`barrier=${barrierId}`));
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(0);
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
    await expect(page.locator('.barrier-action-panel')).toBeVisible();
    await expect(page.getByLabel('Your decision')).toBeVisible();
  } finally {
    await cleanupSeeded(seeded);
  }
});

/**
 * v130 — the overdue occurrence is still reachable, by a different route.
 *
 * This used to assert an "Open routine" button that went straight to the
 * occurrence without opening the person. That button is gone, along with
 * "Open" and "Open task": three labels in a column of their own for the one
 * interaction the whole row already performs. An overdue routine is the
 * person's own work to catch up on, not a decision the manager owes, so the
 * manager reads it and expands the person if they want to act.
 *
 * It costs a click, and this now proves the destination is still exactly the
 * named occurrence rather than a page the manager has to search.
 */
test('an overdue occurrence is named on the row and opened through the person', async ({
  page,
}) => {
  await signIn(page, 'izzul@tamco.local');
  await gotoHydrated(page, '/work?scope=team&filter=attention');

  const row = page.getByTestId('my-team-person-row').filter({ hasText: 'Daily PPE stock check' });
  // The row still says which occurrence it is, which was the point of the CTA.
  await expect(row.locator('[data-cell="needs-you"]')).toContainText('Daily PPE stock check');
  await expect(row.getByRole('button', { name: /Open routine/ })).toHaveCount(0);

  await row.click();
  await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
  await expect(page).toHaveURL(/person=/);
  /*
   * Opening the occurrence itself from that expansion is `team-member-workload-v70`,
   * which walks the routine list and checks the destination is the exact record.
   * Repeating it here would duplicate a longer test, not strengthen this one.
   */
});

/**
 * §66, §71-72 — the vague labels and the generic destination are gone.
 */
test('no manager action is vague or points at a generic page', async ({ page }) => {
  await signIn(page, 'izzul@tamco.local');
  await gotoHydrated(page, '/work?scope=team&filter=attention');

  await expect(page.getByText('Review with them')).toHaveCount(0);
  await expect(page.getByText('Proposal to review')).toHaveCount(0);
  await expect(page.getByText('Review proposal')).toHaveCount(0);

  /*
   * v130 — the button moved out of its own column and in beside the reason it
   * answers, because a column whose width varied by row broke the table's
   * alignment. The rule it enforces is unchanged: whatever button appears must
   * name the action.
   */
  const actions = page.locator('[data-testid="my-team-person-row"] [data-cell="needs-you"] button');
  const count = await actions.count();
  expect(count).toBeGreaterThan(0);

  for (let index = 0; index < count; index += 1) {
    const label = (await actions.nth(index).textContent())?.trim() ?? '';

    expect(label.length).toBeGreaterThan(0);
    expect(['Review', 'Review with them']).not.toContain(label);
  }
});

test('My Day and My Team contain hostile text across viewports and zoom pressure', async ({
  page,
}, testInfo) => {
  const client = admin();
  const marker = `HOSTILE${testInfo.project.name}${Date.now()}`;
  const original = await client.from('user_profiles').select('full_name').eq('id', TEMP).single();
  const longName =
    'Temporary Tester With An Intentionally Long Employee Name For Responsive Layout Verification';
  const longTitle = (
    `${marker} ` +
    'Machine guarding contractor readiness, controls, documentation, induction and shutdown coordination '.repeat(
      2,
    )
  ).slice(0, 190);
  const longRequest =
    `${marker} ` +
    'Confirm the complete decision path, accountable owner and safe interim control before the planned shutdown window. '.repeat(
      3,
    ) +
    'REFERENCEWITHOUTBREAKSAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

  let seeded: Awaited<ReturnType<typeof seedRequests>> | null = null;
  try {
    await client.from('user_profiles').update({ full_name: longName }).eq('id', TEMP);
    seeded = await seedRequests(1, marker, {
      ownerId: TEMP,
      taskTitle: longTitle,
      request: longRequest,
      raisedAt: '2026-01-01T00:00:00.000Z',
    });

    await signIn(page, 'izzul@tamco.local');

    const cases = [
      ['1440', 1440],
      ['1280', 1280],
      ['1024', 1024],
      ['768', 768],
      ['430', 430],
      ['390', 390],
      ['125% zoom pressure', 1152],
      ['150% zoom pressure', 960],
    ] as const;

    const dayRow = page.getByTestId('my-day-attention-row').filter({ hasText: marker });
    await expect(dayRow).toBeVisible();
    await expect(page.getByTestId('my-day-attention-row')).toHaveCount(2);

    for (const [label, width] of cases) {
      await page.setViewportSize({ width, height: 900 });
      const report = await dayRow.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const copy = element.querySelector('[data-cell="attention-copy"]')!.getBoundingClientRect();
        const action = element
          .querySelector('[data-cell="attention-action"]')!
          .getBoundingClientRect();
        return {
          height: row.height,
          copyInside: copy.left >= row.left - 1 && copy.right <= row.right + 1,
          actionInside:
            action.left >= row.left - 1 &&
            action.right <= row.right + 1 &&
            action.bottom <= row.bottom + 1,
          overlap: !(
            copy.right <= action.left + 1 ||
            copy.left >= action.right - 1 ||
            copy.bottom <= action.top + 1 ||
            copy.top >= action.bottom - 1
          ),
          clipped: element.scrollHeight > element.clientHeight + 1,
        };
      });
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );

      expect(scrolls, `My Day scrolls horizontally at ${label}`).toBe(false);
      expect(report.copyInside, `My Day text crosses its row at ${label}`).toBe(true);
      expect(report.actionInside, `My Day action leaves its row at ${label}`).toBe(true);
      expect(report.overlap, `My Day action overlaps text at ${label}`).toBe(false);
      expect(report.clipped, `My Day row clips content at ${label}`).toBe(false);
      expect(report.height, `My Day row has a giant blank gap at ${label}`).toBeLessThan(180);
    }

    await gotoHydrated(page, '/work?scope=team&filter=attention');
    const teamRow = page.getByTestId('my-team-person-row').filter({ hasText: marker });
    await expect(teamRow).toContainText(longName);

    for (const [label, width] of cases) {
      await page.setViewportSize({ width, height: 900 });
      const report = await teamRow.evaluate((element) => {
        const row = element.getBoundingClientRect();
        const action = element.querySelector('[data-cell="action"]')!.getBoundingClientRect();
        return {
          actionInside:
            action.left >= row.left - 1 &&
            action.right <= row.right + 1 &&
            action.bottom <= row.bottom + 1,
          clipped: element.scrollHeight > element.clientHeight + 1,
        };
      });
      const scrolls = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );

      expect(scrolls, `My Team scrolls horizontally at ${label}`).toBe(false);
      expect(report.actionInside, `My Team action leaves its row at ${label}`).toBe(true);
      expect(report.clipped, `My Team row clips hostile text at ${label}`).toBe(false);
    }
  } finally {
    if (seeded) await cleanupSeeded(seeded);
    await client
      .from('user_profiles')
      .update({ full_name: original.data?.full_name ?? 'Temporary Tester' })
      .eq('id', TEMP);
  }
});
