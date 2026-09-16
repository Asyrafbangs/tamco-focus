import AxeBuilder from '@axe-core/playwright';
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v192 — two findings from the post-v191 crawl (every role, desktop and phone,
 * light and Night mode, with axe on every page shape).
 *
 * 1. In Night mode the red count badges — "My Team 1", "Routine 2", the bell's
 *    unread count and the navigation badge — put white text on the lightened
 *    red: about 2.6:1. They now use --on-accent, as the buttons already did.
 *    axe does not look inside aria-hidden badges, so the bell and navigation
 *    counts are measured here directly.
 * 2. On a phone the Monthly Plan is an agenda: headers and empty days are
 *    hidden, which left the header row and every empty week as a row with no
 *    cells — a broken table to a screen reader (aria-required-children).
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const IZZUL = 'f0c05000-0000-4000-a000-000000000002';
const LIM = 'f0c05000-0000-4000-a000-000000000006';
const ZONE = 'Asia/Kuala_Lumpur';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

function endOfDay(days: number) {
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(
    new Date(Date.now() + days * 86_400_000),
  );
  return new Date(`${date}T23:59:59.999+08:00`).toISOString();
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

/** WCAG contrast of an element's text against its own background colour. */
async function contrastOf(page: Page, selector: string) {
  return page
    .locator(selector)
    .first()
    .evaluate((element) => {
      const parse = (value: string) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe)
          .color.match(/[\d.]+/g)!
          .map(Number);
        probe.remove();
        return rgb.slice(0, 3);
      };
      const luminance = ([r, g, b]: number[]) => {
        const channel = (c: number) => {
          const s = c / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };
        return 0.2126 * channel(r!) + 0.7152 * channel(g!) + 0.0722 * channel(b!);
      };
      const style = getComputedStyle(element);
      const fg = luminance(parse(style.color));
      const bg = luminance(parse(style.backgroundColor));
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    });
}

test('v192 red count badges are readable in Night mode', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The fixtures are created once.');
  const admin = service();
  const title = `Late for the badge ${crypto.randomUUID().slice(0, 5)}`;
  const { data: task, error } = await admin
    .from('tasks')
    .insert({
      title,
      status: 'active',
      work_class: 'operational_action',
      focus_bucket: 'operational',
      origin: 'self_initiated',
      primary_owner_id: LIM,
      created_by: LIM,
      due_at: endOfDay(-2),
      due_is_date_only: true,
    })
    .select('id')
    .single();
  if (error) throw error;
  const { error: noticeError } = await admin.from('notifications').insert({
    recipient_id: IZZUL,
    kind: 'barrier_raised',
    channel: 'digest',
    requires_action: true,
    title: 'A badge to read',
    body: title,
    task_id: task!.id,
    quiet: true,
  });
  if (noticeError) throw noticeError;

  try {
    await page.addInitScript(() => localStorage.setItem('tamco-focus-theme', 'dark'));
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/work');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    const over = page.locator('.count.over').first();
    await expect(over).toBeVisible();
    const results = await new AxeBuilder({ page })
      .include('.count.over')
      .withRules(['color-contrast'])
      .analyze();
    expect(results.violations).toEqual([]);

    for (const badge of ['.count.over', '.notification-bell-count']) {
      await expect(page.locator(badge).first()).toBeVisible();
      expect(await contrastOf(page, badge), badge).toBeGreaterThanOrEqual(4.5);
    }
    if ((await page.locator('.navbadge').count()) > 0) {
      expect(await contrastOf(page, '.navbadge'), '.navbadge').toBeGreaterThanOrEqual(4.5);
    }
  } finally {
    await admin.from('notifications').delete().eq('task_id', task!.id);
    await admin.from('tasks').delete().eq('id', task!.id);
  }
});

test('v192 the phone agenda is a table a screen reader can read', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The agenda is the phone layout.');
  await signIn(page, 'izzah@tamco.local');
  await page.goto('/plan');
  await expect(page.getByRole('heading', { name: 'Monthly Plan' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

  const results = await new AxeBuilder({ page })
    .withRules(['aria-required-children', 'aria-required-parent'])
    .analyze();
  expect(results.violations).toEqual([]);

  // The days that carry something are still there, as cards.
  const visibleDays = page.locator('.calendar .day:not(.is-empty)');
  if ((await visibleDays.count()) > 0) await expect(visibleDays.first()).toBeVisible();
});

/**
 * v192 — the attention window, read back. A crawl sweep chooses a value, saves
 * it, reloads, and reads it back where it matters: v187 made this one setting
 * decide what "due soon" means on My Day.
 */
test('v192 the attention window saves, reads back and changes My Day', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'One organisation setting.');
  const admin = service();
  const read = async () =>
    (
      await admin
        .from('org_settings')
        .select('value')
        .eq('key', 'day.upcoming_window_days')
        .single()
    ).data?.value;
  expect(await read()).toBe(5);

  try {
    await signIn(page, 'admin@tamco.local');
    await page.goto('/more/settings?section=reminders');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(
      page.getByRole('button', { name: /Alerts & escalation.*Attention window/ }),
    ).toBeVisible();

    const row = page.locator('form.setting-row', {
      has: page.locator('input[name="key"][value="day.upcoming_window_days"]'),
    });
    await row.locator('input[name="value"]').fill('3');
    // The section saves as one: "Save changes" submits every row in it.
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect.poll(read).toBe(3);

    await page.reload();
    await expect(
      page
        .locator('form.setting-row', {
          has: page.locator('input[name="key"][value="day.upcoming_window_days"]'),
        })
        .locator('input[name="value"]'),
    ).toHaveValue('3');

    await page.goto('/today');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
    await expect(page.locator('.day-summary')).toContainText('3 days');
  } finally {
    await admin.from('org_settings').update({ value: 5 }).eq('key', 'day.upcoming_window_days');
  }
  expect(await read()).toBe(5);
});
