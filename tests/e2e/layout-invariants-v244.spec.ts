import { expect, test, type Page } from '@playwright/test';

/**
 * v244 — three rules that hold on every screen, in both themes.
 *
 * Each of these was a real defect found one page at a time between v237 and
 * v243, and each was invisible to everything the suite already measured,
 * because none of them changes how wide the page is:
 *
 *  - A link given a size and a position but no colour falls back to the
 *    browser's own `#0000EE`, which is 1.3:1 on a dark panel. Found on "Open
 *    person" in v237, and twice before that in v181 and v218.
 *  - Something inside a card that neither wraps nor shrinks carries on out
 *    through the side of it. Found on a Monthly Plan chip in v242.
 *  - A strip that scrolls hides whichever item does not fit, and the item that
 *    does not fit can be the one you are standing on. Found on My Work's tabs
 *    in v241, Routine's in v242, and the settings menu in v243.
 *
 * Written as one walk of the whole application so the next instance of any of
 * them is caught on the page it appears on, rather than on the page somebody
 * happens to look at.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** The browser's own link colours, which nothing here should ever show. */
const UNSTYLED_LINK = ['rgb(0, 0, 238)', 'rgb(0, 0, 204)', 'rgb(85, 26, 139)'];

const ROUTES: Array<{ email: string; pages: string[] }> = [
  {
    email: 'izzul@tamco.local',
    pages: [
      '/today',
      '/work',
      '/work?tab=available',
      '/work?tab=shared',
      '/work?tab=completed',
      '/work?scope=team',
      '/work?scope=team&filter=available',
      '/work?scope=team&filter=attention',
      '/work?scope=team&filter=delivered',
      /*
       * The second reading of Completed, which is where "Open person" lives.
       *
       * Left out of the first version of this list, and the proof step caught
       * it: reintroducing the v237 bare-link defect changed nothing, because
       * the walk never opened the page that shows it. A list of routes is only
       * as good as the views it actually reaches.
       */
      '/work?scope=team&filter=delivered&view=person',
      '/work?scope=team&filter=updates',
      '/work/routine',
      '/work/routine?view=upcoming',
      '/work/routine?view=completed',
      '/goals',
      '/goals?view=team',
      '/plan',
      '/more',
      '/more/records',
      '/more/attachments',
      '/more/archive',
      '/more/settings',
      '/more/settings?section=security',
      '/esh',
      '/findings',
      '/findings/register',
      '/findings/closed',
      '/findings/verification',
      '/findings/settings',
    ],
  },
  {
    email: 'admin@tamco.local',
    pages: [
      '/more/admin/users',
      '/more/admin/organisation',
      '/more/admin/visibility',
      '/more/admin/contacts',
      '/more/audit',
    ],
  },
];

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|more|esh|findings)/, { timeout: 30_000 });
}

/**
 * What the three rules find on the page as it stands.
 *
 * Deliberately not axe's job: axe does not look at `aria-hidden` decoration,
 * does not know what a card is, and has no opinion about a tab you cannot see.
 */
async function breaches(page: Page, defaults: string[]) {
  return page.evaluate((unstyled) => {
    const out: string[] = [];
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}.${(element.className || '').toString().split(' ').slice(0, 2).join('.')}`;
    const root =
      document.querySelector('.task-detail-drawer') ??
      document.querySelector('main#main') ??
      document.body;

    /*
     * The screen-reader clip is `width: 1px; white-space: nowrap`, which looks
     * exactly like text with nowhere to go. It is the opposite: text put there
     * deliberately for somebody who cannot see the layout.
     */
    const clipped = (element: Element) =>
      element.closest('.visually-hidden') !== null || element.clientWidth <= 1;

    for (const link of root.querySelectorAll('a')) {
      const box = link.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (clipped(link)) continue;
      if (unstyled.includes(getComputedStyle(link).color)) {
        out.push(`BARE LINK "${(link.textContent ?? '').trim().slice(0, 30)}" ${name(link)}`);
      }
    }

    for (const element of root.querySelectorAll('*')) {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;

      /*
       * A card that does not clip, holding something that reaches past it. The
       * card has to be `overflow: visible` for this to be a defect rather than
       * a scroller or a deliberate crop.
       */
      const card = element.parentElement?.closest(
        '.focus-panel, .card, .esh-dash-panel, .day, .settings-section, .team-person-section',
      );
      if (card && card !== element && getComputedStyle(card).overflow === 'visible') {
        const bounds = card.getBoundingClientRect();
        if (box.right > bounds.right + 2) {
          out.push(
            `ESCAPES ${name(element)} "${(element.textContent ?? '').trim().slice(0, 24)}" ends ${Math.round(box.right - bounds.right)}px past ${name(card)}`,
          );
        }
      }
    }

    /*
     * A strip that scrolls is fine. A strip that scrolls with the item you are
     * standing on outside it is not: nothing on screen then says where you are.
     */
    for (const strip of root.querySelectorAll('nav')) {
      if (strip.scrollWidth <= strip.clientWidth + 2) continue;
      const current = strip.querySelector('[aria-current], a.active, button.active');
      if (!current) continue;
      const bounds = strip.getBoundingClientRect();
      const box = current.getBoundingClientRect();
      if (box.left < bounds.left - 1 || box.right > bounds.right + 1) {
        out.push(
          `HIDDEN CURRENT ${name(strip)} "${(current.textContent ?? '').trim().slice(0, 24)}"`,
        );
      }
    }

    return [...new Set(out)];
  }, defaults);
}

for (const theme of ['light', 'dark'] as const) {
  test(`v244 the layout rules hold across the application in ${theme}`, async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop', 'This walk drives its own viewport sizes.');
    test.setTimeout(900_000);

    await page.addInitScript((value: string) => {
      try {
        window.localStorage.setItem('tamco-focus-theme', value);
      } catch {
        /* a private window has no storage; the default theme is fine */
      }
    }, theme);

    const found: string[] = [];
    let pagesSeen = 0;

    for (const who of ROUTES) {
      await signIn(page, who.email);
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 1000 });
        for (const url of who.pages) {
          const response = await page.goto(url);
          if ((response?.status() ?? 0) >= 400) {
            found.push(`${width} ${url}: HTTP ${response?.status()}`);
            continue;
          }
          // The workspace streams in behind the hydration marker, so wait for
          // something the page itself renders before measuring it.
          await page
            .locator('main#main, .esh-app')
            .first()
            .waitFor({ state: 'visible', timeout: 20_000 });
          await page.waitForTimeout(350);
          pagesSeen += 1;

          for (const breach of await breaches(page, UNSTYLED_LINK)) {
            found.push(`${width} ${url}: ${breach}`);
          }
        }
      }
    }

    /*
     * And the drawer, which is not a route: it opens over one, and its sections
     * are shut until somebody opens them, so the walk above sees none of it.
     *
     * `opened` is asserted because the first version of this clicked nothing —
     * the sections are accordion buttons, not <summary> elements — and reported
     * a shut drawer as clean.
     */
    await page.setViewportSize({ width: 390, height: 1000 });
    // Back to somebody who carries work: the loop above ends as an
    // administrator, whose Active list is empty.
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work?tab=active');
    /*
     * `.title-link` is what a work row's primary link is called. Written as
     * `.row-primary-link` first, this matched nothing, the whole block was
     * skipped, and breaking the section selector on purpose still passed —
     * a guard that guarded nothing. So the row is asserted, not tested for.
     */
    const firstRow = page.locator('.task-row .title-link, .task-row .row-primary-link').first();
    await expect(firstRow, 'no work row to open a drawer from').toBeVisible({ timeout: 20_000 });
    {
      await firstRow.click();
      const drawer = page.locator('.task-detail-drawer');
      await expect(drawer).toBeVisible({ timeout: 20_000 });
      const sections = drawer.locator('.task-accordion-summary');
      const opened = await sections.count();
      expect(opened, 'the drawer offered no sections to open').toBeGreaterThan(0);
      for (let index = 0; index < opened; index += 1) {
        await sections
          .nth(index)
          .click({ timeout: 5_000 })
          .catch(() => undefined);
      }
      await page.waitForTimeout(400);
      for (const breach of await breaches(page, UNSTYLED_LINK)) {
        found.push(`drawer open: ${breach}`);
      }
    }

    await info.attach(`breaches-${theme}`, {
      body: found.join('\n') || 'none',
      contentType: 'text/plain',
    });
    /*
     * Refuses to pass having looked at nothing. Two tests earlier in this work
     * passed against the very defects they were written for, both because they
     * measured something that could not have differed.
     */
    expect(pagesSeen, 'no pages were measured').toBeGreaterThan(40);
    expect(found, 'layout rules broken').toEqual([]);
  });
}
