import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v173 — a dotted line, which grants nothing.
 *
 * Organisation can now record who somebody works for alongside their reporting
 * manager. The rule these tests hold the screen to is the one the procedure
 * already enforces: the line grants no sight of the person's work, and the
 * confirmation says so before anything is drawn. That the line truly grants
 * nothing is proven in the integration suite, against a manager whose formal
 * reports it does see; what is proven here is that the screen does not imply
 * otherwise.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'Izzul Asyraf';
const TESTER = 'Temporary Tester';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** The branch under the person who carries the seeded team. */
async function openTeamBranch(page: Page) {
  await page.goto('/more/admin/organisation');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page
    .locator('.org-tree > .org-node')
    .filter({ hasText: IZZUL })
    .getByRole('link', { name: /Show \d+ reports?/ })
    .click();
  await expect(page.locator('.org-branch')).toContainText(TESTER);
}

function testerRow(page: Page) {
  return page.locator('.org-person').filter({ hasText: TESTER });
}

test.describe('v173 the dotted line', () => {
  test('says it grants nothing before anything is drawn', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openTeamBranch(page);

    await testerRow(page)
      .getByRole('link', { name: `Set the dotted line for ${TESTER}` })
      .click();

    const panel = page.locator('.org-move-panel');
    await expect(panel.getByRole('heading', { name: 'Change dotted line?' })).toBeVisible();
    await expect(panel).toContainText('Current dotted line: None — no dotted line');
    await expect(panel).toContainText("A dotted line gives nobody sight of Temporary's work.");

    /*
     * The reporting manager is not offered. A dotted line to the same person as
     * the solid one says nothing, the procedure refuses it, and a choice that
     * can only be refused is not a choice.
     */
    const choices = panel.getByLabel('Dotted-line manager');
    await expect(choices.locator('option', { hasText: IZZUL })).toHaveCount(0);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);

    await panel.getByRole('link', { name: 'Cancel' }).click();
    await expect(page.locator('.org-move-panel')).toHaveCount(0);
  });

  test('draws a dotted line, shows it in words, and takes it away again', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The data change runs once.');
    await signIn(page, 'admin@tamco.local');
    await openTeamBranch(page);

    await testerRow(page)
      .getByRole('link', { name: `Set the dotted line for ${TESTER}` })
      .click();
    const panel = page.locator('.org-move-panel');
    await panel.getByLabel('Dotted-line manager').selectOption({ label: 'Amer Hakim · EMP-201' });
    await panel.getByLabel('Reason (optional)').fill('Answers to Amer on site safety.');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByText('Dotted line updated.')).toBeVisible();

    // Read back from the chart, not from the panel that claimed it.
    await openTeamBranch(page);
    await expect(testerRow(page)).toContainText('Dotted line to Amer Hakim');
    // And the formal line is untouched: the tester is still under Izzul.
    await expect(page.locator('.org-branch')).toContainText(TESTER);

    // Taken away through the same door, leaving the fixture as it was found.
    await testerRow(page)
      .getByRole('link', { name: `Set the dotted line for ${TESTER}` })
      .click();
    const again = page.locator('.org-move-panel');
    await expect(again).toContainText('Current dotted line: Amer Hakim');
    await again.getByLabel('Dotted-line manager').selectOption('');
    await again.getByRole('button', { name: 'Save' }).click();
    await expect(again.getByText('Dotted line updated.')).toBeVisible();

    await openTeamBranch(page);
    await expect(testerRow(page)).not.toContainText('Dotted line to');
  });
});
