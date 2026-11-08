import { expect, test, type Page } from '@playwright/test';

/**
 * v315 — the Monthly Plan and the Goals workspace, guarded.
 *
 * Each test here exists because the audit crawl found the defect it describes
 * on a screen that every other gate reported as green. They assert measured,
 * computed values rather than the presence of a class, for the same reason
 * `design-system.spec.ts` does: every one of these was a cascade or a
 * media-query problem that looked correct in the stylesheet.
 *
 * Two of them are general rather than local — the invisible-control check and
 * the text-size check — because they catch a CLASS of defect that the existing
 * gates are blind to by construction. Both blind spots are named in the tests
 * that close them.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/**
 * Amer, deliberately.
 *
 * The seed gives him work due `date_trunc('day', now()) + 12 hours`, so there
 * is always an item on today's square whatever month the suite runs in, and
 * three Active goals with structured success measures. A fixture whose dates
 * drift off the visible month would make these tests pass by measuring
 * nothing.
 */
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('amer@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function open(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });
}

test.describe('Monthly Plan', () => {
  /**
   * On a phone the grid becomes an agenda: the weekday headers go, the empty
   * days go, and the days either side of an item go with them. The card was
   * still headed by the bare number it is headed by in the grid, so a person
   * saw "7", "8" and "24" with no weekday, no month and nothing saying which
   * one was today. The full date was computed and passed in all along, and
   * rendered only inside `.visually-hidden`.
   */
  test('an agenda card names its own day, and today says so', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'The agenda replaces the grid below 700px.');
    await signIn(page);
    await open(page, '/plan');

    const today = page.locator('.day.today');
    await expect(
      today,
      "today's card is missing — Amer's seed always has work due today",
    ).toHaveCount(1);

    const heading = await today.locator('.daynum').evaluate((element) => {
      const visible = [...element.children].filter((child) => {
        const style = getComputedStyle(child);
        return style.display !== 'none' && !child.classList.contains('visually-hidden');
      });
      return visible.map((child) => (child.textContent ?? '').trim()).join(' ');
    });

    // A weekday and a month, not a bare number.
    expect(heading, 'the agenda card heading').toMatch(
      /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)[^]*\d{1,2}[^]*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/,
    );
    expect(heading).toContain('Today');

    // Exactly one of the two forms reaches the accessibility tree, so the date
    // is not announced twice.
    const announced = await today
      .locator('.daynum')
      .evaluate(
        (element) =>
          [...element.querySelectorAll('[aria-hidden="true"]')].filter(
            (child) => getComputedStyle(child).display !== 'none',
          ).length,
      );
    expect(announced).toBeGreaterThan(0);
    const srText = await today.locator('.daynum .visually-hidden').textContent();
    expect(srText).toMatch(/today/i);
  });

  /**
   * A 180px month column gave the title one line, which ends at about fifteen
   * characters, while the word "Task" underneath had a line to itself. The
   * title is the only thing that tells two entries apart.
   */
  test('an entry gives its title two lines before it gives up', async ({ page }) => {
    await signIn(page);
    await open(page, '/plan');

    const title = page.locator('.cal-item-title').first();
    await expect(title).toBeVisible();

    const measured = await title.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        clamp: style.webkitLineClamp,
        whiteSpace: style.whiteSpace,
        lineHeight: parseFloat(style.lineHeight),
        height: element.getBoundingClientRect().height,
      };
    });

    expect(measured.clamp, 'calendar entry title line clamp').toBe('2');
    // The single-line ellipsis rule on every other line of the entry is more
    // specific than the title's own rule; losing to it is what clipped a
    // full-width phone card at fifteen characters.
    expect(measured.whiteSpace, 'calendar entry title white-space').toBe('normal');
    // Room for two lines, not one that happens to say `line-clamp: 2`.
    expect(measured.height).toBeGreaterThanOrEqual(measured.lineHeight * 0.9);
  });
});

test.describe('Goals list', () => {
  /**
   * §"Goal-list hierarchy" asks each row for one primary progress value. The
   * column named for it rendered `successMeasureCount` — a count fixed when
   * the goal was agreed — so three active goals read "1", "1", "1".
   */
  test('each row states one primary progress value', async ({ page }) => {
    await signIn(page);
    await open(page, '/goals');

    const rows = page.locator('.goal-row');
    const count = await rows.count();
    expect(count, "Amer's seed has three Active goals").toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const row = rows.nth(index);
      const figure = row.locator('.goal-row-progress-figure strong');
      await expect(figure).toHaveText(/^\d{1,3}%$/);

      const stated = Number.parseInt(((await figure.textContent()) ?? '').replace('%', ''), 10);
      // The bar is drawn from the same figure, not from a second one. Measured
      // rather than read from the attribute, because the width is what a person
      // compares down the column.
      const drawn = await row
        .locator('.goal-row-progress .progress-track > span')
        .evaluate((fill) => ({
          fill: fill.getBoundingClientRect().width,
          track: (fill.parentElement as HTMLElement).getBoundingClientRect().width,
        }));
      expect(drawn.track).toBeGreaterThan(0);
      expect(Math.round((drawn.fill / drawn.track) * 100)).toBe(stated);
    }
  });

  /**
   * `goalDisplayHealth` returns "Needs attention" when a support request is
   * open, and the row printed a second "Support requested" badge beside it.
   * One cause, two chips, two urgencies, and a row half again as tall.
   */
  test('a row never states the same condition twice', async ({ page }) => {
    await signIn(page);
    await open(page, '/goals');

    const badges = page.locator('.goal-row-badges');
    const count = await badges.count();
    expect(count).toBeGreaterThan(0);

    for (let index = 0; index < count; index += 1) {
      const text = (await badges.nth(index).textContent()) ?? '';
      expect(text).toMatch(/Support requested|Needs attention|Update due|On track|Completed/);
      expect(text, 'health stated twice in one row').not.toMatch(
        /Needs attention[^]*Support requested|Support requested[^]*Needs attention/,
      );
    }
  });
});

/**
 * The blind spot in `touch-targets-v183`.
 *
 * That gate skips any control whose computed opacity is 0 — reasonably, since
 * it is measuring what a finger can aim at. But `opacity: 0` paints nothing
 * and intercepts everything, so the state it skips is exactly the state where
 * a control is unaimable and still pressable. A goal row's Revise and Open sat
 * at `z-index: 2` over a stretched row link in precisely that state, and a tap
 * at the right-hand end of a healthy goal opened the Revise dialog.
 *
 * Hiding a control with opacity remains correct — it is what makes the
 * hover-reveal transition possible. Hiding it without `pointer-events: none`
 * is not.
 */
test.describe('nothing invisible is pressable', () => {
  const ROUTES = ['/plan', '/goals'];

  test('on Plan and Goals', async ({ page }) => {
    await signIn(page);

    const offenders: string[] = [];
    for (const route of ROUTES) {
      await open(page, route);

      const found = await page.evaluate(() => {
        const selector =
          'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]';
        const effectiveOpacity = (element: Element) => {
          let opacity = 1;
          let node: Element | null = element;
          while (node && node !== document.documentElement) {
            opacity *= Number.parseFloat(getComputedStyle(node).opacity || '1');
            node = node.parentElement;
          }
          return opacity;
        };

        const bad: string[] = [];
        for (const element of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') continue;
          // `pointer-events` is inherited, so the element's own computed value
          // already accounts for an ancestor switching it off.
          if (style.pointerEvents === 'none') continue;
          // The styled-control pattern: a visually removed input whose label is
          // the real target. The label is what a person presses, and it is
          // measured in its own right by the selector above.
          if (element.closest('label')) continue;
          if (element.closest('.visually-hidden')) continue;
          if (effectiveOpacity(element) > 0.01) continue;
          const box = element.getBoundingClientRect();
          if (box.width === 0 || box.height === 0) continue;

          const name = (
            element.getAttribute('aria-label') ||
            element.textContent ||
            element.tagName
          )
            .trim()
            .slice(0, 48);
          bad.push(
            `${element.tagName.toLowerCase()}${element.className ? `.${String(element.className).trim().split(/\s+/).join('.')}` : ''} "${name}"`,
          );
        }
        return [...new Set(bad)];
      });

      offenders.push(...found.map((entry) => `${route} · ${entry}`));
    }

    expect(offenders, 'controls that are invisible and still take a click').toEqual([]);
  });
});

/**
 * The blind spot in the locked type scale.
 *
 * `design-system.spec.ts` measures every rendered size against the scale, at
 * the default text size. A rule that writes a literal `12px` passes it
 * perfectly — and then ignores §22.2's personal text-size setting entirely,
 * because only `calc(… * var(--font-scale))` and the tokens built on it move
 * when a reader chooses Large or Larger. v304 named that fault for everything
 * below 12px; it is the same fault at every other size, and it was still
 * sitting in an inline `style={{ fontSize: 16 }}` on the Plan month label and
 * in five module rules in this area.
 *
 * Scoped to the classes this area declares for itself — `cal-`, `daynum`,
 * `plan-`, `legend-`, `goal-`, `team-goal` — and to the unclassed elements
 * those rules reach through a descendant selector. Deliberately NOT the whole
 * subtree: a goal row contains `.btn`, `.sub`, `.status-badge` and
 * `.workspace-tabs`, which belong to every screen in the product, and the page
 * head above it carries the same fault at a literal 24px and 12px. Those are
 * somebody else's rule to fix and someone has to own the widening of this
 * check; claiming them here would mean either failing on work this area may
 * not touch or quietly allow-listing them, and an allowlist is how a guard
 * stops guarding.
 *
 * Module-declared sizes are also outside it: their class names are hashed and
 * carry no stable prefix to select on. The six in this area were corrected by
 * hand in the same series.
 */
test.describe('the personal text size reaches this area', () => {
  const ROUTES = ['/plan', '/goals'] as const;
  const SCALE = 1.25;

  test('every size this area sets grows with it', async ({ page }) => {
    await signIn(page);

    const fixed: string[] = [];
    for (const route of ROUTES) {
      await open(page, route);

      const measure = () =>
        page.evaluate(() => {
          const AREA = /(^|\s)(cal-|daynum|plan-|legend-|goal-|team-goal)/;
          const classesOf = (element: Element) =>
            typeof element.className === 'string' ? element.className : '';
          /*
           * An element counts when it wears one of this area's classes, or
           * when it wears none at all and its nearest classed ancestor does —
           * which is how `.goal-session-disclosure > summary` and
           * `.goal-summary-inline b` are reached. An element wearing somebody
           * else's class is somebody else's rule.
           */
          const qualifies = (element: Element): boolean => {
            const own = classesOf(element);
            if (AREA.test(own)) return true;
            if (own.trim()) return false;
            let node = element.parentElement;
            while (node) {
              const classes = classesOf(node);
              if (classes.trim()) return AREA.test(classes);
              node = node.parentElement;
            }
            return false;
          };

          return [...document.querySelectorAll('body *')]
            .filter((element) => {
              if (element.closest('.visually-hidden')) return false;
              if ((element as HTMLElement).offsetParent === null) return false;
              if (!qualifies(element)) return false;
              return [...element.childNodes].some(
                (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim(),
              );
            })
            .map((element) => ({
              size: Number.parseFloat(getComputedStyle(element).fontSize),
              label: `${element.tagName.toLowerCase()}.${String(element.className).slice(0, 40)}`,
            }));
        });

      const before = await measure();
      expect(before.length, `${route} has text this area sizes`).toBeGreaterThan(0);

      await page.evaluate(() => {
        document.documentElement.dataset.textSize = 'larger';
      });
      const after = await measure();
      expect(after.length).toBe(before.length);

      for (let index = 0; index < before.length; index += 1) {
        const was = before[index]!;
        const now = after[index]!;
        // A control deliberately set to 0 to hide a glyph behind a pseudo
        // element has no size to scale.
        if (was.size === 0) continue;
        if (Math.abs(now.size / was.size - SCALE) < 0.02) continue;
        fixed.push(`${route} · ${was.label} stayed at ${was.size}px`);
      }

      await page.evaluate(() => {
        delete document.documentElement.dataset.textSize;
      });
    }

    expect([...new Set(fixed)], 'sizes the text-size setting cannot reach').toEqual([]);
  });
});
