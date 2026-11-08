import { expect, test, type Page } from '@playwright/test';

/**
 * v305 — the tab rails in Work are one control at three weights.
 *
 * My Work stacked three rows of tabs in three unrelated idioms — an enclosed
 * segmented track, a grey filled pill, and navy-filled folder tabs — and
 * Routines added a fourth that was pixel-for-pixel the top-level control two
 * rows below the real one. A person could not tell which of the nested
 * questions they had just answered, and the navy fill made the least
 * important row the heaviest ink on the page.
 *
 * Six separate blocks of CSS produced that, each one reasonable on its own.
 * Nothing could see the drift, because nothing compared the rows to each
 * other. This does.
 *
 * Measured from the rendered page, never from the presence of a class: every
 * one of those six idioms had a class saying what it was meant to be.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** A manager: every level of rail exists for this account. */
async function signIn(page: Page) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
}

/**
 * The routes that carry a stack of rails. `?panel=manager` is here because the
 * control it reveals — "People / Routines" — is reachable from no default URL,
 * which is exactly why the v303 touch guard never saw that it was a 20px
 * target.
 */
const ROUTES = ['/work', '/work?scope=team', '/work/routine', '/work/routine?panel=manager'];

interface Rail {
  label: string;
  level: number;
  top: number;
  rowRule: boolean;
  fontSize: number;
  indicatorWidth: number;
  indicatorColour: string;
  tabs: number;
  selected: number;
  filled: string[];
  rounded: string[];
}

async function railsOn(page: Page, route: string): Promise<Rail[]> {
  await page.goto(route);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });
  await expect(page.locator('nav.tab-rail').first()).toBeVisible();

  return page.evaluate(() => {
    const transparent = (colour: string) =>
      colour === 'transparent' || /rgba\(\s*0,\s*0,\s*0,\s*0\s*\)/.test(colour);

    return [...document.querySelectorAll<HTMLElement>('nav.tab-rail')].map((rail) => {
      const rowStyle = getComputedStyle(rail);
      const links = [...rail.querySelectorAll<HTMLAnchorElement>(':scope > a')];
      const selected = links.filter((link) => link.getAttribute('aria-current') === 'page');
      // The selected tab is what carries the level's mark; an empty rail is a
      // fault reported through `tabs` rather than a crash here.
      const probe = selected[0] ?? links[0] ?? null;
      const probeStyle = probe === null ? null : getComputedStyle(probe);

      return {
        label: rail.getAttribute('aria-label') ?? rail.className,
        level: [1, 2, 3].find((step) => rail.classList.contains(`tab-rail-${step}`)) ?? 0,
        top: Math.round(rail.getBoundingClientRect().top),
        rowRule:
          rowStyle.borderBottomStyle !== 'none' &&
          Number.parseFloat(rowStyle.borderBottomWidth) > 0 &&
          !transparent(rowStyle.borderBottomColor),
        fontSize: probeStyle === null ? 0 : Number.parseFloat(probeStyle.fontSize),
        indicatorWidth: probeStyle === null ? 0 : Number.parseFloat(probeStyle.borderBottomWidth),
        indicatorColour: probeStyle === null ? '' : probeStyle.borderBottomColor,
        tabs: links.length,
        selected: selected.length,
        // The two idioms this replaced: a filled chip or a folder tab. Both
        // are visible as a painted background or a rounded corner on a tab.
        filled: links
          .map((link) => getComputedStyle(link).backgroundColor)
          .filter((colour) => !transparent(colour)),
        rounded: links
          .map((link) => getComputedStyle(link).borderTopLeftRadius)
          .filter((radius) => Number.parseFloat(radius) > 0),
      };
    });
  });
}

test.describe('the Work tab rails are one control at three weights', () => {
  test('every rail is the same construction, and its level is legible', async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
      'The rail is width-independent; desktop and mobile cover both shapes it takes.',
    );
    test.setTimeout(120_000);
    await signIn(page);

    const faults: string[] = [];

    for (const route of ROUTES) {
      const rails = await railsOn(page, route);
      expect(rails.length, `${route} renders no tab rail`).toBeGreaterThan(0);

      const ordered = [...rails].sort((a, b) => a.top - b.top);

      for (const rail of ordered) {
        const where = `${route} · "${rail.label}"`;

        if (rail.level === 0) faults.push(`${where} is on no level`);
        if (rail.tabs === 0) faults.push(`${where} is a rail with no tabs on it`);
        if (rail.selected !== 1) {
          faults.push(`${where} marks ${rail.selected} tabs as current, not 1`);
        }
        /*
         * A filled or rounded tab is one of the retired idioms coming back.
         * The navy fill is the one that mattered: it put the heaviest ink on
         * the page under the least important choice.
         */
        if (rail.filled.length > 0) {
          faults.push(`${where} paints a tab (${rail.filled[0]}); a rail is text on a rule`);
        }
        if (rail.rounded.length > 0) {
          faults.push(`${where} rounds a tab (${rail.rounded[0]}); a rail is text on a rule`);
        }
        // Only the top level closes the page header. Three stacked rules are
        // the same defect in a different costume.
        if (rail.rowRule && rail.level !== 1) {
          faults.push(`${where} draws a rule under level ${rail.level}`);
        }
        if (!rail.rowRule && rail.level === 1) {
          faults.push(`${where} is level 1 and draws no rule`);
        }
      }

      /*
       * Read down the page, a rail is never more senior than the one above it.
       * This is what "My routine / My Team" broke: it was the level-1 control
       * rendered again two rows below the real level-1 control, so two
       * different questions wore the same costume and neither could be ranked.
       */
      for (let index = 1; index < ordered.length; index += 1) {
        const above = ordered[index - 1];
        const below = ordered[index];
        if (above && below && below.level < above.level) {
          faults.push(
            `${route} · "${below.label}" (level ${below.level}) sits under ` +
              `"${above.label}" (level ${above.level})`,
          );
        }
      }
      if (ordered.filter((rail) => rail.level === 1).length > 1) {
        faults.push(`${route} has more than one level-1 rail`);
      }

      /*
       * The hierarchy itself: a more junior rail is set smaller and marked
       * more lightly. Measured between the distinct levels present, so a page
       * with two level-2 rails is not asked to rank them against each other.
       */
      const byLevel = new Map<number, Rail>();
      for (const rail of ordered) if (!byLevel.has(rail.level)) byLevel.set(rail.level, rail);
      const levels = [...byLevel.keys()].filter((level) => level > 0).sort();

      for (let index = 1; index < levels.length; index += 1) {
        const seniorLevel = levels[index - 1];
        const juniorLevel = levels[index];
        const senior = seniorLevel === undefined ? undefined : byLevel.get(seniorLevel);
        const junior = juniorLevel === undefined ? undefined : byLevel.get(juniorLevel);
        if (!senior || !junior) continue;
        if (!(junior.fontSize < senior.fontSize)) {
          faults.push(
            `${route} · level ${junior.level} is set at ${junior.fontSize}px, not smaller than ` +
              `level ${senior.level} at ${senior.fontSize}px`,
          );
        }
        if (junior.indicatorWidth > senior.indicatorWidth) {
          faults.push(
            `${route} · level ${junior.level} is marked ${junior.indicatorWidth}px thick, ` +
              `heavier than level ${senior.level} at ${senior.indicatorWidth}px`,
          );
        }
      }

      /*
       * Level 3 narrows a list; levels 1 and 2 move you. The mark desaturates
       * at the step where the reader stops travelling, and that difference is
       * what stops My Team's "Everyone / Needs attention" reading as a peer of
       * the row of destinations above it.
       */
      const filter = byLevel.get(3);
      const navigation = byLevel.get(2) ?? byLevel.get(1);
      if (filter && navigation && filter.indicatorColour === navigation.indicatorColour) {
        faults.push(
          `${route} · the filter and the navigation above it are both marked ` +
            `${filter.indicatorColour}`,
        );
      }
    }

    expect(faults, 'tab rails that break the hierarchy').toEqual([]);
  });

  /**
   * The retired idioms, by name.
   *
   * The rules above describe what a rail must be; this says the six things it
   * replaced are gone rather than merely overridden somewhere else in a
   * 17,000-line stylesheet. A control that still carries one of these classes
   * without the rail is a row that was added later and styled from memory.
   */
  test('no row in Work is left on a retired tab idiom', async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== 'desktop' && testInfo.project.name !== 'mobile',
      'One pass over the markup is enough.',
    );
    test.setTimeout(120_000);
    await signIn(page);

    const strays: string[] = [];
    for (const route of ROUTES) {
      await page.goto(route);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });

      const found = await page.evaluate(() =>
        [
          '.workspace-tabs:not(.tab-rail)',
          '.focus-tabs:not(.tab-rail)',
          '.focus-tabs.underline',
          '.routine-audience:not(.tab-rail)',
          '.routine-axis:not(.tab-rail)',
        ].filter((selector) => document.querySelector(selector) !== null),
      );
      strays.push(...found.map((selector) => `${route} · ${selector}`));
    }

    expect(strays, 'rows still on a retired tab idiom').toEqual([]);
  });
});
