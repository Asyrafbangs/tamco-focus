import { expect, test } from '@playwright/test';

/**
 * Guards the design tokens and responsive rules reconciled against the approved
 * prototype (`Building Specification/index (1).html`).
 *
 * These assert measured, computed values rather than the presence of a class,
 * because the regressions they exist to catch were all cascade problems: a rule
 * was written, looked right in the stylesheet, and lost to a more specific
 * selector declared later.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: import('@playwright/test').Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL(/\/(today|work|plan|more|team)/);
}

test.describe('design tokens match the approved prototype', () => {
  test('the shared dimension tokens are defined and applied', async ({ page }) => {
    await signIn(page);

    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const read = (name: string) => style.getPropertyValue(name).trim();
      return {
        contentMax: read('--content-max'),
        controlHeight: read('--control-h'),
        pageGap: read('--page-gap'),
        sectionGap: read('--section-gap'),
        radius: read('--radius'),
        radiusSmall: read('--radius-sm'),
      };
    });

    /*
     * The prototype's second :root block, except for the two the density brief
     * of v249 set deliberately: the content column came in from 1440px so a
     * row's three columns stay readable instead of stretching across a wide
     * screen, and the page gap from 20px as part of tightening the vertical
     * rhythm. Both are the values asked for, so this guard follows them.
     */
    expect(tokens).toEqual({
      contentMax: '1200px',
      controlHeight: '38px',
      pageGap: '16px',
      sectionGap: '16px',
      radius: '14px',
      radiusSmall: '10px',
    });
  });

  test('the content column is bounded by the token, not a literal', async ({ page }) => {
    await signIn(page);

    const maxWidth = await page
      .locator('.main')
      .evaluate((element) => getComputedStyle(element).maxWidth);

    // Reads the token, so it moves with it (v249: 1440px -> 1200px).
    expect(maxWidth).toBe('1200px');
  });

  test('the app shell matches the prototype rail and header', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'mobile', 'The rail is replaced by bottom navigation.');
    await signIn(page);

    const rail = await page.locator('.rail').boundingBox();
    const topbar = await page.locator('.topbar').boundingBox();

    // Prototype values. These previously read 72/68 to match a shell that had
    // drifted; the assertion is the guard, so it follows the prototype and the
    // stylesheet was corrected instead.
    expect(Math.round(rail?.width ?? 0)).toBe(76);
    expect(Math.round(topbar?.height ?? 0)).toBe(72);
  });
});

test.describe('responsive behaviour', () => {
  test('mobile replaces the rail with bottom navigation and clears it', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Mobile-only rule.');
    await signIn(page);

    await expect(page.locator('.rail')).toBeHidden();
    await expect(page.locator('.mobile-nav')).toBeVisible();

    // Content must not sit underneath the fixed bottom navigation.
    const clearance = await page.evaluate(() => {
      const nav = document.querySelector('.mobile-nav');
      const main = document.querySelector('.main');
      if (!nav || !main) return null;
      return {
        navHeight: Math.round(nav.getBoundingClientRect().height),
        mainPaddingBottom: parseInt(getComputedStyle(main).paddingBottom, 10),
      };
    });

    expect(clearance).not.toBeNull();
    expect(clearance!.mainPaddingBottom).toBeGreaterThanOrEqual(clearance!.navHeight);
  });

  test('no page scrolls horizontally', async ({ page }) => {
    await signIn(page);

    for (const path of [
      '/today',
      '/work',
      '/work/routine',
      '/goals',
      '/plan',
      '/more',
      '/more/records',
      '/more/settings',
    ]) {
      await page.goto(path);
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      );
      expect(overflows, `${path} scrolls horizontally`).toBe(false);
    }
  });
});

test.describe('settings sections', () => {
  /**
   * Every section shows its panel.
   *
   * This used to guard an enumerated list of
   * `[data-active='x'] [data-settings-panel='x']` rules, where a section added
   * without its line was `display: none` for good - navigable, present in the
   * DOM, and invisible. v305 took the list away: `SettingsPanel` sets `hidden`
   * from the open section the workspace already holds, `page.tsx` builds its
   * panels as a `Record<SettingsKey, ReactNode>` so a section without one is a
   * type error, and `tests/unit/settings-sections-v305.test.ts` asserts both
   * shapes without a browser.
   *
   * It stays because none of that measures a panel. A rule elsewhere in a
   * 17,000-line stylesheet can still collapse one, and only a rendered page
   * knows.
   */
  test('each one reveals a panel with something in it', async ({ page }) => {
    await signIn(page);
    await page.goto('/more/settings');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const sections = await page.evaluate(() =>
      [...document.querySelectorAll('[data-settings-panel]')].map((panel) =>
        panel.getAttribute('data-settings-panel'),
      ),
    );
    expect(sections.length).toBeGreaterThan(5);

    const invisible: string[] = [];
    for (const section of sections) {
      await page.goto(`/more/settings?section=${section}`);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      /*
       * The hydration marker is not this page.
       *
       * It goes up from the root layout, and the workspace streams in behind
       * `loading.tsx` afterwards. Measuring a panel on the marker alone can
       * measure the placeholder, which has no panel in it — so this reported
       * "alerts" as a section whose panel never displays, which is exactly the
       * silent failure it exists to catch, from a page that had not arrived.
       *
       * Waiting for any panel to be attached is not circular: every panel is
       * in the DOM whatever the active section, and hidden by CSS. It proves
       * the page rendered without asserting anything about this one.
       */
      await page.locator('[data-settings-panel]').first().waitFor({ state: 'attached' });
      const shown = await page.evaluate((key) => {
        const panel = document.querySelector(`[data-settings-panel="${key}"]`);
        if (!panel) return false;
        const box = panel.getBoundingClientRect();
        return box.height > 0 && box.width > 0;
      }, section);
      if (!shown) invisible.push(String(section));
    }

    expect(invisible, 'settings sections whose panel never displays').toEqual([]);
  });
});

test.describe('typography', () => {
  /**
   * The type scale, locked.
   *
   * 444 font-size rules had grown to twenty-two distinct values, including
   * 8.7px and 9.8px - arithmetic that escaped into the stylesheet rather than
   * sizes anybody chose. Rounding them was the easy half; this is the half
   * that stops it happening again, because a scale nothing enforces is a
   * suggestion.
   *
   * Measured on the rendered page rather than read from the stylesheet, so it
   * covers inline styles and anything a component sets for itself.
   */
  /*
   * v304 — the floor is 12px, and the scale starts there.
   *
   * The steps below 12 are gone. Seven of them (8, 9, 9.5, 10, 10.5, 11, 11.5)
   * covered 415 declarations, including a person's name at 11px and section
   * labels at 9px, and nothing enforced a minimum because the floor was never
   * stated. They are now one token, `--text-xs`, at 12px — the smallest size
   * this product asks anybody to read.
   *
   * Keeping them listed here would let the next 9px rule back in, which is the
   * whole point of locking a scale.
   */
  const SCALE = [
    12, 12.5,
    // The inherited base, from `body { font: calc(13.5px * var(--font-scale)) }`.
    // Anything that sets no size of its own lands here.
    13.5, 13, 14, 15, 16, 17, 18, 20, 21, 22, 24, 25, 26, 28,
    // Browser defaults on elements the product does not size itself.
    32, 37.3281,
  ];

  test('every rendered size is a step on the scale', async ({ page }) => {
    await signIn(page);

    const offScale = new Map<number, string>();
    for (const path of ['/today', '/work', '/work/routine', '/goals', '/plan', '/more/settings']) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      const found = await page.evaluate(() =>
        [...document.querySelectorAll('body *')]
          .filter((element) => {
            const text = [...element.childNodes].some(
              (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim(),
            );
            if (!text || (element as HTMLElement).offsetParent === null) return false;
            /*
             * Screen-reader-only text has no visual size to be consistent with.
             * aria-hidden text is the opposite case - on screen, kept only from
             * the screen reader - and it is where a calendar entry's visible
             * label lives, so skipping it let v163's 8.3px meta lines and 7.6px
             * chips through unmeasured.
             */
            return !element.closest('.visually-hidden');
          })
          .map((element) => ({
            size: Number.parseFloat(getComputedStyle(element).fontSize),
            label: element.className || element.tagName,
          })),
      );
      for (const entry of found) {
        if (!Number.isFinite(entry.size)) continue;
        if (!SCALE.some((step) => Math.abs(step - entry.size) < 0.02)) {
          offScale.set(entry.size, `${path} · ${String(entry.label).slice(0, 40)}`);
        }
      }
    }

    expect(
      [...offScale.entries()].map(([size, where]) => `${size}px on ${where}`),
      'font sizes outside the scale',
    ).toEqual([]);
  });
});

test.describe('touch targets', () => {
  /**
   * v302 — both dimensions, every control, across the product.
   *
   * The previous form of this test measured `height` alone, on whichever page
   * sign-in landed on, over six hand-listed selectors. All three narrowed it
   * until it could not see what an audit crawl then found: "ESH Home" at
   * 30px wide, the month pager at 35px wide, and the My Day counts, the
   * Monthly Plan and Routines scope switches and the Records row actions —
   * all plain `a` elements, 16-38px, matched by none of those selectors.
   *
   * It runs on the mobile project because that is what reports
   * `pointer: coarse`; a 390px desktop window does not, and under it the
   * stylesheet's touch rules are inert. An audit run that way reported
   * `.cal-item-move` as 22px wide when on a real phone it is 44.
   */
  const ROUTES = [
    '/today',
    '/work',
    '/work/routine',
    '/plan',
    '/goals',
    '/capture',
    '/more',
    '/more/settings',
    '/more/attachments',
  ];

  test('every control is at least 44px in both directions on mobile', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Touch sizing applies to the mobile build.');
    await signIn(page);

    const undersized: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });

      const found = await page.evaluate(() => {
        const selector =
          'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]';
        const small: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          // Hidden inputs behind their own styled button are the correct
          // pattern, not a small target.
          if (el.closest('.visually-hidden')) continue;
          const style = getComputedStyle(el);
          if (style.visibility === 'hidden' || style.display === 'none') continue;
          if (parseFloat(style.opacity) === 0) continue;

          // What a finger actually aims at is not always the element itself.
          // A checkbox is aimed at through the row that labels it, and a row's
          // title link through the row, which is clickable along its whole
          // width (v181). Measuring the inline text instead would demand 44px
          // of every list row and reopen the settled 39px one-line row.
          const input = el as HTMLInputElement;
          let measured: HTMLElement = el;
          const after = getComputedStyle(el, '::after');
          if (input.type === 'checkbox' || input.type === 'radio') {
            measured = (el.closest('label') as HTMLElement | null) ?? el;
          } else if (after.content !== 'none' && after.position === 'absolute') {
            // The stretched-link pattern: `.row-primary-link::after` is
            // `position: absolute; inset: 0`, so the row is the hit area and
            // the 16px of text is only its label. Measure what is pressable.
            measured = (el.offsetParent as HTMLElement | null) ?? el;
          }
          /*
           * Layout size, not painted size. New Work is a dialog, and while its
           * opening transform is still running `getBoundingClientRect` returns
           * the scaled box — every 44px control in it measures 43 and reads as
           * a defect. v183 settled this: measure `offsetWidth`/`offsetHeight`.
           */
          const width = measured.offsetWidth;
          const height = measured.offsetHeight;
          if (width === 0 || height === 0) continue;
          if (width >= 44 && height >= 44) continue;
          const box = { width, height };

          const name = (
            el.getAttribute('aria-label') ||
            el.id ||
            el.getAttribute('name') ||
            el.textContent ||
            el.tagName
          )
            .trim()
            .slice(0, 40);
          small.push(
            `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).trim().split(/\s+/).join('.')}` : ''} "${name}" — ${Math.round(box.width)}×${Math.round(box.height)}px`,
          );
        }
        return [...new Set(small)];
      });

      undersized.push(...found.map((entry) => `${route} · ${entry}`));
    }

    expect(undersized, 'controls under 44px on a touch screen').toEqual([]);
  });
});
