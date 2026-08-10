import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const TASK_TITLE = 'Close out corrective actions from the June audit';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

test('Next action is editable and completable, and an update never changes it', async ({
  page,
}, testInfo) => {
  const runId = Date.now();
  const directAction = `Confirm v35 ${testInfo.project.name} evidence ownership ${runId}`;
  const updateAction = `Book v35 ${testInfo.project.name} follow-up ${runId}`;
  const updateText = `Verified the v35 ${testInfo.project.name} action flow ${runId}.`;

  await signIn(page);

  /*
   * Find the task by state, not by assuming one.
   *
   * This used to be `/work?tab=operational` — the Operational Actions tab,
   * which held the task whatever its state. v40 replaced work-class tabs with
   * state tabs and the URL was rewritten to `/work`, which now means the
   * ACTIVE tab. The navigation silently became state-dependent, so once an
   * earlier test in the run moved this task to Available the link was simply
   * not on the page and this failed with a timeout that looked like a product
   * bug.
   *
   * Checking both tabs restores the original intent: reach this task wherever
   * it currently sits.
   */
  await page.goto('/work');
  const taskLink = page.getByRole('link', { name: TASK_TITLE });
  if ((await taskLink.count()) === 0) {
    await page.goto('/work?tab=available');
  }
  await expect(taskLink).toBeVisible();
  await taskLink.click();

  const detail = page.getByRole('dialog', { name: TASK_TITLE });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Next action', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Do Next', { exact: true })).toHaveCount(0);
  await expect(detail.getByRole('region', { name: 'Task support' })).toBeVisible();
  await expect(detail.getByRole('tab', { name: 'Overview' })).toBeVisible();

  const drawerBox = await detail.boundingBox();
  expect(drawerBox).not.toBeNull();
  if (testInfo.project.name === 'desktop') {
    expect(drawerBox!.width).toBeGreaterThanOrEqual(618);
    expect(drawerBox!.width).toBeLessThanOrEqual(622);
    await expect(detail.getByRole('region', { name: 'Attachments and evidence' })).toBeHidden();
    await detail.getByRole('button', { name: 'Expand' }).click();
    await expect(detail.getByRole('region', { name: 'Attachments and evidence' })).toBeVisible();
    await detail.getByRole('button', { name: 'Restore' }).click();
  } else {
    expect(drawerBox!.width).toBeGreaterThanOrEqual(388);
    expect(drawerBox!.width).toBeLessThanOrEqual(392);
  }

  const ageInfoButton = detail.getByRole('button', { name: 'Show task-age details' });
  const ageInfoBox = await ageInfoButton.boundingBox();
  expect(ageInfoBox).not.toBeNull();
  await expect(detail.getByLabel('Task information').getByText(/^Open /)).toHaveCount(0);
  await ageInfoButton.click();
  const ageDialog = page.getByRole('dialog', { name: 'Task-age indicators' });
  await expect(ageDialog).toBeVisible();
  await expect(page.locator('body > .modal-layer')).toHaveCount(1);
  expect(
    await ageDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  const ageDialogBox = await ageDialog.boundingBox();
  const viewport = page.viewportSize();
  expect(ageDialogBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(ageDialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(ageDialogBox!.x + ageDialogBox!.width).toBeLessThanOrEqual(viewport!.width);
  expect(ageDialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(ageDialogBox!.y + ageDialogBox!.height).toBeLessThanOrEqual(viewport!.height);
  await expect(ageDialog.getByText(/^Open \d/)).toBeVisible();
  await expect(ageDialog.getByText(/^Active \d/)).toBeVisible();
  await ageDialog.getByRole('button', { name: 'Understood' }).click();
  await expect(ageDialog).toHaveCount(0);
  await expect(ageInfoButton).toBeFocused();

  await detail.getByRole('button', { name: /^(Edit|\+ Set next action)$/ }).click();
  await detail.getByRole('textbox', { name: 'Next action' }).fill(directAction);
  await detail.getByRole('button', { name: 'Save next action' }).click();
  await expect(detail.getByText(directAction, { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Active', { exact: true }).first()).toBeVisible();

  await detail.getByRole('tab', { name: /Checklist/ }).click();
  const currentNextAction = detail.locator('.current-next-action-block');
  await expect(currentNextAction).toContainText(directAction);
  await currentNextAction.getByRole('button', { name: 'Mark done' }).click();

  await detail.getByRole('tab', { name: 'Overview' }).click();
  await expect(
    detail
      .getByRole('region', { name: 'Next action' })
      .getByText('No next action recorded', { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText('Active', { exact: true }).first()).toBeVisible();

  /*
   * v43 sections 12 and 26 — the two are now separate commands.
   *
   * An update says what changed. It cannot carry a next action, and posting one
   * must not rewrite the plan behind the owner's back. The composer therefore
   * has exactly one question, and the next action stays where it was.
   */
  await detail.getByRole('tab', { name: /Updates/ }).click();
  await expect(detail.getByRole('heading', { name: 'Post an update' })).toBeVisible();

  // The four controls v43 removed are gone.
  await expect(detail.getByLabel('What happens next?')).toHaveCount(0);
  await expect(detail.getByLabel('This is evidence only')).toHaveCount(0);
  await expect(detail.getByRole('group', { name: 'Mention participants' })).toHaveCount(0);
  await expect(detail.getByRole('button', { name: 'Need help', exact: true })).toHaveCount(0);

  await detail.getByLabel('What changed?').fill(updateText);
  await detail.getByRole('button', { name: 'Post update' }).click();
  await expect(detail.getByText(updateText, { exact: true })).toBeVisible();

  // Still no next action: an update did not invent one.
  await detail.getByRole('tab', { name: 'Overview' }).click();
  await expect(
    detail
      .getByRole('region', { name: 'Next action' })
      .getByText('No next action recorded', { exact: true }),
  ).toBeVisible();

  // Setting it is its own action, from Overview, and it sticks.
  await detail.getByRole('button', { name: /^(Edit|\+ Set next action)$/ }).click();
  await detail.getByRole('textbox', { name: 'Next action' }).fill(updateAction);
  await detail.getByRole('button', { name: 'Save next action' }).click();
  await expect(detail.getByText(updateAction, { exact: true }).first()).toBeVisible();

  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expectAccessible(page);

  if (testInfo.project.name === 'mobile') {
    await detail.getByRole('tab', { name: 'Overview' }).click();
    await detail.getByRole('button', { name: 'Edit', exact: true }).click();
    await detail
      .getByRole('textbox', { name: 'Next action' })
      .fill('Chase Operations for the machine guarding evidence');
    await detail.getByRole('button', { name: 'Save next action' }).click();
  }
});

test('task-age help remains contained at the reported narrow viewport', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One exact-width regression pass is sufficient.');
  await page.setViewportSize({ width: 600, height: 466 });
  await signIn(page);
  await page.goto('/work');
  await page.getByRole('link', { name: TASK_TITLE }).click();

  const detail = page.getByRole('dialog', { name: TASK_TITLE });
  const ageInfoButton = detail.getByRole('button', { name: 'Show task-age details' });
  const buttonBox = await ageInfoButton.boundingBox();
  expect(buttonBox).not.toBeNull();
  const informationLine = detail.getByLabel('Task information');
  expect(await informationLine.evaluate((element) => element.scrollHeight <= 44)).toBe(true);
  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );

  await ageInfoButton.click();
  const ageDialog = page.getByRole('dialog', { name: 'Task-age indicators' });
  await expect(ageDialog).toBeVisible();
  await expect(page.locator('body > .modal-layer')).toHaveCount(1);
  const dialogBox = await ageDialog.boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(600);
  expect(dialogBox!.y).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.y + dialogBox!.height).toBeLessThanOrEqual(466);
  expect(
    await ageDialog.evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
  expect(
    await page
      .locator('html')
      .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
  ).toBe(true);
});

test('due-date changes preserve the previous commitment in Recent activity', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One audited mutation pass is sufficient.');
  await signIn(page);
  await page.goto('/work');
  await page.getByRole('link', { name: TASK_TITLE }).click();

  const detail = page.getByRole('dialog', { name: TASK_TITLE });
  await detail.getByRole('button', { name: 'Edit due' }).click();
  let dueDialog = page.getByRole('dialog', { name: 'Edit due date' });
  if ((await dueDialog.getByLabel('New due date').inputValue()) !== '2026-08-03') {
    await dueDialog.getByLabel('New due date').fill('2026-08-03');
    await dueDialog
      .getByLabel('Reason (optional)')
      .fill('Restore the approved local fixture date before this check');
    await dueDialog.getByRole('button', { name: 'Save', exact: true }).click();
    await detail.getByRole('button', { name: 'Edit due' }).click();
    dueDialog = page.getByRole('dialog', { name: 'Edit due date' });
  }
  await expect(dueDialog.getByText('3 Aug 2026', { exact: true })).toBeVisible();
  await dueDialog.getByLabel('New due date').fill('2026-08-10');
  await dueDialog.getByLabel('Reason (optional)').fill('Waiting for supplier confirmation');
  await dueDialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dueDialog).toHaveCount(0);
  await expect(detail.getByLabel('Task information')).toContainText('Due 10 Aug 2026');

  await detail.getByRole('tab', { name: 'Updates' }).click();
  await expect(detail.getByText('Due date changed', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(/3 Aug 2026 → 10 Aug 2026/).first()).toBeVisible();
  await expect(detail.getByText(/Reason: Waiting for supplier confirmation/).first()).toBeVisible();

  // Restore the seeded commitment so later projects start from the approved example.
  await detail.getByRole('tab', { name: 'Overview' }).click();
  await detail.getByRole('button', { name: 'Edit due' }).click();
  await page
    .getByRole('dialog', { name: 'Edit due date' })
    .getByLabel('New due date')
    .fill('2026-08-03');
  await page
    .getByRole('dialog', { name: 'Edit due date' })
    .getByLabel('Reason (optional)')
    .fill('Restore the approved local fixture date');
  await page
    .getByRole('dialog', { name: 'Edit due date' })
    .getByRole('button', { name: 'Save', exact: true })
    .click();
  await expect(detail.getByLabel('Task information')).toContainText('Due 3 Aug 2026');
});

test('required evidence is selected once and completed atomically', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One storage mutation pass is sufficient.');
  await signIn(page);
  await page.goto('/work');
  await page.getByRole('link', { name: TASK_TITLE }).click();

  const detail = page.getByRole('dialog', { name: TASK_TITLE });
  await detail.getByRole('tab', { name: /Checklist/ }).click();
  const requiredRow = detail.locator('.task-checklist-row').filter({
    hasText: 'Obtain machine guarding sign-off',
  });
  if (await requiredRow.getByRole('button', { name: 'Undo' }).isVisible()) {
    await requiredRow.getByRole('button', { name: 'Undo' }).click();
  }
  await requiredRow.getByRole('button', { name: 'Complete with evidence' }).click();

  const evidenceDialog = page.getByRole('dialog', { name: 'Complete with evidence' });
  const chooserPromise = page.waitForEvent('filechooser');
  await evidenceDialog
    .getByRole('button', { name: 'Choose file / photo / screenshot', exact: true })
    .click();
  const chooser = await chooserPromise;
  await chooser.setFiles(join(process.cwd(), 'tests', 'fixtures', 'guarding-sign-off.txt'));
  await evidenceDialog
    .getByLabel('Completion note (optional)')
    .fill('Guarding approval attached and checked.');
  await evidenceDialog.getByRole('button', { name: 'Save evidence & complete' }).click();
  await expect(evidenceDialog).toHaveCount(0);
  await expect(requiredRow.getByRole('button', { name: 'Undo' })).toBeVisible();
  await expect(detail.getByRole('tab', { name: 'Checklist 1/3' })).toBeVisible();

  await detail.getByRole('tab', { name: 'Updates' }).click();
  await expect(detail.getByText('Evidence attached', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Checklist item completed', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText(/Progress 33%/).first()).toBeVisible();
  await expectAccessible(page);

  await detail.getByRole('tab', { name: /Checklist/ }).click();
  await requiredRow.getByRole('button', { name: 'Undo' }).click();
  await expect(detail.getByRole('tab', { name: 'Checklist 0/3' })).toBeVisible();
});
