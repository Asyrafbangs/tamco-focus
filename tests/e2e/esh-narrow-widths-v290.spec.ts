import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { config } from 'dotenv';

config({ path: '.env.local', quiet: true });
const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

/*
 * v290 - the two widths the suite has never opened.
 *
 * The configured projects are 1440, 1280, 1024, 768 and 390. A phone narrower
 * than 390 is the common case on a plant floor - an iPhone SE is 375 and the
 * oldest handsets still in use are 320 - and 320 is where a fixed-width
 * control, a long word or a table head stops fitting. The v218 crawl proves
 * these screens at 390 and above; this proves the same screens at 375 and 320,
 * in Day and in Night, including the public form that is only ever opened on a
 * phone.
 *
 * The page-level check is the crawl's, which asks the page to scroll and reads
 * back whether it moved, because `scrollWidth` counts an inner scroll
 * container and a table that correctly scrolls inside its own box would read
 * as a broken page. The element-level check is new, and is what says *which*
 * element is too wide when it does fail.
 */

function service(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function scrollsSideways(page: Page) {
  return page.evaluate(() => {
    const root = document.scrollingElement || document.documentElement;
    const before = root.scrollLeft;
    root.scrollLeft = 9999;
    const moved = root.scrollLeft > 0;
    root.scrollLeft = before;
    return moved || document.body.scrollWidth > document.documentElement.clientWidth + 1;
  });
}

/**
 * Elements whose own right edge is past the viewport, excluding anything that
 * sits inside a box which scrolls sideways on purpose. A register table is
 * allowed to be wider than a phone; the card around it is not.
 */
async function pastTheEdge(page: Page) {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth + 1;
    const inOwnScroller = (node: Element) => {
      let at: Element | null = node.parentElement;
      while (at && at !== document.body) {
        const style = getComputedStyle(at);
        if (
          (style.overflowX === 'auto' || style.overflowX === 'scroll') &&
          at.scrollWidth > at.clientWidth
        ) {
          return true;
        }
        at = at.parentElement;
      }
      return false;
    };
    const named = (node: Element) => {
      const id = node.id ? `#${node.id}` : '';
      const own =
        typeof node.className === 'string' && node.className.trim()
          ? `.${node.className.trim().split(/\s+/).join('.')}`
          : '';
      let within = '';
      let at: Element | null = node.parentElement;
      while (at && at !== document.body) {
        if (typeof at.className === 'string' && at.className.trim()) {
          within = ` in .${at.className.trim().split(/\s+/)[0]}`;
          break;
        }
        at = at.parentElement;
      }
      const words = (node.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40);
      return `${node.tagName.toLowerCase()}${id}${own}${within}${words ? ` "${words}"` : ''}`;
    };
    const over: string[] = [];
    for (const node of Array.from(document.body.querySelectorAll('*'))) {
      const style = getComputedStyle(node);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.position === 'fixed') continue;
      // The screen-reader-only pattern: one pixel, clipped away. It is off the
      // layout on purpose and nobody can see it overflow.
      if (style.clip !== 'auto' || style.clipPath !== 'none') continue;
      /*
       * A closed `details` keeps a stale box: Chrome skips layout for the
       * content it is hiding, and the rect that comes back is the one the
       * element last had, or one computed against the wrong containing block.
       * The open menu is measured on purpose further down.
       */
      if (node.closest('details:not([open])')) continue;
      const box = node.getBoundingClientRect();
      if (box.width <= 2 || box.height <= 2) continue;
      if (box.right <= limit) continue;
      if (inOwnScroller(node)) continue;
      over.push(`${named(node)} right=${Math.round(box.right)} limit=${limit}`);
    }
    // The outermost offender only: a wide child makes every ancestor wide too.
    return over.slice(0, 6);
  });
}

/**
 * A client acting as a real person, so RLS decides what the call may do.
 * `service()` bypasses it and is kept for the fixtures that are pure setup.
 */
async function apiAs(email: string) {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

/*
 * v301 - the finding this spec opens is now its own.
 *
 * It used to read whichever finding happened to be in the database and assert
 * that one existed. `supabase/seed.sql` creates none: it seeds
 * `esh_import_batches`, `esh_import_rows` and `esh_staff_access` and stops. So
 * the row it found was always one another spec had left behind, and on a
 * database where nothing else had run the spec failed before it opened a
 * single page - `the seed must hold a finding to open at these widths`, with
 * 0 rows in `esh_findings` and the rest of the seed intact.
 *
 * Which also meant the detail page was opened with whatever title that other
 * spec had chosen. The title here is long on purpose: a narrow-width check
 * that opens a finding called "v269 abc123" proves nothing about the widths
 * where a real title has to wrap, and production titles run past sixty
 * characters.
 *
 * Not deleted afterwards. That is this suite's convention for ESH fixtures -
 * `esh-audit-gaps-v269` and the others leave theirs - and a finding carries
 * audit rows that a delete would have to reach around.
 */
async function raiseFinding(): Promise<string> {
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: {
      title:
        'v290 the guard fence on the number three press has been modified and the interlock no longer stops the machine',
      description: 'Raised so this spec has a detail page of its own to open at every width.',
      reported_on: '2026-10-20',
      accountable_department_id: departments?.[0]?.id,
      location: 'BR2 Workshop',
      required_outcome:
        'Refit the fence and make the interlock stop the machine whenever it is open.',
      priority: 'high',
      risk_level: 'high',
      owner_email: 'widths@example.com',
      due_date: '2026-12-10',
      escalation: [],
      no_further_escalation_reason: 'e2e',
    },
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.ok) throw new Error(`raise: ${error?.message ?? JSON.stringify(data)}`);
  return data.finding_id as string;
}

async function signIn(page: Page) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill('izzul@tamco.local');
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

/*
 * v293 — 430 as well, and the workspace with it.
 *
 * 320 and 375 are the narrow end; 430 is a current large phone, and it is
 * where a two-column workspace is closest to deciding whether it is one
 * column or two. The remaining widths the package asks for — 390, 768, 1024
 * and 1440 — are the configured browser projects, so every spec already runs
 * at them.
 */
/*
 * v293 - 768 and 1024 as well, where the triage workspace stops being two
 * columns and becomes one. 390 and 1440 are the configured projects, so
 * between them the set is 320, 375, 390, 430, 768, 1024 and 1440.
 */
const WIDTHS = [320, 375, 430, 768, 1024];

const PATHS = [
  '/findings',
  '/findings?queue=verification',
  '/findings/register',
  '/findings/register?filter=all',
  '/findings/register?filter=overdue',
  '/findings/new',
  '/findings/verification',
  '/findings/intake',
  '/findings/patterns',
  '/findings/patterns/insights',
  '/findings/settings',
];

test('v290 every Finding screen fits a narrow phone, in Day and Night', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'One narrow pass; the crawl covers 390 upward.');
  test.setTimeout(300_000);

  const findingId = await raiseFinding();
  const paths = [...PATHS, `/findings/${findingId}`];

  await signIn(page);

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    for (const theme of ['light', 'dark'] as const) {
      await page.goto('/findings');
      await page.evaluate((value) => localStorage.setItem('tamco-focus-theme', value), theme);
      for (const path of paths) {
        await page.goto(path);
        await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        expect(
          await scrollsSideways(page),
          `${path} at ${width}px (${theme}) scrolls sideways`,
        ).toBe(false);
        expect(await pastTheEdge(page), `${path} at ${width}px (${theme})`).toEqual([]);
      }

      /*
       * The module switcher, opened. It is a menu anchored to a summary that
       * starts 54px into the screen, and it was 290px wide: at 320px the last
       * quarter of "Finding Management" and of its description sat off the
       * right edge, with no sideways scroll to reach it. A closed `details`
       * reports a stale box, so this is the only way to measure it.
       */
      await page.goto('/findings');
      await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
      await page.locator('.esh-switcher summary').click();
      await expect(page.locator('.esh-switcher[open]')).toBeAttached();
      const menu = await page.locator('.esh-switcher ul').boundingBox();
      expect(menu, 'the opened switcher must have a box to measure').not.toBeNull();
      expect(
        menu!.x >= 0 && menu!.x + menu!.width <= width,
        `the switcher menu at ${width}px (${theme}) runs from ${Math.round(menu!.x)} to ${Math.round(menu!.x + menu!.width)} on a ${width}px screen`,
      ).toBe(true);
      // Reachable, not merely within the box: the last item must take a click.
      const last = page.locator('.esh-switcher li a').last();
      await expect(last).toBeVisible();
      const item = await last.boundingBox();
      expect(
        item!.x + item!.width <= width,
        `the last switcher item at ${width}px (${theme}) ends at ${Math.round(item!.x + item!.width)}`,
      ).toBe(true);
    }
  }
});

test('v290 the public form fits the narrowest phone that will scan a sticker', async ({
  browser,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'mobile', 'The public form is a phone screen.');
  test.setTimeout(180_000);

  /*
   * This is the one screen somebody reaches by holding a phone up to a sticker,
   * so it is the one where a width nobody tested costs a report. Opened and
   * closed again here: a shared local database left with public reporting on
   * changes what every other spec sees at `/report`.
   */
  const code = `BR2-NARROW-${Date.now().toString(36).toUpperCase()}`;
  const db = service();
  const { data: departments } = await db.from('departments').select('id').eq('code', 'OPS');
  await db.from('esh_qr_locations').insert({
    organization_id: ORGANIZATION,
    public_code: code,
    display_label: 'BR2 Narrow width fixture',
    department_id: departments?.[0]?.id ?? null,
    active: true,
  });
  await db
    .from('esh_qr_intake_settings')
    .update({ enabled: true })
    .eq('organization_id', ORGANIZATION);

  const stranger = await browser.newContext();
  const visitor = await stranger.newPage();
  try {
    for (const width of WIDTHS) {
      await visitor.setViewportSize({ width, height: 844 });
      for (const theme of ['light', 'dark'] as const) {
        await visitor.goto(`/report/${code}`);
        await visitor.evaluate((value) => localStorage.setItem('tamco-focus-theme', value), theme);
        await visitor.goto(`/report/${code}`);
        await expect(visitor.getByRole('button', { name: 'Take photo' })).toBeVisible();
        await expect(visitor.getByRole('button', { name: 'Choose photo' })).toBeVisible();
        expect(
          await scrollsSideways(visitor),
          `the public form at ${width}px (${theme}) scrolls sideways`,
        ).toBe(false);
        expect(await pastTheEdge(visitor), `the public form at ${width}px (${theme})`).toEqual([]);
      }
    }
  } finally {
    await stranger.close();
    await db
      .from('esh_qr_intake_settings')
      .update({ enabled: false })
      .eq('organization_id', ORGANIZATION);
    await db.from('esh_qr_locations').delete().eq('public_code', code);
  }
});
