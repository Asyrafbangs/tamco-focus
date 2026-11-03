import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v285 — the three reads that report a failure instead of throwing, and why.
 *
 * The v282/v283 rule is that a read that failed must not be reported as "there
 * is nothing here". Throwing is one way to keep it and the right one where the
 * missing data IS the screen's subject. It is the wrong one for a tile on a
 * screen whose other half still works: a dashboard RPC blinking should not
 * take Today's attention queue down with it.
 *
 * `queries.ts` already had the third answer and it is the house pattern for
 * list reads — `listRegister` returns `failed` and Today renders it as "The
 * queue could not be read", commented "A failed read is not an empty register
 * (§33.2)". These three now do the same, which is a smaller change than it
 * sounds: what they stop doing is collapsing three different answers into one
 * `null`.
 *
 * What was wrong before:
 *
 * - `getDashboard` — Today read `dashboard?.protection.unprotected ?? 0`, so a
 *   failed read announced no significant risks without verified protection and
 *   no overdue actions. The most reassuring sentence this screen can say, said
 *   on no evidence, directly above a panel that does admit when it cannot read.
 * - `getOperationalHealth` — `null` renders nothing, and nothing is how this
 *   panel says "all well". The one widget whose job is reporting trouble was
 *   quietest when it had least idea.
 * - `getRolloutStatus` — `null` is deliberately load-bearing in the safe
 *   direction elsewhere (unreadable rollout holds owner mail), but on the
 *   screen that administers the rollout it hid the mode, the counts and the
 *   control together.
 *
 * `getPublicDashboard` is asserted here too, unchanged on purpose.
 */

type Answer = { data: unknown; error: { code?: string; message: string } | null };

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502: Answer = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

const state = vi.hoisted(() => ({
  rpcs: new Map<string, unknown>(),
  calls: [] as string[],
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    rpc: async (name: string) => {
      state.calls.push(name);
      const queued = state.rpcs.get(name);
      if (Array.isArray(queued)) {
        return queued.length > 1 ? queued.shift() : queued[0];
      }
      return queued ?? { data: null, error: null };
    },
  }),
}));

import {
  getDashboard,
  getOperationalHealth,
  getPublicDashboard,
  getRolloutStatus,
} from '@/server/esh/queries';

/** Answers queued for one RPC, taken in order, the last one repeating. */
function answerRpc(name: string, ...answers: Answer[]) {
  state.rpcs.set(name, answers);
}

const FIGURES = {
  ok: true,
  as_of: '2026-11-03T02:00:00Z',
  open_findings: 14,
  overdue_actions: 3,
  awaiting_verification: 2,
  oldest_open_days: 91,
  open_by_risk: { high: 4 },
  protection: { unprotected: 4 },
  closure: { closed: 7, on_time: 5, late: 2, median_days: 11 },
  monthly: [],
  by_department: [],
};

beforeEach(() => {
  state.rpcs.clear();
  state.calls.length = 0;
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v285 getDashboard', () => {
  it('reports the failure rather than resolving to nothing in particular', async () => {
    answerRpc('esh_dashboard', UPSTREAM_502);

    await expect(getDashboard()).resolves.toEqual({ data: null, failed: true });
  });

  /*
   * The whole point, asserted on the figure that did the damage. `?? 0` on a
   * null dashboard is what made Today say nought unprotected significant
   * risks; `failed` is what lets it say it could not count them instead.
   */
  it('does not let a caller read a figure of nought out of a failed read', async () => {
    answerRpc('esh_dashboard', UPSTREAM_502);

    const dashboard = await getDashboard();

    expect(dashboard.failed, 'a failed read was not reported as failed').toBe(true);
    expect(dashboard.data?.protection.unprotected ?? 0).toBe(0);
    // Which is why the caller must branch on `failed` and not on `data`.
    expect(dashboard.failed ? null : (dashboard.data?.protection.unprotected ?? 0)).toBeNull();
  });

  // The retry is here for the reason it is on `getEshAccess`: a gateway 502
  // often does not survive being asked again, and Today meets the most load.
  it('asks a second time before giving up, and takes the answer when it arrives', async () => {
    answerRpc('esh_dashboard', UPSTREAM_502, { data: FIGURES, error: null });

    const dashboard = await getDashboard();

    expect(state.calls.filter((name) => name === 'esh_dashboard')).toHaveLength(2);
    expect(dashboard.failed).toBe(false);
    expect(dashboard.data?.protection.unprotected).toBe(4);
  });

  it('gives up after the second failure rather than asking indefinitely', async () => {
    answerRpc('esh_dashboard', UPSTREAM_502);

    await expect(getDashboard()).resolves.toEqual({ data: null, failed: true });
    expect(state.calls.filter((name) => name === 'esh_dashboard')).toHaveLength(2);
  });

  /*
   * Without this, every case above would pass on a function that reported
   * `failed: true` for everything — which would put a "could not be read"
   * notice on a healthy Today, every visit.
   */
  it('reports no failure when the read answers', async () => {
    answerRpc('esh_dashboard', { data: FIGURES, error: null });

    const dashboard = await getDashboard();

    expect(dashboard.failed).toBe(false);
    expect(dashboard.data?.openFindings).toBe(14);
    expect(dashboard.data?.overdueActions).toBe(3);
  });

  /*
   * The third answer, which used to be the same `null` as the other two: the
   * function itself declined. That is not a failed read, so no screen reports
   * it as one.
   */
  it('reports no failure when the function declines with ok: false', async () => {
    answerRpc('esh_dashboard', { data: { ok: false }, error: null });

    await expect(getDashboard()).resolves.toEqual({ data: null, failed: false });
  });
});

describe('v285 getOperationalHealth', () => {
  const HEALTHY = {
    ok: true,
    last_run_at: '2026-11-03T01:00:00Z',
    last_run_ok: true,
    hours_since_run: 1,
    queued: 0,
    failing: 0,
    held: 0,
    review_overdue: 0,
  };

  /*
   * The sharpest case of the three. This panel reports trouble and renders
   * nothing when there is none, so a failed read looked exactly like a system
   * with nothing to report.
   */
  it('reports the failure rather than going silent', async () => {
    answerRpc('esh_operational_health', UPSTREAM_502);

    await expect(getOperationalHealth()).resolves.toEqual({ data: null, failed: true });
  });

  it('reports no failure when the read answers', async () => {
    answerRpc('esh_operational_health', { data: HEALTHY, error: null });

    const health = await getOperationalHealth();

    expect(health.failed).toBe(false);
    expect(health.data?.lastRunOk).toBe(true);
  });

  it('reports no failure when the function declines with ok: false', async () => {
    answerRpc('esh_operational_health', { data: { ok: false }, error: null });

    await expect(getOperationalHealth()).resolves.toEqual({ data: null, failed: false });
  });
});

describe('v285 getRolloutStatus', () => {
  const RESTRICTED = {
    ok: true,
    mode: 'restricted',
    authorization_version: 2,
    contacts_total: 11,
    contacts_enabled: 4,
    contacts_revoked: 1,
    held: 6,
    held_releasable: 4,
  };

  it('reports the failure rather than resolving to nothing in particular', async () => {
    answerRpc('esh_rollout_status', UPSTREAM_502);

    await expect(getRolloutStatus()).resolves.toEqual({ data: null, failed: true });
  });

  /*
   * The caution worth keeping. The import review reads
   * `rollout.data?.mode === 'live' ? 'live' : 'held'`, so an unreadable
   * rollout still holds owner mail rather than sending it — a failed read must
   * not become `mode: 'live'` by any route.
   */
  it('never reports a mode it could not read, so owner mail stays held', async () => {
    answerRpc('esh_rollout_status', UPSTREAM_502);

    const rollout = await getRolloutStatus();

    expect(rollout.data?.mode).toBeUndefined();
    expect(rollout.data?.mode === 'live' ? 'live' : 'held').toBe('held');
  });

  /*
   * And the caution that was wrong. The administration screen decided who was
   * "waiting to be cleared" with `rollout?.mode !== 'live'`, which read a
   * failed read as restricted and put the list up on a guess. Known-restricted
   * is now the condition, and this is the fact it rests on.
   */
  it('does not let a failed read pass for a restricted rollout', async () => {
    answerRpc('esh_rollout_status', UPSTREAM_502);

    const rollout = await getRolloutStatus();

    expect(rollout.data?.mode === 'restricted').toBe(false);
    expect(rollout.failed).toBe(true);
  });

  it('reports no failure when the read answers', async () => {
    answerRpc('esh_rollout_status', { data: RESTRICTED, error: null });

    const rollout = await getRolloutStatus();

    expect(rollout.failed).toBe(false);
    expect(rollout.data?.mode).toBe('restricted');
    expect(rollout.data?.heldReleasable).toBe(4);
  });

  it('reports no failure when the function declines with ok: false', async () => {
    answerRpc('esh_rollout_status', { data: { ok: false }, error: null });

    await expect(getRolloutStatus()).resolves.toEqual({ data: null, failed: false });
  });
});

describe('v285 getPublicDashboard, left as it was on purpose', () => {
  /*
   * The one read in the file deliberately unchanged, asserted so that a later
   * pass through this module does not "finish the job" by changing it.
   *
   * `null` here is already reported honestly, in the page's own words: "These
   * figures are not available at the moment. Nothing is shown rather than
   * numbers that may be wrong." Neither alternative is an improvement —
   * throwing would put a framework error page on a public address, and the
   * page is revalidated every five minutes, so a throw would fail the
   * regeneration rather than any one visit.
   */
  it('still returns null on a failed read, rather than throwing', async () => {
    answerRpc('esh_public_dashboard', UPSTREAM_502);

    await expect(getPublicDashboard()).resolves.toBeNull();
  });

  it('still returns the figures when the read answers', async () => {
    answerRpc('esh_public_dashboard', { data: FIGURES, error: null });

    const data = await getPublicDashboard();

    expect(data?.openFindings).toBe(14);
    expect(data?.overdueActions).toBe(3);
  });
});
