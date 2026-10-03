import { expect, test, type Page } from '@playwright/test';

/**
 * v252 — a team row's title stays on one line, whatever the title says.
 *
 * The one-line row is a decision, not an accident: three columns were chosen
 * over a two-line title-above-meta form so a manager sees about twenty-six rows
 * at once instead of thirteen. Nothing was holding it up. v235 guards what a
 * row *says* and `design-system` guards the tokens, but until this test no spec
 * measured the height of a row anywhere in the suite, so the form could drift
 * back a line at a time without a single failure.
 *
 * It was already able to drift. The owner and reason cells clamp with
 * `white-space: nowrap` and an ellipsis; the title did not clamp at all, and
 * the title is the one column that narrows as the window does
 * (`minmax(0, 1fr)`), so a real title can wrap above the 860px stacking
 * breakpoint and take the row to two lines. That is the "lots of overflow text"
 * reported from production twice.
 *
 * The local seed cannot show it: its titles are a few words long where
 * production's run to sixty-odd characters. So the titles are replaced here
 * with ones that length. The CSS is what is under test, not the fixture.
 *
 * Recent activity is deliberately taller than the other two: a note and any
 * finding sit under its title, which is the density that makes a week readable
 * in a minute. So the rule asserted everywhere is about the *title*, and only
 * the row budget differs.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** A real title's shape: a sentence, not a label. 64 characters. */
const LONG_TITLE = 'Close out the corrective actions raised in the June internal audit';

/**
 * Above the 860px breakpoint, where the columns apply. Below it the row is
 * deliberately a stack and is taller, so measuring there would assert the
 * opposite of what this protects.
 */
const WIDTHS = [900, 1100, 1440];

const VIEWS: Array<{ name: string; url: string; row: string; title: string; maxRow: number }> = [
  {
    name: 'Waiting',
    // `available` is the Waiting list. `attention` is the people table, which
    // holds no rows of this kind — the first version of this test measured that
    // and reported nothing wrong, three widths in a row.
    url: '/work?scope=team&filter=available',
    row: '.team-waiting-row',
    title: '.team-waiting-main .row-primary-link',
    /*
     * One line of 15px text in a row padded 9px top and bottom measures 38px. A
     * two-line row is 56px or more, and the two-line brief that was turned down
     * asked for 52-58px, so 46px sits in the gap: loose enough for a font or
     * padding change, far too tight for a second line.
     */
    maxRow: 46,
  },
  {
    name: 'Completed',
    url: '/work?scope=team&filter=delivered',
    row: '.team-delivered-row',
    title: '.team-delivered-main .row-primary-link',
    maxRow: 46,
  },
  {
    name: 'Recent activity',
    url: '/work?scope=team&filter=updates',
    row: '.team-activity-row',
    title: '.team-activity-main .row-primary-link',
    // Measures 56px with a note under the title, which is intended. A wrapped
    // title would add a line on top of that.
    maxRow: 72,
  },
];

async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work)/, { timeout: 30_000 });
}

test('v252 a team row title holds one line at every width that uses columns', async ({
  page,
}, info) => {
  test.skip(info.project.name !== 'desktop', 'This test drives its own viewport sizes.');
  test.setTimeout(180_000);

  await signIn(page);

  const wrapped: string[] = [];
  const tall: string[] = [];
  let measured = 0;
  let waitingSeen = 0;

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });

    for (const view of VIEWS) {
      await page.goto(view.url);
      await page.locator('main#main').waitFor({ state: 'visible', timeout: 20_000 });

      const rows = page.locator(view.row);
      if ((await rows.count()) === 0) continue;
      /*
       * Wait for the row to be laid out, not merely present. Measured straight
       * after the navigation, every row reported a height of 0 and both
       * assertions below became unfireable - the rows were in the document
       * before the workspace had streamed in.
       */
      await rows.first().waitFor({ state: 'visible', timeout: 20_000 });
      await expect
        .poll(async () => (await rows.first().boundingBox())?.height ?? 0, { timeout: 10_000 })
        .toBeGreaterThan(0);

      // Give every row a production-length title before measuring.
      const replaced = await page.evaluate(
        ({ selector, text }) => {
          const titles = document.querySelectorAll(selector);
          for (const title of titles) title.textContent = text;
          return titles.length;
        },
        { selector: view.title, text: LONG_TITLE },
      );
      expect(
        replaced,
        `${width} ${view.name}: nothing matched "${view.title}", so no title was lengthened`,
      ).toBeGreaterThan(0);

      const found = await rows.evaluateAll(
        (elements, titleSelector) =>
          elements.slice(0, 12).map((element, index) => {
            const title = element.querySelector(titleSelector.split(' ').pop() ?? 'a');
            const lineHeight = title ? parseFloat(getComputedStyle(title).lineHeight) : 0;
            const titleHeight = title?.getBoundingClientRect().height ?? 0;
            return {
              index,
              rowHeight: Math.round(element.getBoundingClientRect().height),
              lineHeight: Math.round(lineHeight),
              titleHeight: Math.round(titleHeight),
              // Rounded down, so a title exactly one line tall reads as 1 even
              // when the line box is a fraction taller than the font.
              lines: lineHeight > 0 ? Math.floor(titleHeight / lineHeight + 0.15) : -1,
            };
          }),
        view.title,
      );

      measured += found.length;
      if (view.name === 'Waiting') waitingSeen += found.length;

      for (const row of found) {
        expect(
          row.lineHeight,
          `${width} ${view.name} row ${row.index}: line-height did not resolve to a number, so the line count means nothing`,
        ).toBeGreaterThan(0);
        if (row.lines > 1) {
          wrapped.push(
            `${width} ${view.name} row ${row.index}: title on ${row.lines} lines (${row.titleHeight}px over a ${row.lineHeight}px line)`,
          );
        }
        if (row.rowHeight > view.maxRow) {
          tall.push(
            `${width} ${view.name} row ${row.index}: ${row.rowHeight}px, over its ${view.maxRow}px budget`,
          );
        }
      }
    }
  }

  await info.attach('rows-measured', {
    body: `${measured} rows (${waitingSeen} waiting)\nwrapped:\n${wrapped.join('\n') || 'none'}\ntall:\n${tall.join('\n') || 'none'}`,
    contentType: 'text/plain',
  });

  /*
   * Refuses to pass having measured nothing. Both counts are asserted because
   * the first version of this test measured 33 rows and still proved nothing:
   * none of them was a Waiting row, which is the view the decision is about.
   */
  expect(measured, 'no team rows were measured at any width').toBeGreaterThan(10);
  expect(waitingSeen, 'no Waiting row was measured at any width').toBeGreaterThan(5);
  expect(wrapped, 'a row title wrapped to a second line').toEqual([]);
  expect(tall, 'a team row grew past its budget').toEqual([]);
});

/*
 * The other half of the decision: the clamp is only for the columns form.
 *
 * Once the row is a stack there is a full width to wrap into, and an ellipsis
 * on a phone hides words rather than saving space - the same reasoning that
 * gave the attention reason its second line back in v239. Without this test
 * the relaxation is a claim with nothing holding it: clamping titles on a
 * phone too would break nothing in the suite.
 */
test('v252 a long title wraps again once the row is a stack', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', 'This test drives its own viewport size.');

  await signIn(page);
  await page.setViewportSize({ width: 390, height: 900 });

  const waiting = VIEWS.find((view) => view.name === 'Waiting');
  if (!waiting) throw new Error('the Waiting view is no longer in VIEWS');
  await page.goto(waiting.url);
  await page.locator('main#main').waitFor({ state: 'visible', timeout: 20_000 });

  const rows = page.locator(waiting.row);
  await rows.first().waitFor({ state: 'visible', timeout: 20_000 });
  await expect
    .poll(async () => (await rows.first().boundingBox())?.height ?? 0, { timeout: 10_000 })
    .toBeGreaterThan(0);

  const replaced = await page.evaluate(
    ({ selector, text }) => {
      const titles = document.querySelectorAll(selector);
      for (const title of titles) title.textContent = text;
      return titles.length;
    },
    { selector: waiting.title, text: LONG_TITLE },
  );
  expect(replaced, 'no Waiting title was found to lengthen').toBeGreaterThan(0);

  const first = await rows.first().evaluate((element) => {
    const title = element.querySelector('.row-primary-link');
    if (!title) return { lines: -1, clipped: true, whiteSpace: 'none' };
    const style = getComputedStyle(title);
    const lineHeight = parseFloat(style.lineHeight);
    return {
      lines:
        lineHeight > 0 ? Math.floor(title.getBoundingClientRect().height / lineHeight + 0.15) : -1,
      clipped: title.scrollWidth > title.clientWidth + 1,
      whiteSpace: style.whiteSpace,
    };
  });

  await info.attach('stacked-title', {
    body: JSON.stringify(first),
    contentType: 'text/plain',
  });

  /*
   * Asserted on what the browser resolved, not on the rule being present: a
   * later rule winning the cascade would leave the stylesheet looking right
   * and the phone still truncating.
   */
  expect(first.whiteSpace, 'the title is still nowrap at 390px, so a phone truncates it').not.toBe(
    'nowrap',
  );
  expect(
    first.lines,
    'a 64-character title did not wrap at 390px, so it is being clipped instead',
  ).toBeGreaterThan(1);
  expect(first.clipped, 'the title is cut off rather than wrapped at 390px').toBe(false);
});
