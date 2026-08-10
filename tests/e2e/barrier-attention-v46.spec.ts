import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  // This flow deliberately changes person mid-test, because the whole point is
  // that a request travels from one to the other. `/sign-in` redirects anybody
  // who already has a session, so the previous one has to go first.
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * The whole point of v46, end to end: a manager should never have to work out
 * what is being asked of them. Every route in lands on the same request, with
 * the response box already in front of them.
 */
test('a decision request is actionable from every entry point', async ({ page }, testInfo) => {
  const runId = Date.now();
  const request = `Appoint the alternative contractor ${testInfo.project.name} ${runId}`;

  const taskTitle = `Install machine guarding ${testInfo.project.name} ${runId}`;

  // --- Izzah asks -----------------------------------------------------------
  await signIn(page, 'izzah@tamco.local');

  /*
   * Capture a task rather than taking whichever row happens to be first.
   *
   * "The first task" is a moving target: other specs in this suite raise
   * barriers and complete work, so the row that greeted this test yesterday is
   * a different one today — and one that already has an open barrier will not
   * offer Raise barrier at all, which is correct behaviour reported as a test
   * failure.
   */
  await page.getByRole('link', { name: 'Capture work' }).click();
  const capture = page.getByRole('dialog', { name: 'Capture work' });
  await expect(capture).toBeVisible();
  await capture.getByLabel('What needs to be done?').fill(taskTitle);
  await capture.getByRole('button', { name: 'Add Work' }).click();

  // The dialog advances a step at a time; asserting each one keeps a click
  // from being sent at a screen that has not arrived yet.
  await expect(capture.getByText('One quick question')).toBeVisible();
  // "Yes" — work that needs following up is ordinary work, and ordinary work
  // is what a barrier is raised against. A Quick Action is the wrong subject.
  await capture.getByRole('button', { name: /^Yes/ }).click();
  await expect(capture.getByText('Recommended destination')).toBeVisible();
  await capture.getByRole('button', { name: 'Confirm & Create' }).click();

  // Work that needs follow-up lands in Available, and Capture takes you there.
  await page.goto('/work?tab=available');
  await page.getByRole('link', { name: taskTitle }).click();

  const drawer = page.locator('.task-detail-drawer');
  await expect(drawer).toBeVisible();

  // With no open barrier the quiet option is the one on offer.
  await drawer.getByRole('button', { name: 'Raise barrier' }).click();

  const barrierForm = page.getByRole('dialog', { name: 'Raise Barrier' });
  await expect(barrierForm).toBeVisible();
  await barrierForm
    .getByLabel('What is blocking the work?')
    .fill(`The original contractor cannot meet the date ${runId}.`);
  await barrierForm.getByLabel('What do you need from them?').fill(request);
  await barrierForm.getByRole('radio', { name: 'Decision' }).check();
  // "Who needs to act?" is left at its default, which is the reporting manager.
  await barrierForm.getByRole('button', { name: 'Send request' }).click();

  // §39 — the owner is told who they are waiting for, and is not invited to
  // raise a second barrier about the same problem.
  const waiting = page.locator('.barrier-exception.waiting');
  await expect(waiting).toBeVisible();
  await expect(waiting).toContainText('Waiting for');
  await expect(
    page.locator('.barrier-exception').getByRole('button', { name: 'Raise barrier' }),
  ).toHaveCount(0);

  // --- Izzul is asked -------------------------------------------------------
  await signIn(page, 'izzul@tamco.local');

  /*
   * §7, §10 — the request states the act, not "1 item".
   *
   * Read from the full attention list rather than My Day. My Day deliberately
   * shows only the three highest-priority items (v49 §1), so a request created
   * by a test is not necessarily on it — that is the summary working, not a
   * failure, and asserting there would make this test depend on how much
   * happens to be outstanding.
   */
  await page.goto('/work?filter=attention');
  const queue = page.locator('.attention-list');
  await expect(queue).toBeVisible();
  const queueRow = queue.locator('.attention-card', { hasText: request });
  await expect(queueRow.locator('.attention-card-type')).toHaveText('Decision needed');
  await expect(queueRow.locator('.attention-card-meta')).toContainText('Requested by Izzah');

  const provideDecision = queueRow.getByRole('link', { name: 'Provide decision' });
  await expect(provideDecision).toBeVisible();
  const attentionHref = await provideDecision.getAttribute('href');
  expect(attentionHref).toContain('attention=barrier');
  expect(attentionHref).toContain('barrier=');
  const expectedBarrierId = new URL(attentionHref!, 'http://localhost').searchParams.get('barrier');

  await provideDecision.click();

  // §56 — the decision form is already here. No hunting through Overview.
  const panel = page.locator('.barrier-action-panel');
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Decision needed');
  await expect(panel).toContainText(request);

  const responseBox = panel.getByLabel('Your decision');
  await expect(responseBox).toBeVisible();
  await expect(responseBox).toBeFocused();

  // §58 — My Team offers the identical destination, not a second interface.
  await page.goto('/work?scope=team&filter=attention');
  const teamAction = page.getByRole('button', { name: /Provide decision/ }).first();
  await teamAction.click();
  await expect(page).toHaveURL(/attention=barrier/);
  await expect(page).toHaveURL(new RegExp(`barrier=${expectedBarrierId}`));

  // --- Izzul answers --------------------------------------------------------
  await page.goto(attentionHref!);
  const openPanel = page.locator('.barrier-action-panel');
  await openPanel.getByLabel('Your decision').fill(`Proceed with the alternative ${runId}.`);
  await openPanel.getByRole('button', { name: 'Send decision' }).click();

  // §27, §63 — the request is answered, so it stops asking; the barrier is not
  // resolved, because the blocker has not gone anywhere.
  await expect(page.locator('.barrier-action-panel')).toHaveCount(0);
  await expect(page.locator('.barrier-exception.owed')).toHaveCount(0);

  await page.goto('/work?filter=attention');
  await expect(page.locator('.attention-card', { hasText: request })).toHaveCount(0);

  // --- Izzah sees the answer, and the barrier still open ---------------------
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work?tab=available');
  await page.getByRole('link', { name: taskTitle }).click();
  await expect(page.locator('.barrier-exception.waiting')).toContainText('remains open');
});
