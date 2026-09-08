import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { showActiveWork } from './support/work-list';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

/** A valid, dependency-free one-page PDF used to exercise the real renderer. */
function pdfFixture(text: string) {
  const safeText = text.replace(/[()\\]/g, (character) => `\\${character}`);
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${safeText}) Tj\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => {
    const offset = Buffer.byteLength(pdf, 'ascii');
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xrefOffset = Buffer.byteLength(pdf, 'ascii');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(pdf, 'ascii');
}

async function expectHydrated(page: import('@playwright/test').Page) {
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function expectAccessible(page: import('@playwright/test').Page) {
  // Modals and drawers fade in, and Playwright calls an element visible well
  // before its opacity reaches 1. axe measures whatever is painted at the
  // instant it runs, so scanning mid-transition reports contrast for blended
  // colours nobody ever sees — a real failure against a state that does not
  // exist. Let every running transition settle first.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => animation instanceof CSSTransition)
      .every((animation) => animation.playState === 'finished'),
  );

  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}

async function clickVisibleControl(
  page: import('@playwright/test').Page,
  locator: import('@playwright/test').Locator,
) {
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

test('employee captures a Quick Action from desktop and mobile', async ({ page }, testInfo) => {
  const title = `E2E ${testInfo.project.name} label check ${Date.now()}`;

  await page.goto('/sign-in');
  await expectAccessible(page);
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expectHydrated(page);

  /*
   * One screen since the New Work redesign. This test still described the two
   * page flow it replaced — a "Confirm & Create" step, a "One quick question"
   * interstitial and a dialog called "Capture work" — none of which exist, so
   * it was failing against a product that works.
   *
   * Quick Action is now reached by answering the follow-up question rather than
   * by picking today's date, which is the point of the change: a date is a
   * commitment and was never evidence about how long work takes.
   */
  await page.getByRole('link', { name: /New Work/i }).click();
  await expect(page).toHaveURL(/\/today\?capture=1$/);
  const dialog = page.getByRole('dialog', { name: 'New Work' });
  await expect(dialog).toBeVisible();
  await expectAccessible(page);
  await dialog.locator('#capture-title').fill(title);

  await dialog.getByText('Add details', { exact: true }).click();
  await dialog.getByText('No — it finishes in one go').click();
  await expect(dialog.getByText(/Quick Action/)).toBeVisible();

  await dialog.getByRole('button', { name: /^Create work$/ }).click();

  await expect(page).toHaveURL(/\/today$/);

  /*
   * Checked on Work, not on My Day.
   *
   * The Today section is a ranked shortlist of three — "the next few things
   * worth your time" — not a list of everything. This test used to pass because
   * the old flow set a due date of today, which bought the new task a slot.
   * Asserting there now would make the test a measurement of how busy the
   * shared fixture database happens to be.
   */
  await page.goto('/work');
  await showActiveWork(page);
  await expect(page.getByText(title, { exact: true })).toBeVisible();
  await expectAccessible(page);
});

test('employee opens task detail and posts an update with private evidence', async ({
  page,
}, testInfo) => {
  const update = `E2E ${testInfo.project.name} task update ${Date.now()}`;
  const fileName = `e2e-${testInfo.project.name}-evidence.txt`;

  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expectHydrated(page);

  await page.goto('/work');
  await showActiveWork(page);
  await expectHydrated(page);
  await page
    .getByRole('link', { name: 'Close out corrective actions from the June audit' })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Close out corrective actions from the June audit',
  });
  await expect(detail).toBeVisible();
  // v84 - one drawer. Steps and Updates are named sections, and the composer
  // is opened by the button that names it rather than by arriving somewhere.
  await detail.getByRole('button', { name: /^Steps/ }).click();
  await expect(detail.locator('.task-checklist-list')).toBeVisible();
  await expect(detail.getByText(/^First:/)).toHaveCount(0);
  await expect(
    detail.getByText('Steps are the only record of what is left to do, and they drive progress.'),
  ).toHaveCount(0);

  await detail.getByRole('button', { name: '+ Add update' }).click();
  await detail.getByLabel('What changed?').fill(update);
  await detail.getByLabel('Add files').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('Browser-verified private evidence.'),
  });
  await clickVisibleControl(page, detail.getByRole('button', { name: 'Post update' }));

  const updatesDisclosure = detail.getByRole('button', { name: /^Updates/ });
  await expect(updatesDisclosure.locator('small')).toContainText(/^Latest · /);
  await updatesDisclosure.click();
  await expect(detail.getByText(update, { exact: true })).toHaveCount(1);
  // Attachments live in Details now, with the rest of the record.
  await detail.getByRole('button', { name: 'Details', exact: true }).click();
  const attachment = detail.getByRole('link', { name: new RegExp(fileName) }).first();
  await expect(attachment).toBeVisible();
  const href = await attachment.getAttribute('href');
  expect(href).toBeTruthy();
  const download = await page.context().request.get(href!);
  expect(download.ok()).toBe(true);
  expect(await download.text()).toContain('Browser-verified private evidence.');
  await expectAccessible(page);
});

test('employee reads a PDF in the task drawer without the browser download plug-in', async ({
  page,
}, testInfo) => {
  const fileName = `inline-${testInfo.project.name}-${Date.now()}.pdf`;

  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzah@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expectHydrated(page);

  await page.goto('/work');
  await showActiveWork(page);
  await expectHydrated(page);
  await page
    .getByRole('link', { name: 'Close out corrective actions from the June audit' })
    .click();
  const detail = page.getByRole('dialog', {
    name: 'Close out corrective actions from the June audit',
  });
  await expect(detail).toBeVisible();

  await detail.getByRole('button', { name: '+ Add update' }).click();
  await detail.getByLabel('What changed?').fill('Added the PDF for an in-app review.');
  await detail.getByLabel('Add files').setInputFiles({
    name: fileName,
    mimeType: 'application/pdf',
    buffer: pdfFixture('TAMCO Focus inline PDF preview'),
  });
  await clickVisibleControl(page, detail.getByRole('button', { name: 'Post update' }));

  const updatesDisclosure = detail.getByRole('button', { name: /^Updates/ });
  if ((await updatesDisclosure.getAttribute('aria-expanded')) !== 'true') {
    await updatesDisclosure.click();
  }
  /*
   * The post triggers a router refresh, and clicking the chip while that is
   * still in flight opens a viewer the re-render then discards. Waiting for
   * the chip to settle is waiting for the post to finish landing, which is a
   * precondition of the click rather than a weakening of it.
   */
  const chip = detail.getByRole('button', { name: fileName });
  await expect(chip).toBeVisible();
  await expect(detail.getByText('Update posted.')).toBeVisible();
  await chip.click();

  await expect(page.getByRole('heading', { name: fileName })).toBeVisible();
  /*
   * Scoped to the header itself, not to `detail`. The drawer is labelled by
   * its own heading, and in viewer mode that heading is the file name - so a
   * dialog locator built from the task title stops matching the moment the
   * file opens.
   */
  const headerDownload = page
    .locator('.task-detail-head')
    .getByRole('link', { name: 'Download', exact: true });
  await expect(headerDownload).toBeVisible();
  await expect(headerDownload).toHaveAttribute('href', /^\/api\/attachments\/[0-9a-f-]+$/i);
  await expect(headerDownload).toHaveAttribute('download', fileName);
  await expect(page.getByRole('toolbar', { name: 'PDF page controls' })).toBeVisible();
  await expect(page.getByText('Page 1 of 1', { exact: true })).toBeVisible();
  const pageCanvas = page.getByRole('img', { name: `Page 1 of 1 in ${fileName}` });
  await expect(pageCanvas).toBeVisible();
  await expect
    .poll(() =>
      pageCanvas.evaluate((canvas: HTMLCanvasElement) => canvas.width > 100 && canvas.height > 100),
    )
    .toBe(true);
  await expect(page.locator('.task-detail iframe')).toHaveCount(0);
  await expect(page.locator('.task-detail').getByRole('button', { name: /^Open$/ })).toHaveCount(0);
  await expectAccessible(page);
});
