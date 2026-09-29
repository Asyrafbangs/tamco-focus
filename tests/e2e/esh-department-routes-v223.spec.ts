import { config } from 'dotenv';
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';

/**
 * v225 - the accountable department is a combobox: type, then choose.
 *
 * It replaced a select so that a long list can be narrowed and a missing
 * department added without abandoning the form.
 */
async function chooseDepartment(page: Page, name: string) {
  const field = page.getByLabel('Accountable department', { exact: true });
  await field.click();
  await field.fill(name);
  await page.getByRole('option', { name, exact: true }).click();
}

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more)/, { timeout: 30_000 });
}

test('v223 a department carries its own escalation route into a new finding', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Settings; one layout is enough.');
  const suffix = randomBytes(3).toString('hex');
  const level1 = `route.one.${suffix}@example.com`;
  const level2 = `route.two.${suffix}@example.com`;

  await signIn(page);
  await page.goto('/findings/settings?tab=follow-up');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const card = page.locator('section.esh-form-card', {
    has: page.getByRole('heading', { name: 'Operations', exact: true }),
  });
  await expect(card).toBeVisible();
  // Each level says when it is told, from the organisation's own policy.
  await expect(card).toContainText(/after \d+ days? overdue/);
  // The department may already carry a route, so the test sets the two it
  // wants rather than assuming it starts empty.
  await card.getByLabel('Level 1').fill(level1);
  if ((await card.getByLabel('Level 2').count()) === 0) {
    await card.getByRole('button', { name: /^\+ Add level/ }).click();
  }
  await card.getByLabel('Level 2').fill(level2);
  for (const extra of [3, 4, 5, 6, 7, 8, 9]) {
    const field = card.getByLabel(`Level ${extra}`);
    if ((await field.count()) > 0) await field.fill('');
  }
  await card.getByRole('button', { name: 'Save route' }).click();
  await expect(card.getByRole('status')).toContainText('2 recipients');

  // Choosing that department on a new finding offers the route.
  await page.goto('/findings/new');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const form = page.locator('form.esh-finding-form');
  await chooseDepartment(page, 'Operations');
  await page.getByRole('button', { name: 'Next' }).click();
  // v228 - both addresses are in the folded summary. Scoped to it, because the
  // editor underneath still holds them in hidden inputs so the finding carries
  // the route, which makes an unscoped match ambiguous.
  const route = page.locator('.esh-route-summary');
  await expect(route).toContainText(level1);
  await expect(route).toContainText(level2);
  // v228 - the department's own route arrives folded, so what it says is what
  // it would do rather than two boxes asking to be read again.
  await expect(form).toContainText('The route this department normally uses');

  // It is an offer: another department replaces it rather than adding to it.
  await page.getByRole('button', { name: 'Back' }).click();
  await chooseDepartment(page, 'Administration');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(form.getByText(level1)).toHaveCount(0);

  /*
   * This suite shares one database, and a route left on Operations would be
   * offered to every later finding recorded there — quietly adding an
   * escalation recipient another spec never asked for.
   */
  await page.goto('/findings/settings?tab=follow-up');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  for (const level of [1, 2]) {
    await card.getByLabel(`Level ${level}`).fill('');
  }
  await card.getByRole('button', { name: 'Save route' }).click();
  await expect(card.getByRole('status')).toContainText('Route cleared');
});
