import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v133 — one completion pattern, learned once.
 *
 * Focus completion asked for an optional note in a large textarea and nothing
 * else. Routine completion was a bare Complete button. Evidence, in both
 * cases, had to be attached somewhere else beforehand — so the one thing a
 * completion exists to capture was the one thing neither form asked for, and
 * the two flows taught two different rituals for the same moment.
 *
 * The other half is what a routine occurrence is not: it was labelled
 * "Available" and offered "Activate", both of which are Focus ideas. An
 * occurrence is created by a schedule, it is upcoming or due or late, and
 * nobody activates it.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Opens the first Focus task whose completion is actually available. */
async function openCompletableTask(page: Page): Promise<boolean> {
  for (const tab of ['active', 'available']) {
    await page.goto(`/work?tab=${tab}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await showActiveWork(page);
    const rows = page.locator('.task-row .title-link');
    const total = await rows.count();
    for (let index = 0; index < total; index += 1) {
      await page.goto(`/work?tab=${tab}`);
      await showActiveWork(page);
      await rows.nth(index).click();
      await expect(page.locator('.task-detail-drawer')).toBeVisible();
      const complete = page.getByRole('button', { name: /^Complete work$/ }).first();
      if ((await complete.count()) > 0 && (await complete.isEnabled())) {
        await complete.click();
        return true;
      }
    }
  }
  return false;
}

test.describe('v133 the completion form', () => {
  test('asks for evidence in a target worth aiming at', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    expect(
      await openCompletableTask(page),
      'the seed must carry work Izzah can complete, or this test proves nothing',
    ).toBe(true);

    const zone = page.locator('.evidence-target');
    await expect(zone).toBeVisible();
    await expect(zone).toContainText('click to choose files');
    // The formats are stated, rather than discovered by having a file refused.
    await expect(zone).toContainText('PDF');

    /*
     * Size is the point, not decoration. The control this replaces was a
     * single button with a drop hint beside it — a target that small is hard
     * to hit with a dragged file and easy to miss entirely, and at the moment
     * of completion attaching the proof IS the task.
     */
    const box = (await zone.boundingBox())!;
    expect(box.height, 'the evidence target is back to being a button').toBeGreaterThan(90);
  });

  test('keeps the note collapsed until somebody wants it', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    expect(
      await openCompletableTask(page),
      'the seed must carry work Izzah can complete, or this test proves nothing',
    ).toBe(true);

    // A large empty box invites "Done.", which costs a line and says nothing.
    await expect(page.locator('textarea[name="completionNote"]')).toHaveCount(0);
    await page.getByRole('button', { name: /Add completion note/ }).click();
    await expect(page.locator('textarea[name="completionNote"]')).toBeVisible();
  });

  test('offers a camera, because the proof is often taken there and then', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    expect(
      await openCompletableTask(page),
      'the seed must carry work Izzah can complete, or this test proves nothing',
    ).toBe(true);

    // Nobody drags a file on a phone. Open the work, photograph it, complete.
    await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
    await expect(page.locator('input[capture="environment"]')).toHaveCount(1);
  });

  test('does not ask twice for evidence the work already has', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    expect(
      await openCompletableTask(page),
      'the seed must carry work Izzah can complete, or this test proves nothing',
    ).toBe(true);

    /*
     * A gate that demands a fresh upload when the step already carries the
     * measurement sheet is how a gate teaches people to attach junk: a blank
     * document, a duplicate photo, whatever passes. Where evidence exists the
     * form says so.
     */
    const existing = page.locator('.completion-existing');
    if ((await existing.count()) > 0) {
      await expect(existing).toContainText('already attached to this work');
    }
  });
});

test.describe('v133 a routine occurrence is not Focus work', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work/routine');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    /*
     * A row that is due, in preference to whichever is first.
     *
     * `.first()` here was the next upcoming occurrence, and an occurrence the
     * schedule has not reached yet cannot be completed - so the completion
     * test below found a disabled button and skipped itself with "this
     * occurrence is not ready to complete in the seed", every run, silently.
     * The seed does generate due and overdue occurrences; this was picking the
     * wrong one. The other two tests in this group accept any state, so the
     * fallback keeps them running on a fixture with nothing due.
     */
    const rows = page.locator('.routine-row');
    const due = rows.filter({ hasText: /Overdue|Due today/ });
    const target = (await due.count()) > 0 ? due.first() : rows.first();
    await target.locator('a, button').first().click();
    await expect(page.locator('.task-detail-drawer')).toBeVisible();
  });

  test('is never Available, and never activated', async ({ page }) => {
    const drawer = page.locator('.task-detail-drawer');
    /*
     * Available is a Focus state: valid work not yet being carried, waiting
     * for somebody to decide to activate it. An occurrence has no such
     * decision — the schedule made it, and it is upcoming, due or late.
     */
    await expect(drawer.locator('.task-status-state')).not.toContainText('Available');
    await expect(drawer.locator('.task-status-state')).toContainText(
      /Overdue|Due today|Upcoming|Completed/,
    );
    await expect(drawer.getByRole('button', { name: /^Start work/ })).toHaveCount(0);
  });

  test('completes through the same form as Focus work', async ({ page }) => {
    const complete = page.getByRole('button', { name: /^Complete$/ }).first();
    if ((await complete.count()) === 0 || !(await complete.isEnabled())) {
      test.skip(true, 'This occurrence is not ready to complete in the seed.');
    }
    await complete.click();

    // The same component, so the employee learns this once.
    await expect(page.locator('.evidence-target')).toBeVisible();
    await expect(page.getByRole('button', { name: /Add completion note/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Take photo' })).toBeVisible();
  });

  test('says what is outstanding rather than greying out in silence', async ({ page }) => {
    /*
     * "Complete is greyed out" is a question. "Finish 2 steps and add
     * evidence" is an instruction — and somebody standing in a plant with a
     * phone cannot hover a tooltip to find out which.
     */
    const complete = page.getByRole('button', { name: /^Complete$/ }).first();
    if ((await complete.count()) > 0 && !(await complete.isEnabled())) {
      await expect(page.locator('.routine-blockers')).toBeVisible();
      await expect(page.locator('.routine-blockers')).not.toHaveText('');
    }
  });
});
