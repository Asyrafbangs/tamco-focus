import { expect, test, type Page } from '@playwright/test';

/**
 * v128 — the primary action belongs to the mode you are in.
 *
 * The Work shell carried one global New Work button across both Focus and
 * Routine. On Routine that was a trap rather than a convenience: New Work
 * creates a task, so somebody who wanted a repeating responsibility got a
 * one-off piece of work, no schedule, and no explanation. The empty Routine
 * screen then offered a second, equally prominent "Set up a routine" button
 * inside it, so the one screen with nothing on it had two competing calls to
 * action pointing in different directions.
 *
 * The button now follows the Focus / Routine selector, and the empty state
 * states the fact and stops. Nobody has to work out whether they are creating
 * a task or a schedule — the page they are on already knows.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

const head = (page: Page) => page.locator('.pagehead');

test.describe('v128 the header action follows the selector', () => {
  test('Focus offers New Work, Routine offers Set up routine', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');

    await page.goto('/work');
    await expect(head(page).getByRole('link', { name: /New Work/ })).toBeVisible();
    await expect(head(page).getByRole('link', { name: /Set up routine/ })).toHaveCount(0);

    /*
     * Through the selector rather than by URL: the requirement is that
     * switching mode switches the action, so the switch is what is exercised.
     */
    await page.getByRole('link', { name: /^Routine/ }).click();
    await expect(page).toHaveURL(/\/work\/routine$/);
    await expect(head(page).getByRole('link', { name: /Set up routine/ })).toBeVisible();
    await expect(head(page).getByRole('link', { name: /New Work/ })).toHaveCount(0);
  });

  test('a manager gets the same switch on the team panel', async ({ page }) => {
    // Assigning work and assigning a schedule are both things a manager does,
    // so neither view is an exception to the rule — they only differ in which
    // of the two the button offers.
    await signIn(page, 'izzul@tamco.local');

    await page.goto('/work?scope=team');
    // v130 renamed this to the manager's word for the same flow.
    await expect(head(page).getByRole('link', { name: /Assign work/ })).toBeVisible();

    await page.goto('/work/routine?panel=manager');
    await expect(head(page).getByRole('link', { name: /Set up routine/ })).toBeVisible();
    await expect(head(page).getByRole('link', { name: /New Work/ })).toHaveCount(0);
  });
});

test.describe('v128 Set up routine actually sets up a routine', () => {
  test('it opens the form when followed from the Routine page itself', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work/routine');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    /*
     * The hard case, and the one that was broken twice over. This link points
     * at the page it is on, so following it is a soft navigation: the server
     * component re-renders and the client one below it does not remount, so a
     * form whose open state is read once on mount would never open. Two
     * separate faults had to be fixed for this to pass — `?new=` with an empty
     * title read as false, and the manager needed a key.
     */
    await head(page)
      .getByRole('link', { name: /Set up routine/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Set up a routine' })).toBeVisible();
  });

  test('it opens the form on a cold load of the same address', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work/routine?schedules=1&new=');
    await expect(page.getByRole('dialog', { name: 'Set up a routine' })).toBeVisible();
  });
});

test('v128 the empty Routine screen offers exactly one way to start', async ({ page }) => {
  /*
   * The Temporary Tester, not the manager the rest of this file signs in as.
   * Every viewport project runs against ONE database, and
   * `routine-recurrence-v62` signs in as that manager and creates schedules —
   * so the first project saw "No routine responsibilities yet" and the second
   * saw "1 routine schedule is waiting for manager activation". This identity
   * is the one the seed gives no routine work to and no spec assigns any.
   */
  await signIn(page, 'temp.tester@tamco.local');
  await page.goto('/work/routine');

  // Scoped to the occurrence panel: the schedules disclosure carries an empty
  // state of its own, so `.first()` here would be a guess about DOM order.
  const empty = page.locator('.focus-panel .empty-state');
  await expect(empty).toContainText('No routine responsibilities yet');
  await expect(empty).toContainText(
    'Routine work will appear here automatically when a schedule is set up or assigned to you.',
  );
  // The second button. It said the same thing as the header, one screen-inch
  // below it, and on the only screen where a reader has nothing else to look at.
  await expect(empty.getByRole('link')).toHaveCount(0);
  await expect(empty.getByRole('button')).toHaveCount(0);

  // One visible control for setting a routine up, in the header. The
  // schedules section keeps its own, but that disclosure is shut, so nothing
  // competes with the header until somebody goes looking for it.
  await expect(page.getByRole('link', { name: /Set up routine/ })).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Set up a routine' })).toBeHidden();
});
