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

/** Every screen a signed-in person reaches from the navigation. */
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
   * DOM, and invisible. v316 took the list away: `SettingsPanel` sets `hidden`
   * from the open section the workspace already holds, `page.tsx` builds its
   * panels as a `Record<SettingsKey, ReactNode>` so a section without one is a
   * type error, and `tests/unit/settings-sections-v316.test.ts` asserts both
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
      /*
       * Wait for THIS section's panel, not for any panel.
       *
       * These are client-side navigations, so the previous section's panels
       * are still attached when the next one is still streaming — `.first()`
       * was satisfied instantly by the page being replaced, and the section
       * actually asked for was not in the DOM yet. It was then recorded as
       * "never displays", which is how this test came and went depending on
       * how far down the list a section sat. Attachment is not visibility:
       * the assertion below still has to find a real box.
       */
      await page
        .locator(`[data-settings-panel="${section}"]`)
        .waitFor({ state: 'attached', timeout: 15_000 });
      await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 15_000 });
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

  /**
   * The scale moves when a reader asks it to.
   *
   * The test above locks which sizes exist. It says nothing about whether a
   * person can change them, and a rule writing a literal `14px` passes it
   * perfectly while ignoring 22.2's personal text-size setting entirely —
   * only `calc(... * var(--font-scale))` and the tokens built on it move when
   * somebody chooses Large or Largest. v312 put the floor on the setting and
   * left every other step a literal, so Large reached inherited body text and
   * nothing a component sized for itself: 140 declarations across ten
   * stylesheets, plus three inline `fontSize` values, one of them an 11px
   * line on the sign-in page that was under the floor as well.
   *
   * v315 checked this on Plan and Goals, scoped by a regular expression to
   * the classes those two screens declare for themselves, and said in as many
   * words that somebody had to own widening it rather than allow-listing the
   * shared classes it could not reach. This is that widening: the whole
   * product, every element, no filter. It lives here because what it guards
   * is the scale, not those two screens.
   */
  test('every size moves with the personal text setting', async ({ page }) => {
    await signIn(page);

    /*
     * Mark every element that is rendered and carries text of its own, and
     * say how many there were.
     *
     * Stamping rather than collecting, because the two measurements have to be
     * of the same elements. The guard used to compare `before[i]` with
     * `after[i]`: the same element only while nothing in the document moves,
     * so anything inserted, removed or reordered between the passes shifted
     * the pairing silently and the guard could compare a heading's size with
     * a caption's. Reading the stamp back compares like with like, and makes
     * the count a check rather than a dependency.
     */
    const stamp = () =>
      page.evaluate(() => {
        for (const marked of document.querySelectorAll('[data-scale-probe]')) {
          delete (marked as HTMLElement).dataset.scaleProbe;
        }
        let index = 0;
        for (const element of document.querySelectorAll('body *')) {
          const node = element as HTMLElement;
          if (node.closest('.visually-hidden')) continue;
          if (node.offsetParent === null) continue;
          const ownText = [...node.childNodes].some(
            (child) => child.nodeType === Node.TEXT_NODE && (child.textContent ?? '').trim(),
          );
          if (!ownText) continue;
          node.dataset.scaleProbe = String(index);
          index += 1;
        }
        return index;
      });

    const readStamped = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('[data-scale-probe]')].map((element) => ({
          id: (element as HTMLElement).dataset.scaleProbe!,
          size: Number.parseFloat(getComputedStyle(element).fontSize),
          label: `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`,
        })),
      );

    /*
     * Stamp until the page stops arriving, and leave it stamped.
     *
     * Hydration and the loading skeleton are both waited for below, and
     * neither is the end of the rendering: `/capture` holds 55 eligible
     * elements at that point and 87 a tenth of a second later. Measuring
     * there and again after a 400ms pause compared two different populations,
     * which is what failed in CI on 9 November — 53 against 85 — and
     * intermittently before it.
     *
     * Two identical counts in a row rather than one, because a single match
     * can be two polls either side of one insertion.
     */
    const settle = async (path: string) => {
      let previous = -1;
      let steady = 0;
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const count = await stamp();
        steady = count === previous ? steady + 1 : 0;
        previous = count;
        if (steady >= 2) return count;
        await page.waitForTimeout(120);
      }
      throw new Error(`${path} never stopped rendering; the last count was ${previous}`);
    };

    const SCALE = 1.25;
    const fixed = new Set<string>();
    let compared = 0;

    for (const path of ROUTES) {
      await page.goto(path);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });

      const stamped = await settle(path);
      expect(stamped, `${path} renders text`).toBeGreaterThan(0);
      const before = new Map((await readStamped()).map((entry) => [entry.id, entry]));

      await page.evaluate(() => {
        document.documentElement.dataset.textSize = 'larger';
      });
      /*
       * Let the new size finish arriving.
       *
       * `font-size` is an animatable property, and a rule that transitions
       * every property animates it: the rail's hover label carries a bare
       * `transition: 0.15s`, so a measurement taken on the next tick reads
       * the size it is leaving, not the one it is going to, and the label
       * reported 12px on all nine routes. v183 settled the same class of
       * artefact for the box model by measuring layout rather than paint.
       * 150ms is the longest transition in the stylesheet.
       */
      await page.waitForTimeout(400);
      const after = await readStamped();

      /*
       * Everything stamped is still there to be read. The settle above is what
       * makes that true; if it stops being true this says so rather than
       * quietly checking a smaller page.
       */
      expect(after.length, `${path} lost stamped elements between the two measurements`).toBe(
        stamped,
      );

      for (const now of after) {
        const was = before.get(now.id);
        if (!was) continue;
        // A glyph hidden behind a pseudo element has no size to scale.
        if (was.size === 0) continue;
        compared += 1;
        if (Math.abs(now.size / was.size - SCALE) < 0.02) continue;
        fixed.add(`${path} · ${was.label} stayed at ${was.size}px`);
      }

      await page.evaluate(() => {
        delete document.documentElement.dataset.textSize;
        for (const marked of document.querySelectorAll('[data-scale-probe]')) {
          delete (marked as HTMLElement).dataset.scaleProbe;
        }
      });
    }

    /*
     * And it looked at something.
     *
     * A filter that stops matching, or a settle that returns an empty page,
     * would otherwise leave this reporting an empty set of faults from an
     * empty set of measurements — which is the shape every vacuous guard in
     * this repository has had. The floor is well under the ~1,400 the nine
     * routes currently yield, so it catches collapse rather than drift.
     */
    expect(compared, 'sizes actually compared across the product').toBeGreaterThan(400);
    expect([...fixed], 'sizes the text-size setting cannot reach').toEqual([]);
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

  test('every control is at least 44px in both directions on mobile', async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Touch sizing applies to the mobile build.');
    await signIn(page);

    const undersized: string[] = [];
    /*
     * What the crawl actually looked at, per route.
     *
     * This test reported green for as long as it has existed and then failed
     * the moment a gate run happened to leave attachments behind, because
     * `/more/attachments` is empty on a clean database and a route with no
     * rows has nothing to measure. A count of zero is not a pass, so each
     * route has to yield controls, and the stretched-link branch — the one
     * that was measuring the wrong box — has to run somewhere.
     */
    const inspected = new Map<string, number>();
    let stretched = 0;
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });

      const found = await page.evaluate(() => {
        let seen = 0;
        let rows = 0;
        const selector =
          'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]';
        const small: string[] = [];
        for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          // Hidden inputs behind their own styled button are the correct
          // pattern, not a small target.
          if (el.closest('.visually-hidden')) continue;
          seen += 1;
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
            /*
             * The stretched-link pattern: `.row-primary-link::after` is
             * `position: absolute; inset: 0`, so the row is the hit area and
             * the 16px of text is only its label. Measure what is pressable.
             *
             * That box is the containing block of the pseudo-element — the
             * nearest ancestor that is positioned — and NOT `offsetParent`.
             * For anything inside a table `offsetParent` is the nearest
             * `td`/`th`/`table` whether or not it is positioned, so the ten
             * rows of `/more/attachments` reported 338x39px: the width of the
             * first cell and the height of its two lines of text. The row
             * itself is `.interactive-row { position: relative }` and measures
             * 362x127px on a phone, which is what a finger lands on. Walk up
             * to it instead.
             */
            let block = el.parentElement;
            while (block && getComputedStyle(block).position === 'static') {
              block = block.parentElement;
            }
            measured = block ?? (el.offsetParent as HTMLElement | null) ?? el;
            rows += 1;
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
        return { small: [...new Set(small)], seen, rows };
      });

      inspected.set(route, found.seen);
      stretched += found.rows;
      undersized.push(...found.small.map((entry) => `${route} · ${entry}`));
    }

    expect(
      [...inspected].filter(([, count]) => count === 0).map(([route]) => route),
      'routes where the crawl measured no controls at all',
    ).toEqual([]);
    expect(stretched, 'stretched row links measured').toBeGreaterThan(0);
    expect(undersized, 'controls under 44px on a touch screen').toEqual([]);
  });
});
