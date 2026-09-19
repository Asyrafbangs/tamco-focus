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
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
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

/**
 * v149 — and it survives a re-render that arrives late.
 *
 * The retry that re-applies focus after the closing navigation used to be a
 * loop of twelve animation frames that stopped at the first success. Both
 * halves were wrong. Frames are a unit of TIME, and they stretch exactly when
 * the render being waited for is slow; and stopping on success meant a
 * re-render arriving after the caret was put back took it away again with
 * nothing left running to notice.
 *
 * That second half is the one this forces. The row is replaced 400ms after
 * Escape — comfortably after the 245ms restore — which is precisely what React
 * does when the closing navigation commits a little late. Without the fix the
 * caret is left on nothing; with it, the observer sees the replacement and
 * puts it back.
 */
test('v149 the caret survives a re-render that lands after it was restored', async ({ page }) => {
  await signIn(page, 'amer@tamco.local');
  await page.goto('/goals');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await row.locator('.row-primary-link').click();
  await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toBeVisible();

  // Armed before Escape so the swap lands inside the closing sequence rather
  // than being raced against it from the test side.
  await page.evaluate(() => {
    setTimeout(() => {
      const link = document.querySelector<HTMLElement>(
        '.goal-row a.row-primary-link[href*="f0c06000-0000-4000-a000-000000000001"]',
      );
      if (!link) return;
      link.replaceWith(link.cloneNode(true));
    }, 400);
  });

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toHaveCount(0);
  await expect(row.locator('.row-primary-link')).toBeFocused({ timeout: 10_000 });
});

/**
 * v166 — and it survives the re-render that arrives WITH the drawer's removal.
 *
 * v149 watches the page settle for 1500ms after the closing navigation, which
 * covers a row replaced 400ms later. It cannot cover this one: the watcher was
 * stopped by the drawer's own unmount cleanup, and the commit that unmounts the
 * drawer is the same commit that re-renders the page underneath it. A row
 * replaced at that moment left the caret on the body with nothing left running
 * to notice.
 *
 * That is the shape `goals-v33` kept failing with — about one full run in five
 * — after v138, v149 and v164 had each removed a different cause. The swap here
 * is triggered by the dialog's removal rather than by a timer, so it lands in
 * that commit every time instead of once in five runs.
 */
/**
 * v166 — a drawer opened by its address still gives the caret to its row.
 *
 * `SideDrawer` returns focus to whatever held it when the drawer mounted. Open
 * one by its address and nothing held it: a notification link does exactly
 * this, so does a bookmark, and so does any run where the press that opened the
 * drawer did not leave the caret on the row. The restore then "succeeds" onto
 * the body, and a keyboard user is dropped at the top of the document with the
 * goal they were reading nowhere near them.
 *
 * The row is the right answer whether or not it was what opened the drawer, so
 * the drawer is told which row is its own rather than inferring it.
 */
test('v166 a drawer opened by address returns the caret to its row', async ({ page }) => {
  await signIn(page, 'amer@tamco.local');
  await page.goto('/goals?goal=f0c06000-0000-4000-a000-000000000001');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const drawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
  await expect(drawer).toBeVisible();
  // Rendered by the server off-screen, which Playwright still calls visible:
  // it is on screen, and listening, once it has slid in (v195).
  await expect(drawer).toHaveAttribute('data-open', 'true');

  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);

  const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await expect(row.locator('.row-primary-link')).toBeFocused({ timeout: 10_000 });
});

test('v166 the caret survives a re-render that lands as the drawer leaves', async ({ page }) => {
  await signIn(page, 'amer@tamco.local');
  await page.goto('/goals');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });
  await row.locator('.row-primary-link').click();
  await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toBeVisible();

  await page.evaluate(() => {
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          const wasTheDrawer =
            node.matches('.task-detail-layer') || Boolean(node.querySelector('[role="dialog"]'));
          if (!wasTheDrawer) continue;
          const link = document.querySelector<HTMLElement>(
            '.goal-row a.row-primary-link[href*="f0c06000-0000-4000-a000-000000000001"]',
          );
          link?.replaceWith(link.cloneNode(true));
          observer.disconnect();
          return;
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: /Safety Digitalisation/ })).toHaveCount(0);
  await expect(row.locator('.row-primary-link')).toBeFocused({ timeout: 10_000 });
});

/**
 * v196 — the restore outlives the drawer, so it must stand aside for the next.
 *
 * The observer that puts the caret back used to stop when the drawer
 * unmounted, which is also the moment its own close lands — so once the
 * database answered quickly, a re-render just after the close left the caret
 * on nothing (the v149 test above, failing on both layouts). It now runs on
 * after the drawer has gone, for up to a second and a half.
 *
 * Pressing Back straight after closing reopens the drawer inside that time,
 * with nothing a person chose holding the caret in between. The reopened
 * panel is `tabindex="-1"` — the same shape as a container a navigation parks
 * the caret on — and without a rule for it the observer pulled the caret out
 * of the drawer being read and back onto the row behind it.
 */
test('v196 the caret stays in a drawer reopened as the last one leaves', async ({ page }) => {
  await signIn(page, 'amer@tamco.local');
  await page.goto('/goals');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const row = page.locator('.goal-row').filter({ hasText: 'Safety Digitalisation' });

  await row.locator('.row-primary-link').click();
  const drawer = page.getByRole('dialog', { name: /Safety Digitalisation/ });
  await expect(drawer).toHaveAttribute('data-open', 'true');
  await page.keyboard.press('Escape');
  // Gone: from here the first drawer's observer runs on its own.
  await expect(page.locator('.task-detail-layer')).toHaveCount(0);

  await page.goBack();
  await expect(drawer).toHaveAttribute('data-open', 'true');
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.getAttribute('role')))
    .toBe('dialog');
  // Something re-renders while the observer is still running — content
  // streaming in, a badge updating — which is what wakes it.
  await page.evaluate(() => document.body.appendChild(document.createElement('div')));
  // Past the observer's deadline, the caret is still inside the drawer.
  await page.waitForTimeout(1_800);
  expect(
    await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]'))),
    'the caret was taken out of the drawer being read',
  ).toBe(true);
});
