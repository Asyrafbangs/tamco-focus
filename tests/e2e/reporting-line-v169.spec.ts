import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * v169 — moving somebody is a decision, taken twice.
 *
 * Dropping a row onto a manager and changing who somebody answers to are not
 * the same act, however alike they look. Every route to a move — the drag and
 * the "Change manager" control — arrives at the same confirmation, which states
 * who is moving, who they report to now, and who they would report to instead.
 *
 * Dragging itself is not exercised here: it is an enhancement over the control
 * these tests use, and a synthesised HTML5 drag proves the test harness rather
 * than the product. What matters is that the confirmation cannot be skipped,
 * which is asserted from the route everybody can take — keyboard, phone, or
 * mouse.
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

/** Opens the branch under the person who carries the seeded team. */
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

function row(page: Page, name: string) {
  return page.locator('.org-person').filter({ hasText: name });
}

test.describe('v169 changing a reporting line', () => {
  test('states the change in full before anything moves', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openTeamBranch(page);

    await row(page, TESTER)
      .getByRole('link', { name: /Change who/ })
      .click();

    const panel = page.locator('.org-move-panel');
    await expect(panel.getByRole('heading', { name: 'Change reporting line?' })).toBeVisible();
    await expect(panel).toContainText(TESTER);
    await expect(panel).toContainText(`Current manager: ${IZZUL}`);

    /*
     * The dangerous default, asserted.
     *
     * Opened from the row there is no proposal yet, so the select starts where
     * the person already is. Starting at "None — top of the line" would turn an
     * unconsidered Save into a move to the top of the organisation.
     */
    await expect(panel.getByLabel('New manager').locator('option:checked')).toHaveText(
      new RegExp(IZZUL),
    );

    // Nothing has happened yet: the line is still what it was.
    await expect(page.locator('.org-branch')).toContainText(TESTER);

    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations).toEqual([]);
  });

  test('cancel leaves the line where it was', async ({ page }) => {
    await signIn(page, 'admin@tamco.local');
    await openTeamBranch(page);

    await row(page, TESTER)
      .getByRole('link', { name: /Change who/ })
      .click();
    await expect(page.locator('.org-move-panel')).toBeVisible();
    await page.locator('.org-move-panel').getByRole('link', { name: 'Cancel' }).click();

    await expect(page.locator('.org-move-panel')).toHaveCount(0);
    await expect(page.locator('.org-branch')).toContainText(TESTER);
  });

  test('moves somebody, and puts them back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'The data change runs once.');
    await signIn(page, 'admin@tamco.local');
    await openTeamBranch(page);

    await row(page, TESTER)
      .getByRole('link', { name: /Change who/ })
      .click();
    const panel = page.locator('.org-move-panel');
    // Options read "Name · EMP-ID", and both halves are seeded fixtures.
    await panel.getByLabel('New manager').selectOption({ label: 'Amer Hakim · EMP-201' });
    await panel.getByLabel('Reason (optional)').fill('Covering while Izzul is away.');
    await panel.getByRole('button', { name: 'Save' }).click();
    await expect(panel.getByText('Reporting line updated.')).toBeVisible();

    // Read back from the tree rather than from the panel that just claimed it.
    await page.goto('/more/admin/organisation');
    await page
      .locator('.org-tree > .org-node')
      .filter({ hasText: IZZUL })
      .getByRole('link', { name: /Show \d+ reports?/ })
      .click();
    await row(page, 'Amer Hakim')
      .getByRole('link', { name: /Show \d+ reports?/ })
      .click();
    await expect(row(page, 'Amer Hakim').locator('..').locator('.org-branch')).toContainText(
      TESTER,
    );

    // Put the fixture back the way it was found, through the same door.
    await row(page, TESTER)
      .getByRole('link', { name: /Change who/ })
      .click();
    const back = page.locator('.org-move-panel');
    await back.getByLabel('New manager').selectOption({ label: 'Izzul Asyraf · MGR-100' });
    await back.getByRole('button', { name: 'Save' }).click();
    await expect(back.getByText('Reporting line updated.')).toBeVisible();
  });

  test('refuses a move that would loop the line', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'One attempt is enough.');
    await signIn(page, 'admin@tamco.local');
    await openTeamBranch(page);

    /*
     * Izzul manages the tester, so putting Izzul under the tester closes a loop
     * the immediate self-check cannot see.
     *
     * The row is addressed as the node's own child rather than "the first one":
     * the branch hanging below it holds people too, and which of them comes
     * first is not this test's business.
     */
    await page
      .locator('.org-tree > .org-node')
      .filter({ hasText: IZZUL })
      .locator('> .org-person')
      .getByRole('link', { name: /Change who/ })
      .click();

    const panel = page.locator('.org-move-panel');
    await panel.getByLabel('New manager').selectOption({ label: 'Temporary Tester · TMP-900' });
    await panel.getByRole('button', { name: 'Save' }).click();

    await expect(panel.getByText(/loop back on itself/i)).toBeVisible();
    // And the tree is untouched: Izzul still carries the team.
    await page.goto('/more/admin/organisation');
    await expect(page.locator('.org-tree > .org-node').filter({ hasText: IZZUL })).toContainText(
      /Show \d+ reports?/,
    );
  });

  test('is not reachable by anybody but an administrator', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/more/admin/organisation');
    await expect(page.getByRole('heading', { name: 'Identity and access' })).toHaveCount(0);
    await expect(page.locator('.org-tree')).toHaveCount(0);
  });
});
