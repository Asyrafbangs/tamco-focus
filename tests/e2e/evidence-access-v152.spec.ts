import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import { showActiveWork } from './support/work-list';

/**
 * v152 — A27 and A30 at the front door.
 *
 * `tests/integration/storage-object-access-v152.test.ts` holds the storage
 * layer to these two scenarios: who may read an object, and for how long. This
 * spec holds the route in front of it to the same rules, because the two are
 * separately capable of being wrong. `/api/attachments/<id>` is the only
 * evidence link the interface ever hands out, and it is a redirect — a route
 * that skipped its authorisation check would happily mint a signed URL for
 * anybody who guessed an id, and the storage policies would never see the
 * request.
 *
 * A30: "Manager attempts unrelated employee/file URL — server denies access,
 * including aggregates and storage URLs."
 * A27: "Manager opens completed evidence later — authorized preview/download
 * works, including Office fallback; private link not publicly usable."
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** Izzah's, seeded, and shared with nobody — which is what makes a refusal
 * elsewhere mean something. */
const TASK = 'Close out corrective actions from the June audit';

async function signIn(page: Page, email: string) {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * Presses a control the way a person would, once it is genuinely reachable.
 *
 * The drawer's action row settles a moment after the panel opens, and a click
 * dispatched at a coordinate something else still covers lands on the thing in
 * front. Copied from `capture-work.spec.ts`, which needed it for this exact
 * button.
 */
async function clickVisibleControl(page: Page, locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      locator.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
        );
        return hit === element || element.contains(hit);
      }),
    )
    .toBe(true);
  await locator.focus();
  await expect(locator).toBeFocused();
  await page.keyboard.press('Enter');
}

/**
 * Attaches a file to Izzah's task through the interface and returns the link
 * the interface offers for it.
 *
 * Through the product rather than through the database on purpose: the path
 * under test starts at the upload, and an object placed by the service role
 * would prove nothing about what the application actually stores.
 */
async function attachEvidence(
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<string> {
  await page.goto('/work');
  await showActiveWork(page);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  await page.getByRole('link', { name: TASK }).click();

  const detail = page.getByRole('dialog', { name: TASK });
  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: '+ Add update' }).click();
  await detail.getByLabel('What changed?').fill('Attached for the access check.');
  await detail.getByLabel('Add files').setInputFiles(file);
  await clickVisibleControl(page, detail.getByRole('button', { name: 'Post update' }));
  await expect(detail.getByText('Update posted.')).toBeVisible({ timeout: 20_000 });

  await detail.getByRole('button', { name: 'Details', exact: true }).click();
  const link = detail.getByRole('link', { name: new RegExp(file.name) }).first();
  await expect(link).toBeVisible();

  const href = await link.getAttribute('href');
  expect(href, 'the interface offered no link for the file it stored').toBeTruthy();
  /*
   * §19: "Never use permanent public URLs for private evidence." The link is
   * an application route, so every open is authorised and recorded; a storage
   * URL in this attribute would be a permanent one, readable by anybody it was
   * ever pasted to.
   */
  expect(href!).toMatch(/^\/api\/attachments\/[0-9a-f-]+$/i);
  return href!;
}

/** A second signed-in person, in their own browser context. */
async function pageFor(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { page, context };
}

test('A30 an evidence link is refused to everybody it does not belong to', async ({
  page,
  browser,
  request,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The upload runs once.');

  await signIn(page, 'izzah@tamco.local');
  const href = await attachEvidence(page, {
    name: `access-${Date.now()}.txt`,
    mimeType: 'text/plain',
    buffer: Buffer.from('Private evidence.'),
  });

  /*
   * The `request` fixture is its own context with its own empty cookie jar, so
   * this is the request somebody makes with a link and no account — pasted
   * into a chat, forwarded in an email, or found in a browser history on a
   * shared terminal.
   *
   * The answer is the sign-in page, not the file and not a 404: `src/proxy.ts`
   * catches the request before the route sees it and preserves where they were
   * heading, so following the link after signing in lands on the evidence. The
   * proxy calls itself "a convenience redirect, not the security boundary",
   * which is exactly right and is why the two assertions below are about the
   * response never being the file rather than about the status code.
   */
  const unfollowed = await request.get(`${baseURL}${href}`, { maxRedirects: 0 });
  expect(unfollowed.status()).toBe(307);
  expect(unfollowed.headers()['location'] ?? '').toMatch(/^\/sign-in\?next=/);

  const anonymous = await request.get(`${baseURL}${href}`);
  expect(anonymous.url(), 'an evidence link resolved somewhere other than sign-in').toContain(
    '/sign-in',
  );
  expect(await anonymous.text()).not.toContain('Private evidence.');

  // A real employee with a real session and no business with this task. The
  // refusal is 404 rather than 403 deliberately: the API route treats denied
  // and absent alike, so an id cannot be probed for existence.
  const outsider = await pageFor(browser, 'lim@tamco.local');
  const refused = await outsider.page.context().request.get(href);
  expect(refused.status(), 'an unrelated employee opened somebody else’s evidence').toBe(404);
  await outsider.context.close();

  /*
   * Both controls. Without them a route that refused everybody would pass
   * every assertion above, on an application where no evidence could be
   * opened at all.
   */
  const owner = await page.context().request.get(href);
  expect(owner.ok(), 'the owner could not open her own evidence').toBe(true);
  expect(await owner.text()).toContain('Private evidence.');

  const manager = await pageFor(browser, 'izzul@tamco.local');
  const allowed = await manager.page.context().request.get(href);
  expect(allowed.ok(), 'the manager could not open the evidence').toBe(true);
  await manager.context.close();
});

test('A27 the manager’s link reaches a signed object, not a public one', async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The upload runs once.');

  await signIn(page, 'izzah@tamco.local');
  /*
   * A PowerPoint file, which is the format §19 names and the pipeline refused
   * outright until v152 widened the bucket: the completion panel read "Photos
   * · PDF · Word · Excel · PowerPoint" while storage answered "mime type
   * application/vnd.openxmlformats-officedocument.presentationml.presentation
   * is not supported". Attaching one here is the end-to-end proof of that fix,
   * and it is also the Office case A27 asks about.
   */
  const name = `handover-${Date.now()}.pptx`;
  const href = await attachEvidence(page, {
    name,
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    buffer: Buffer.from('PK deck'),
  });

  const opened = await page.context().request.get(href);
  expect(opened.ok(), 'a PowerPoint file could not be opened after being stored').toBe(true);

  /*
   * §19: "If a format cannot be previewed, retain authorized download rather
   * than showing a broken preview." There is no Office viewer, so the route
   * redirects to a download — and the file keeps the name it was uploaded
   * with rather than the sanitised storage key, because a person looking in
   * their downloads folder is looking for the name they chose.
   */
  const landed = opened.url();
  expect(landed, 'the route did not redirect to storage').toContain('/storage/v1/object/sign/');
  expect(decodeURIComponent(landed)).toContain(name);
  expect(opened.headers()['content-disposition'] ?? '').toContain('attachment');

  /*
   * And the object underneath it is not public. Same URL, same path, without
   * the signature — which is the thing somebody would try after noticing the
   * token expired.
   */
  const unsigned = landed.split('?')[0]!;
  const bare = await request.get(unsigned);
  expect(bare.ok(), 'the storage object was readable without its signature').toBe(false);
});

/**
 * v152 — the sign-in redirect that guards those links does not leave the site.
 *
 * Found while testing the above: the `next` parameter the proxy sets is
 * honoured after sign-in, and the only check on it was `startsWith('/')`.
 * `//attacker.example` starts with a slash and is an absolute URL to another
 * origin, so the link
 *
 *     https://tamco-focus.vercel.app/sign-in?next=//attacker.example
 *
 * showed the genuine sign-in page on the genuine domain, took a genuine
 * password, and then handed the person to a copy of it. Confirmed against the
 * running application before the fix — the browser landed on another origin.
 *
 * The destination here is a second local origin rather than a real external
 * one, so the test proves the navigation without depending on the internet.
 */
test('the sign-in redirect cannot be pointed off this site', async ({
  page,
  baseURL,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One sign-in is enough.');

  const elsewhere = '//127.0.0.1:54321/storage/v1/object/public';
  await page.goto(`/sign-in?next=${encodeURIComponent(elsewhere)}`);

  // The value is refused on the way in as well as on the way out, so the page
  // never renders a field pointing at somebody else's site.
  await expect(page.locator('input[name="next"]')).toHaveValue('/today');

  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/today$/);
  expect(new URL(page.url()).origin, 'sign-in handed the browser to another origin').toBe(
    new URL(baseURL!).origin,
  );
});
