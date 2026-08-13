import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function openNewWork(page: Page, email = 'izzul@tamco.local') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|plan|more|team)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  await page.goto('/today?capture=1');
  const dialog = page.getByRole('dialog', { name: 'New Work' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * A Major Project proposal, from the form to the manager's drawer.
 *
 * The regression this covers passed every test that existed: a proposal was
 * created, routed to and rendered. It just arrived with nothing in it, because
 * the field that fills `rationale` had been removed from the form. So this
 * walks the whole path and reads the drawer, rather than asserting on the row.
 */
test.describe('v61 major project proposal', () => {
  test('asks for a case, and shows it to the person deciding', async ({ page }) => {
    const dialog = await openNewWork(page);

    const title = `Consolidate plant scheduling ${Date.now()}`;
    await dialog.locator('#capture-title').fill(title);

    // The proposal fields live behind the same disclosure as the work type,
    // so choosing Major Project has to reveal them without a second step.
    await dialog.getByText('Add details', { exact: true }).click();
    await dialog.locator('#capture-work-type').selectOption('major_project');

    const rationale = dialog.locator('#capture-rationale');
    await expect(rationale).toBeVisible();
    await expect(dialog.getByText(/goes to your manager to approve/i)).toBeVisible();

    // Nothing typed: the form must refuse rather than send a bare title.
    await dialog.getByRole('button', { name: /^Create work$/ }).click();
    await expect(dialog.getByText(/Explain why this needs to be a project/i)).toBeVisible();
    await expect(page).toHaveURL(/capture=1/);

    await rationale.fill('Six plants keep separate spreadsheets and the numbers disagree.');
    await dialog.locator('#capture-success').fill('One schedule for every plant.');
    await dialog.locator('#capture-months').fill('4');

    await dialog.getByRole('button', { name: /^Create work$/ }).click();
    await expect(page).toHaveURL(/\/work\?proposal=/);

    // What the manager actually reads.
    await expect(page.getByText('No rationale was recorded.')).toHaveCount(0);
    await expect(page.getByText(/numbers disagree/)).toBeVisible();
    await expect(page.getByText('One schedule for every plant.')).toBeVisible();
    await expect(page.getByText(/about 4 months/i)).toBeVisible();
  });

  test('leaves ordinary work untouched', async ({ page }) => {
    const dialog = await openNewWork(page);
    await dialog.locator('#capture-title').fill(`Order bearings ${Date.now()}`);
    await dialog.getByText('Add details', { exact: true }).click();

    // Normal work must not be asked to justify itself; that was the whole
    // point of putting these behind the Major Project choice.
    await expect(dialog.locator('#capture-rationale')).toHaveCount(0);
    await expect(dialog.locator('#capture-months')).toHaveCount(0);
  });
});
