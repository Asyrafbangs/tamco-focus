import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v284 — the finding read's call site, not just the helper.
 *
 * `esh-failed-read-v283` proves `requireAnswer` refuses to let a failed read
 * pass for an answer. Nothing proved `getFindingDetail` still calls it:
 * `src/server/esh/queries.ts` begins `import 'server-only'`, which threw on
 * import under vitest, so an edit back to `return null` on error would have
 * failed no test. `vitest.config.ts` resolves `server-only` to a no-op for
 * tests only, which is what lets this file ask the question from outside.
 *
 * What is at stake: the detail page turns null into `notFound()`. Returning
 * null for a read that failed is the page saying this finding does not exist,
 * on the one screen where that statement does the most damage.
 *
 * `esh-access-call-site-v284` does the same for the access read.
 */

const state = vi.hoisted(() => ({ findingRead: vi.fn() }));

/*
 * Only the `esh_findings` read is served. Both cases below leave
 * `getFindingDetail` before it asks for anything else — the failed read throws,
 * the absent finding returns null — so a builder that answers one query is the
 * whole surface, and a second query arriving here would be a change in
 * behaviour worth failing on.
 */
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      if (table !== 'esh_findings') {
        throw new Error(`unexpected read of ${table} after a finding read that did not answer`);
      }
      const builder = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => state.findingRead(),
      };
      return builder;
    },
  }),
}));

import { getFindingDetail } from '@/server/esh/queries';

const A_FINDING = 'f0c05200-0000-4000-a000-000000000001';

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const READ_FAILED = {
  data: null,
  error: { code: 'PGRST000', message: 'An invalid response was received from the upstream server' },
};

beforeEach(() => {
  state.findingRead.mockReset();
  // The console.error is the production behaviour under test, not noise to fix.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v284 getFindingDetail, when the finding read fails', () => {
  it('throws rather than reporting the finding does not exist', async () => {
    state.findingRead.mockReturnValue(READ_FAILED);

    await expect(getFindingDetail(A_FINDING)).rejects.toThrow(/could not be read/);
  });

  it('names the failure rather than leaving it in the log', async () => {
    state.findingRead.mockReturnValue(READ_FAILED);

    await expect(getFindingDetail(A_FINDING)).rejects.toThrow(/PGRST000.*upstream server/);
  });

  // Asserted directly rather than inferred from the rejection: whatever
  // `getFindingDetail` does with a failed read, it must not be this.
  it('does not resolve to null', async () => {
    state.findingRead.mockReturnValue(READ_FAILED);

    const outcome = await getFindingDetail(A_FINDING).then(
      (detail) => ({ resolved: detail }),
      () => null,
    );

    expect(outcome, 'a failed read resolved instead of throwing').toBeNull();
  });
});

describe('v284 getFindingDetail, when the finding read succeeds', () => {
  /*
   * Without this, the cases above would pass just as well if `getFindingDetail`
   * threw on everything. A finding that genuinely is not there — deleted, or
   * outside what RLS lets this person see — still returns null, and the page
   * still 404s. That is the behaviour v283 had to preserve.
   */
  it('returns null for a finding that genuinely is not there', async () => {
    state.findingRead.mockReturnValue({ data: null, error: null });

    await expect(getFindingDetail(A_FINDING)).resolves.toBeNull();
  });
});
