import { expect, test, type Page } from '@playwright/test';

import { createWork } from './helpers/capture';

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/**
 * A manager creates work, finds it, deletes it, and finds it in the Bin.
 *
 * Reported from Production as two separate impossibilities: work created and
 * then visible on no tab at all, and a Bin that stayed empty after deleting.
 * The database disagreed — creating, reading back, `can_delete` and
 * `delete_task` all behaved correctly when driven directly — which left the
 * application layer as the only place the cycle could be breaking, and it was
 * the one layer with no test walking it end to end.
 */
test.describe('v63 manager work lifecycle', () => {
  test('creates work, sees it on Available, deletes it, finds it in the Bin', async ({
    page,
  }, testInfo) => {
    const title = `Manager cycle ${testInfo.project.name} ${Date.now()}`;
    await signIn(page, 'izzul@tamco.local');

    await createWork(page, title, 'continues');

    // Ordinary work with follow-up is Operational, which is filed as Available.
    await page.goto('/work?tab=available');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.getByText(title, { exact: true })).toBeVisible();

    // Open it and delete it.
    await page.getByText(title, { exact: true }).click();
    const drawer = page.locator('.task-detail-drawer');
    await expect(drawer).toBeVisible();

    // v84 - administration lives behind the ••• menu in the drawer footer.
    await drawer.getByRole('button', { name: 'More task actions' }).click();
    const deleteButton = page.getByRole('menu').getByRole('button', { name: /^Move to Bin$/ });
    await expect(deleteButton).toBeVisible();
    await deleteButton.click();

    // Scoped to the confirmation modal by name. Unscoped, the menu's own
    // "Move to Bin" command matched first and sat behind the modal overlay.
    const confirm = page.getByRole('dialog', { name: 'Move to Bin' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^Move to Bin$/ }).click();
    await expect(confirm).toBeHidden();

    await expect(page.getByText(title, { exact: true })).toHaveCount(0);

    await page.goto('/work?tab=bin');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.getByText('The Bin is empty')).toHaveCount(0);
    await expect(page.locator('.bin-row', { hasText: title })).toBeVisible();

    /*
     * The badge counts from anywhere, not only from the Bin.
     *
     * It used to be read off the list, which was fetched only when the Bin tab
     * was already open — so it showed 0 on Active, Available and Shared, and
     * became correct the moment you clicked the thing it was supposed to be
     * telling you about.
     */
    await page.getByRole('button', { name: 'More work views' }).click();
    const binTab = page.getByRole('link', { name: /^Bin/ });
    const onBin = (await binTab.textContent())?.replace(/\D/g, '');
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    // v88 - the Bin is a utility, not a work state, so it moved under More.
    await page.getByRole('button', { name: 'More work views' }).click();
    await expect(page.getByRole('link', { name: /^Bin/ })).toHaveText(new RegExp(`${onBin}$`));
    expect(Number(onBin)).toBeGreaterThan(0);
  });

  test('one manager does not see what another manager binned', async ({ page }, testInfo) => {
    /*
     * `routine_templates_select` grants every manager sight of every routine in
     * the organisation, and the task Bin is bounded by `can_view_task`, which
     * for a manager covers their whole reporting line. Without scoping, the Bin
     * becomes a shared list of everybody's deleted work rather than a way back
     * from your own mistake.
     */
    const title = `Private bin ${testInfo.project.name} ${Date.now()}`;
    await signIn(page, 'izzul@tamco.local');
    await createWork(page, title, 'continues');

    await page.goto('/work?tab=available');
    await page.getByText(title, { exact: true }).click();
    const drawer = page.locator('.task-detail-drawer');
    await drawer.getByRole('button', { name: 'More task actions' }).click();
    await page
      .getByRole('menu')
      .getByRole('button', { name: /^Move to Bin$/ })
      .click();
    const confirm = page.getByRole('dialog', { name: 'Move to Bin' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: /^Move to Bin$/ }).click();
    await expect(confirm).toBeHidden();

    await page.goto('/work?tab=bin');
    await expect(page.locator('.bin-row', { hasText: title })).toBeVisible();

    // The administrator is not the person who deleted it.
    await signIn(page, 'admin@tamco.local');
    await page.goto('/work?tab=bin');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.bin-row', { hasText: title })).toHaveCount(0);
  });
});
