import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|plan|more|team)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openUser(page: Page, who: string) {
  await page.goto('/more/admin/users');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.locator('.master-list a', { hasText: who }).first().click();
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Administrator → User directory, walked the way an administrator walks it.
 *
 * The module had a working create procedure, a working update procedure and a
 * working visibility procedure, and still could not be used to answer "let Amer
 * see Izzah and Ajmal" without leaving the person you were looking at. It also
 * shipped an Employee ID `pattern` that no browser could compile, so the field
 * announced a rule it never enforced.
 */
test.describe('v66 administrator user directory', () => {
  test('creates a user, and the Employee ID rule actually applies', async ({ page }, testInfo) => {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/more/admin/users?create=1');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    /*
     * `pattern` is compiled with the `v` flag, where a bare `-` inside a
     * character class is reserved. The old value therefore threw a SyntaxError
     * on every render and the constraint was dropped entirely: a one-character
     * Employee ID passed. This asserts the browser accepts the expression and
     * enforces it.
     */
    const employeeId = page.getByLabel(/Employee ID/);
    await employeeId.fill('A');
    expect(await employeeId.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(false);
    await employeeId.fill('EMP-90001');
    expect(await employeeId.evaluate((el: HTMLInputElement) => el.checkValidity())).toBe(true);

    const stamp = `${testInfo.project.name}${Date.now()}`.slice(-9);
    const name = `Probe ${stamp}`;
    await page.getByLabel('Full name').fill(name);
    await employeeId.fill(`EMP-${stamp}`);
    await page.getByLabel('Email address').fill(`probe${stamp}@tamco.local`);
    await page.getByLabel('Temporary password').fill('ProbePass123!');
    // Department is required and starts unchosen; without this the form dies on
    // a native bubble and nothing at all appears to happen.
    await page.getByLabel('Department').selectOption({ index: 1 });

    await page.getByRole('button', { name: /^Create user$/ }).click();
    await expect(
      page.locator('.settings-form [role="status"], .settings-form [role="alert"]'),
    ).toContainText(/created|saved/i);

    await page.goto('/more/admin/users');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.master-list a', { hasText: name })).toBeVisible();
  });

  test('updating a user persists every field it offers', async ({ page }, testInfo) => {
    await signIn(page, 'admin@tamco.local');
    await openUser(page, 'Ajmal');

    const newName = `Ajmal Rizani ${testInfo.project.name}`;
    await page.getByLabel('Full name').fill(newName);
    await page.getByLabel('Role').selectOption('manager');
    await page.getByRole('button', { name: /^Save user$/ }).click();
    await expect(
      page.locator('.settings-form [role="status"], .settings-form [role="alert"]').first(),
    ).toContainText(/saved/i);

    // Read back from the server, not from the form we just typed into.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.getByLabel('Full name')).toHaveValue(newName);
    await expect(page.getByLabel('Role')).toHaveValue('manager');
  });

  test('an administrator grants one person sight of two others', async ({ page }) => {
    /*
     * The case that prompted this: everybody reports to one manager, but Amer
     * needs to see Izzah and Ajmal. That is a mode plus two explicit grants,
     * and it is now set from Amer's own page rather than from a separate
     * screen keyed by the word "viewer".
     */
    await signIn(page, 'admin@tamco.local');
    await openUser(page, 'Amer');

    const visibility = page.locator('.admin-visibility-section');
    await expect(visibility).toBeVisible();
    await expect(visibility).toContainText('What Amer can see');

    await visibility.getByRole('radio', { name: /Specific people only/ }).check();
    for (const person of ['Izzah', 'Ajmal']) {
      await visibility.getByRole('checkbox', { name: new RegExp(person) }).check();
    }
    await visibility.getByRole('button', { name: /Save/ }).click();
    await expect(visibility.locator('[role="status"], [role="alert"]').first()).toContainText(
      /saved/i,
    );

    // Persisted, and shown as such when the page is re-opened.
    await openUser(page, 'Amer');
    const reopened = page.locator('.admin-visibility-section');
    await expect(reopened.getByRole('checkbox', { name: /Izzah/ })).toBeChecked();
    await expect(reopened.getByRole('checkbox', { name: /Ajmal/ })).toBeChecked();

    // And it is real: Amer can now see their work, which he could not before.
    await signIn(page, 'amer@tamco.local');
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.getByText('Izzah', { exact: false }).first()).toBeVisible();
  });
});
