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
