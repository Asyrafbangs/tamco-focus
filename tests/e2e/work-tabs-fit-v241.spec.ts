import { expect, test, type Page } from '@playwright/test';

/**
 * v241 — every state My Work offers is on screen, including the one you are on.
 *
 * The four states are a scrolling strip, and at 150px apiece they needed more
 * room than a phone or a tablet has once the More control takes its share. One
 * of them was always off the end — and on Shared or Completed it was the ACTIVE
 * one, so the strip showed a clipped dark sliver beside More and nothing said
 * which list was being read.
 *
 * A scrolling strip is a reasonable pattern. Hiding the tab you are standing on
 * is not.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

/** Which tabs are fully inside the strip that holds them, across every strip. */
async function tabsOnScreen(page: Page) {
  return page.evaluate(() => {
    const strips = [...document.querySelectorAll('.focus-tabs')];
    if (strips.length === 0) return null;
    return strips.flatMap((strip) => {
      const bounds = strip.getBoundingClientRect();
      return [...strip.querySelectorAll('a')].map((tab) => {
        const box = tab.getBoundingClientRect();
        return {
          label: (tab.textContent ?? '').trim(),
          active: tab.getAttribute('aria-current') === 'page' || tab.classList.contains('active'),
          whole: box.left >= bounds.left - 1 && box.right <= bounds.right + 1,
        };
      });
    });
  });
}

test('v241 every work state is on screen at every width', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'This drives its own viewport sizes.');
  test.setTimeout(240_000);
  await signIn(page);

  const missing: string[] = [];
  /*
   * Every strip the app has, not only My Work's. There are four of them and
   * none holds more than four tabs; Routine's three were cut at 390 for the
   * same reason My Work's were, and the Team views strip lost "Recent
   * activity" the same way.
   */
  const PLACES = [
    '/work?tab=active',
    '/work?tab=available',
    '/work?tab=shared',
    '/work?tab=completed',
    '/work/routine',
    '/work/routine?view=upcoming',
  ];
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const tab of PLACES) {
      await page.goto(tab);
      await page.locator('.focus-tabs').first().waitFor({ state: 'visible' });
      const tabs = await tabsOnScreen(page);
      expect(tabs, 'the work tab row is missing').not.toBeNull();
      for (const one of tabs!) {
        if (!one.whole) missing.push(`${width}px on ${tab}: "${one.label}" is cut off`);
      }
      /*
       * Said separately, because this is the half that makes the screen
       * unreadable rather than merely incomplete: whatever else scrolls, the
       * tab you are standing on has to be visible.
       */
      const current = tabs!.find((one) => one.active);
      if (current && !current.whole) {
        missing.push(`${width}px on ${tab}: the ACTIVE tab "${current.label}" is cut off`);
      }
    }
  }

  await info.attach('tabs', {
    body: missing.join('\n') || 'all on screen',
    contentType: 'text/plain',
  });
  expect(missing, 'work state tabs cut off').toEqual([]);
});
