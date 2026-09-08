import { expect, type Page } from '@playwright/test';

/**
 * Open "Other active work" if the page has closed it.
 *
 * v146 §9 puts the current focus and the week's agreed results above the Active
 * list and collapses the list itself. It opens by default only while there is
 * nothing above it to read, so whether a row is on screen now depends on
 * whether that person happens to have a current focus or a priority — and the
 * five viewport projects share one database, so an earlier spec setting one is
 * enough to hide every row from a later one.
 *
 * Every spec that reaches for a task row on My Work calls this first. It is a
 * shared module rather than nine copies because the rule belongs to the page,
 * not to any of them, and the next spec to touch a row should not have to
 * rediscover it from a ten-second timeout.
 */
export async function showActiveWork(page: Page): Promise<void> {
  const shell = page.getByTestId('other-active-work');
  if ((await shell.count()) === 0) return;

  const open = await shell.evaluate((node) => (node as HTMLDetailsElement).open);
  if (open) return;

  await shell.locator('summary').click();
  await expect(shell).toHaveAttribute('open', '');
}
