import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v284 — the call sites, not just the helpers.
 *
 * v282 and v283 established the rule that a failed read must not be reported
 * as "no access" or as "this finding does not exist", and
 * `esh-access-answer-v282` and `esh-failed-read-v283` prove it on the helpers
 * that carry it: `accessFromAnswer` and `requireAnswer`.
 *
 * Nothing proved the readers still CALL them. `src/server/esh/access.ts` and
 * `src/server/esh/queries.ts` both begin `import 'server-only'`, which threw on
 * import under vitest, so the helpers had to be tested at one remove and the
 * wiring could not be tested at all. An edit that dropped a call — back to
 * `return NO_ESH_ACCESS`, back to `return null` — would have failed nothing.
 * `vitest.config.ts` now resolves `server-only` to a no-op for tests only, and
 * this file closes that gap for the access read: a database that answers with an
 * error, and `getEshAccess` asked what it does about it.
 *
 * `esh-finding-detail-call-site-v284` does the same for the finding read.

 */

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

vi.mock('next/navigation', () => ({ notFound: state.notFound }));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: state.rpc }),
}));

import { NO_ESH_ACCESS } from '@/domain/esh-findings';
import { getEshAccess, requireEshAccess } from '@/server/esh/access';

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502 = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

const ENABLED_COORDINATOR = {
  data: {
    enabled: true,
    preset: 'coordinator',
    scope_all: false,
    department_ids: ['f0c05100-0000-4000-a000-000000000001'],
    can_coordinate: true,
  },
  error: null,
};

beforeEach(() => {
  state.rpc.mockReset();
  state.notFound.mockClear();
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('v284 getEshAccess, when the access read fails', () => {
  it('throws rather than reporting no access', async () => {
    state.rpc.mockResolvedValue(UPSTREAM_502);

    await expect(getEshAccess()).rejects.toThrow(/could not be read/);
  });

  it('names the failure, so the cause reaches the reader and not only the log', async () => {
    state.rpc.mockResolvedValue(UPSTREAM_502);

    await expect(getEshAccess()).rejects.toThrow(/PGRST000.*upstream server/);
  });

  /*
   * The distinction is the whole point, so it is asserted directly rather than
   * left to be inferred from a rejection: whatever `getEshAccess` does with a
   * failed read, it must not be this.
   */
  it('does not resolve to NO_ESH_ACCESS', async () => {
    state.rpc.mockResolvedValue(UPSTREAM_502);

    const outcome = await getEshAccess().then(
      (access) => ({ resolved: access }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
    expect(outcome as unknown).not.toEqual({ resolved: NO_ESH_ACCESS });
  });

  /*
   * A route is where the damage was done: `requireEshAccess` turns no access
   * into `notFound()`, which is how an unreachable database came to tell a
   * coordinator the page does not exist.
   */
  it('does not reach notFound() from a route', async () => {
    state.rpc.mockResolvedValue(UPSTREAM_502);

    await expect(requireEshAccess('coordinate')).rejects.toThrow(/could not be read/);
    expect(state.notFound, 'a failed read 404ed the route').not.toHaveBeenCalled();
  });

  // The retry exists because a gateway 502 often does not survive being asked
  // again; it is the second failure that is reported.
  it('asks a second time before giving up, and takes the answer when it arrives', async () => {
    state.rpc.mockResolvedValueOnce(UPSTREAM_502).mockResolvedValueOnce(ENABLED_COORDINATOR);

    const access = await getEshAccess();

    expect(state.rpc).toHaveBeenCalledTimes(2);
    expect(access.enabled).toBe(true);
    expect(access.canCoordinate).toBe(true);
  });
});

describe('v284 getEshAccess, when the access read succeeds', () => {
  /*
   * Without this, every case above would still pass if `getEshAccess` threw
   * unconditionally. A read that SAYS no access is no access, and still 404s.
   */
  it('returns NO_ESH_ACCESS for an answer that says the module is off', async () => {
    state.rpc.mockResolvedValue({ data: { enabled: false }, error: null });

    await expect(getEshAccess()).resolves.toEqual(NO_ESH_ACCESS);
  });

  it('404s a route for a person whose access is genuinely off', async () => {
    state.rpc.mockResolvedValue({ data: { enabled: false }, error: null });

    await expect(requireEshAccess()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(state.notFound).toHaveBeenCalled();
  });
});
