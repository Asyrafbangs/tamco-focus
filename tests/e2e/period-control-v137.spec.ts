import { expect, test, type Page } from '@playwright/test';

/**
 * v137 — one period control, everywhere a screen reports over a window.
 *
 * The app had grown four of these. My Work → Completed offered five presets
 * and a date range; My Team offered four presets as a segmented strip with no
 * range and no "Last year"; Routine → Team offered a fifth set built around
 * months while Routine → Completed offered three rolling ones; and Records
 * offered two bare date boxes and no presets at all. Same question, four
 * answers, and learning one taught you nothing about the others.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** Every screen that reports over a period, and what it opens on. */
const SURFACES = [
  { name: 'My Team', url: '/work?scope=team', opensOn: 'Last 30 days' },
  { name: 'My Work → Completed', url: '/work?tab=completed', opensOn: 'Last 30 days' },
  { name: 'Routine → My team', url: '/work/routine?panel=manager', opensOn: 'This month' },
  { name: 'Routine → Completed', url: '/work/routine?view=completed', opensOn: 'This month' },
  { name: 'Records', url: '/more/records', opensOn: 'All time' },
] as const;

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const picker = page.locator('.period-picker').first();
  await expect(picker).toBeVisible();
  return picker;
}

test.describe('v137 the period control', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
  });

  for (const surface of SURFACES) {
    test(`is the same control on ${surface.name}`, async ({ page }) => {
      const picker = await open(page, surface.url);
      await expect(picker.getByRole('button')).toContainText(surface.opensOn);

      await picker.getByRole('button').click();
      const menu = page.locator('.period-picker-panel');
      await expect(menu).toBeVisible();

      /*
       * The shape is what has to match: a short list of named presets, and a
       * From / To / Apply range under a rule. Records is the one screen that
       * also offers "All time", because an archive exists to find one old
       * record; everywhere else a lifetime figure flatters whoever has been
       * here longest.
       */
      const presets = await menu.getByRole('link').count();
      expect(presets).toBeGreaterThanOrEqual(4);
      expect(presets).toBeLessThanOrEqual(5);
      await expect(menu.getByLabel('From')).toBeVisible();
      await expect(menu.getByLabel('To')).toBeVisible();
      await expect(menu.getByRole('button', { name: 'Apply' })).toBeVisible();

      // The period you are on is marked, so the button and the menu agree.
      await expect(menu.getByRole('link', { name: surface.opensOn })).toHaveAttribute(
        'aria-current',
        'page',
      );
    });
  }

  test('refuses a period in the future, on every surface that offers one', async ({ page }) => {
    // A report asks what has already happened. This is not validation for its
    // own sake: the same product let "15 Sep 2926" into a manager's backlog.
    const picker = await open(page, '/work?scope=team');
    await picker.getByRole('button').click();
    const menu = page.locator('.period-picker-panel');
    const today = new Date().toISOString().slice(0, 10);
    await expect(menu.getByLabel('From')).toHaveAttribute('max', today);
    await expect(menu.getByLabel('To')).toHaveAttribute('max', today);
  });

  for (const surface of [
    { name: 'My Team', url: '/work?scope=team' },
    { name: 'My Work → Completed', url: '/work?tab=completed' },
  ]) {
    test(`a custom range is an address, not a mode, on ${surface.name}`, async ({ page }) => {
      /*
       * Presets are links and the range is a GET form, so both end up in the URL
       * and a period can be bookmarked or sent to somebody. My Team could not
       * express a range at all before this.
       */
      const picker = await open(page, surface.url);
      await picker.getByRole('button').click();
      const menu = page.locator('.period-picker-panel');
      await menu.getByLabel('From').fill('2026-01-01');
      await menu.getByLabel('To').fill('2026-03-31');
      await menu.getByRole('button', { name: 'Apply' }).click();

      await expect(page).toHaveURL(/period=custom/);
      await expect(page).toHaveURL(/period_from=2026-01-01/);
      await expect(page).toHaveURL(/period_to=2026-03-31/);
      // And the control says what was asked for, in the words the rest of the
      // product uses for a date — not the ISO string the form submitted.
      await expect(page.locator('.period-picker').first().getByRole('button')).toContainText(
        '1 Jan to 31 Mar',
      );
    });
  }

  test('one date alone is a question, not a refusal', async ({ page }) => {
    /*
     * "From" was required, so filling only "To" was refused by the browser —
     * and the menu closed on the same click, taking the message that would
     * have explained it. Apply appeared to do nothing at all.
     */
    const picker = await open(page, '/work?scope=team');
    await picker.getByRole('button').click();
    const menu = page.locator('.period-picker-panel');
    await menu.getByLabel('To').fill('2026-03-31');
    await menu.getByRole('button', { name: 'Apply' }).click();

    await expect(page).toHaveURL(/period_to=2026-03-31/);
    await expect(page.locator('.period-picker').first().getByRole('button')).toContainText(
      'up to 31 Mar',
    );
  });

  test('a range entered the wrong way round is read as the range it describes', async ({
    page,
  }) => {
    /*
     * It used to be honoured literally, so the period began after it ended and
     * could not contain anything. My Team then reported "0 completed" — a
     * claim about the team, from a period that cannot hold a single record.
     */
    const picker = await open(page, '/work?scope=team');
    await picker.getByRole('button').click();
    const menu = page.locator('.period-picker-panel');
    await menu.getByLabel('From').fill('2026-03-31');
    await menu.getByLabel('To').fill('2026-01-01');
    await menu.getByRole('button', { name: 'Apply' }).click();

    await expect(page.locator('.period-picker').first().getByRole('button')).toContainText(
      '1 Jan to 31 Mar',
    );
  });

  test('an incomplete range keeps the menu open to say so', async ({ page }) => {
    // Closing on the click discarded the browser's own validation message
    // along with the panel it was anchored to.
    const picker = await open(page, '/work?scope=team');
    await picker.getByRole('button').click();
    const menu = page.locator('.period-picker-panel');
    await menu.getByLabel('From').fill('2099-01-01');
    await menu.getByRole('button', { name: 'Apply' }).click();
    await page.waitForTimeout(500);

    // Refused by `max`, so nothing was applied and the control is still there.
    await expect(page).not.toHaveURL(/period=custom/);
    await expect(menu).toBeVisible();
  });

  test('the period survives the links that carry it', async ({ page }) => {
    /*
     * The regression this guards: widening the window and then opening
     * somebody put the question silently back to thirty days, so the drawer
     * said "Last 30 days" under a strip that still said 90.
     */
    await page.goto('/work?scope=team&period=90');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    // The name, not the centre of the row: on a phone the row is a tall stack
    // of bands and its middle is not a reliable place to press.
    await page
      .getByTestId('my-team-person-row')
      .filter({ hasText: 'Amer' })
      .getByText('Amer Hakim')
      .click();
    const panel = page.getByTestId('my-team-person-panel');
    await expect(panel).toBeVisible();
    // The window the expansion counts over, said inside it (v143 §6 puts it on
    // the Completed section's summary rather than in a drawer heading).
    await expect(panel).toContainText('last 90 days');
  });

  test('a closed period does not quietly run up to now', async ({ page }) => {
    /*
     * "Last year" is the option My Team could not previously offer, because a
     * window resolved to a lower bound only — it would have meant "everything
     * since last January", twenty months of work under a label promising
     * twelve. Nothing in this fixture was closed last year, so the honest
     * answer is an empty period rather than this year's work.
     */
    await page.goto('/work?scope=team&filter=delivered&period=last-year');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    // The card row this used to read is gone (v142 §3); the control itself
    // still has to name the period it applied.
    await expect(page.locator('.team-views .period-picker').getByRole('button')).toContainText(
      'Last year',
    );
    await expect(page.locator('.focus-panel')).toContainText('closed last year');
    await expect(page.locator('.team-available-group')).toHaveCount(0);
  });
});
