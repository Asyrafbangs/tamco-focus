import { expect, test, type Page } from '@playwright/test';

/**
 * v240 — a work row on a phone ends on one line, not three.
 *
 * Stacking every cell gave the badges a line of their own, right-aligned
 * against nothing, and then the chevron a line of its own below that,
 * left-aligned against nothing. Two ragged lines of chrome under every row,
 * on the screen with the least room for them.
 *
 * Neither changed the page's width, so no overflow check could see it. What
 * this asks is where things sit relative to each other, which is the question
 * the eye asks.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

test.describe('v240 the work row on a phone', () => {
  test.beforeEach(async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'A phone rule.');
    await signIn(page);
    await page.goto('/work?tab=active');
    await expect(page.locator('.task-row').first()).toBeVisible();
  });

  test('the badges start where the title starts', async ({ page }) => {
    const ragged = await page.evaluate(() => {
      const out: string[] = [];
      for (const row of document.querySelectorAll('.task-row')) {
        /*
         * The first badge, not the strip that holds it. The strip spans the
         * full width whether its content is pushed right or left, so measuring
         * the container answers nothing — it passed against the defect.
         */
        const flags = row.querySelector('.row-flags > *');
        const title = row.querySelector('.title-link, .row-primary-link');
        if (!flags || !title) continue;
        const left = Math.round(flags.getBoundingClientRect().left);
        const titleLeft = Math.round(title.getBoundingClientRect().left);
        // Right-aligned against nothing is what this is here to catch: on a
        // phone the badges were pushed to the far edge of a full-width row.
        if (Math.abs(left - titleLeft) > 2) {
          out.push(
            `"${(title.textContent ?? '').trim().slice(0, 30)}" flags at ${left}, title at ${titleLeft}`,
          );
        }
      }
      return out;
    });
    expect(ragged, 'badges not aligned with the title').toEqual([]);
  });

  test('the chevron shares the badges’ line rather than taking its own', async ({ page }) => {
    const stranded = await page.evaluate(() => {
      const out: string[] = [];
      for (const row of document.querySelectorAll('.task-row')) {
        const chevron = row.querySelector(':scope > .row-chevron');
        const flags = row.querySelector(':scope > .row-flags');
        if (!chevron || !flags) continue;
        const one = chevron.getBoundingClientRect();
        const two = flags.getBoundingClientRect();
        // Sharing a line: their vertical spans overlap.
        if (one.top >= two.bottom - 1 || one.bottom <= two.top + 1) {
          out.push(
            `chevron at ${Math.round(one.top)}..${Math.round(one.bottom)} vs badges ${Math.round(two.top)}..${Math.round(two.bottom)}`,
          );
        }
        // And it ends the line rather than starting it.
        const row_ = row.getBoundingClientRect();
        if (one.right < row_.left + row_.width / 2) {
          out.push(`chevron sits at the left of its row (${Math.round(one.right)})`);
        }
      }
      return out;
    });
    expect(stranded, 'the chevron is on a line of its own').toEqual([]);
  });
});
