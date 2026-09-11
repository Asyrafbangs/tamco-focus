import { expect, test, type Page } from '@playwright/test';

/**
 * v139 — a visibility grant is sight of people, and a manager role is authority
 * over them. They were the same flag, so the grant had almost no screen to use.
 *
 * The approved example (MASTER_PRODUCT_SPEC.md §22.5, Appendix A9) is a team
 * member who supervises two interns: Amer may VIEW Izzah and Ajmal, and may do
 * nothing else to them — no editing, no activation, no reassignment, no
 * accepting a completion. Work → My Team already read visibility, but Routine
 * and Goals gated their whole team layer on the role, so the grant showed him
 * nothing there.
 *
 * The other half of this spec is the half that matters: opening those screens
 * must not widen what he can see by one person. Everything the team layer reads
 * is bound by RLS on his own session, and `focus.visible_user_ids()` gives him
 * his own id plus the two grants — not his own manager, and not the colleagues
 * nobody granted him.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** The two people the grant names. */
const GRANTED = ['Izzah Nurul', 'Ajmal Rizani'];

/**
 * Everybody else with an account.
 *
 * Izzul is Amer's own reporting manager: `user_profiles` lets Amer read that
 * row so the interface can name who he reports to, which is a licence to read
 * a name and not to see their work. He must not appear as somebody to open.
 */
const OFF_LIMITS = ['Lim Wei Sheng', 'Temporary Tester', 'Izzul Asyraf', 'System Administrator'];

/**
 * Every team surface, at the address the grant should now reach.
 *
 * `namesPeople` says whether a roster is expected. Two of these legitimately
 * name nobody: the delivered list shows an empty state when the window holds
 * no completions, and the "by routine" axis lists schedules rather than
 * people. Both must still be checked for the names that may never appear.
 */
const TEAM_SURFACES = [
  { name: 'Work → My Team', url: '/work?scope=team', anchor: 'Needs attention', namesPeople: true },
  {
    name: 'Work → My Team, needs attention',
    url: '/work?scope=team&filter=attention',
    anchor: 'Needs attention',
    namesPeople: true,
  },
  {
    name: 'Work → My Team, available',
    url: '/work?scope=team&filter=available',
    anchor: 'Work waiting to be picked up',
    namesPeople: true,
  },
  {
    name: 'Work → My Team, delivered',
    url: '/work?scope=team&filter=delivered',
    anchor: 'What your team closed',
    namesPeople: false,
  },
  {
    name: 'Routine → My team',
    url: '/work/routine?panel=manager',
    anchor: 'Routine schedules',
    namesPeople: true,
  },
  {
    name: 'Routine → My team, by routine',
    url: '/work/routine?panel=manager&by=routines',
    anchor: 'Routine schedules',
    namesPeople: false,
  },
  {
    name: 'Goals → My Team',
    url: '/goals?view=team',
    anchor: 'Employee goals',
    namesPeople: true,
  },
] as const;

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Open a screen and wait for it to have actually said something.
 *
 * `main` paints before the server content streams into it. Reading the text a
 * moment too early gets the loading skeleton, which names nobody — and would
 * have passed every "this person is absent" assertion in here for entirely the
 * wrong reason. So each surface names something only the finished view says,
 * and nothing is read until that has appeared.
 */
async function open(page: Page, url: string, anchor?: string) {
  await page.goto(url);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.locator('main#main')).toBeVisible();
  if (anchor) await expect(page.locator('main#main')).toContainText(anchor);
  else await expect(page.locator('main#main')).not.toContainText('One moment');
}

/** What the page says once it has finished saying it. */
async function contentOf(page: Page): Promise<string> {
  return (await page.locator('main#main').innerText()).replace(/\s+/g, ' ');
}

test.describe('v139 a grant is sight, not authority', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, 'amer@tamco.local');
  });

  for (const surface of TEAM_SURFACES) {
    test(`${surface.name} shows the granted people and nobody else`, async ({ page }) => {
      await open(page, surface.url, surface.anchor);

      const text = await contentOf(page);

      // At least one of the two where a roster is expected, so the screen is
      // genuinely reachable rather than an empty shell that would pass the
      // "nobody forbidden" check below for the wrong reason.
      if (surface.namesPeople) {
        expect(
          GRANTED.some((name) => text.includes(name)),
          `${surface.name} named neither granted person`,
        ).toBe(true);
      }

      for (const name of OFF_LIMITS) {
        expect(text.includes(name), `${surface.name} named ${name}, who is not granted`).toBe(
          false,
        );
      }
    });
  }

  test('the team screens are reachable from the navigation, not only by URL', async ({ page }) => {
    // A grant with no way in is the bug this fixes: the data was always
    // permitted, there was simply no screen offering it.
    await open(page, '/work');
    await expect(
      page.getByRole('navigation', { name: 'Work scope' }).getByRole('link', { name: /My Team/ }),
    ).toBeVisible();

    await open(page, '/work/routine');
    await expect(
      page.getByRole('group', { name: 'Routine view' }).getByRole('link', { name: 'My team' }),
    ).toBeVisible();

    await open(page, '/goals');
    await expect(
      page
        .getByRole('navigation', { name: 'Goal workspace' })
        .getByRole('link', { name: 'My Team' }),
    ).toBeVisible();
  });

  test('and cannot set a Goal for the people it can read', async ({ page }) => {
    // Reading somebody's Goals is what the grant is for. Adding to them is an
    // authority, and the panel offered the button to anybody who could see it.
    await open(page, '/goals?view=team', 'Employee goals');
    await expect(page.getByRole('button', { name: /Add goal/ })).toHaveCount(0);
  });

  test('but none of the authority a manager has', async ({ page }) => {
    /*
     * Sight of somebody's work is not permission to hand them more of it. The
     * header used to offer "Assign work" to anybody on My Team, which promised
     * an authority the grant does not carry.
     */
    await open(page, '/work?scope=team');
    await expect(page.getByRole('link', { name: /Assign work/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /New Work/ })).toBeVisible();
  });
});

test.describe('v139 no grant, no screen', () => {
  test.beforeEach(async ({ page }) => {
    // Lim's visibility mode is `none`.
    await signIn(page, 'lim@tamco.local');
  });

  test('a person with no grant at all still has no team screen', async ({ page }) => {
    // Opening the scope on visibility must not mean opening it on nothing.
    await open(page, '/work');
    await expect(page.getByRole('navigation', { name: 'Work scope' })).toHaveCount(0);

    await open(page, '/goals');
    await expect(page.getByRole('navigation', { name: 'Goal workspace' })).toHaveCount(0);

    await open(page, '/work/routine');
    await expect(page.getByRole('group', { name: 'Routine view' })).toHaveCount(0);
  });

  test('and a direct URL cannot conjure one', async ({ page }) => {
    // The gate is a rendering decision; the data behind it is bound by RLS. Ask
    // for the team address anyway and there is still nobody there.
    for (const surface of TEAM_SURFACES) {
      /*
       * No anchor: for somebody with no grant these views render their own
       * empty state, so the thing a populated screen says never appears. The
       * heading is enough to know the server render arrived.
       */
      await open(page, surface.url);
      await expect(page.locator('main#main h1')).toBeVisible();
      const text = await contentOf(page);
      for (const name of [...GRANTED, ...OFF_LIMITS]) {
        expect(text.includes(name), `${surface.url} named ${name} to somebody with no grant`).toBe(
          false,
        );
      }
    }
  });
});
