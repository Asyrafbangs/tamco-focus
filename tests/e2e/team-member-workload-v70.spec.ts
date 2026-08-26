import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Locator, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZAH = 'f0c05000-0000-4000-a000-000000000004';
const LIM = 'f0c05000-0000-4000-a000-000000000006';
const IZZAH_GOAL = 'f0c06000-0000-4000-a000-000000000002';

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function closeDrawer(page: Page, selector: string) {
  const drawer = page.locator(selector);
  await drawer.getByRole('button', { name: /^Close/ }).click();
  // SideDrawer deliberately stays mounted for its 245 ms exit transition.
  // Do not click a row underneath until that layer has actually unmounted or
  // its delayed close navigation can overwrite the new record URL.
  await expect(drawer).toHaveCount(0);
}

async function ensureExpanded(details: Locator) {
  const expanded = await details.evaluate((node) => (node as HTMLDetailsElement).open);
  if (!expanded) await details.locator('summary').click();
  await expect(details).toHaveAttribute('open', '');
}

test.describe('v70 Team member workload detail', () => {
  test('lists named Available work, routines and goals and opens their exact records', async ({
    page,
  }, testInfo) => {
    const service = serviceClient();
    const availableTitle = `Team workload fixture ${testInfo.project.name} ${Date.now()}`;
    const { data: availableTask, error: availableTaskError } = await service
      .from('tasks')
      .insert({
        title: availableTitle,
        status: 'backlog',
        work_class: 'operational_action',
        focus_bucket: 'operational',
        origin: 'self_initiated',
        primary_owner_id: IZZAH,
        created_by: IZZAH,
      })
      .select('id')
      .single();
    if (availableTaskError) throw availableTaskError;

    try {
      await signIn(page, 'izzul@tamco.local');
      await page.goto(`/work?scope=team&person=${IZZAH}`);
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

      const drawer = page.locator('.team-member-drawer');
      await expect(drawer.getByRole('heading', { name: 'Izzah Nurul' })).toBeVisible();

      const otherWorkload = drawer.locator('.member-other-workload');
      await ensureExpanded(otherWorkload);
      await expect(
        otherWorkload.getByText(
          'Available work and routines are theirs to schedule. They appear here for context, not as something to action.',
        ),
      ).toHaveCount(0);

      const availableRows = otherWorkload.locator(
        '[aria-labelledby="member-available-heading"] .member-other-row',
      );
      const routineRows = otherWorkload.locator(
        '[aria-labelledby="member-routines-heading"] .member-other-row',
      );
      const goalRows = otherWorkload.locator(
        '[aria-labelledby="member-goals-heading"] .member-other-row',
      );

      const availableCount = await availableRows.count();
      const routineCount = await routineRows.count();
      const goalCount = await goalRows.count();
      expect(availableCount).toBeGreaterThan(0);
      expect(routineCount).toBeGreaterThan(0);
      expect(goalCount).toBeGreaterThan(0);

      const availableFixture = availableRows.filter({ hasText: availableTitle });
      const goalFixture = goalRows.filter({ hasText: 'Strengthen frontline safety coaching' });
      await expect(availableFixture).toHaveCount(1);
      await expect(routineRows.first()).toContainText('Weekly workplace safety walk');
      await expect(goalFixture).toHaveCount(1);

      await expect(otherWorkload.locator('summary')).toContainText(
        `Available ${availableCount} · Overdue routines ${routineCount} · Goals ${goalCount}`,
      );
      const accessibility = await new AxeBuilder({ page })
        .include('.team-member-drawer')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze();
      expect(accessibility.violations).toEqual([]);

      const availableLink = availableFixture;
      await availableLink.focus();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(new RegExp(`task=${availableTask.id}`));
      await expect(page.locator('.task-detail-drawer')).toContainText(availableTitle);

      await closeDrawer(page, '.task-detail-drawer');
      await expect(page).toHaveURL(new RegExp(`person=${IZZAH}`));
      await expect(page).not.toHaveURL(/task=/);
      await expect(page.locator('.team-member-drawer')).toBeVisible();

      const reopenedOtherWorkload = page.locator('.member-other-workload');
      await ensureExpanded(reopenedOtherWorkload);
      const routineLink = reopenedOtherWorkload
        .locator('[aria-labelledby="member-routines-heading"] .member-other-row')
        .first();
      const routineHref = await routineLink.getAttribute('href');
      const routineId = new URL(routineHref!, 'http://localhost').searchParams.get('task');
      expect(routineId).toBeTruthy();
      await routineLink.click();
      await expect(page).toHaveURL(new RegExp(`task=${routineId}`));
      await expect(page.locator('.task-detail-drawer')).toContainText(
        'Weekly workplace safety walk',
      );

      await closeDrawer(page, '.task-detail-drawer');
      await expect(page).toHaveURL(new RegExp(`person=${IZZAH}`));
      await expect(page).not.toHaveURL(/task=/);
      const goalOtherWorkload = page.locator('.member-other-workload');
      await ensureExpanded(goalOtherWorkload);
      await goalOtherWorkload
        .locator('[aria-labelledby="member-goals-heading"] .member-other-row', {
          hasText: 'Strengthen frontline safety coaching',
        })
        .click();
      await expect(page).toHaveURL(new RegExp(`goal=${IZZAH_GOAL}`));
      await expect(page).toHaveURL(new RegExp(`person=${IZZAH}`));
      await expect(page.locator('.goal-detail-drawer')).toContainText(
        'Strengthen frontline safety coaching',
      );

      await closeDrawer(page, '.goal-detail-drawer');
      await expect(page).toHaveURL(/\/work\?/);
      await expect(page).toHaveURL(new RegExp(`person=${IZZAH}`));
      await expect(page.locator('.team-member-drawer')).toBeVisible();

      const hasHorizontalOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );
      expect(hasHorizontalOverflow).toBe(false);
    } finally {
      const { error: cleanupError } = await service
        .from('tasks')
        .delete()
        .eq('id', availableTask.id);
      if (cleanupError) throw cleanupError;
    }
  });

  test('a direct person parameter cannot expose workload outside the authorised Team roster', async ({
    page,
  }) => {
    await signIn(page, 'amer@tamco.local');
    await page.goto(`/work?scope=team&person=${LIM}`);
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    await expect(page.locator('.team-member-drawer')).toHaveCount(0);
    await expect(page.getByText('Lim Wei Sheng', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Replace eyewash stations in the laboratory')).toHaveCount(0);
  });
});
