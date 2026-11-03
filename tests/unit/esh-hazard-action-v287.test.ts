import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * v287 — what the classification action sends, and what it says back.
 *
 * The rules live in `esh_set_finding_hazard` and are proven against a real
 * database in `esh_hazard_classification_v287.test.sql`. Two things on this
 * side of the call are worth holding down anyway, because both fail quietly:
 *
 *   * An empty select is a *cleared* classification. If the action forwarded
 *     `''` instead of `null`, the procedure would refuse it as an unknown
 *     category and a coordinator withdrawing a judgement would be told their
 *     own screen's choice was invalid.
 *   * Every refusal the procedure can return has a sentence. A code that
 *     falls through to the generic message tells somebody "try again" about
 *     something trying again will never fix.
 */

const state = vi.hoisted(() => ({
  rpc: vi.fn(),
  revalidated: [] as string[],
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => state.revalidated.push(path),
}));
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServerClient: async () => ({ rpc: state.rpc }),
}));

import { setFindingHazard } from '@/server/esh/hazard-actions';

const FINDING = 'f0c05200-0000-4000-a000-000000000001';

beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockResolvedValue({ data: { ok: true }, error: null });
  state.revalidated = [];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('v287 what the action sends', () => {
  it('passes the chosen categories through unchanged', async () => {
    await setFindingHazard({ findingId: FINDING, primary: 'machinery', secondary: 'electrical' });

    expect(state.rpc).toHaveBeenCalledWith('esh_set_finding_hazard', {
      p_finding_id: FINDING,
      p_primary: 'machinery',
      p_secondary: 'electrical',
    });
  });

  // The withdrawal case. `''` would come back as `unknown_category`.
  it('sends null, not an empty string, when the classification is cleared', async () => {
    const result = await setFindingHazard({ findingId: FINDING, primary: '', secondary: '' });

    expect(result).toEqual({ ok: true });
    expect(state.rpc).toHaveBeenCalledWith('esh_set_finding_hazard', {
      p_finding_id: FINDING,
      p_primary: null,
      p_secondary: null,
    });
  });

  it('drops a secondary when the primary is cleared, rather than being refused for it', async () => {
    await setFindingHazard({ findingId: FINDING, primary: null, secondary: 'fire' });

    expect(state.rpc).toHaveBeenCalledWith('esh_set_finding_hazard', {
      p_finding_id: FINDING,
      p_primary: null,
      p_secondary: null,
    });
  });

  it('refuses a finding id that is not one, without asking the database', async () => {
    const result = await setFindingHazard({
      findingId: 'not-a-uuid',
      primary: 'fire',
      secondary: null,
    });

    expect(result.ok).toBe(false);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('refreshes the three screens the classification appears on', async () => {
    await setFindingHazard({ findingId: FINDING, primary: 'fire', secondary: null });

    expect(state.revalidated).toEqual([
      `/findings/${FINDING}`,
      '/findings/register',
      '/findings/patterns',
    ]);
  });

  it('refreshes nothing when the classification was refused', async () => {
    state.rpc.mockResolvedValue({ data: { ok: false, code: 'not_found' }, error: null });

    await setFindingHazard({ findingId: FINDING, primary: 'fire', secondary: null });

    expect(state.revalidated).toEqual([]);
  });
});

describe('v287 what the action says back', () => {
  const cases: Array<[string, RegExp]> = [
    ['not_permitted', /coordinator/i],
    ['not_found', /not one of those you cover/i],
    ['unknown_category', /no longer in use/i],
    ['same_category_twice', /different one/i],
    ['secondary_without_primary', /main category/i],
  ];

  for (const [code, expected] of cases) {
    it(`turns ${code} into something a person can act on`, async () => {
      state.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });

      const result = await setFindingHazard({
        findingId: FINDING,
        primary: 'machinery',
        secondary: null,
      });

      expect(result.ok).toBe(false);
      expect(result.ok === false && result.message).toMatch(expected);
    });
  }

  it('does not claim to know why when the call itself failed', async () => {
    state.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST000', message: 'upstream' } });

    const result = await setFindingHazard({
      findingId: FINDING,
      primary: 'machinery',
      secondary: null,
    });

    expect(result.ok === false && result.message).toMatch(/could not be saved/i);
  });
});
