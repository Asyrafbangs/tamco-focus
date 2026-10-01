import { expect, test, type Page } from '@playwright/test';

import { createWork } from './helpers/capture';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * What is already waiting on each person.
 *
 * A manager could see that a report had five Available items — the number was
 * on their My Team row — but not what any of them were. The list behind that
 * screen is `getMyTasks`, which is filtered to the caller, so the question
 * asked before handing anybody more work had no answer anywhere in the
 * product.
 */
test.describe('v65 team Available work', () => {
  test('groups the team Available work by the person who owns it', async ({ page }, testInfo) => {
    const title = `Waiting on Izzah ${testInfo.project.name} ${Date.now()}`;

    // Izzah creates work and leaves it Available.
    await signIn(page, 'izzah@tamco.local');
    await createWork(page, title, 'continues');

    // Her manager can now see it, under her name.
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?scope=team&filter=available');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    /*
     * v233 — one list ordered by what needs a manager, not a card per person.
     * The owner is named on the row, so her work is still attributed to her
     * without the screen being a tour of people.
     */
    /*
     * Brand new, no due date and nothing late about it: ordinary queued work,
     * which lands in the folded Later group rather than shouting at a manager.
     * Opening the fold is what makes the rest of the list reachable.
     */
    await page.locator('.team-waiting-later > summary').click();
    const row = page.locator('.team-waiting-row', { hasText: title });
    await expect(row).toBeVisible();
    await expect(row).toContainText('Izzah Nurul');
    // The summary answers "how much?" before any of it is read.
    await expect(page.locator('.team-waiting-summary')).toContainText(/\d+ waiting/);

    /*
     * The badge counts from anywhere, not only from this tab. Built the other
     * way the Bin badge read 0 on every other tab and only became correct once
     * you had clicked the thing it was meant to describe.
     */
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    /*
     * v132 — the way in is the snapshot figure, not a tab.
     *
     * v130 renamed it "Team available work" to stop a tab beside two views of
     * PEOPLE quietly changing the object on screen to a task. v132 went
     * further and took it out of that row entirely: browsing unstarted work is
     * a planning question, not the main way to manage people.
     */
    // Reached as a view now rather than as a figure in a card row (v142 §3).
    const figure = page
      .getByRole('navigation', { name: 'Team views' })
      .getByRole('link', { name: /Waiting/ });
    await expect(figure).toBeVisible();
    const count = Number((await figure.textContent())?.replace(/\D/g, '') ?? '0');
    expect(count).toBeGreaterThan(0);
  });

  test('shows an employee nothing they were not already entitled to see', async ({ page }) => {
    /*
     * The view is bounded entirely by RLS — `task_overview` is
     * `security_invoker`, so it can only ever return work the caller could
     * already open. Somebody with no reports has no team scope at all, so the
     * filter is unreachable rather than empty.
     */
    await signIn(page, 'lim@tamco.local');
    await page.goto('/work?scope=team&filter=available');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await expect(page.getByRole('navigation', { name: 'Team filter' })).toHaveCount(0);
    await expect(page.locator('.team-waiting-row')).toHaveCount(0);
  });

  test('the rows do not swallow the controls around them', async ({ page }) => {
    /*
     * `.row-primary-link::after` is `position: absolute; inset: 0`, resolved
     * against the nearest positioned ancestor. The rows here had none, so every
     * row's click overlay stretched across the whole panel: "Open person"
     * opened whichever task happened to be painted last, and the filter tabs
     * stopped responding entirely once this tab had been visited.
     */
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work?scope=team&filter=available');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    /*
     * v233 — the same invariant, against the controls this view now has: the
     * row's own task, the Later disclosure, and the tabs beside it.
     */
    const rows = page.locator('.team-waiting-row');
    const wanted = (
      await rows.first().locator('.team-waiting-main strong, a').first().innerText()
    ).trim();

    await rows.first().click();
    // The task on the row pressed, not whichever one is painted last.
    await expect(page.locator('.task-detail-drawer')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.task-detail-drawer')).toContainText(wanted);

    // And the sibling tabs still navigate.
    await page.goto('/work?scope=team&filter=available');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    // Back through the Team view. The Everyone / Needs attention filter lives
    // inside Team now (v142 §3), so it is not rendered on this one.
    await page
      .getByRole('navigation', { name: 'Team views' })
      .getByRole('link', { name: /^Team/ })
      .click();
    await expect(page).toHaveURL(/scope=team$/);
    await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();
  });
});
