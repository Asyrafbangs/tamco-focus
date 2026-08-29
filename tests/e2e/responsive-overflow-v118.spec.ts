import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * v118 — the application has to fit the window it is given.
 *
 * Two failures prompted this, and neither was caught by anything already here.
 *
 * The task drawer's ••• menu opened 14 pixels tall with 275 pixels of content
 * inside it. A stale `bottom: calc(100% + 8px)`, left over from when the menu
 * was a `<details>`, landed on a `position: fixed` panel — where `100%` means
 * the viewport — so the panel was handed `top: 438px; bottom: 920px` on a
 * 912px window and collapsed. Every existing check passed: the button was
 * there, the panel was in the DOM, the page did not scroll.
 *
 * The Goals hint opened at `left: -201px` on a 1280px display, because it was
 * right-aligned to a trigger sitting at the left of the column. Over half the
 * sentence was off-screen. It looked like a paragraph with clipped text rather
 * than a broken popover, which is how it survived so long.
 *
 * Both are the same class of defect: laid out, reported present, impossible to
 * read. So these gates measure what a person could actually see — a box with
 * real size, inside the window, showing its content — rather than presence.
 *
 * The suite runs five viewport projects, so writing this once tests it from
 * 390px to 1440px.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * A panel a person can actually use: on the screen, and not crushed.
 *
 * The height floor is deliberately not "equals scrollHeight" — a long menu is
 * allowed to scroll internally. It is "you can see a usable amount of it",
 * which 14px of 275px is not.
 */
async function expectUsablePanel(page: Page, panel: Locator, what: string) {
  await expect(panel, `${what} did not open`).toBeVisible();
  const box = await panel.boundingBox();
  expect(box, `${what} has no box`).not.toBeNull();
  const viewport = page.viewportSize();
  if (!box || !viewport) return;

  expect(box.width, `${what} has no width`).toBeGreaterThan(0);
  expect(box.x, `${what} starts off the left edge (x=${Math.round(box.x)})`).toBeGreaterThan(-2);
  expect(
    Math.round(box.x + box.width),
    `${what} runs past the right edge (right=${Math.round(box.x + box.width)}, viewport=${viewport.width})`,
  ).toBeLessThanOrEqual(viewport.width + 1);

  const { clientHeight, scrollHeight } = await panel.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(
    clientHeight,
    `${what} is crushed: ${clientHeight}px showing of ${scrollHeight}px of content`,
  ).toBeGreaterThanOrEqual(Math.min(scrollHeight, 100));
}

test.describe('v118 popovers stay on screen and show their content', () => {
  test('the task drawer admin menu opens in full', async ({ page }) => {
    await signIn(page);
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await page.locator('a[href*="task="]').first().click();
    const drawer = page.locator('.task-detail-drawer');
    await expect(drawer).toBeVisible();

    await drawer.getByRole('button', { name: 'More task actions' }).click();
    await expectUsablePanel(page, page.locator('.menu-dropdown-panel'), 'The task admin menu');

    // The controls inside it are the point of opening it at all.
    await expect(page.getByRole('button', { name: 'Edit work' })).toBeVisible();
  });

  test('the work views menu opens in full', async ({ page }) => {
    await signIn(page);
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await page.getByRole('button', { name: 'More work views' }).click();
    await expectUsablePanel(page, page.locator('.menu-dropdown-panel'), 'The work views menu');
  });

  test('the completed period menu opens in full', async ({ page }) => {
    await signIn(page);
    await page.goto('/work?tab=completed');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await page.getByRole('button', { name: 'Change the period' }).click();
    await expectUsablePanel(page, page.locator('.menu-dropdown-panel'), 'The period menu');
  });

  test('the Goals explainer opens beside its trigger, not off the edge', async ({ page }) => {
    await signIn(page);
    await page.goto('/goals');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await page.locator('.goals-page-intro summary').click();
    const hint = page.locator('.goals-page-intro details p');
    await expectUsablePanel(page, hint, 'The Goals explainer');

    // The first words are the ones that were lost off the left edge.
    await expect(hint).toContainText('Goals stay visible');
  });

  test('the notification panel opens in full', async ({ page }) => {
    await signIn(page);
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await expectUsablePanel(page, page.locator('.notification-panel'), 'The notification panel');
  });
});

/**
 * Every route, at every project viewport, must fit the window.
 *
 * This asks the window to scroll sideways and checks that it could not, rather
 * than comparing `documentElement.scrollWidth` to `innerWidth`. That comparison
 * is what the older gate uses, and it reports a page as broken when it is not:
 * on `/more/attachments` Chromium inflates the root `scrollWidth` to 707px on a
 * 360px window because of the attachment table's own horizontal scroller, while
 * the page itself does not scroll a pixel. A gate that cries wolf gets deleted,
 * so this one only fails when a person could really drag the page sideways.
 */
const ROUTES = [
  '/today',
  '/work',
  '/work?tab=available',
  '/work?tab=shared',
  '/work?tab=completed',
  '/work/routine',
  '/plan',
  '/goals',
  '/capture',
  '/more',
  '/more/admin/users',
  '/more/admin/visibility',
  '/more/archive',
  '/more/attachments',
  '/more/audit',
  '/more/records',
  '/more/settings',
];

test.describe('v118 no page scrolls sideways', () => {
  test('every route fits the window it is given', async ({ page }) => {
    await signIn(page);

    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      /*
       * Let any client-side redirect finish before measuring. Some of these
       * routes bounce a viewer without the rights to be there, and evaluating
       * mid-navigation throws "execution context was destroyed" — a flake, not
       * a layout problem. Whatever page we land on is the one that gets
       * measured, which is the honest thing to check anyway.
       */
      await page.waitForLoadState('networkidle');

      const scrolled = await page.evaluate(() => {
        window.scrollTo(2000, 0);
        const moved = window.scrollX;
        window.scrollTo(0, 0);
        return moved;
      });

      expect(scrolled, `${route} scrolls horizontally by ${scrolled}px`).toBe(0);
    }
  });
});
