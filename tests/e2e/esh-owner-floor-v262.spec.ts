import { createHash, randomBytes } from 'node:crypto';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v262 — what My Actions looks like to somebody holding a phone on the floor.
 *
 * The owner-facing screens were walked at 390px rather than reasoned about,
 * and three things were wrong that no passing test had noticed, because every
 * one of them is about what the screen looks like rather than what it says:
 *
 * - the count on the selected tab was white on #fafbfc, so the one number
 *   telling the owner how much they owe was invisible;
 * - the overdue rule was written `small.esh-overdue` while the class sits on a
 *   span inside the small, so it matched nothing anywhere in the product and
 *   late work looked exactly like work due next month;
 * - the sticky action header kept a desktop 20px bleed against a 16px phone
 *   gutter, so the page was 4px wider than the screen and dragged sideways.
 *
 * These assert the appearance directly — contrast, difference, and width —
 * because asserting the markup is what let all three through.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';
const ORGANIZATION = 'e5e50000-0000-4000-8000-000000000001';

function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

async function apiAs(email: string): Promise<SupabaseClient> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`Could not sign in as ${email}: ${error.message}`);
  return client;
}

interface Arranged {
  owner: string;
  principalId: string;
  lateActionId: string;
}

/**
 * One urgent action already late and one ordinary one still ahead, so the row
 * treatments have something to differ from.
 */
async function arrange(id: string): Promise<Arranged> {
  const owner = `floor.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const assign = async (title: string, priority: string, due: string) => {
    const { data, error } = await izzul.rpc('esh_save_finding', {
      p_finding_id: null,
      p_payload: {
        title,
        description: 'Materials extend into the marked walkway.',
        reported_on: '2026-09-18',
        accountable_department_id: departments?.[0]?.id,
        location: 'BR2 Warehouse',
        required_outcome: 'Keep the marked walkway clear.',
        priority,
        owner_email: owner,
        due_date: due,
        no_further_escalation_reason: 'e2e',
      },
      p_assign: true,
      p_idempotency_key: crypto.randomUUID(),
    });
    if (error || !data?.ok)
      throw new Error(`assign failed: ${error?.message ?? JSON.stringify(data)}`);
    return data.action_id as string;
  };
  const lateActionId = await assign(`v262 walkway ${id}`, 'urgent', '2026-12-15');
  await assign(`v262 label ${id}`, 'normal', '2026-12-20');

  // Overdue is a date in the past, which the assignment form will not take.
  const { error: lateError } = await service()
    .from('esh_finding_actions')
    .update({ due_at: new Date(Date.now() - 3 * 86_400_000).toISOString() })
    .eq('id', lateActionId);
  if (lateError) throw new Error(`could not backdate: ${lateError.message}`);

  const { data: contact } = await service()
    .from('esh_email_principals')
    .select('id')
    .eq('canonical_email', owner)
    .single();
  const admin = await apiAs('admin@tamco.local');
  const { data: enabled } = await admin.rpc('esh_set_contact_access', {
    p_principal_id: contact!.id,
    p_enabled: true,
    p_reason: 'e2e',
  });
  if (!enabled?.ok) throw new Error('could not enable the contact');
  return { owner, principalId: contact!.id, lateActionId };
}

/** A link as the worker mints one: a random secret, of which only the hash is kept. */
async function mintInbox(principalId: string): Promise<string> {
  const secret = randomBytes(32).toString('base64url');
  const { error } = await service()
    .from('esh_access_grants')
    .insert({
      organization_id: ORGANIZATION,
      principal_id: principalId,
      purpose: 'owner_inbox',
      token_hash: createHash('sha256').update(secret, 'utf8').digest('hex'),
      issued_reason: 'notification',
      expires_at: new Date(Date.now() + 24 * 3_600_000).toISOString(),
    });
  if (error) throw new Error(`mint failed: ${error.message}`);
  return `/respond/access?for=actions#${secret}`;
}

async function openInbox(page: Page, path: string) {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
  const open = page.getByRole('button', { name: 'Open my actions' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page.getByRole('heading', { name: 'My Actions' })).toBeVisible({ timeout: 30_000 });
}

/** WCAG relative luminance, from a computed `rgb(...)` string. */
function luminance(colour: string): number {
  const parts = (colour.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
  const channel = (value: number) => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const [r = 0, g = 0, b = 0] = parts.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

test.describe('v262 the owner screens on a phone', () => {
  test('the count on the selected tab can actually be read', async ({ page }, testInfo) => {
    const arranged = await arrange(
      `c${testInfo.project.name.slice(0, 3)}${crypto.randomUUID().slice(0, 5)}`,
    );
    await openInbox(page, await mintInbox(arranged.principalId));

    const count = page.locator('.esh-filter-tabs a[aria-current="page"] .guest-tab-count');
    await expect(count).toHaveText('2');

    const seen = await count.evaluate((node) => {
      const style = getComputedStyle(node);
      return { colour: style.color, background: style.backgroundColor };
    });

    /*
     * Against its own pill, not against the tab behind it: the pill keeps its
     * pale background inside the dark selected tab, which is exactly how the
     * inherited white came to sit on #fafbfc.
     */
    expect(
      contrast(seen.colour, seen.background),
      `the selected tab's count is ${seen.colour} on ${seen.background}`,
    ).toBeGreaterThan(4.5);
  });

  test('late work does not look like work due next month', async ({ page }, testInfo) => {
    const arranged = await arrange(
      `l${testInfo.project.name.slice(0, 3)}${crypto.randomUUID().slice(0, 5)}`,
    );
    await openInbox(page, await mintInbox(arranged.principalId));

    const rows = page.locator('.guest-action-row');
    await expect(rows).toHaveCount(2);

    const late = page.locator('.guest-action-main .esh-overdue').first();
    await expect(late, 'the overdue date carries the class the stylesheet looks for').toBeVisible();

    const lateColour = await late.evaluate((node) => getComputedStyle(node).color);
    const plainColour = await rows
      .filter({ hasText: 'label' })
      .locator('.guest-action-main small')
      .evaluate((node) => getComputedStyle(node).color);

    expect(lateColour, 'overdue reads the same as everything else on the row').not.toBe(
      plainColour,
    );
  });

  test('urgency is told apart from the rest of the line', async ({ page }, testInfo) => {
    const arranged = await arrange(
      `u${testInfo.project.name.slice(0, 3)}${crypto.randomUUID().slice(0, 5)}`,
    );
    await openInbox(page, await mintInbox(arranged.principalId));

    const urgent = page.locator('.guest-action-priority').first();
    await expect(urgent).toContainText('Urgent');

    const weights = await urgent.evaluate((node) => ({
      own: Number(getComputedStyle(node).fontWeight),
      line: Number(getComputedStyle(node.closest('small')!).fontWeight),
    }));
    expect(weights.own, 'Urgent carries no more weight than the department name').toBeGreaterThan(
      weights.line,
    );
  });

  test('the action does not drag sideways under a thumb', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'A phone-width gutter.');
    const arranged = await arrange(
      `o${testInfo.project.name.slice(0, 3)}${crypto.randomUUID().slice(0, 5)}`,
    );
    await openInbox(page, await mintInbox(arranged.principalId));

    await page.locator('a[href*="/respond/actions/"]').first().click();
    await expect(page.locator('textarea')).toBeVisible({ timeout: 30_000 });

    const overflow = await page.evaluate(() => {
      const doc = document.documentElement;
      const widest = [...document.querySelectorAll('body *')]
        .map((node) => ({ node, box: node.getBoundingClientRect() }))
        .filter((entry) => entry.box.right > doc.clientWidth + 0.5)
        .map((entry) => `${entry.node.tagName.toLowerCase()}.${String(entry.node.className)}`);
      return { past: doc.scrollWidth - doc.clientWidth, widest };
    });

    expect(
      overflow.past,
      `these reach past the right edge: ${overflow.widest.join(', ') || 'nothing'}`,
    ).toBe(0);
  });
});
