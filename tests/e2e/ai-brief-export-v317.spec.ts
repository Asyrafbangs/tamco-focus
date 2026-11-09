import { readFile } from 'node:fs/promises';

import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/**
 * v317 — pressing the buttons, which is the only thing nobody had tested.
 *
 * The unit suite proves the document and the gathering. What it cannot reach
 * is the part the reader actually touches: a clipboard write that browsers
 * refuse for several unrelated reasons, a download whose bytes nothing had
 * ever read back, and a fallback path that only runs when the first one has
 * already failed. An independent review asked for exactly this, and it was
 * right to: "copies to the clipboard" was an assertion about a function
 * call, not about the clipboard.
 *
 * So these cases press Copy and read the clipboard, press Download and read
 * the file, and then break the clipboard on purpose and check that the reader
 * still ends up with the brief - by a different route, and told which route
 * it was.
 */

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openExport(page: Page) {
  await page.goto('/ai');
  /*
   * Hydration first. These buttons do their whole job in an event handler, so
   * a click landing before React has attached one is a click into nothing -
   * and it reads, in the report, exactly like a button that does not work.
   */
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await expect(page.getByRole('heading', { name: 'Export AI brief', level: 1 })).toBeVisible();
}

/** The marks that identify a real brief rather than any old text. */
function expectIsABrief(text: string) {
  expect(text).toContain('# TAMCO Focus — AI brief');
  expect(text).toContain('## How to read this');
  expect(text).toContain('## Source coverage');
  expect(text).toContain('| Source | Included | Available | Status |');
  /* The completeness wording the review asked for, in the delivered bytes. */
  expect(text).toContain(
    '*Available* is a counted total from the source, not the number of rows that came back.',
  );
  expect(text).toContain('## Team tasks');
  expect(text).toContain('## What is deliberately not in this brief');
  expect(text).toContain('Read-only: producing this brief changed no record');
}

test.describe('v317 exporting the AI brief', () => {
  test('Copy puts the whole brief on the clipboard, and says so', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await signIn(page);
    await openExport(page);

    await page.getByRole('button', { name: 'Copy AI brief' }).click();

    const status = page.getByRole('status');
    await expect(status).toContainText('Copied', { timeout: 30_000 });
    /* The size is part of the reassurance: "copied" with nothing behind it is
     * the failure this message exists to rule out. */
    await expect(status).toContainText(/Copied \(\d+(\.\d+)? ?(bytes|KB)\)/);
    await expect(status).toContainText('Paste it into your assistant.');

    const clipped = await page.evaluate(() => navigator.clipboard.readText());
    expectIsABrief(clipped);

    /* Nothing was offered to copy by hand, because nothing went wrong. */
    await expect(page.getByLabel('The brief, to copy by hand')).toHaveCount(0);
  });

  test('Download writes a named file whose bytes are the brief', async ({ page }) => {
    await signIn(page);
    await openExport(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Download .md' }).click(),
    ]);

    /* Sortable by name, to the minute: these pile up in a downloads folder. */
    expect(download.suggestedFilename()).toMatch(/^tamco-ai-brief-\d{4}-\d{2}-\d{2}-\d{4}\.md$/);

    const saved = await download.path();
    expect(saved).not.toBeNull();
    expectIsABrief(await readFile(saved as string, 'utf8'));

    await expect(page.getByRole('status')).toContainText('Saved tamco-ai-brief-');
  });

  test('a refused clipboard downloads the brief and offers it to copy by hand', async ({
    page,
  }) => {
    /*
     * Not a hypothetical. The clipboard is unavailable on an insecure origin,
     * throws when the document is not focused, and Safari refuses it outside
     * a direct gesture - so this is the path a real reader hits, and until now
     * it was the one path nothing had executed.
     */
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        get: () => ({
          writeText: () => Promise.reject(new Error('refused by the browser')),
        }),
      });
    });

    await signIn(page);
    await openExport(page);

    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: 'Copy AI brief' }).click(),
    ]);

    /* Same bytes, different route. That is the claim worth proving. */
    const saved = await download.path();
    expect(saved).not.toBeNull();
    expectIsABrief(await readFile(saved as string, 'utf8'));

    const status = page.getByRole('status');
    await expect(status).toContainText('would not let the page use the clipboard');
    await expect(status).toContainText('downloaded as tamco-ai-brief-');
    await expect(status).toContainText('also in the box below');

    /*
     * And the belt-and-braces third route, for somebody whose downloads are
     * blocked as well: the text on the page, selectable.
     */
    const box = page.getByLabel('The brief, to copy by hand');
    await expect(box).toBeVisible();
    expectIsABrief(await box.inputValue());

    /* It is a transcript, not an editor: nobody should be able to alter it. */
    await expect(box).toHaveAttribute('readonly', '');
  });
});
