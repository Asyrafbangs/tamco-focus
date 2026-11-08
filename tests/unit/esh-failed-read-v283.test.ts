import { describe, expect, it } from 'vitest';

import { readCapabilities, requireAnswer } from '@/domain/reads';

/**
 * v283 — "nothing" and "no answer" are different facts.
 *
 * `getFindingDetail` returned null both when a finding was genuinely absent and
 * when the read failed, and the detail page turns null into `notFound()`. A
 * gateway 502 therefore told the reader that a finding did not exist — on the
 * one screen in the module where that statement does the most damage, and in
 * exactly the way v282's access read did before it.
 */
describe('v283 a failed read is not an absent row', () => {
  it('throws when the read failed, naming what could not be read', () => {
    expect(() => requireAnswer({ message: 'upstream 502' }, 'The finding')).toThrow(
      /The finding could not be read: unknown upstream 502/,
    );
  });

  it('carries the code through, so the cause survives into the error', () => {
    expect(() =>
      requireAnswer({ code: 'PGRST301', message: 'JWT expired' }, 'The register'),
    ).toThrow(/PGRST301 JWT expired/);
  });

  it('says nothing at all when the read succeeded', () => {
    expect(() => requireAnswer(null, 'The finding')).not.toThrow();
  });
});

/**
 * v322 — the same fact, for the reads that decide what you may do.
 *
 * `getTaskDetail` and `getGoalDetail` took `capabilityResult.data ?? {}`, so a
 * read that failed produced a complete set of `false` capabilities. The task
 * drawer chooses its one primary action from them, which is how an owner
 * looking at her own Active work got a drawer with nothing in it she could do
 * and no error anywhere — `evidence-upload-v135` found no `Complete work`
 * button on mobile in the gate of 8 November 2026 while the same test passed
 * on desktop in the same run.
 *
 * A refusal and a failure are still different facts here. These tests hold
 * both halves: a successful read saying no is obeyed, a failed one is raised.
 */
describe('v322 a capability read insists on an answer', () => {
  it('raises rather than reporting a task you may do nothing with', async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      return { data: null, error: { code: '502', message: 'invalid upstream response' } };
    };

    /*
     * The reader is shown `error.message` as "Reference" by
     * `src/app/(app)/error.tsx` and asked to quote it, so it is the same
     * short greppable identifier as the eleven other failing reads in
     * `queries.ts` — not the upstream 502's own words, which go to the log.
     */
    await expect(
      readCapabilities<Record<string, unknown>>({
        read,
        source: 'getTaskDetail:capabilities',
        reference: 'TASK_CAPABILITIES_UNAVAILABLE',
      }),
    ).rejects.toThrow(/^TASK_CAPABILITIES_UNAVAILABLE$/);
    // Once, then once more. A gateway 502 usually does not survive being asked
    // again, and a third ask would only make a slow screen slower.
    expect(calls).toBe(2);
  });

  it('retries a failure that does not repeat, and returns the answer', async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      return calls === 1
        ? { data: null, error: { code: '502', message: 'invalid upstream response' } }
        : { data: { can_complete: true }, error: null };
    };

    await expect(
      readCapabilities<{ can_complete?: boolean }>({
        read,
        source: 'getTaskDetail:capabilities',
        reference: 'TASK_CAPABILITIES_UNAVAILABLE',
      }),
    ).resolves.toEqual({ can_complete: true });
    expect(calls).toBe(2);
  });

  it('obeys a successful read that says no', async () => {
    const read = async () => ({ data: { can_complete: false }, error: null });

    await expect(
      readCapabilities<{ can_complete?: boolean }>({
        read,
        source: 'getTaskDetail:capabilities',
        reference: 'TASK_CAPABILITIES_UNAVAILABLE',
      }),
    ).resolves.toEqual({ can_complete: false });
  });

  it('spends no second read when the caller already has the answer', async () => {
    let calls = 0;
    const read = async () => {
      calls += 1;
      return { data: { can_complete: true }, error: null };
    };

    // The screens read capabilities inside the same `Promise.all` as everything
    // else they need, so the first attempt is handed in. Re-reading here would
    // double every capability read in the product.
    await expect(
      readCapabilities<{ can_complete?: boolean }>({
        read,
        source: 'getTaskDetail:capabilities',
        reference: 'TASK_CAPABILITIES_UNAVAILABLE',
        first: { data: { can_complete: true }, error: null },
      }),
    ).resolves.toEqual({ can_complete: true });
    expect(calls).toBe(0);
  });
});
