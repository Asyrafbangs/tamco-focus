import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

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

test('Next action is editable, completable, and refreshed by a task update', async ({
  page,
}, testInfo) => {
  const runId = Date.now();
  const directAction = `Confirm v35 ${testInfo.project.name} evidence ownership ${runId}`;
  const updateAction = `Book v35 ${testInfo.project.name} follow-up ${runId}`;
  const updateText = `Verified the v35 ${testInfo.project.name} action flow ${runId}.`;

  await signIn(page);
  await page.goto('/work?tab=operational');
  await page.getByRole('link', { name: TASK_TITLE }).click();

  const detail = page.getByRole('dialog', { name: TASK_TITLE });
  await expect(detail).toBeVisible();
  await expect(detail.getByText('Next action', { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Do Next', { exact: true })).toHaveCount(0);

  const ageInfoButton = detail.getByRole('button', { name: 'Explain task-age indicators' });
  await ageInfoButton.click();
  const ageDialog = page.getByRole('dialog', { name: 'Task-age indicators' });
  await expect(ageDialog).toBeVisible();
  await expect(ageDialog.getByText('Open age', { exact: true })).toBeVisible();
  await expect(ageDialog.getByText('Current-state age', { exact: true })).toBeVisible();
  await expect(detail.locator('.next-action-card').getByText('Open age')).toHaveCount(0);
  await ageDialog.getByRole('button', { name: 'Understood' }).click();
  await expect(ageDialog).toHaveCount(0);
  await expect(ageInfoButton).toBeFocused();

  await detail.getByRole('button', { name: /^(Edit|\+ Set next action)$/ }).click();
  await detail.getByRole('textbox', { name: 'Next action' }).fill(directAction);
  await detail.getByRole('button', { name: 'Save next action' }).click();
  await expect(detail.getByText(directAction, { exact: true }).first()).toBeVisible();
  await expect(detail.getByText('Active', { exact: true }).first()).toBeVisible();

  await detail.getByRole('tab', { name: /Checklist/ }).click();
  const directChecklistItem = detail.locator('.checklist-item').filter({ hasText: directAction });
  await expect(directChecklistItem).toBeVisible();
  await directChecklistItem.getByRole('button', { name: 'Complete' }).click();

  await detail.getByRole('tab', { name: 'Overview' }).click();
  await expect(
    detail
      .getByRole('region', { name: 'Next action' })
      .getByText('No next action recorded', { exact: true }),
  ).toBeVisible();
  await expect(detail.getByText('Active', { exact: true }).first()).toBeVisible();

  await detail.getByRole('tab', { name: /Updates/ }).click();
  await detail.getByRole('button', { name: 'Write update' }).click();
  await detail.getByLabel('What changed?').fill(updateText);
  await detail.getByLabel('What happens next?').fill(updateAction);
  await detail.getByRole('button', { name: 'Post update' }).click();
  await expect(detail.getByText(updateText, { exact: true })).toBeVisible();

  await detail.getByRole('tab', { name: 'Overview' }).click();
  await expect(detail.getByText(updateAction, { exact: true }).first()).toBeVisible();
  await detail.getByRole('tab', { name: /Checklist/ }).click();
  await expect(detail.locator('.checklist-item').filter({ hasText: updateAction })).toBeVisible();

  expect(await detail.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
    true,
  );
  await expectAccessible(page);
});
