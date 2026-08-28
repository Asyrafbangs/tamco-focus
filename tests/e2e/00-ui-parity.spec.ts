import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page, type TestInfo } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function expectHydrated(page: Page) {
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function completeActivationPromptIfNeeded(page: Page) {
  const reasonModal = page.getByRole('dialog', { name: 'Over focus target' });
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect
    .poll(async () => (await reasonModal.isVisible()) || (await undo.isVisible()))
    .toBe(true);

  if (!(await reasonModal.isVisible())) return;
  await reasonModal
    .getByLabel('Why is this additional focus needed now?')
    .selectOption('urgent_deadline');
  await reasonModal.getByRole('button', { name: 'Activate anyway' }).click();
  await expect(reasonModal).toHaveCount(0);
}

async function signIn(page: Page, email = 'izzah@tamco.local') {
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|plan|more|team)/);
  await expectHydrated(page);
}

async function attachViewport(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(`${name}-${testInfo.project.name}`, {
    // `caret: 'initial'` rather than Playwright's default. The default hides the
    // text caret by writing `style="caret-color: transparent"` onto the focused
    // element, which React then sees as a server/client attribute mismatch on
    // the next hydration and logs as an error. A screenshot helper must not
    // alter the page it is documenting.
    body: await page.screenshot({ animations: 'disabled', caret: 'initial', fullPage: false }),
    contentType: 'image/png',
  });
}

async function expectNoDocumentOverflow(page: Page, path: string) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(
    dimensions.document,
    `${path} causes document-level horizontal scrolling`,
  ).toBeLessThanOrEqual(dimensions.viewport + 1);
}

test('main employee surfaces retain prototype structure at every required viewport', async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await signIn(page);

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'My Day' })).toBeVisible();
  await expect(page.locator('.today-grid')).toBeVisible();
  await attachViewport(page, testInfo, 'today');
  await expectNoDocumentOverflow(page, '/today');

  // v40 section 1 — Focus navigates by STATE. Major / Operational /
  // Self-Development are still work classes and still drive the 1 / 5 / 1
  // capacity strip, but they are no longer tabs.
  await page.goto('/work');
  await expect(page.locator('.capacity-strip')).toBeVisible();
  await expect(page.locator('.capacity-strip')).toContainText('Operational');
  for (const tab of ['active', 'available', 'shared']) {
    await page.goto(tab === 'active' ? '/work' : `/work?tab=${tab}`);
    await expect(page.locator('.focus-tabs a.active')).toHaveAttribute(
      'href',
      tab === 'active' ? '/work' : `/work?tab=${tab}`,
    );
    await expect(page.locator('.focus-panel')).toBeVisible();
    await attachViewport(page, testInfo, `work-${tab}`);
    await expectNoDocumentOverflow(page, `/work?tab=${tab}`);
  }

  /*
   * v43 section 6 — Routine lives inside the SAME Work shell as Focus. The
   * heading, the Capture entry point and the Focus/Routine selector are shared,
   * so this asserts the shell rather than a Routine-specific heading: the whole
   * requirement is that switching does not feel like another application.
   */
  await page.goto('/work/routine');
  await expect(page.getByRole('heading', { name: 'My Work' })).toBeVisible();
  await expect(page.getByRole('link', { name: /New Work/i })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Workspace' })).toBeVisible();

  // But Routine keeps its own occurrence lifecycle, never Focus vocabulary.
  await expect(page.getByRole('link', { name: /Due now \/ this week/ })).toBeVisible();
  await expect(page.getByRole('link', { name: /^Upcoming/ })).toBeVisible();
  await expect(page.locator('.focus-panel')).not.toContainText('Available Work');

  await attachViewport(page, testInfo, 'routine');
  await expectNoDocumentOverflow(page, '/work/routine');

  await page.goto('/goals');
  await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();
  await expect(page.locator('.goal-list-panel')).toBeVisible();
  await attachViewport(page, testInfo, 'goals');
  await expectNoDocumentOverflow(page, '/goals');

  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
  await expect(page.locator('.calendar, .empty-state').first()).toBeVisible();
  await attachViewport(page, testInfo, 'plan');
  await expectNoDocumentOverflow(page, '/plan');

  await page.goto('/more/records');
  await expect(page.getByRole('heading', { name: 'Records and completion review' })).toBeVisible();
  await expect(page.locator('.record-list')).toBeVisible();
  await attachViewport(page, testInfo, 'records');
  await expectNoDocumentOverflow(page, '/more/records');

  await page.goto('/more/settings');
  await expect(page.getByRole('heading', { name: 'Team rules and my preferences' })).toBeVisible();
  await expect(page.locator('.settings-shell')).toBeVisible();
  await attachViewport(page, testInfo, 'settings');
  await expectNoDocumentOverflow(page, '/more/settings');
  await expectHydrated(page);

  await page.getByRole('button', { name: 'Switch to Night mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const darkTokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue('--bg').trim(), style.getPropertyValue('--surface').trim()];
  });
  expect(darkTokens).toEqual(['#0d1420', '#151f2d']);
  await attachViewport(page, testInfo, 'settings-dark');

  expect(consoleErrors).toEqual([]);
});

/**
 * v53 §22 — the old `/team` page is gone, and its links are not.
 *
 * The screen a manager needs is Work → My Team, and the depth behind it is the
 * Team Member drawer there (covered by `team-context-v48.spec.ts`). What this
 * has to prove is that the retired route still lands somebody in the right
 * place rather than on a 404 that reads as "your team view was deleted" — and
 * that what they land on is the real thing, not an empty shell.
 */
test('the retired Team route lands on Work → My Team', async ({ page }, testInfo) => {
  await signIn(page, 'izzul@tamco.local');

  await page.goto('/team');
  await expect(page).toHaveURL(/\/work\?scope=team$/);
  await expect(page.getByRole('heading', { name: 'My Team' })).toBeVisible();
  await expect(page.getByTestId('my-team-person-row').first()).toBeVisible();

  await attachViewport(page, testInfo, 'team');
  await expectNoDocumentOverflow(page, '/work?scope=team&filter=attention');
});

test('Monthly Plan shows a manager the reporting line their settings cover', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Scope behaviour is viewport independent.');

  // A manager opens the calendar to see where the team's dates collide, so Team
  // is their default. The rows come from `plan_events`, a security_invoker view
  // — RLS decides what exists, the scope only filters it.
  await signIn(page, 'izzul@tamco.local');
  await page.goto('/plan');
  await expect(page.getByRole('link', { name: 'My team' })).toHaveClass(/active/);

  const owned = page.locator('.cal-item-owner');
  await expect(owned.first()).toBeVisible();
  const names = await owned.allInnerTexts();
  expect(names.every((name) => name.trim() !== 'Izzul Asyraf')).toBe(true);

  // Narrowing to their own work must not silently keep the team's items.
  await page.getByRole('link', { name: 'Only me' }).click();
  await expect(page.getByRole('link', { name: 'Only me' })).toHaveClass(/active/);
  await expect(page.locator('.cal-item-owner')).toHaveCount(0);

  // An employee has no reporting line, so the control is absent rather than
  // present and empty.
  await page.context().clearCookies();
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/plan');
  await expect(page.getByRole('navigation', { name: 'Calendar scope' })).toHaveCount(0);
  await expect(page.locator('.cal-item').first()).toBeVisible();
  const sharedOwnerNames = await page.locator('.cal-item-owner').allInnerTexts();
  expect(sharedOwnerNames.every((name) => name.trim() !== 'Izzah Nurul')).toBe(true);
});

test('rows, nested actions, drawers, checklist evidence, tabs and calendar are independent', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'Interaction mutation/restore runs once.');
  await signIn(page);

  await page.goto('/work');
  await expectHydrated(page);
  const firstRow = page.locator('.task-row', {
    hasText: 'Close out corrective actions from the June audit',
  });
  await expect(firstRow).toBeVisible();
  const rowHref = await firstRow.locator('.row-primary-link').getAttribute('href');
  const box = await firstRow.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height / 2);
  await expect(page).toHaveURL(new RegExp(rowHref!.replace(/[?]/g, '\\?')));

  const drawer = page.locator('.task-detail');
  await expect(drawer).toBeVisible();
  expect(await drawer.evaluate((element) => getComputedStyle(element).transitionDuration)).not.toBe(
    '0s',
  );
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(page).not.toHaveURL(/task=/);
  await expect(firstRow.locator('.row-primary-link')).toBeFocused();

  await firstRow.locator('.row-primary-link').focus();
  await page.keyboard.press('Enter');
  await expect(drawer).toBeVisible();
  // v84 - one drawer, named disclosures. Steps is a section, not a tab.
  await drawer.getByRole('button', { name: /^Steps/ }).click();
  const requiredItem = drawer.locator('.task-checklist-row').filter({
    hasText: 'Evidence required',
  });
  await requiredItem.getByRole('button', { name: 'Complete with evidence' }).click();
  const evidenceDialog = page.getByRole('dialog', { name: 'Complete with evidence' });
  await expect(evidenceDialog).toBeVisible();
  const chooserPromise = page.waitForEvent('filechooser');
  await evidenceDialog
    .getByRole('button', { name: 'Choose file / photo / screenshot', exact: true })
    .click();
  const chooser = await chooserPromise;
  expect(chooser.isMultiple()).toBe(false);
  await page.keyboard.press('Escape');
  await expect(evidenceDialog).toHaveCount(0);

  const optionalItem = drawer.locator('.task-checklist-row').filter({
    hasText: 'Evidence optional',
  });
  if (await optionalItem.getByRole('button', { name: 'Undo' }).isVisible()) {
    await optionalItem.getByRole('button', { name: 'Undo' }).click();
  }

  // v42 section E — the circle and the Complete button are one action. `exact`
  // matters now that the circle's accessible name also begins with "Complete".
  const completeButton = optionalItem.getByRole('button', { name: 'Complete', exact: true });
  const completeCircle = optionalItem.locator('.checklist-state-button');

  await completeButton.click();
  await expect(optionalItem.getByRole('button', { name: 'Undo' })).toBeVisible();
  await optionalItem.getByRole('button', { name: 'Undo' }).click();
  await expect(completeButton).toBeVisible();

  // The circle must complete the same item, not merely exist.
  await expect(completeCircle).toBeVisible();
  await completeCircle.click();
  await expect(optionalItem.getByRole('button', { name: 'Undo' })).toBeVisible();
  await optionalItem.getByRole('button', { name: 'Undo' }).click();
  await expect(completeButton).toBeVisible();

  await page.keyboard.press('Escape');

  // This interaction mutates state, so it owns a disposable fixture instead of
  // borrowing the seeded Available-work row used by later Team tests. A missed
  // transient Undo toast previously left that shared row Active and caused the
  // rest of the sequential E2E run to fail for the wrong reason.
  const service = serviceClient();
  const activationTitle = `UI parity activation ${testInfo.project.name} ${Date.now()}`;
  const { error: activationTaskError } = await service.from('tasks').insert({
    title: activationTitle,
    status: 'backlog',
    work_class: 'operational_action',
    focus_bucket: 'operational',
    origin: 'self_initiated',
    urgency: 'normal',
    primary_owner_id: IZZAH,
    created_by: IZZAH,
  });
  if (activationTaskError) throw activationTaskError;

  await page.goto('/work?tab=available');
  await expectHydrated(page);
  const availableRow = page.locator('.task-row', { hasText: activationTitle });
  await expect(availableRow).toBeVisible();
  await availableRow.getByRole('button', { name: 'Activate' }).click();
  await completeActivationPromptIfNeeded(page);
  await expect(page.locator('.task-detail')).toHaveCount(0);
  await expect(availableRow).toHaveCount(0);

  // The Work-level feedback host survives the row's removal, so Undo remains
  // keyboard-accessible and restores the exact task. The next verification
  // reset removes this unique audited fixture; append-only history means a
  // physical in-test delete would be deliberately rejected.
  const activationUndo = page.getByRole('button', { name: 'Undo' });
  await expect(activationUndo).toBeVisible();
  await expect(activationUndo).toBeFocused();
  await activationUndo.press('Enter');
  await expect(availableRow).toBeVisible();
  await expect(availableRow.getByRole('button', { name: 'Activate' })).toBeFocused();

  // The same feedback stays inside an open modal drawer. Its focus trap must
  // include Undo; closing the drawer while the window is live re-parents the
  // control to Work, where Undo restores the row and its original action.
  await availableRow.getByRole('link', { name: `Open ${activationTitle}`, exact: true }).click();
  const activationDrawer = page.locator('.task-detail');
  await expect(activationDrawer).toBeVisible();
  // v84 - administration moved behind the ••• menu in the footer. Nothing is
  // hidden behind Expand any more, so no expansion is needed to reach it.
  await activationDrawer.getByRole('button', { name: 'More task actions' }).click();
  await activationDrawer.getByRole('button', { name: 'Activate' }).click();
  await completeActivationPromptIfNeeded(page);
  const drawerUndo = activationDrawer.getByRole('button', { name: 'Undo' });
  await expect(drawerUndo).toBeVisible();
  await expect(drawerUndo).toBeFocused();
  await activationDrawer.getByRole('button', { name: 'Close task detail' }).click();
  await expect(activationDrawer).toHaveCount(0);
  const relocatedUndo = page.getByRole('button', { name: 'Undo' });
  await expect(relocatedUndo).toBeVisible();
  await expect(relocatedUndo).toBeFocused();
  await relocatedUndo.press('Enter');
  await expect(availableRow).toBeVisible();
  await expect(availableRow.getByRole('button', { name: 'Activate' })).toBeFocused();

  await page.goto('/plan');
  await expectHydrated(page);
  const calendarItems = page.locator('.cal-item');
  if ((await calendarItems.count()) > 0) {
    const item = calendarItems.first();
    const taskHref = await item.getAttribute('href');
    await item.click();
    await expect(page).toHaveURL(new RegExp(taskHref!.replace(/[?]/g, '\\?')));
    await expect(page.locator('.task-detail')).toBeVisible();
    await page.keyboard.press('Escape');
  }

  await page.goto('/more/settings');
  await expectHydrated(page);
  await page.getByRole('button', { name: /Accessibility/ }).click();
  await expect(page.getByLabel('Text size')).toBeVisible();
  await page.getByLabel('Text size').selectOption('large');
  await expect(page.getByText(/unsaved section/)).toBeVisible();
  await page.getByRole('button', { name: 'Discard' }).click();
  await expect(page.getByText(/unsaved section/)).toHaveCount(0);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedDuration = await page
    .locator('.settings-nav-row')
    .first()
    .evaluate((element) => getComputedStyle(element).transitionDuration);
  expect(['0.01ms', '1e-05s']).toContain(reducedDuration);

  const accessibility = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(accessibility.violations).toEqual([]);
});

test('mobile navigation and full-width drawer retain keyboard-sized controls', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'Mobile-only interaction contract.');
  await signIn(page);
  await expect(page.locator('.rail')).toBeHidden();
  await expect(page.locator('.mobile-nav')).toBeVisible();
  await page.goto('/work');
  await expectHydrated(page);
  await page.locator('.task-row').first().locator('.row-primary-link').click();
  const drawer = page.locator('.task-detail');
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(Math.round(box?.width ?? 0)).toBe(390);
  await expectNoDocumentOverflow(page, 'mobile task drawer');
});
