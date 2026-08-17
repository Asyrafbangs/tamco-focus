import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const PEOPLE = {
  admin: 'f0c05000-0000-4000-a000-000000000001',
  izzul: 'f0c05000-0000-4000-a000-000000000002',
  amer: 'f0c05000-0000-4000-a000-000000000003',
  lim: 'f0c05000-0000-4000-a000-000000000006',
} as const;

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

test.describe('v69 Team visibility and navigation', () => {
  test('an administrator sees every other active user and can open Izzul by keyboard', async ({
    page,
  }) => {
    const service = serviceClient();
    const { count, error } = await service
      .from('user_profiles')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'active')
      .neq('id', PEOPLE.admin);
    if (error) throw error;

    await signIn(page, 'admin@tamco.local');
    await page.goto('/work?scope=team');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    const rows = page.getByTestId('my-team-person-row');
    await expect(rows).toHaveCount(count ?? 0);

    const izzul = rows.filter({ hasText: 'Izzul Asyraf' });
    await expect(izzul).toBeVisible();
    await izzul.focus();
    await page.keyboard.press('Enter');

    const drawer = page.locator('.team-member-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByRole('heading', { name: 'Izzul Asyraf' })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer).toHaveCount(0);
    await expect(page).toHaveURL(/scope=team/);
    await expect(page).not.toHaveURL(/person=/);
    await expect(izzul).toBeFocused();

    const horizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    expect(horizontalOverflow).toBe(false);
  });

  test('task collaboration does not promote an unauthorised owner into My Team', async ({
    page,
  }, testInfo) => {
    const service = serviceClient();
    const title = `Visibility boundary ${testInfo.project.name} ${Date.now()}`;
    const { data: task, error: taskError } = await service
      .from('tasks')
      .insert({
        title,
        status: 'backlog',
        work_class: 'operational_action',
        focus_bucket: 'operational',
        origin: 'self_initiated',
        primary_owner_id: PEOPLE.lim,
        created_by: PEOPLE.lim,
      })
      .select('id')
      .single();
    if (taskError) throw taskError;

    try {
      const { error: collaboratorError } = await service.from('task_collaborators').insert({
        task_id: task.id,
        user_id: PEOPLE.amer,
        added_by: PEOPLE.lim,
      });
      if (collaboratorError) throw collaboratorError;

      await signIn(page, 'amer@tamco.local');
      await page.goto('/work?scope=team&filter=available');
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

      // Amer may see Izzah and Ajmal as people. The individual Lim task is
      // shared with him, but that does not make Lim one of his Team people.
      await expect(page.locator('.team-available-group', { hasText: 'Lim Wei Sheng' })).toHaveCount(
        0,
      );
      await expect(page.getByText(title, { exact: true })).toHaveCount(0);
    } finally {
      await service.from('tasks').delete().eq('id', task.id);
    }
  });
});
