import { expect, test, type Page } from '@playwright/test';

/**
 * v136 — the numbers on My Team can be got behind, and every person is in
 * every list.
 *
 * Two reports, one cause. The snapshot printed four figures and made two of
 * them links: "Completed 30 days" was plain text, so of the four things a
 * manager reads in ten seconds, the one answering "what has my team actually
 * delivered" was the only one they could not follow. The work behind it
 * existed, but only inside a person's drawer — which answers the question for
 * somebody you have already decided to open, the opposite of how you would use
 * it.
 *
 * The second is quieter. Team Available work was grouped from the task rows,
 * so a person with an empty backlog had no group and simply was not on the
 * page. A manager reading five people on My Team and four here cannot tell
 * "nothing waiting" from "the page did not show them" — and nothing waiting is
 * the answer to who gets the next thing. The same figure now also appears on
 * the person's own row, so "who may be overloaded" can be answered while
 * looking at the people rather than by leaving them.
 *
 * v233 replaced the grouping with a flat, exception-first list, so a person can
 * no longer be missing from it. What is still worth guarding is that the two
 * screens agree: the figures on the people table and the list of work read
 * different queries off one definition of waiting work.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openTeam(page: Page, query = '') {
  await page.goto(`/work?scope=team${query}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/** The names on the people table, which every other list is measured against. */
async function rosterNames(page: Page): Promise<string[]> {
  const rows = page.getByTestId('my-team-person-row');
  const names = await rows.locator('[data-cell="person"] strong').allInnerTexts();
  return names.map((name) => name.trim()).sort();
}

/** The names the Completed view puts a card on screen for. */
async function groupNames(page: Page): Promise<string[]> {
  const names = await page.locator('.team-available-group > header strong').allInnerTexts();
  return names.map((name) => name.trim()).sort();
}

test.describe('v136 completed is reachable', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await openTeam(page);
  });

  test('completed work is reachable, as a view of its own', async ({ page }) => {
    /*
     * v136 made this reachable at all: the figure was a <span> in a strip of
     * four, so the one number answering "what has the team delivered" was the
     * only one a manager could not follow. v142 §3 removed the strip and made
     * it a view instead — the same rule, one level up.
     */
    const completed = page
      .getByRole('navigation', { name: 'Team views' })
      .getByRole('link', { name: /Completed/ });
    await expect(completed).toHaveCount(1);

    await completed.click();
    await expect(page).toHaveURL(/filter=delivered/);
    await expect(page.locator('.focus-panel')).toContainText('What your team closed');
  });

  test('names the kind of each record rather than counting them together', async ({ page }) => {
    // A routine occurrence closes every week and a Major Project once a
    // quarter. A list that does not say which is which reads as a ranking.
    await openTeam(page, '&filter=delivered&period=this-year');
    const rows = page.locator('.team-available-row');
    if ((await rows.count()) === 0) {
      test.skip(true, 'Nobody in this fixture has completed anything this year.');
    }
    await expect(rows.first()).toContainText(/Owned work|Contribution|Routine/);
  });

  test('the list adds up to the figure above it', async ({ page }) => {
    /*
     * The strip and the list read two different tables, so they can drift
     * apart silently — a manager would see 15 completed and count 11. Summing
     * the per-person counts is the only assertion that catches that, and it
     * fails if either side changes its definition of a completion.
     */
    // The tab carries the count now that the card row is gone.
    const label = await page
      .getByRole('navigation', { name: 'Team views' })
      .getByRole('link', { name: /Completed/ })
      .innerText();
    const headline = Number(label.replace(/[^0-9]/g, ''));

    await openTeam(page, '&filter=delivered');
    const counts = await page.locator('.team-available-group > header .muted').allInnerTexts();
    const summed = counts.reduce((total, text) => total + Number(text.trim().split(' ')[0]), 0);
    expect(summed).toBe(headline);
  });

  test('reports a person who delivered nothing rather than dropping them', async ({ page }) => {
    await openTeam(page);
    const roster = await rosterNames(page);

    await openTeam(page, '&filter=delivered');
    const delivered = await groupNames(page);
    if (delivered.length === 0) {
      test.skip(true, 'Nobody in this fixture has completed anything in the default window.');
    }

    /*
     * The roster is the same roster. An empty period is as often a fact about
     * the period as about the person, and omitting the name shows neither —
     * but it is a footnote, not a card each, so the names are looked for
     * across both.
     */
    const footnote = await page.getByTestId('team-delivered-none').innerText();
    for (const name of roster) {
      expect(
        delivered.includes(name) || footnote.includes(name),
        `${name} is unaccounted for`,
      ).toBe(true);
    }
  });
});

test.describe('v136 waiting work is all accounted for', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
  });

  /** Every "N waiting" figure on the people table, by name. */
  async function waitingByPerson(page: Page): Promise<Map<string, number>> {
    const found = new Map<string, number>();
    const rows = page.getByTestId('my-team-person-row');
    for (let index = 0; index < (await rows.count()); index += 1) {
      const cell = rows.nth(index).locator('[data-cell="person"]');
      const name = (await cell.locator('strong').innerText()).trim();
      const said = (await cell.innerText()).match(/(\d+) waiting/);
      found.set(name, said ? Number(said[1]) : 0);
    }
    return found;
  }

  /** Every row in the Waiting view, counted by whose work it is. */
  async function waitingRowsByOwner(page: Page): Promise<Map<string, number>> {
    // Later is folded, and a closed <details> renders no text at all, so a
    // count taken without opening it would be the exceptions only.
    const later = page.locator('.team-waiting-later > summary');
    if ((await later.count()) > 0) await later.click();

    const found = new Map<string, number>();
    const lines = await page.locator('.team-waiting-row .team-waiting-main small').allInnerTexts();
    for (const line of lines) {
      // "Amer · Due in 4 days · waiting 20 days" — the owner leads the line.
      const name = line.split('·')[0]!.trim();
      found.set(name, (found.get(name) ?? 0) + 1);
    }
    return found;
  }

  test('waiting work does not go missing between the two screens', async ({ page }) => {
    /*
     * The view was grouped by person and built from the task rows, so somebody
     * with an empty backlog had no group and was simply absent from a page
     * headed "Available work": a manager reading five people on My Team and
     * four here could not tell "nothing waiting" from "the page did not show
     * them".
     *
     * v233 answers that a different way — Waiting lists work rather than
     * people, so a missing name is no longer possible — which moves the
     * question to whether the two screens still agree about the volume. They
     * read different queries off one shared definition of waiting work, so
     * this is the assertion that catches a drift: drop somebody's items from
     * the list, or count them twice on the people table, and the totals part
     * company.
     */
    await openTeam(page);
    const byPerson = await waitingByPerson(page);
    const expected = [...byPerson.values()].reduce((total, count) => total + count, 0);

    await openTeam(page, '&filter=available');
    const summary = await page.locator('.team-waiting-summary').innerText();
    const stated = summary.match(/(\d+) waiting/);
    expect(stated ? Number(stated[1]) : 0).toBe(expected);

    // A list of work, not a card per person: the wall of "No action needed
    // from you" that v130 removed must not come back in another view.
    expect(await page.locator('.team-available-group').count()).toBe(0);
  });

  test('the people table states what each person has waiting', async ({ page }) => {
    /*
     * This is the reported bug in its exact shape: from Needs attention, a
     * manager could not see what a person had waiting without leaving the
     * people table for a view that replaces it — losing the person they were
     * reading in order to look them up. The figure belongs on the row, and it
     * has to be the figure the Waiting view would give for them.
     */
    await openTeam(page, '&filter=available');
    const byOwner = await waitingRowsByOwner(page);
    const withWaiting = [...byOwner.entries()].filter(([, count]) => count > 0);
    if (withWaiting.length === 0) {
      test.skip(true, 'Nobody in this fixture has waiting work.');
    }

    await openTeam(page);
    for (const [name, count] of withWaiting) {
      // Located by name, never by index: the five viewport projects share one
      // database and the row order is not stable between them.
      const row = page.getByTestId('my-team-person-row').filter({ hasText: name });
      await expect(row.locator('[data-cell="person"]')).toContainText(`${count} waiting`);
    }
  });

  test('a person with work waiting no longer reads as having nothing', async ({ page }) => {
    /*
     * The summary line said "Nothing active" when Active was empty, which is
     * true and misleading in the same breath: somebody with nine items queued
     * and none started is not somebody with nothing.
     */
    await openTeam(page);
    const rows = page.getByTestId('my-team-person-row').filter({ hasText: 'waiting' });
    for (let index = 0; index < (await rows.count()); index += 1) {
      await expect(rows.nth(index).locator('[data-cell="person"]')).not.toContainText(
        'Nothing active',
      );
    }
  });
});
