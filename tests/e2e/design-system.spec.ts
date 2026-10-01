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

    // Values from the prototype's second :root block.
    expect(tokens).toEqual({
      contentMax: '1440px',
      controlHeight: '38px',
      pageGap: '20px',
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

    expect(maxWidth).toBe('1440px');
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
   * The panels are hidden by default and revealed by an enumerated list of
   * `[data-active='x'] [data-settings-panel='x']` rules. Adding a section
   * without adding its line leaves it `display: none` for good - navigable,
   * present in the DOM, and invisible. That is a silent failure no type
   * checker can see, so it is checked here.
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
  const SCALE = [
    8, 9, 9.5, 10, 10.5, 11, 11.5, 12, 12.5,
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
  test('every control is at least 44px tall on mobile', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'Touch sizing applies to the mobile build.');
    await signIn(page);

    // `.btn.small`, `.why-btn`, and `.theme-toggle` each declare their own
    // height after `.btn` in the cascade, so a rule on `.btn` alone left them
    // at 36-42px. This asserts the measured result rather than the rule.
    const undersized = await page.evaluate(() =>
      [...document.querySelectorAll('button, a.btn, .mobile-nav a, input, select, .why-btn')]
        .map((element) => ({
          label: (element.textContent ?? '').trim().slice(0, 24) || element.tagName,
          height: Math.round(element.getBoundingClientRect().height),
        }))
        .filter((entry) => entry.height > 0 && entry.height < 44),
    );

    expect(undersized).toEqual([]);
  });
});
