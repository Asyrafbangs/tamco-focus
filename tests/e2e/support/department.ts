import type { Locator, Page } from '@playwright/test';

/**
 * v223 - the accountable department is a combobox: type, then choose the
 * department from the list. `scope` narrows to one form when a page has more.
 */
export async function chooseDepartment(scope: Page | Locator, name: string) {
  const field = scope.getByRole('combobox', { name: 'Accountable department' });
  await field.fill(name);
  await scope.getByRole('option', { name, exact: true }).click();
}
