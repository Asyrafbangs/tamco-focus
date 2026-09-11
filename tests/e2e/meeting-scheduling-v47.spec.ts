import { expect, test, type Page } from '@playwright/test';

import { createWork } from './helpers/capture';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Creates a task owned by Izzah with an open decision request addressed to
 * Izzul, and leaves the page signed in as Izzah.
 */
async function raiseRequest(page: Page, taskTitle: string, request: string) {
  await signIn(page, 'izzah@tamco.local');

  await createWork(page, taskTitle);

  await page.goto('/work?tab=available');
  await page.getByRole('link', { name: taskTitle }).click();
  await expect(page.locator('.task-detail-drawer')).toBeVisible();

  await page.locator('.task-detail-drawer').getByRole('button', { name: 'Need support' }).click();
  const form = page.getByRole('dialog', { name: 'Raise Barrier' });
  await form.getByLabel('What is blocking the work?').fill('The contractor cannot meet the date.');
  await form.getByLabel('What do you need from them?').fill(request);
  await form.getByRole('radio', { name: 'Decision' }).check();
  await form.getByRole('button', { name: 'Send request' }).click();
  await expect(page.locator('.barrier-exception.waiting')).toBeVisible();
}

test('a request can be queued, scheduled, and only then answered', async ({ page }, testInfo) => {
  const runId = Date.now();
  const taskTitle = `Machine guarding ${testInfo.project.name} ${runId}`;
  const request = `Appoint the alternative contractor ${testInfo.project.name} ${runId}`;

  await raiseRequest(page, taskTitle, request);

  // --- Izzul defers it to a discussion ---------------------------------------
  await signIn(page, 'izzul@tamco.local');

  // The full list, not My Day's top three (v49 §1).
  await page.goto('/work?filter=attention');
  const queueRow = page.locator('.attention-card', { hasText: request });
  /*
   * Remember which request this run created.
   *
   * The end-to-end gate resets the database once and then runs every viewport
   * project against it, so by the time the mobile project reaches the calendar
   * the desktop project's discussion is sitting on the same day. Picking "the
   * first meeting" therefore picks somebody else's — one that has already been
   * answered, so no action panel renders and the failure reads like a product
   * bug. Every lookup below is anchored to this barrier instead.
   */
  const provideHref = await queueRow
    .getByRole('link', { name: 'Provide decision' })
    .getAttribute('href');
  const barrierId = new URL(provideHref!, 'http://localhost').searchParams.get('barrier');
  expect(barrierId).toBeTruthy();

  await queueRow.getByRole('link', { name: 'Provide decision' }).click();

  const panel = page.locator('.barrier-action-panel');
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: 'Add to Meeting Queue' }).click();
  await expect(panel.getByText('Already in Meeting Queue')).toBeVisible();

  // §29 — queueing answers nothing, so the request is still outstanding.
  await page.goto('/work?filter=attention');
  await expect(page.locator('.attention-card', { hasText: request })).toBeVisible();

  // --- Plan → Meeting Queue → Schedule ---------------------------------------
  await page.goto('/plan');
  // The Meeting Queue opens from a button, so a click before hydration does
  // nothing and the dialog never appears — which reads as "the queue will not
  // open" rather than "clicked too early".
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const trigger = page.getByRole('button', { name: /Meeting Queue/ });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const drawer = page.getByRole('dialog', { name: 'Meeting Queue' });
  await expect(drawer).toBeVisible();
  const topic = drawer.locator('.meeting-queue-row', { hasText: request });
  await expect(topic).toContainText('Requested by: Izzah');

  await topic.getByRole('button', { name: 'Schedule' }).click();
  const scheduleForm = page.getByRole('dialog', { name: 'Schedule discussion' });
  await expect(scheduleForm).toBeVisible();
  // §22 — the topic arrives filled in; nobody retypes the request.
  await expect(scheduleForm.getByLabel('Topic')).toHaveValue(request);

  await scheduleForm.getByLabel('Date and time').fill('2026-08-12T10:00');
  await scheduleForm.getByRole('button', { name: 'Add to calendar' }).click();
  await expect(scheduleForm).toHaveCount(0);

  // --- It lands on the calendar that already existed -------------------------
  await page.goto('/plan?month=2026-08');
  // §42 — the meeting opens the request it exists to settle, so it is findable
  // by that request.
  const meeting = page.locator(`.cal-item.discussion[href*="barrier=${barrierId}"]`);
  await expect(meeting).toBeVisible();

  const meetingHref = await meeting.getAttribute('href');
  expect(meetingHref).toContain('attention=barrier');

  // §30 — still outstanding on My Day, with the urgency reduced rather than
  // the row removed.
  await page.goto('/work?filter=attention');
  const scheduledRow = page.locator('.attention-card', { hasText: request });
  await expect(scheduledRow).toBeVisible();
  await expect(scheduledRow).toContainText('Scheduled for discussion');
  await expect(scheduledRow.getByRole('link', { name: 'Open request' })).toBeVisible();

  // --- The manager answers, and only that clears it --------------------------
  await page.goto(meetingHref!);
  // Send decision stays disabled until React sees a non-empty response, so a
  // `fill` on the server-rendered input sets the DOM value and nothing else.
  // Without this wait the failure reads as "the manager cannot answer".
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const answerPanel = page.locator('.barrier-action-panel');
  await expect(answerPanel).toBeVisible();
  await answerPanel.getByLabel('Your decision').fill(`Proceed after the shutdown ${runId}.`);
  await answerPanel.getByRole('button', { name: 'Send decision' }).click();
  // The response is a Server Action inside a transition. Wait for its visible
  // success contract before navigating, otherwise a fast test runner can tear
  // down the RSC stream while the committed response is still refreshing.
  await expect(
    page.getByText('Response sent. The barrier stays open.', { exact: true }),
  ).toBeVisible();

  await page.goto('/work?filter=attention');
  await expect(page.locator('.attention-card', { hasText: request })).toHaveCount(0);

  // --- The requester sees an answer, and a barrier still open ----------------
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/work?tab=available');
  await page.getByRole('link', { name: taskTitle }).click();

  const banner = page.locator('.barrier-exception.waiting');
  await expect(banner).toContainText('remains open');
  // §4 — the control now offers the answer, not the question.
  await expect(banner.getByRole('button', { name: 'View response' })).toBeVisible();

  // §3 — and it does something: the barrier itself comes into view.
  await banner.getByRole('button', { name: 'View response' }).click();
  await expect(page.locator('.barrier-record.highlighted')).toBeVisible();
  await expect(page.locator('.barrier-record.highlighted')).toContainText(
    `Proceed after the shutdown ${runId}`,
  );
});

/**
 * v47 §9-11, §57 — the layout has to survive text nobody has written yet.
 */
test('action cards contain long content without overflowing', async ({ page }, testInfo) => {
  const runId = Date.now();
  const taskTitle = `Long content ${testInfo.project.name} ${runId}`;
  // Unique per project and run: the gate resets once and runs every viewport
  // against the same data, so a fixed sentence matches other projects' rows.
  const marker = `LONGCASE${testInfo.project.name}${runId}`;
  const request =
    `${marker} confirm whether the alternative contractor can be appointed before the Friday ` +
    'shutdown window given that procurement have not yet returned the comparison quotation ' +
    'and the CONTRACTORREFERENCEWITHNOSPACESAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA is outstanding';

  await raiseRequest(page, taskTitle, request);
  await signIn(page, 'izzul@tamco.local');
  // The full list: My Day shows only the top three (v49 §1).
  await page.goto('/work?filter=attention');

  const row = page.locator('.attention-card', { hasText: marker });
  await expect(row).toBeVisible();

  for (const width of [1280, 768, 375]) {
    await page.setViewportSize({ width, height: 900 });

    // Nothing may push the page sideways.
    const scrolls = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(scrolls, `horizontal scrollbar at ${width}px`).toBe(false);

    // The button must stay inside the card it belongs to, at every width.
    /*
     * The card must have real padding, not just contain its children.
     *
     * `.card` in this stylesheet supplies the border and the radius and no
     * padding; each card class sets its own. A new card that forgets looks
     * exactly like a broken one — text flat against the border, separators
     * running edge to edge — and nothing else fails. So this asserts the gap,
     * not merely the absence of overflow.
     */
    const inset = await page.locator('.attention-list').evaluate((card) => {
      const box = card.getBoundingClientRect();
      const heading = card.querySelector('h2')!.getBoundingClientRect();
      return Math.round(heading.left - box.left);
    });
    expect(inset, `card content flat against its border at ${width}px`).toBeGreaterThanOrEqual(12);

    const contained = await row.evaluate((element) => {
      const card = element.getBoundingClientRect();
      const button = element.querySelector('a.btn, button.btn')?.getBoundingClientRect();
      if (!button) return false;
      return (
        button.left >= card.left - 1 &&
        button.right <= card.right + 1 &&
        button.top >= card.top - 1 &&
        button.bottom <= card.bottom + 1
      );
    });
    expect(contained, `action button escaped its card at ${width}px`).toBe(true);
  }
});
