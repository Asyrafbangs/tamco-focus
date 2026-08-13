import { expect, test, type Page } from '@playwright/test';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const PHRASE = 'Complete machine guarding verification';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|plan|more|team)/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * v41 section 3 — the Capture title input must never remount while somebody is
 * typing into it.
 *
 * A remount loses characters, drops focus and moves the caret, which is the
 * single most destructive thing a capture form can do: the person is mid-
 * thought and the box eats it. This types the phrase one character at a time
 * and checks the field survives, keeps focus, and is the same DOM node
 * throughout.
 */
test.describe('Capture title input stability', () => {
  test('survives continuous typing without remounting', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', 'Behaviour is viewport independent.');

    await signIn(page, 'izzah@tamco.local');
    await page.goto('/today?capture=1');

    const title = page.getByLabel('What needs to be done?');
    await expect(title).toBeVisible();
    await title.click();

    // Tag the live node. If React unmounts and recreates the input, the tag is
    // gone — an identity check no amount of matching value can fake.
    await title.evaluate((element) => {
      (element as HTMLInputElement).dataset.stabilityProbe = 'original';
    });

    for (const character of PHRASE) {
      await page.keyboard.type(character, { delay: 12 });
    }

    // Every character survived, in order.
    await expect(title).toHaveValue(PHRASE);

    // Focus never left the field.
    const stillFocused = await title.evaluate((element) => document.activeElement === element);
    expect(stillFocused, 'focus left the title input while typing').toBe(true);

    // The caret is at the end, not reset to the start by a re-render.
    const caret = await title.evaluate((element) => (element as HTMLInputElement).selectionStart);
    expect(caret).toBe(PHRASE.length);

    // Same DOM node as before typing began.
    const probe = await title.evaluate(
      (element) => (element as HTMLInputElement).dataset.stabilityProbe,
    );
    expect(probe, 'the title input was remounted during typing').toBe('original');

    // And the modal around it was not reconstructed either.
    await expect(page.getByRole('dialog', { name: 'New Work' })).toHaveCount(1);
  });
});
