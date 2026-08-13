import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Creating work from the UI, in one place.
 *
 * Six specs each carried their own copy of this sequence, written against the
 * two page Capture Work flow: a link called "Capture work", a dialog of the
 * same name, an "Add Work" button, a "One quick question" interstitial with Yes
 * and No buttons, a "Recommended destination" page, and "Confirm & Create".
 *
 * The New Work redesign replaced all of it with one screen, and every one of
 * those copies broke — twenty failures across specs that were testing barriers,
 * meetings and attention cards, none of which had changed. They were failing on
 * the fixture they used to reach their subject.
 *
 * Keeping the sequence here means the next change to New Work breaks one
 * function rather than six specs, and that the specs read as what they are
 * about: "given a task exists, raise a barrier against it".
 */

/** Opens New Work and returns the dialog. */
export async function openNewWork(page: Page): Promise<Locator> {
  await page.getByRole('link', { name: /New Work/i }).click();
  const dialog = page.getByRole('dialog', { name: 'New Work' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Creates ordinary work and waits for New Work to close.
 *
 * `followUp` decides where it lands, which is the whole point of the redesign:
 * work that continues after the day you start it is Operational and appears
 * under Available, and work that finishes in one go is a Quick Action. The due
 * date no longer has any say in that — it is a commitment, not a signal.
 */
export async function createWork(
  page: Page,
  title: string,
  followUp: 'continues' | 'finishes' = 'continues',
): Promise<void> {
  const dialog = await openNewWork(page);
  await dialog.locator('#capture-title').fill(title);
  await dialog.getByText('Add details', { exact: true }).click();
  await dialog
    .getByText(
      followUp === 'continues' ? 'Yes — it continues afterwards' : 'No — it finishes in one go',
    )
    .click();
  await dialog.getByRole('button', { name: /^Create work$/ }).click();
  await expect(dialog).toBeHidden();
}
