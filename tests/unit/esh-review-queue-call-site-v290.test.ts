import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v290 — the review queue's two reads, held to the rule its own counter keeps.
 *
 * `countAwaitingVerification` has refused to answer a failed read with zero
 * since it was written, and says so in a comment: a count claiming nothing is
 * awaiting verification when it does not know is the lie v282 and v283 closed
 * on the access read and the finding detail.
 *
 * The list beside it did exactly that. `listVerificationQueue` returned an
 * empty array when the submissions read failed, and the page renders an empty
 * array as "Nothing is waiting for verification" — corrections sitting
 * unreviewed while the screen says there is nothing to review. Its second
 * read, the one that turns submissions into register rows, did not look at
 * `error` at all, so a failure there dropped every row and left nothing in the
 * log either.
 *
 * Both are asked here in the shape `esh-access-call-site-v284` established:
 * a database that answers with an error, and the reader asked what it does
 * about it.
 */

const state = vi.hoisted(() => ({
  submissions: vi.fn(),
  registerRows: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({
    from: (table: string) => {
      if (table === 'esh_action_submissions') {
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          limit: async () => state.submissions(),
        };
        return builder;
      }
      if (table === 'esh_action_register_rows') {
        const builder = {
          select: () => builder,
          in: () => builder,
          eq: () => builder,
          is: () => builder,
          then: (resolve: (value: unknown) => unknown) => resolve(state.registerRows()),
        };
        return builder;
      }
      throw new Error(`unexpected read of ${table}`);
    },
  }),
}));

import { listVerificationQueue } from '@/server/esh/queries';

/** What PostgREST hands back when the gateway, not the query, is the problem. */
const UPSTREAM_502 = {
  code: 'PGRST000',
  message: 'An invalid response was received from the upstream server',
};

const ONE_SUBMISSION = {
  data: [
    {
      id: 's1',
      action_id: 'a1',
      version: 1,
      submitted_at: '2026-11-01T08:00:00Z',
      owner_email: 'owner@example.com',
      evidence_asset_ids: [],
    },
  ],
  error: null,
};

beforeEach(() => {
  state.submissions.mockReset();
  state.registerRows.mockReset();
  // The console.error is the production behaviour under test, not noise.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v290 a review queue that could not be read says so', () => {
  it('refuses when the submissions read fails, rather than reporting an empty queue', async () => {
    state.submissions.mockResolvedValue({ data: null, error: UPSTREAM_502 });
    await expect(listVerificationQueue()).rejects.toThrow(
      /The review queue could not be read: PGRST000/,
    );
  });

  it('refuses when the row read behind it fails, which used to drop every row in silence', async () => {
    state.submissions.mockResolvedValue(ONE_SUBMISSION);
    state.registerRows.mockReturnValue({ data: null, error: UPSTREAM_502 });
    await expect(listVerificationQueue()).rejects.toThrow(
      /The review queue could not be read: PGRST000/,
    );
  });

  it('answers an empty queue when both reads succeed and there is genuinely nothing', async () => {
    state.submissions.mockResolvedValue({ data: [], error: null });
    await expect(listVerificationQueue()).resolves.toEqual([]);
  });

  it('carries a submission through when both reads answer', async () => {
    state.submissions.mockResolvedValue(ONE_SUBMISSION);
    state.registerRows.mockReturnValue({
      data: [
        {
          finding_id: 'f1',
          action_id: 'a1',
          reference: 'ESH-1',
          title: 'Trailing cable',
          location: 'BR2',
          department_name: 'Operations',
          priority: 'normal',
        },
      ],
      error: null,
    });
    const rows = await listVerificationQueue();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.reference).toBe('ESH-1');
  });
});
