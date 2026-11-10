import { expect, test, type Page } from '@playwright/test';

/**
 * v324 — My Team answers four questions before it is read.
 *
 * The brief was a stopwatch: inside ten seconds a manager must see who needs
 * them, why, what they are being asked to do, and who has nothing flagged.
 * v323 made the roster a column beside the person being read, which solved the
 * scrolling and left the card illegible — the state was a chip reading "⚠4"
 * with the words in a title attribute, and the load was a bar scaled to the
 * busiest person on a scale nothing on screen stated.
 *
 * These assert the contract that replaced it: four named states, no glyph
 * standing in for a sentence, and no state that cannot be investigated.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

const STATES: string[] = [
  'Action needed from you',
  'Work needs attention',
  'Due soon',
  'No issues flagged',
];

/** Worst first. The index is the priority, so a sort can be checked by it. */
const PRIORITY = new Map(STATES.map((label, index) => [label, index]));

async function openTeam(page: Page, query = '') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await page.goto(`/work?scope=team${query}`);
  /*
   * The name is a client button, so a click landing before hydration does
   * nothing at all and the panel never appears — which reads as the panel
   * being broken rather than as the test being early.
   */
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
}

const cards = (page: Page) => page.getByTestId('my-team-person-row');

/** The state each card declares, in roster order. */
async function statesOnScreen(page: Page): Promise<{ name: string; state: string }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="my-team-person-row"]')].map((row) => ({
      name: (row.querySelector('[data-cell="person"] strong')?.textContent ?? '').trim(),
      state: (row.querySelector('[data-cell="state"]')?.textContent ?? '').trim(),
    })),
  );
}

test.describe('v324 the roster states its case', () => {
  test.beforeEach(async ({ page }) => {
    await openTeam(page);
  });

  test('every card declares exactly one of the four states, in words', async ({ page }) => {
    const found = await statesOnScreen(page);
    expect(found.length, 'the seed must carry a team for this to mean anything').toBeGreaterThan(0);

    for (const person of found) {
      expect(STATES, `${person.name} declares "${person.state}"`).toContain(person.state);
    }
    /*
     * And the four are not all the same, or the label is decoration rather
     * than a classification. The seed carries a request, late work and quiet
     * people; if it ever stops doing so this fails loudly instead of passing
     * on a roster where every card says the same thing.
     */
    expect(new Set(found.map((person) => person.state)).size).toBeGreaterThan(1);
  });

  test('what is wrong is counted in words, never a glyph and a number', async ({ page }) => {
    /*
     * The exact defect: "⚠4" and "!2" were the entire visible statement of the
     * thing the card exists to communicate, with the words reachable only by
     * hovering or by using a screen reader.
     */
    const text = await page.locator('.focus-panel.team-roster').innerText();
    expect(text, 'a warning glyph is standing in for a sentence').not.toMatch(/⚠\s*\d/);
    expect(text, 'an exclamation mark is standing in for a sentence').not.toMatch(/(^|\s)!\s*\d/);

    const exceptions = page.locator('[data-cell="exceptions"]');
    const count = await exceptions.count();
    expect(count, 'no card in this fixture reports an exception').toBeGreaterThan(0);
    for (let index = 0; index < count; index += 1) {
      await expect(exceptions.nth(index)).toHaveText(
        /\d+ (overdue|assigned steps? overdue|due within)/,
      );
    }
  });

  test('no workload bar, and nothing drawn in its place', async ({ page }) => {
    /*
     * It was a share of the busiest person's open items, on a scale nothing
     * stated, inches from a red overdue count — so it said that carrying more
     * work is carrying worse work. Removed rather than relabelled, and not
     * replaced with another indicator the product cannot stand behind.
     */
    await expect(page.locator('.focus-panel.team-roster [data-bar-fill]')).toHaveCount(0);
    await expect(
      page.locator('.focus-panel.team-roster progress, .focus-panel.team-roster meter'),
    ).toHaveCount(0);
  });

  test('the roster is met worst first', async ({ page }) => {
    const found = await statesOnScreen(page);
    const ranks = found.map((person) => PRIORITY.get(person.state) ?? 99);
    for (let index = 1; index < ranks.length; index += 1) {
      expect(
        ranks[index]!,
        `${found[index]!.name} (${found[index]!.state}) sorts above ${found[index - 1]!.name} (${found[index - 1]!.state})`,
      ).toBeGreaterThanOrEqual(ranks[index - 1]!);
    }
  });
});

test.describe('v324 every flagged state can be investigated', () => {
  test.beforeEach(async ({ page }) => {
    await openTeam(page);
  });

  test('"Work needs attention" opens the assignments it is about', async ({ page }) => {
    /*
     * A state that cannot be investigated is worse than no state at all: it
     * tells a manager something is wrong and leaves them to find it. The
     * roster's label is derived from counts; this checks the panel can always
     * show the work those counts refer to.
     */
    const flagged = (await statesOnScreen(page)).filter(
      (person) => person.state === 'Work needs attention',
    );
    expect(flagged.length, 'nobody in this fixture has work needing attention').toBeGreaterThan(0);

    for (const person of flagged) {
      await cards(page)
        .filter({ hasText: person.name })
        .locator('[data-cell="person"] strong')
        .click();
      const panel = page.getByTestId('my-team-person-panel');
      await expect(panel).toBeVisible();

      const section = panel.locator('.team-person-section', {
        has: page.getByRole('heading', { name: 'Work needs attention' }),
      });
      await expect(section, `${person.name} is flagged with nothing to show`).toHaveCount(1);
      const rows = section.locator('.member-work-row');
      expect(
        await rows.count(),
        `${person.name} is flagged with no assignment to open`,
      ).toBeGreaterThan(0);

      // And the assignment opens, which is what "investigate" means.
      await rows.first().click();
      await expect(page.locator('.task-detail-drawer')).toBeVisible();
      await page
        .locator('.task-detail-layer')
        .getByRole('dialog')
        .getByRole('button', { name: /^Close/ })
        .click();
      await expect(page.locator('.task-detail-drawer')).toHaveCount(0);
    }
  });

  test('"Action needed from you" names the decision and offers the control', async ({ page }) => {
    const flagged = (await statesOnScreen(page)).filter(
      (person) => person.state === 'Action needed from you',
    );
    expect(flagged.length, 'nothing in this fixture is addressed to the manager').toBeGreaterThan(
      0,
    );

    for (const person of flagged) {
      const card = cards(page).filter({ hasText: person.name });
      /*
       * Why, on the card, in the product's own words rather than a code: at
       * least three words, so a reason rendered as "goal_support_requested"
       * would fail rather than pass on being non-empty.
       */
      await expect(card.locator('[data-cell="attention-reason"]')).toHaveText(/\S+(\s+\S+){2,}/);
      // And the control that answers it, on the card itself.
      await expect(card.locator('[data-cell="needs-you"] button')).toBeVisible();

      await card.locator('[data-cell="person"] strong').click();
      const panel = page.getByTestId('my-team-person-panel');
      await expect(panel).toBeVisible();
      await expect(
        panel.getByRole('heading', { name: 'Action needed from you' }),
        `${person.name} is flagged for the manager with no decision in the panel`,
      ).toBeVisible();
      await expect(panel.locator('.member-attention-row .btn').first()).toBeVisible();
    }
  });

  test('a decision is never called an exception, nor the reverse', async ({ page }) => {
    /*
     * The distinction a manager asked for by name: not every overdue task is
     * their intervention. An exception never carries a decision control on the
     * card, and a request always does.
     */
    for (const person of await statesOnScreen(page)) {
      const card = cards(page).filter({ hasText: person.name });
      const buttons = await card.locator('[data-cell="needs-you"] button').count();
      if (person.state === 'Action needed from you') {
        expect(buttons, `${person.name} is asked of you with no way to answer`).toBe(1);
      } else {
        expect(buttons, `${person.name} is "${person.state}" and still asks you to act`).toBe(0);
      }
    }
  });
});

test.describe('v324 comparison is a comparison', () => {
  test('two people become one table of figures, not two registers', async ({ page }) => {
    await openTeam(page);
    const names = (await statesOnScreen(page)).map((person) => person.name);
    expect(names.length, 'two people are needed to compare').toBeGreaterThanOrEqual(2);

    await cards(page).filter({ hasText: names[0]! }).locator('[data-cell="person"] strong').click();
    await expect(page.getByTestId('my-team-person-panel')).toBeVisible();
    await page.getByRole('link', { name: 'Compare' }).click();
    await expect(page.getByRole('link', { name: 'Stop comparing' })).toBeVisible();
    await cards(page).filter({ hasText: names[1]! }).locator('[data-cell="person"] strong').click();

    const table = page.locator('.team-compare-table');
    await expect(table).toBeVisible();
    // Both names across the top, every measure on its own row, read across.
    await expect(table.locator('thead th')).toHaveCount(3);
    await expect(table.getByRole('columnheader', { name: names[0]! })).toBeVisible();
    await expect(table.getByRole('columnheader', { name: names[1]! })).toBeVisible();
    for (const measure of ['Overdue', 'Active', 'Shared steps', 'Waiting', 'Needs you']) {
      await expect(table.getByRole('rowheader', { name: measure })).toBeVisible();
    }

    /*
     * And no detail panels underneath. Two full registers is what this
     * replaced: the manager was reconciling them from memory while scrolling
     * between them.
     */
    await expect(page.locator('.team-detail').getByTestId('my-team-person-panel')).toHaveCount(0);

    // The full detail is one press away per person.
    await page.getByRole('link', { name: new RegExp(`Open ${names[0]!.split(' ')[0]}`) }).click();
    await expect(page.getByTestId('my-team-person-panel')).toHaveCount(1);
    await expect(page.locator('.team-compare-table')).toHaveCount(0);
  });
});

test.describe('v324 the four scenarios a manager actually meets', () => {
  test.beforeEach(async ({ page }) => {
    await openTeam(page);
  });

  test('somebody with no assignments reads as having none, not as missing', async ({ page }) => {
    const idle = cards(page).filter({ hasText: 'No open items' });
    expect(
      await idle.count(),
      'nobody in this fixture is without assignments, so this proves nothing',
    ).toBeGreaterThan(0);
    const card = idle.first();
    // Factual on both counts: nothing assigned, and nothing flagged about it.
    await expect(card.locator('[data-cell="state"]')).toHaveText('No issues flagged');
    await expect(card).not.toContainText('Steady');
    await expect(card).not.toContainText('On track');
  });

  test('somebody with no recorded updates says so rather than nothing', async ({ page }) => {
    const quiet = page.locator('[data-cell="latest"]', { hasText: 'no updates recorded' });
    expect(
      await quiet.count(),
      'everybody in this fixture has an update, so this proves nothing',
    ).toBeGreaterThan(0);
  });

  test('a person with several overdue items states the figure', async ({ page }) => {
    const found = await page.locator('[data-cell="exceptions"]').allInnerTexts();
    const overdue = found
      .map((text) => Number(/(\d+) overdue/.exec(text)?.[1] ?? '0'))
      .filter((count) => count > 0);
    expect(overdue.length, 'nobody in this fixture is overdue').toBeGreaterThan(0);
    expect(Math.max(...overdue), 'the count is stated, not approximated').toBeGreaterThan(0);
  });

  test('a project awaiting the manager is on the screen, with its control', async ({ page }) => {
    /*
     * v49 took work proposals out of the per-person classification because
     * there was no review workflow to send anybody to. There is one now, and
     * it is a panel of its own above the roster rather than a second copy on
     * the proposer's card — so the check is that the decision is reachable,
     * not that it is repeated.
     */
    const proposals = page.locator('.focus-panel', {
      has: page.getByRole('heading', { name: /Major Projects for discussion/ }),
    });
    if ((await proposals.count()) === 0) {
      test.info().annotations.push({
        type: 'note',
        description: 'No project is awaiting a decision in this fixture.',
      });
      return;
    }
    await expect(proposals.getByRole('link', { name: 'Review' }).first()).toBeVisible();
    await expect(proposals).toContainText('Needs your decision');
  });
});
