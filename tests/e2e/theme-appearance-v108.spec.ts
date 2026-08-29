import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openAppearance(page: Page) {
  await page.goto('/more/settings?section=appearance');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('#settings-detail-title')).toHaveText('Appearance');
  await expect(page.getByRole('button', { name: 'Save theme' })).toBeVisible();
}

/** The resolved value of a token, as the browser actually computes it. */
function token(page: Page, name: string) {
  return page.evaluate(
    (property) =>
      getComputedStyle(document.documentElement).getPropertyValue(property).trim().toLowerCase(),
    name,
  );
}

/**
 * v108 - the nine colours, end to end.
 *
 * The feature is only worth anything if a colour chosen here reaches the rest
 * of the product and survives coming back tomorrow, so this follows one colour
 * from the picker to the computed token, through a reload, and back out again
 * on reset.
 */
test.describe('v108 appearance', () => {
  test('a chosen colour applies, persists across a reload, and resets', async ({ page }) => {
    await signIn(page);
    await openAppearance(page);

    // The built-in palette, before anything is chosen.
    expect(await token(page, '--blue')).toBe('#1668e8');

    await page.getByLabel('Primary hex value').fill('#aa3311');
    // Applied live: the page itself changes, not only the preview panel.
    await expect.poll(() => token(page, '--blue')).toBe('#aa3311');

    await page.getByRole('button', { name: 'Save theme' }).click();
    await expect(page.getByText(/Theme saved/i)).toBeVisible();

    /*
     * The real test of persistence: a different page in a fresh navigation,
     * where the value can only have come from the server or from the pre-paint
     * script - not from the component that set it.
     */
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    expect(await token(page, '--blue')).toBe('#aa3311');

    await openAppearance(page);
    await page.getByRole('button', { name: 'Reset to default' }).click();
    await expect.poll(() => token(page, '--blue')).toBe('#1668e8');
    await page.getByRole('button', { name: 'Save theme' }).click();
    await expect(page.getByText(/Theme saved/i)).toBeVisible();

    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    expect(await token(page, '--blue')).toBe('#1668e8');
  });

  test('an unreadable combination is reported but not forbidden', async ({ page }) => {
    await signIn(page);
    await openAppearance(page);

    await page.getByLabel('Primary text hex value').fill('#f2f2f2');
    // Reported, because nobody should make the product unreadable unknowingly.
    await expect(page.getByText('Primary text on cards', { exact: false })).toBeVisible();
    // Not forbidden, because somebody may have a reason and the software does
    // not get to overrule them.
    await expect(page.getByRole('button', { name: 'Save theme' })).toBeEnabled();
  });

  test('nothing but a colour ever reaches the stylesheet', async ({ page }) => {
    await signIn(page);
    await openAppearance(page);
    const before = await token(page, '--blue');

    /*
     * Text that is not a colour at all leaves the token where it was. The
     * field holds the typing so it can be corrected, and the stylesheet simply
     * does not take it.
     */
    await page.getByLabel('Primary hex value').fill('rebeccapurple');
    await expect.poll(() => token(page, '--blue')).toBe(before);

    /*
     * An attempt to close the declaration and write rules of its own. The
     * field is capped at seven characters, so what survives is `#123456` - a
     * colour, and only a colour. Asserting the shape rather than the value is
     * the point: whatever arrives, the token holds six hex digits and nothing
     * that could be a rule.
     */
    await page.getByLabel('Primary hex value').fill('#123456; } body { display: none');
    await expect.poll(() => token(page, '--blue')).toMatch(/^#[0-9a-f]{6}$/);
    // The page is still standing, which is what the injection would have taken.
    await expect(page.locator('#settings-detail-title')).toHaveText('Appearance');
    await expect(page.locator('body')).toBeVisible();
  });

  test('the appearance panel is accessible', async ({ page }) => {
    await signIn(page);
    await openAppearance(page);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    expect(results.violations).toEqual([]);
  });
});
