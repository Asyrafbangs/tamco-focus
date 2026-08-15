import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email = 'izzul@tamco.local') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|plan|more|team)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openRoutines(page: Page) {
  await page.goto('/work/routine');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Setting up a routine, the way somebody actually does it.
 *
 * The reported symptom was "I created it and nothing happened": the list said
 * "nothing scheduled yet", the Upcoming tab was empty and the calendar showed
 * nothing. None of it raised an error, so this walks the screen and reads what
 * a person would read.
 */
test.describe('v62 routine recurrence', () => {
  test('sets up the first Wednesday of every month and says when it next runs', async ({
    page,
  }, testInfo) => {
    const title = `Gemba ${testInfo.project.name} ${Date.now()}`;
    await signIn(page);
    await openRoutines(page);

    await page.getByRole('button', { name: 'Set up a routine' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up a routine' });
    await expect(dialog).toBeVisible();

    await dialog.locator('#routine-title').fill(title);
    await dialog.getByRole('radio', { name: 'Monthly' }).check();

    // The pattern that had no representation at all before v62.
    await dialog.getByLabel('Which occurrence in the month').selectOption('1');
    await dialog.getByLabel('Which weekday').selectOption('3');

    // The preview is computed from the same fields the server stores, so it is
    // a promise about what will happen rather than a caption.
    await expect(dialog.locator('.recurrence-preview')).toContainText(
      'The first Wednesday of every month',
    );

    await dialog.getByRole('button', { name: 'Create routine' }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator('.routine-template-row', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('The first Wednesday of every month');

    /*
     * The heart of the report. Generation runs a fortnight ahead, so a routine
     * whose next date is further out has nothing generated — and the list used
     * to say "nothing scheduled yet", which is what a broken routine says too.
     */
    await expect(row).toContainText(/Next: \d/);
    await expect(row).not.toContainText('nothing scheduled yet');
  });

  test('a weekly routine takes several days and an end', async ({ page }, testInfo) => {
    const title = `Walk ${testInfo.project.name} ${Date.now()}`;
    await signIn(page);
    await openRoutines(page);

    await page.getByRole('button', { name: 'Set up a routine' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up a routine' });
    await dialog.locator('#routine-title').fill(title);
    await dialog.getByRole('radio', { name: 'Weekly' }).check();

    /*
     * Weekly starts with today's weekday already selected, as a calendar
     * client does. So every day is set explicitly here rather than only the
     * two being added — otherwise the day the suite happens to run on joins
     * the pattern and the assertion becomes a fact about the calendar.
     */
    const wanted = ['Monday', 'Thursday'];
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
      'Sunday',
    ]) {
      const toggle = dialog.getByRole('button', { name: day, exact: true });
      const on = (await toggle.getAttribute('aria-pressed')) === 'true';
      if (on !== wanted.includes(day)) await toggle.click();
    }

    await dialog.getByRole('radio', { name: 'End after' }).check();
    await dialog.getByLabel('Number of occurrences').fill('4');

    await expect(dialog.locator('.recurrence-preview')).toContainText('4 times');

    await dialog.getByRole('button', { name: 'Create routine' }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator('.routine-template-row', { hasText: title });
    await expect(row).toContainText('Monday and Thursday');
    await expect(row).toContainText('4 times');
  });

  test('deletes to the Bin and restores from it', async ({ page }, testInfo) => {
    const title = `Mistake ${testInfo.project.name} ${Date.now()}`;
    await signIn(page);
    await openRoutines(page);

    await page.getByRole('button', { name: 'Set up a routine' }).click();
    const dialog = page.getByRole('dialog', { name: 'Set up a routine' });
    await dialog.locator('#routine-title').fill(title);
    await dialog.getByRole('radio', { name: 'Daily' }).check();
    await dialog.getByRole('button', { name: 'Create routine' }).click();
    await expect(dialog).toBeHidden();

    const row = page.locator('.routine-template-row', { hasText: title });
    await expect(row).toBeVisible();

    // Deleting is the creator's to do, so the button is there for them.
    await row.getByRole('button', { name: 'Delete' }).click();
    const confirm = page.getByRole('dialog', { name: 'Delete this routine?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Delete to Bin' }).click();

    await expect(page.locator('.routine-template-row', { hasText: title })).toHaveCount(0);

    /*
     * Restored from the Routine page, not the Focus Bin.
     *
     * A deleted routine was briefly listed under Work → Bin, which put a
     * schedule inside the module for operational work — and that tab's count
     * did not include it either, so the badge said 2 beside four rows.
     */
    const bin = page.locator('.routine-bin');
    await expect(bin).toBeVisible();
    await bin.locator('summary').click();
    const binRow = page.locator('.routine-bin-row', { hasText: title });
    await expect(binRow).toBeVisible();

    // Restored paused, so nothing is generated until somebody decides.
    await binRow.getByRole('button', { name: 'Restore paused' }).click();
    // Wait for the server action to confirm before navigating: a `goto` fired
    // while the transition is still in flight abandons it, and the routine then
    // never comes back — which reads as "restore does not work".
    await expect(page.getByText(/is back, and paused/i)).toBeVisible();
    await openRoutines(page);
    const restored = page.locator('.routine-template-row', { hasText: title });
    await expect(restored).toBeVisible();
    await expect(restored).toContainText('Paused');
  });
});
