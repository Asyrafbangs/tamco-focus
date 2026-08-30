import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
/** Izzah's Active Goal. Deliberately not one of Amer's — other specs read his. */
const IZZAH_GOAL = 'f0c06000-0000-4000-a000-000000000002';
const IZZAH_GOAL_TITLE = 'Strengthen frontline safety coaching';
const AMER = 'f0c05000-0000-4000-a000-000000000003';

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

async function signInAs(email: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

/**
 * A Task with one open request addressed to Izzul.
 *
 * Written directly rather than driven through Capture and Raise Barrier: what
 * these tests are about is what the *attention* surfaces do with a request, and
 * the capture and barrier flows already have their own specs.
 */
async function seedTaskRequest(marker: string) {
  const client = admin();
  const { data: task, error: taskError } = await client
    .from('tasks')
    .insert({
      title: `Replace the guard interlock ${marker}`,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: IZZAH,
      created_by: IZZAH,
    })
    .select('id')
    .single();
  if (taskError || !task) throw new Error(`Could not seed task: ${taskError?.message}`);

  const { data: request, error: requestError } = await client
    .from('barriers')
    .insert({
      task_id: task.id,
      raised_by: IZZAH,
      description: `Blocked pending a decision ${marker}`,
      support_needed: `${marker}: confirm the interlock specification before Friday`,
      impact: 'may_delay' as const,
      status: 'open' as const,
      action_pending: true,
      action_required_from: IZZUL,
      action_type: 'decision' as const,
    })
    .select('id')
    .single();
  if (requestError || !request) throw new Error(`Could not seed request: ${requestError?.message}`);

  return { taskId: String(task.id), requestId: String(request.id) };
}

/**
 * Removes a fixture Task and its requests.
 *
 * A Task that has been through a real operation owns immutable audit history,
 * and the database refuses to delete it — deliberately, and the suite should
 * not be the one exception. Cancelled work is absent from every list these
 * tests read, so where the refusal is that guard the record is left in place;
 * anything else is a genuine failure and is reported.
 */
async function removeTask(taskId: string) {
  const client = admin();
  await client.from('barriers').delete().eq('task_id', taskId);
  const { error } = await client.from('tasks').delete().eq('id', taskId);
  if (!error) return;
  if (!/append-only/i.test(error.message)) {
    throw new Error(`Could not clean up the seeded task: ${error.message}`);
  }

  const { data } = await client.from('tasks').select('status').eq('id', taskId).single();
  if (data?.status !== 'cancelled' && data?.status !== 'completed') {
    throw new Error(
      `The seeded task kept audit history without reaching a terminal state: ${data?.status}`,
    );
  }
}

/** The real operation, not an insert: the trigger and the audit are the point. */
async function raiseGoalRequest(marker: string) {
  const izzah = await signInAs('izzah@tamco.local');
  const { data, error } = await izzah.rpc('raise_goal_support_request', {
    p_goal_id: IZZAH_GOAL,
    p_description: `Coaching slots are not being released ${marker}`,
    p_support_needed: `${marker}: confirm which supervisors can be released each week`,
    p_idempotency_key: `e2e-${marker}`,
  });
  if (error) throw new Error(`Could not raise the Goal request: ${error.message}`);
  const result = data as { ok?: boolean; request_id?: string; message?: string };
  if (!result?.ok) throw new Error(`Goal request refused: ${result?.message ?? 'unknown'}`);
  return String(result.request_id);
}

async function removeGoalRequest(requestId: string) {
  const client = admin();
  await client.from('notifications').delete().eq('barrier_id', requestId);
  await client.from('barriers').delete().eq('id', requestId);
  // The request set the Goal's health; put it back so nothing downstream reads
  // a state this test invented.
  const { error } = await client.from('goals').update({ health: 'on_track' }).eq('id', IZZAH_GOAL);
  if (error) throw new Error(`Could not restore the Goal: ${error.message}`);
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
 * v53 §21 — one request engine, two kinds of subject.
 *
 * A request raised against a Goal has no `task_id`, and the attention read
 * model used to look every subject up by that column. One Goal request was
 * enough to make the whole lookup fail: every card on the screen, Task requests
 * included, lost its heading and rendered "Work", and the Goal request itself
 * offered a button pointing at `/work?task=null`.
 *
 * So this asserts both at once — the Goal request has a real destination, and
 * the Task request beside it still knows its own name.
 */
test('a Goal request and a Task request sit in one list, each with its own subject', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The request mutation runs once.');
  const marker = `V53REQ${Date.now()}`;
  const seededTask = await seedTaskRequest(marker);
  const goalRequestId = await raiseGoalRequest(marker);

  try {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?filter=attention');

    const taskCard = page.locator('.attention-card', {
      hasText: `${marker}: confirm the interlock`,
    });
    await expect(taskCard.locator('.attention-card-title')).toHaveText(
      `Replace the guard interlock ${marker}`,
    );
    await expect(taskCard.locator('.attention-card-type')).toHaveText('Decision needed');

    const goalCard = page.locator('.attention-card', {
      hasText: `${marker}: confirm which supervisors`,
    });
    await expect(goalCard.locator('.attention-card-title')).toHaveText(IZZAH_GOAL_TITLE);
    await expect(goalCard.locator('.attention-card-type')).toHaveText('Goal support needed');
    await expect(goalCard.locator('.attention-card-meta')).toContainText('Requested by Izzah');

    // The destination is the Goal, and it is the Goal — not a task id, and not
    // My Day, which is where this used to land.
    const cta = goalCard.getByRole('link', { name: 'Review goal' });
    await expect(cta).toHaveAttribute('href', `/goals?goal=${IZZAH_GOAL}`);
    await cta.click();

    await expect(page).toHaveURL(new RegExp(`goal=${IZZAH_GOAL}`));
    const drawer = page.locator('.goal-detail-drawer');
    await expect(drawer.getByRole('button', { name: 'Resolve support' }).first()).toBeVisible();
    await expect(drawer).toContainText(`${marker}: confirm which supervisors`);
  } finally {
    await removeGoalRequest(goalRequestId);
    await removeTask(seededTask.taskId);
  }
});

/**
 * v53 §2 — cancellation closes the loop instead of leaving it hanging.
 *
 * The request stops asking, but it is not deleted and it is not marked
 * resolved: nobody answered it. Both halves matter, so both are checked — the
 * screen no longer shows it, and the record still says what happened.
 */
test('cancelling work retires its open request without pretending it was answered', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The cancellation runs once.');
  const marker = `V53CANCEL${Date.now()}`;
  const seeded = await seedTaskRequest(marker);

  try {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?filter=attention');
    const card = page.locator('.attention-card', { hasText: marker });
    await expect(card).toBeVisible();

    await page.goto(`/work?task=${seeded.taskId}`);
    const drawer = page.locator('.task-detail-drawer');
    // v84 - administration sits behind the ••• menu in the drawer footer, and
    // is no longer gated on expanding the drawer first.
    await drawer.getByRole('button', { name: 'More task actions' }).click();
    // The menu holds commands only; the reason is asked in its own dialog.
    await page
      .getByRole('menu')
      .getByRole('button', { name: /^Cancel work$/ })
      .click();
    const cancelDialog = page.getByRole('dialog', { name: 'Cancel work' });
    await cancelDialog
      .getByLabel('Why is this work no longer needed?')
      .fill('The line was decommissioned, so the guard is no longer needed.');
    await cancelDialog.getByRole('button', { name: /^Cancel work$/ }).click();
    await expect(
      drawer.getByText('Work cancelled. It stays on the record with your reason.'),
    ).toBeVisible();

    await page.goto('/work?filter=attention');
    await expect(page.locator('.attention-card', { hasText: marker })).toHaveCount(0);

    const stored = await admin()
      .from('barriers')
      .select('status, action_pending, source_active, source_inactive_at, resolved_at')
      .eq('id', seeded.requestId)
      .single();
    expect(stored.error, 'the request must still exist as history').toBeNull();
    expect(stored.data!.action_pending).toBe(false);
    expect(stored.data!.source_active).toBe(false);
    expect(stored.data!.source_inactive_at).not.toBeNull();
    // Not resolved. Nobody answered it; the work simply stopped.
    expect(stored.data!.status).toBe('open');
    expect(stored.data!.resolved_at).toBeNull();
  } finally {
    await removeTask(seeded.taskId);
  }
});

/**
 * v53 §19 — a plan can be built gradually and finalised only at exactly 100%.
 *
 * Asserted against the number the screen itself shows rather than a fixture
 * total, so the rule is what is being tested and not the seed.
 */
test('the formal Goal plan states its own gap and refuses to finalise below 100%', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One read-only structural check.');
  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/goals?view=team&person=${AMER}`);

  const plan = page.getByRole('region', { name: /Performance Period|Goal plan/ });
  const allocated = await plan.getByText(/% formal Active allocation/).textContent();
  const percent = Number(/(\d+)%/.exec(allocated ?? '')?.[1]);
  expect(Number.isFinite(percent)).toBe(true);
  expect(percent).toBeLessThan(100);

  await expect(plan.getByText(`${100 - percent}% still requires allocation`)).toBeVisible();
  await expect(plan.getByRole('button', { name: 'Finalize plan' })).toBeDisabled();
});

/**
 * v53 §17 — Complete and Cancel are different things and stay different.
 *
 * Completion has to say what was achieved against every agreed measure;
 * cancellation has to say why the expectation no longer applies. Nothing is
 * submitted here: the point is that the product asks the right question for
 * each ending, which a single "Close Goal" could not.
 */
test('a Goal offers completion and cancellation as separate, differently evidenced acts', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One read-only structural check.');
  await signIn(page, 'izzul@tamco.local');
  await page.goto(`/goals?view=team&person=${IZZAH}&goal=${IZZAH_GOAL}`);

  const drawer = page.locator('.goal-detail-drawer');
  await expect(drawer).toBeVisible();

  await drawer.getByText('Complete this Goal').click();
  await expect(
    drawer.getByText(/Record what was achieved against every agreed success measure/),
  ).toBeVisible();
  const results = drawer.locator('textarea[name^="measure-"]');
  await expect(results).not.toHaveCount(0);
  await expect(results.first()).toHaveAttribute('required', '');
  await expect(drawer.getByLabel('Final result summary')).toHaveAttribute('required', '');

  await drawer.getByText('Cancel this Goal').click();
  await expect(drawer.getByLabel('Why does this Goal no longer apply?')).toHaveAttribute(
    'required',
    '',
  );
  await expect(drawer.getByRole('button', { name: 'Cancel Goal' })).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Complete Goal' })).toBeVisible();
});
