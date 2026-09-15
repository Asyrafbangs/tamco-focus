import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v186 — My Alerts, honoured.
 *
 * Four of the five switches now change what is sent, and the form says how.
 * "Routine work coming up" is no longer offered, because nothing sends a
 * routine-upcoming notice; saving the form must still keep whatever it holds,
 * on or off, rather than quietly switching it off with the checkbox gone.
 *
 * Lim's preferences are the fixture, set explicitly first and restored after,
 * because every viewport project runs against the same database.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const LIM = 'f0c05000-0000-4000-a000-000000000006';

const EVERY_SWITCH_ON = {
  barrier_involving_me: true,
  assignment_changes: true,
  collaboration_handoff: true,
  due_today_and_deadlines: true,
  routine_upcoming: true,
};

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function setPreferences(values: Partial<typeof EVERY_SWITCH_ON>) {
  const { error } = await service()
    .from('user_alert_preferences')
    .update(values)
    .eq('user_id', LIM);
  if (error) throw error;
}

async function stored() {
  const { data, error } = await service()
    .from('user_alert_preferences')
    .select(
      'barrier_involving_me,assignment_changes,collaboration_handoff,due_today_and_deadlines,routine_upcoming',
    )
    .eq('user_id', LIM)
    .single();
  if (error) throw error;
  return data;
}

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function openAlerts(page: Page) {
  await page.goto('/more/settings?section=alerts');
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  return page.locator('[data-settings-panel="alerts"]');
}

test.afterEach(async () => {
  await setPreferences(EVERY_SWITCH_ON);
});

test('v186 My alerts offers the switches that do something, and keeps the one it hides', async ({
  page,
}) => {
  await setPreferences({ ...EVERY_SWITCH_ON, routine_upcoming: false });
  await signIn(page, 'lim@tamco.local');

  let panel = await openAlerts(page);
  const alerts = panel.getByRole('group', { name: 'My alerts' });
  await expect(alerts.getByRole('checkbox')).toHaveCount(4);
  await expect(alerts.getByText('Routine work coming up')).toHaveCount(0);
  await expect(alerts).toContainText(
    'Switch one off and its emails stop, but its notices still appear in Notifications.',
  );
  await expect(alerts).toContainText(
    'A safety or compliance barrier, or anything about mandatory work, is always sent.',
  );

  await alerts.getByRole('checkbox', { name: 'Collaborative handoff' }).uncheck();
  // The form's own submit button is hidden inside the workspace; this is the
  // one people press.
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByRole('status')).toContainText('Your preferences were saved.');
  expect(await stored()).toEqual({
    ...EVERY_SWITCH_ON,
    collaboration_handoff: false,
    routine_upcoming: false,
  });

  // And a stored "on" survives a save just the same.
  await setPreferences({ routine_upcoming: true });
  panel = await openAlerts(page);
  await panel
    .getByRole('group', { name: 'My alerts' })
    .getByRole('checkbox', { name: 'Collaborative handoff' })
    .check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(panel.getByRole('status')).toContainText('Your preferences were saved.');
  expect(await stored()).toEqual(EVERY_SWITCH_ON);
});
