import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { expect, test, type Page } from '@playwright/test';

config({ path: '.env.local', quiet: true });

/**
 * v269 — four gaps found by auditing what was built against what can be
 * reached. Each is a thing the database could do that the screens could not
 * ask for, or a number nobody could act on:
 *
 *  1. a blocker could be reported and never cleared;
 *  2. the kind of evidence could be set at assignment and never corrected;
 *  3. an effectiveness check existed but nothing ever suggested one, on the
 *     findings where forgetting it matters most;
 *  4. unassessed findings were a count with nowhere to go.
 */

const PASSWORD = process.env.SEED_USER_PASSWORD ?? 'LocalFocus123!';

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

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto('/sign-in');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/(today|work|goals)/, { timeout: 30_000 });
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

interface Raised {
  findingId: string;
  actionId: string;
  owner: string;
}

async function raise(id: string, options: { risk: string; kind?: string }): Promise<Raised> {
  const owner = `gaps.${id}@example.com`;
  const izzul = await apiAs('izzul@tamco.local');
  const { data: departments } = await izzul.from('departments').select('id').eq('code', 'OPS');
  const payload: Record<string, unknown> = {
    title: `v269 ${id}`,
    description: 'Something to correct.',
    reported_on: '2026-10-20',
    accountable_department_id: departments?.[0]?.id,
    location: 'BR2',
    required_outcome: 'Correct it.',
    priority: 'high',
    risk_level: options.risk,
    owner_email: owner,
    due_date: '2026-12-10',
    escalation: [],
    no_further_escalation_reason: 'e2e',
  };
  if (options.kind) payload.evidence_kind = options.kind;
  const { data, error } = await izzul.rpc('esh_save_finding', {
    p_finding_id: null,
    p_payload: payload,
    p_assign: true,
    p_idempotency_key: crypto.randomUUID(),
  });
  if (error || !data?.ok) throw new Error(`assign: ${error?.message ?? JSON.stringify(data)}`);
  return {
    findingId: data.finding_id as string,
    actionId: data.action_id as string,
    owner,
  };
}

function stamp(project: string) {
  return `${project.slice(0, 3)}${crypto.randomUUID().slice(0, 6)}`;
}

async function openFinding(page: Page, findingId: string) {
  await page.goto(`/findings/${findingId}`);
  await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');
}

const ESH_ONLY = 'These are the ESH screens, which have one layout.';

test.describe('v269 what the screens could not reach', () => {
  test('a reported blocker can be cleared', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', ESH_ONLY);
    const raised = await raise(stamp(testInfo.project.name), { risk: 'high' });
    const admin = service();
    const { data: principal } = await admin
      .from('esh_email_principals')
      .select('id, organization_id')
      .eq('canonical_email', raised.owner)
      .single();
    const { error } = await admin.from('esh_action_blockers').insert({
      organization_id: principal!.organization_id,
      action_id: raised.actionId,
      category: 'budget',
      help_needed: 'The purchase order for the interlock has not been signed.',
      responsible: 'Faizal in Purchasing',
      raised_by_principal_id: principal!.id,
    });
    if (error) throw new Error(`blocker: ${error.message}`);

    await signIn(page, 'izzul@tamco.local');
    await openFinding(page, raised.findingId);

    const notice = page.locator('.esh-interim[data-state="blocked"]');
    await expect(notice).toContainText('Faizal in Purchasing');

    // The gap: ESH could read this and had no way to say it was resolved.
    await notice.getByLabel('What was done about it').fill('Purchase order signed this morning.');
    await notice.getByRole('button', { name: 'This is no longer blocking' }).click();

    await expect(notice).toHaveCount(0, { timeout: 20_000 });
  });

  test('what counts as proof can be corrected after assignment', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', ESH_ONLY);
    const raised = await raise(stamp(testInfo.project.name), {
      risk: 'high',
      kind: 'photograph',
    });
    await signIn(page, 'izzul@tamco.local');
    await openFinding(page, raised.findingId);

    await page.getByRole('button', { name: 'More actions for this finding' }).click();
    await page.getByRole('button', { name: 'Change what is accepted' }).click();
    await page.getByLabel('Kind of evidence').selectOption('functional_test');
    await page.getByRole('button', { name: 'Change what is accepted' }).last().click();

    await expect(page.getByText('Evidence kind changed.')).toBeVisible({ timeout: 20_000 });
    const { data } = await service()
      .from('esh_finding_actions')
      .select('evidence_kind')
      .eq('id', raised.actionId)
      .single();
    expect(data!.evidence_kind, 'a photograph cannot show an interlock works').toBe(
      'functional_test',
    );
  });

  test('significant work with no check booked says so', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', ESH_ONLY);
    const raised = await raise(stamp(testInfo.project.name), { risk: 'critical' });
    await service()
      .from('esh_finding_actions')
      .update({ state: 'accepted', accepted_at: new Date().toISOString() })
      .eq('id', raised.actionId);

    await signIn(page, 'izzul@tamco.local');
    await openFinding(page, raised.findingId);

    /*
     * Scheduling is entirely manual, so on the findings where it matters most
     * it is the thing most likely to be forgotten. The prompt is the only
     * reason one ever gets booked.
     */
    await expect(page.locator('.esh-interim[data-state="check-none"]')).toContainText(
      /nobody is going back to check/i,
    );
  });

  test('unassessed findings are a list, not only a number', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop', ESH_ONLY);
    await raise(stamp(testInfo.project.name), { risk: 'not_assessed' });
    await signIn(page, 'izzul@tamco.local');
    await page.goto('/findings/register?filter=unassessed');
    await expect(page.locator('html')).toHaveAttribute('data-app-hydrated', 'true');

    // Scoped to the view chips: the rows carry the words "Not assessed" too,
    // which is the point of the view and not a second navigation control.
    await expect(
      page.getByRole('navigation', { name: 'Register views' }).getByRole('link', {
        name: 'Not assessed',
      }),
    ).toBeVisible();
    await expect(page.locator('.esh-register-row').first()).toBeVisible();

    // Every row in this view is waiting for somebody to grade it.
    const risks = await page.locator('.esh-register-row').allInnerTexts();
    expect(risks.length).toBeGreaterThan(0);
    for (const row of risks) {
      expect(row, 'a graded finding is in the unassessed list').toMatch(/Not assessed/i);
    }
  });
});
