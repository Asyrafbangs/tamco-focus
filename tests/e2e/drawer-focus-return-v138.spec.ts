import { expect, test, type Page } from '@playwright/test';

/**
 * v138 — closing a drawer puts the caret back on the row that opened it, even
 * when that row is no longer the same element.
 *
 * `SideDrawer` recorded the node that had focus when it mounted and focused
 * that same object on close. Opening the drawer is a navigation and so is
 * closing it, and either re-render can replace the row: focusing a detached
 * node does nothing, reports nothing, and leaves the caret on the body. A
 * keyboard user is then returned to the top of the document with no idea where
 * they were.
 *
 * It surfaced as `goals-v33` failing about one full run in five — never in
 * isolation, which is what made it worth pinning down here instead. This spec
 * does not wait for the race: it replaces the row while the drawer is open, so
 * the case that used to be luck is now the case under test.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v138 the caret comes back', () => {
  test('to the row that opened the drawer', async ({ page }) => {
    await signIn(page, 'amer@tamco.local');
    await page.goto('/goals');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
    // The link itself, not a point inside the row: on a phone the row is a tall
    // stack of bands and its middle is not a reliable place to press.
    await row.locator('.row-primary-link').click();
    await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toHaveCount(0);
    await expect(row.locator('.row-primary-link')).toBeFocused();
  });

  test('even when the row has been replaced underneath it', async ({ page }) => {
    await signIn(page, 'amer@tamco.local');
    await page.goto('/goals');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
    // The link itself, not a point inside the row: on a phone the row is a tall
    // stack of bands and its middle is not a reliable place to press.
    await row.locator('.row-primary-link').click();
    await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toBeVisible();

    /*
     * What a re-render does, done deliberately: swap the link for an identical
     * one. The drawer's captured node is now detached, which is exactly the
     * state that made this fail intermittently under load.
     */
    const swapped = await page.evaluate(() => {
      const link = document.querySelector<HTMLElement>(
        '.goal-row a.row-primary-link[href*="f0c06000-0000-4000-a000-000000000001"]',
      );
      if (!link) return false;
      const replacement = link.cloneNode(true) as HTMLElement;
      link.replaceWith(replacement);
      return !link.isConnected && replacement.isConnected;
    });
    expect(swapped, 'the row link was replaced').toBe(true);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toHaveCount(0);

    // Found again by its address rather than by the object that has gone.
    await expect(row.locator('.row-primary-link')).toBeFocused();
  });

  test('and never steals it from whatever the person did next', async ({ page }) => {
    await signIn(page, 'amer@tamco.local');
    await page.goto('/goals');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
    // The link itself, not a point inside the row: on a phone the row is a tall
    // stack of bands and its middle is not a reliable place to press.
    await row.locator('.row-primary-link').click();
    await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toBeVisible();

    await page.keyboard.press('Escape');
    // Straight somewhere else, before the drawer has finished closing. The
    // main navigation is on every width; the header search is not.
    const elsewhere = page.getByRole('navigation', { name: 'Main' }).getByRole('link', {
      name: 'Plan',
    });
    await elsewhere.focus();
    await page.waitForTimeout(900);

    /*
     * Restoring must never take the caret off something the person chose. It
     * runs only while the caret is still the drawer's to give back.
     */
    await expect(elsewhere).toBeFocused();
  });
});
