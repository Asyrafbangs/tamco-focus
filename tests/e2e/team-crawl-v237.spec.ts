import { expect, test, type Page } from '@playwright/test';

/**
 * v237 — what a crawl of My Team found that 600 passing tests did not.
 *
 * v233–v236 rebuilt four views and the person drill-down. The suite checked
 * every path it was written for; none of it walked the views in Night mode or
 * measured a plain anchor, so two defects shipped through a green run:
 *
 *  - "Open person" was given a size and a position and no colour, so it fell
 *    back to the browser's own link blue, #0000EE — 1.3:1 on the panel at
 *    night. The view this replaced had carried `color: var(--blue)` since v181
 *    with a comment saying exactly that, and rewriting the rules dropped it.
 *  - The chips — Timeline, By person, the activity kinds, the per-person
 *    filters — rendered at 34px on a phone. The touch-target check selects
 *    `button, a.btn, .mobile-nav a, input, select, summary`, so a plain anchor
 *    styled as a pill was outside a rule it plainly belongs to.
 *
 * Both are the kind of thing that is invisible until somebody is using the
 * product at night, or with a thumb.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

const VIEWS = [
  '/work?scope=team',
  '/work?scope=team&filter=available',
  '/work?scope=team&filter=delivered',
  '/work?scope=team&filter=delivered&view=person',
  '/work?scope=team&filter=updates',
];

/** The browser's own link colour, which no element here should ever show. */
const UNSTYLED_LINK = ['rgb(0, 0, 238)', 'rgb(0, 0, 204)', 'rgb(85, 26, 139)'];

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

async function settle(page: Page, url: string) {
  await page.goto(url);
  // The workspace streams in behind the hydration marker, so wait for what the
  // view itself renders before measuring anything on it.
  await page
    .locator('.focus-panel, .team-waiting, .team-delivered, .team-activity')
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
}

test.describe('v237 the team views in Night mode', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page);
    await page.addInitScript((value: string) => {
      try {
        window.localStorage.setItem('tamco-focus-theme', value);
      } catch {
        /* a private window has no storage; the default theme is fine */
      }
    }, 'dark');
  });

  test('no link is left at the browser default colour', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'A colour is a colour at any width.');

    const bare: string[] = [];
    for (const url of VIEWS) {
      await settle(page, url);
      const found = await page.evaluate((defaults) => {
        const out: string[] = [];
        for (const link of document.querySelectorAll('main#main a')) {
          const colour = getComputedStyle(link).color;
          if (defaults.includes(colour)) {
            out.push(`${(link.textContent ?? '').trim().slice(0, 30)} — ${colour}`);
          }
        }
        return out;
      }, UNSTYLED_LINK);
      for (const entry of found) bare.push(`${url}: ${entry}`);
    }

    await info.attach('bare links', {
      body: bare.join('\n') || 'none',
      contentType: 'text/plain',
    });
    /*
     * Named rather than measured as a ratio, because the ratio depends on what
     * is behind it and the defect does not: an element showing the user agent's
     * colour has not chosen one. At night that is 1.3:1.
     */
    expect(bare, 'links showing the browser default colour').toEqual([]);
  });
});

test('v237 the team chips are touch targets on a phone', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'The 44px rule is a phone rule.');
  await signIn(page);

  const small: string[] = [];
  for (const url of VIEWS) {
    await settle(page, url);
    const found = await page.evaluate(() => {
      const out: string[] = [];
      const chips = document.querySelectorAll(
        '.team-activity-filters a, .team-activity-people a, .team-delivered-views a, .team-delivered-people a, .team-delivered-group > header a, .team-person-exit a',
      );
      for (const chip of chips) {
        const box = chip.getBoundingClientRect();
        if (box.height === 0 || box.width === 0) continue;
        if (box.height < 44) {
          out.push(`"${(chip.textContent ?? '').trim().slice(0, 30)}" ${Math.round(box.height)}px`);
        }
      }
      return out;
    });
    for (const entry of found) small.push(`${url}: ${entry}`);
  }

  await info.attach('undersized chips', {
    body: small.join('\n') || 'none',
    contentType: 'text/plain',
  });
  expect(small, 'chips below the 44px touch target').toEqual([]);
});
