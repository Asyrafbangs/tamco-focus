import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/*
 * v299 — the assistant is for managers, and three places have to agree.
 *
 * v295 shipped `/ai` with no role gate anywhere: the rail listed it for
 * everybody, the page checked only that somebody was signed in, and the route
 * checked the same. The v298 merge therefore widened the audience to the whole
 * workforce as a side effect of a deploy. Nothing leaked — every tool runs as
 * the asker and answers only from records they may already read — but who the
 * feature is for became an accident instead of a decision.
 *
 * The rule is one function, `canUseAssistant`. This spec proves it is actually
 * enforced, and proves it at the layer that matters:
 *
 *   * the rail does not offer it           — presentation;
 *   * `/ai` renders the not-found screen    — the address, not the link;
 *   * `POST /api/ai/chat` answers 403       — the endpoint, which a hidden
 *                                             link does nothing to protect.
 *
 * A manager is checked in the same run, because a gate that refused everybody
 * would pass every negative assertion here.
 *
 * **The page gate is a soft 404 and that is not this change's doing.** The
 * `(app)` group has a `loading.tsx`, so the shell is streamed — with its 200 —
 * before the page component runs and calls `notFound()`. The status cannot
 * then be changed, and `/more/admin/users` behaves identically for the same
 * reason: 200, with "404 | This page could not be found" in `main`. So the
 * assertion here is on what the person receives rather than on the status
 * line. The hard boundary is the route, which answers before anything streams.
 *
 * `amer@tamco.local` is seeded `team_member`, `izzul@tamco.local` `manager`.
 */

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

test.describe('v299 assistant access', () => {
  test('a team member is not offered it, cannot reach it, and cannot post to it', async ({
    page,
  }) => {
    await signIn(page, 'amer@tamco.local');

    /*
     * `count()` rather than `not.toBeVisible()`: the rail collapses to icons
     * at some widths, so an entry that is present but off-screen would pass a
     * visibility assertion while still being one keyboard tab away.
     */
    expect(await page.getByRole('link', { name: 'TAMCO AI' }).count()).toBe(0);

    await page.goto('/ai');
    /*
     * Wait for the streamed shell to resolve first. Read any earlier and the
     * assertions pass against the loading state, which contains neither the
     * heading nor the box and would pass whether the gate existed or not.
     */
    await expect(page.getByText('One moment')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('This page could not be found')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Ask about your work' })).toHaveCount(0);
    await expect(page.getByLabel('Ask the assistant', { exact: true })).toHaveCount(0);

    const posted = await page.request.post('/api/ai/chat', {
      data: { question: 'Which findings are overdue?' },
    });
    expect(posted.status()).toBe(403);
    /*
     * And the refusal says who it is for. A bare 403 with no body reads as a
     * fault rather than a boundary, and this endpoint is called by our own
     * client code.
     */
    expect(await posted.text()).toMatch(/managers and administrators/i);
  });

  test('a manager is offered it, reaches it, and is not refused by the route', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');

    await expect(page.getByRole('link', { name: 'TAMCO AI' }).first()).toBeVisible();

    await page.goto('/ai');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(
      page.getByRole('heading', { name: 'Ask about your work', level: 1 }),
    ).toBeVisible();

    /*
     * Not an assertion that the question is answered — CI has no API key and
     * should not have one. Only that the role gate is not what stops it. The
     * refusal that follows (no key, or a budget ceiling) is a different
     * mechanism with its own tests, and any status except 403 proves the one
     * thing this case is about.
     */
    const posted = await page.request.post('/api/ai/chat', {
      data: { question: 'Which findings are overdue?' },
    });
    expect(posted.status()).not.toBe(403);
  });

  test('the disabled notice names the variable this installation reads', async ({ page }) => {
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/ai');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const box = page.getByLabel('Ask the assistant', { exact: true });
    await expect(box).toBeVisible();

    /*
     * Both branches assert, and neither is skipped. A `test.skip` on "this
     * environment has a key" would be silent on every developer machine that
     * has one — which is exactly how a stale selector once survived 21 stages
     * here — and CI, having no key, would be the only place it ever ran.
     *
     * Until v299 the disabled text was the literal `GROQ_API_KEY`, and it
     * stayed on the screen for two versions after the provider became OpenAI.
     * It now comes from the running configuration, so when the assistant is
     * off it must name one of the two real variables: never a third thing,
     * and never a provider-free hand-wave that leaves an administrator with
     * nothing to set. When the assistant is on, it must not be asking for a
     * key at all.
     */
    const placeholder = await box.getAttribute('placeholder');
    if (await box.isDisabled()) {
      expect(placeholder).toMatch(/not switched on/i);
      expect(placeholder).toMatch(/\b(GROQ|OPENAI)_API_KEY\b/);
    } else {
      expect(placeholder ?? '').not.toMatch(/API_KEY|not switched on/i);
      /*
       * Typed first on purpose: Ask is disabled on an empty box regardless of
       * the key, so asserting it straight away would fail for a reason that
       * has nothing to do with this case.
       */
      await box.fill('Which findings are overdue?');
      await expect(page.getByRole('button', { name: 'Ask', exact: true })).toBeEnabled();
    }
  });
});
