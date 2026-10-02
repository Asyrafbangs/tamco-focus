import { expect, test, type Page } from '@playwright/test';

/**
 * v242 — nothing sticks out through the side of the card it lives in.
 *
 * The Monthly Plan draws each day as a card and each item inside it as a row
 * with a meta line: a glyph, the kind of work, and chips such as "Review by".
 * Every child of that line is `flex: none`, so where a day card was narrow
 * enough the chip did not wrap or shrink — it carried on out through the side
 * of the card, 11px past the edge at 768.
 *
 * The page stayed exactly as wide as it was, so no overflow check saw it. What
 * finds this is asking where a thing is relative to the thing containing it.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

test('v242 nothing on the Monthly Plan escapes its day', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'This drives its own viewport sizes.');
  test.setTimeout(240_000);
  await signIn(page);

  const escaped: string[] = [];
  let daysSeen = 0;
  for (const width of [390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto('/plan');
    await page.locator('main#main').waitFor({ state: 'visible' });
    /*
     * §17.4 gives a phone a date-grouped agenda rather than the month grid, so
     * `.day` is simply absent at the narrowest width. That is not a failure;
     * checking nothing at every width would be, which is what `daysSeen`
     * refuses at the end.
     */
    await page.waitForTimeout(600);
    daysSeen += await page.locator('.day').count();

    const found = await page.evaluate(() => {
      const out: string[] = [];
      for (const day of document.querySelectorAll('.day')) {
        const bounds = day.getBoundingClientRect();
        for (const element of day.querySelectorAll('*')) {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;
          if (box.right > bounds.right + 2 || box.left < bounds.left - 2) {
            out.push(
              `${element.tagName.toLowerCase()}.${(element.className || '').toString().split(' ').slice(0, 2).join('.')} "${(element.textContent ?? '').trim().slice(0, 24)}" ends ${Math.round(box.right - bounds.right)}px past its day`,
            );
          }
        }
      }
      return [...new Set(out)];
    });
    for (const one of found) escaped.push(`${width}px: ${one}`);
  }

  await info.attach('escapes', {
    body: escaped.join('\n') || 'nothing escapes',
    contentType: 'text/plain',
  });
  expect(daysSeen, 'no day cards were rendered at any width').toBeGreaterThan(0);
  expect(escaped, 'items reaching past the day that holds them').toEqual([]);
});
