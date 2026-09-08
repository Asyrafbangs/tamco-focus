import { expect, test, type Page } from '@playwright/test';
import { showActiveWork } from './support/work-list';

/**
 * v130 — three levels of navigation, and rows that are quiet until they are not.
 *
 * The Work page asked three different questions in a row of controls that all
 * looked the same: whose work (My Work / My Team), what kind (Focus / Routine)
 * and which list (Active / Available / Shared / Completed). The first two were
 * the same component, rendered inline, so they sat on one line and read as four
 * peers. My Team had the same problem one level down, where a workspace switch
 * and a filter were given identical weight.
 *
 * The rows had the opposite problem: every one of them repeated what was true
 * of all of them — the full class name, the year, a status that matched the tab
 * — and stated an exception twice when there was one, once as a date and once
 * as a chip on the far side of the row.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v130 the levels are told apart', () => {
  test('scope and work type are two controls on two lines', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'A geometric check, once.');
    // A manager, because only a manager has a scope to switch.
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const scope = page.locator('nav.workspace-tabs:not(.mode)');
    const mode = page.locator('nav.workspace-tabs.mode');
    await expect(scope).toBeVisible();
    await expect(mode).toBeVisible();

    /*
     * The actual defect, which no presence check would have caught: both were
     * `display: inline-flex`, so they flowed onto ONE line and "My Work | My
     * Team | Focus | Routine" read as a single row of four peers.
     */
    const scopeBox = (await scope.boundingBox())!;
    const modeBox = (await mode.boundingBox())!;
    expect(
      modeBox.y,
      'the work type control is on the same line as the scope control',
    ).toBeGreaterThanOrEqual(scopeBox.y + scopeBox.height);
  });

  /*
   * The real page head, not the loading skeleton's. Both carry `.pagehead`, so
   * a bare class selector is two elements on a slow first paint.
   */
  const head = (page: Page) => page.locator('.pagehead[data-task-feedback-page-anchor]');

  test('the header action and sentence follow the scope', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');

    await page.goto('/work');
    await expect(head(page)).toContainText('Work you are carrying');
    await expect(head(page).getByRole('link', { name: /New Work/ })).toBeVisible();

    await page.goto('/work?scope=team');
    // Same flow, the manager's word for it.
    await expect(head(page).getByRole('link', { name: /Assign work/ })).toBeVisible();
    await expect(head(page).getByRole('link', { name: /New Work/ })).toHaveCount(0);
  });

  /*
   * v130 named the capacity strip and coloured it only where it meant
   * something. v144 removed it (specification §3): "Major 1/1, Operational 6/5"
   * counts items, and one Major Project is not one inspection, so the ratio was
   * never a workload measure whatever colour it was in.
   *
   * The rule that outlived it is that My Work says what it is showing without
   * a strip of numbers above the list.
   */
  test('no capacity ratio sits above the work', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work');

    await expect(page.locator('.capacity-strip')).toHaveCount(0);
    await expect(page.getByText(/Over focus target/i)).toHaveCount(0);
    await expect(page.locator('.focus-tab-meaning')).toBeVisible();
  });
});

test.describe('v130 a work row says what differs', () => {
  test('one word for the class, a short date, and no year for this year', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work');
    await showActiveWork(page);
    await expect(page.locator('.task-row').first()).toBeVisible();

    const rows = page.locator('.task-row');
    // "Action" and "Project" are the same on every row and tell nobody anything.
    await expect(rows.getByText('Operational Action')).toHaveCount(0);
    await expect(rows.getByText('Major Project')).toHaveCount(0);
    await expect(rows.getByText('Self-Development Plan')).toHaveCount(0);

    /*
     * Since v145 §11 the word is the PURPOSE rather than the class, which is
     * the same rule applied to a better question: why the work exists rather
     * than what shape it is. Asserted against the fixtures, where every active
     * task carries one.
     */
    const words = (await rows.locator('.sub').allInnerTexts()).join(' ');
    expect(words).toMatch(/Reactive|Planned|Improvement/);

    // The year repeated on every row is the part the eye has to step over.
    const thisYear = String(new Date().getFullYear());
    const dates = await rows.locator('.row-due').allInnerTexts();
    expect(dates.length, 'no dated work to check').toBeGreaterThan(0);
    for (const date of dates) {
      expect(date, `"${date}" still prints the current year`).not.toContain(thisYear);
    }
  });

  test('an overdue row says so once, where the date would be', async ({ page }) => {
    await signIn(page, 'izzah@tamco.local');
    await page.goto('/work');
    await showActiveWork(page);
    await expect(page.locator('.task-row').first()).toBeVisible();

    const late = page.locator('.task-row', { has: page.locator('.row-due.late') });
    if ((await late.count()) === 0) test.skip(true, 'Nothing overdue in this seed.');

    const row = late.first();
    await expect(row.locator('.row-due.late')).toContainText(/Overdue/);
    /*
     * It used to be both: "27 Aug 2026" on the left and an "Overdue 4 days"
     * chip on the right, in two vocabularies, for the reader to reconcile.
     */
    await expect(row.locator('.row-flag', { hasText: /Overdue/ })).toHaveCount(0);
  });
});

test.describe('v130 My Team is an exception list, not a table of buttons', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?scope=team');
    await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
  });

  test('the columns say what they hold', async ({ page }) => {
    const header = page.locator('[class*="listHeader"]');
    await expect(header).toContainText('Current focus');
    await expect(header).toContainText('Latest update');
    // "Working on" could not answer which of four Active items this was, and
    // "Latest" could mean the latest task, change or message.
    await expect(header).not.toContainText('Working on');
    await expect(header.getByText('Action', { exact: true })).toHaveCount(0);
  });

  test('healthy rows are quiet and carry no buttons', async ({ page }) => {
    const rows = page.getByTestId('my-team-person-row');

    // The loudest text in the table said the same nothing on every healthy row.
    await expect(page.getByText('No action needed from you')).toHaveCount(0);
    // Three labels for the one interaction the whole row already performs.
    await expect(rows.getByRole('button', { name: 'Open' })).toHaveCount(0);
    await expect(rows.getByRole('button', { name: 'Open task' })).toHaveCount(0);
    await expect(rows.getByRole('button', { name: 'Open routine' })).toHaveCount(0);

    // Somebody with nothing outstanding shows a dash, not a sentence.
    await expect(rows.filter({ hasText: 'Nothing needed from you' }).first()).toBeVisible();
  });

  test('the filter row browses people, and only people', async ({ page }) => {
    const tabs = page.getByRole('navigation', { name: 'Team filter' });
    /*
     * v130 renamed the third tab "Team available work" because, beside two
     * views of PEOPLE, it changed the object on screen to a task without
     * saying so. v132 took it out of this row entirely, and v142 §3 made it a
     * view of its own called "Not started": browsing unstarted work is a
     * planning question, not the main way to manage people.
     */
    await expect(tabs.getByRole('link')).toHaveCount(2);
    await expect(tabs.getByRole('link', { name: /available|not started/i })).toHaveCount(0);
    await expect(
      page.getByRole('navigation', { name: 'Team views' }).getByRole('link', {
        name: /Not started/,
      }),
    ).toBeVisible();
  });

  /*
   * The ordering rule is NOT asserted here.
   *
   * In this seed every person who needs something also sorts early
   * alphabetically, so exception-first and A-to-Z produce the same list and a
   * check written here would pass whether the rule existed or not. It is
   * covered by `tests/unit/team-order.test.ts`, on data where the two orders
   * disagree.
   */

  test('a row carries a button only where a decision is owed', async ({ page }) => {
    const rows = page.getByTestId('my-team-person-row');
    const quiet = rows.filter({ hasText: 'Nothing needed from you' }).first();
    await expect(quiet.getByRole('button')).toHaveCount(0);
    // And the chevron is on every row, because every row opens.
    await expect(quiet.locator('[class*="chevron"]')).toBeVisible();
  });
});
