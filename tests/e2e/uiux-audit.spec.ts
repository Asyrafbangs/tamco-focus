import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

/**
 * UI/UX audit crawl — evidence, not a gate.
 *
 * Walks the core product (ESH is another session's work and is excluded) as
 * three roles, at three widths, in both themes, and records what it finds
 * rather than asserting. The output is `uiux-audit/report.json` plus a
 * screenshot per page state, which is then read and ranked by hand.
 *
 * It deliberately repeats the v181 crawl's primitives: that crawl found nine
 * real defects a green suite had missed.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const OUT = join(process.cwd(), 'uiux-audit');
const SHOTS = join(OUT, 'shots');

type Role = 'manager' | 'member' | 'admin';
type Width = { name: 'mobile' | 'tablet' | 'desktop'; width: number; height: number };
type Theme = 'light' | 'dark';

const ACCOUNT: Record<Role, string> = {
  manager: 'izzul@tamco.local',
  member: 'amer@tamco.local',
  admin: 'admin@tamco.local',
};

const WIDTHS: Width[] = [
  { name: 'mobile', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
];

/** Core product only. ESH (findings, intake, triage, reports) is excluded. */
const ROUTES: { path: string; label: string; roles: Role[] }[] = [
  { path: '/today', label: 'My Day', roles: ['manager', 'member'] },
  { path: '/work', label: 'My Work', roles: ['manager', 'member'] },
  { path: '/work?scope=team', label: 'My Team', roles: ['manager'] },
  { path: '/work/routine', label: 'Routines', roles: ['member'] },
  { path: '/plan', label: 'Monthly Plan', roles: ['manager', 'member'] },
  { path: '/goals', label: 'Goals', roles: ['manager', 'member'] },
  { path: '/capture', label: 'New Work', roles: ['member'] },
  { path: '/more', label: 'More', roles: ['member'] },
  { path: '/more/settings', label: 'Settings', roles: ['member'] },
  { path: '/more/records', label: 'Records', roles: ['member'] },
  { path: '/more/archive', label: 'Archive', roles: ['member'] },
  { path: '/more/attachments', label: 'Attachments', roles: ['member'] },
  { path: '/more/audit', label: 'Audit', roles: ['admin'] },
  { path: '/more/admin/users', label: 'Identity and access', roles: ['admin'] },
  { path: '/more/admin/organisation', label: 'Organisation', roles: ['admin'] },
  { path: '/more/admin/visibility', label: 'Visibility', roles: ['admin'] },
];

interface Finding {
  role: Role;
  route: string;
  label: string;
  width: Width['name'];
  theme: Theme;
  kind: 'axe' | 'overflow' | 'touch-target' | 'tiny-text' | 'focus-ring' | 'load-error';
  detail: string;
  shot?: string;
}

const findings: Finding[] = [];
const visited: string[] = [];

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals|plan|team|more)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

async function setTheme(page: Page, theme: Theme) {
  await page.evaluate((value) => {
    try {
      localStorage.setItem('tamco-focus-theme', value);
    } catch {
      /* private window */
    }
  }, theme);
}

/** Serious and critical WCAG 2 A/AA violations, one line each. */
async function axeFindings(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id} (${v.impact}, ${v.nodes.length}×): ${v.nodes[0]?.target.join(' ')}`);
}

/** Interactive controls shorter or narrower than the 44px target (v183). */
async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const selector =
      'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab], [role=link]';
    const seen = new Map<string, { w: number; h: number }>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // A visually-hidden input behind its own styled button is the correct
      // pattern, not a small target: New Work's "Choose files" drives a 1×1
      // file input. Measuring it reported a defect that does not exist.
      if (el.classList.contains('visually-hidden')) continue;
      // The ::after touch-area trick (v183/v184) counts, so measure it too.
      const after = getComputedStyle(el, '::after');
      const grownH =
        after.content !== 'none' ? Math.max(box.height, parseFloat(after.height) || 0) : box.height;
      if (box.width >= 44 && grownH >= 44) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || el.tagName)
        .trim()
        .slice(0, 48);
      // The class list is what makes the finding actionable: it names the rule
      // to change instead of leaving the selector to be guessed.
      const classes =
        el.className && typeof el.className === 'string'
          ? `.${el.className.trim().split(/\s+/).join('.')}`
          : '';
      const key = `${el.tagName.toLowerCase()}${classes}|${name}`;
      if (!seen.has(key)) seen.set(key, { w: Math.round(box.width), h: Math.round(grownH) });
    }
    return Array.from(seen.entries())
      .slice(0, 8)
      .map(([key, size]) => `${key} — ${size.w}×${size.h}px`);
  });
}

/** Visible text below 12px, which §6 of the UX rules treats as a defect. */
async function tinyText(page: Page) {
  return page.evaluate(() => {
    const seen = new Set<string>();
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (!el.textContent?.trim()) continue;
      if (el.children.length > 0) continue;
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      const size = parseFloat(getComputedStyle(el).fontSize);
      if (size >= 12) continue;
      seen.add(`${el.tagName.toLowerCase()} ${size}px — "${el.textContent.trim().slice(0, 40)}"`);
      if (seen.size >= 6) break;
    }
    return Array.from(seen);
  });
}

/** Does the first focusable control show a visible ring? */
async function focusRingMissing(page: Page) {
  return page.evaluate(() => {
    const first = document.querySelector<HTMLElement>(
      'main a[href], main button, main input:not([type=hidden])',
    );
    if (!first) return null;
    first.focus();
    const style = getComputedStyle(first);
    const ring =
      (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
      style.boxShadow !== 'none';
    return ring
      ? null
      : (first.getAttribute('aria-label') || first.textContent || first.tagName)
          .trim()
          .slice(0, 40);
  });
}

async function auditPage(
  page: Page,
  role: Role,
  route: { path: string; label: string },
  width: Width,
  theme: Theme,
) {
  const id = `${role}_${route.label.replace(/\W+/g, '-')}_${width.name}_${theme}`;
  const record = (kind: Finding['kind'], detail: string, shot?: string) =>
    findings.push({
      role,
      route: route.path,
      label: route.label,
      width: width.name,
      theme,
      kind,
      detail,
      shot,
    });

  await page.setViewportSize({ width: width.width, height: width.height });
  await setTheme(page, theme);

  try {
    await page.goto(route.path, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true', {
      timeout: 20_000,
    });
    /*
     * Hydration is not arrival. `data-app-hydrated` says React mounted; the
     * route's data is still streaming behind `app/(app)/loading.tsx`, and the
     * first crawl measured that skeleton on every page — axe scanned four grey
     * bars and reported a clean bill of health. Wait for the skeleton to
     * detach, then for the network to settle, before measuring anything.
     */
    await expect(page.locator('.loading-skeleton')).toHaveCount(0, { timeout: 30_000 });
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => {});
  } catch (error) {
    record('load-error', error instanceof Error ? error.message.slice(0, 200) : String(error));
    return;
  }
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
  visited.push(id);

  const shot = `${id}.png`;
  await page.screenshot({ path: join(SHOTS, shot), fullPage: false });

  for (const violation of await axeFindings(page)) record('axe', violation, shot);

  const overflows = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth > doc.clientWidth + 1
      ? `${doc.scrollWidth}px in a ${doc.clientWidth}px viewport`
      : null;
  });
  if (overflows) record('overflow', overflows, shot);

  if (width.name === 'mobile') {
    for (const target of await smallTargets(page)) record('touch-target', target, shot);
  }

  for (const text of await tinyText(page)) record('tiny-text', text, shot);

  const unfocusable = await focusRingMissing(page);
  if (unfocusable) record('focus-ring', `no visible ring on "${unfocusable}"`, shot);
}

test.describe('UI/UX audit', () => {
  test.describe.configure({ mode: 'serial', timeout: 30 * 60_000 });

  for (const role of ['manager', 'member', 'admin'] as Role[]) {
    test(`crawl as ${role}`, async ({ page }) => {
      mkdirSync(SHOTS, { recursive: true });
      await signIn(page, ACCOUNT[role]);

      for (const route of ROUTES.filter((r) => r.roles.includes(role))) {
        for (const width of WIDTHS) {
          for (const theme of ['light', 'dark'] as Theme[]) {
            await auditPage(page, role, route, width, theme);
          }
        }
      }

      writeFileSync(
        join(OUT, 'report.json'),
        JSON.stringify({ visited: visited.length, findings }, null, 2),
        'utf8',
      );
    });
  }
});
