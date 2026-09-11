import { expect, test, type Page } from '@playwright/test';

/**
 * v164 — a dialog that has closed keeps its hands off the caret.
 *
 * `Modal` put focus back on whatever opened it 200ms after closing, whether or
 * not the person had put it somewhere else in the meantime. Close "Set a Goal"
 * and open a goal inside that window, and the caret was taken off the goal's
 * row and handed to "+ New goal" — so the goal drawer, which returns focus to
 * whatever held it when it opened, returned it there as well.
 *
 * That is the whole of goals-v33's long-running intermittent: never in
 * isolation, because only a loaded machine stretches that test's own steps
 * across the 200ms. v138 and v149 hardened the drawer; the thief was the
 * modal. These tests act inside the window on purpose rather than waiting for
 * load to line it up.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** Opens "Set a Goal" and waits until it holds the caret, which is when it listens for Escape. */
async function openSetAGoal(page: Page) {
  await page.getByRole('button', { name: '+ New goal' }).click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(document.activeElement?.closest('[role="dialog"][aria-label="Set a Goal"]')),
      ),
    )
    .toBe(true);
}

test.describe('v164 a closed dialog and the caret', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'amer@tamco.local');
    await page.goto('/goals');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  });

  test('gives it back to "+ New goal" when nobody has moved it', async ({ page }) => {
    await openSetAGoal(page);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Set a Goal' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '+ New goal' })).toBeFocused();
  });

  test('never takes it back from what the person did next', async ({ page }) => {
    await openSetAGoal(page);
    await page.keyboard.press('Escape');
    // Straight somewhere else, inside the 200ms the dialog takes to close.
    const elsewhere = page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Plan' });
    await elsewhere.focus();

    // The dialog leaves in the same moment it used to take the caret back, so
    // once it has gone the answer is settled.
    await expect(page.getByRole('dialog', { name: 'Set a Goal' })).toHaveCount(0);
    await expect(elsewhere).toBeFocused();
  });

  test('a goal opened straight after it gets the caret back on its own row', async ({ page }) => {
    await openSetAGoal(page);
    await page.keyboard.press('Escape');

    // goals-v33's sequence with the delay taken out: the row is pressed while
    // the dialog is still on its way out.
    const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
    await row.locator('.row-primary-link').click();
    const drawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
    await expect(drawer).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(row.locator('.row-primary-link')).toBeFocused();
  });
});
